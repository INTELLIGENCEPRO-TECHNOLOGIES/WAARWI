/*
# Allocate negative balance adjustments to invoices (credit ventilation engine)

## Summary
Implements the credit ventilation engine for negative balance_adjustments (reports de solde negatifs).
When a customer has a negative balance_adjustment (credit positioning), this engine distributes
that credit to unpaid invoices WITHOUT modifying customers.balance. It creates sale_payments
marked with affects_balance = false (non-accounting justification lines) and credit_allocations
for traceability.

## Changes

### 1. New column: sale_payments.affects_balance (boolean, default true)
  - When false, the payment is a pure allocation/ventilation line
  - Visible in the ledger for justification but excluded from running balance calculation
  - Excludes from Debit/Credit totals

### 2. Backfill: mark existing avoir and prepayment allocation payments
  - Payments with source_return_id (avoir) → affects_balance = false
  - Payments with method_name starting with 'Acompte ·' → affects_balance = false

### 3. New function: _allocate_negative_adjustments_to_invoices(p_customer_id, p_tenant_id)
  - SECURITY DEFINER, no GRANT (internal only)
  - Finds negative balance_adjustments with unused credit (abs(amount) - amount_used > 0)
  - Iterates unpaid invoices FIFO
  - For each: inserts sale_payments (affects_balance = false), updates sales.paid/status,
    increments balance_adjustments.amount_used, creates credit_allocations
  - NEVER modifies customers.balance
  - NEVER creates cash movements
  - Idempotent via credit_allocations unique constraint

### 4. Modified function: set_customer_balance
  - After creating a negative adjustment, calls _allocate_negative_adjustments_to_invoices
    to immediately allocate the credit to existing unpaid invoices

### 5. Modified function: create_credit_sale (latest version)
  - After creating the sale, if negative adjustment credit exists, calls the allocator
    so the new invoice gets allocated immediately

### 6. Regularization for BABACAR MBOW
  - Runs the allocator for all customers with unused negative adjustments and unpaid invoices

## Security
  - _allocate_negative_adjustments_to_invoices: REVOKE ALL FROM PUBLIC/anon/authenticated
  - set_customer_balance: existing GRANT unchanged
  - sale_payments.affects_balance: no policy change needed (existing policies apply)

## Important Notes
  - customers.balance is NEVER modified by the allocation engine
  - The allocation is purely a ventilation: it proves which invoices are covered
  - Running balance in the ledger must skip rows where affects_balance = false
*/

-- ============================================================
-- 1. Add affects_balance column to sale_payments
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sale_payments' AND column_name = 'affects_balance'
  ) THEN
    ALTER TABLE public.sale_payments ADD COLUMN affects_balance boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- ============================================================
-- 2. Backfill: mark existing allocation payments as non-balance-affecting
-- ============================================================
UPDATE public.sale_payments
SET affects_balance = false
WHERE affects_balance = true
  AND (
    source_return_id IS NOT NULL
    OR (method_name LIKE 'Acompte · %' AND cash_session_id IS NULL)
  );

-- ============================================================
-- 3. Internal function: allocate negative adjustments to invoices
-- ============================================================
CREATE OR REPLACE FUNCTION public._allocate_negative_adjustments_to_invoices(
  p_customer_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adj record;
  v_sale record;
  v_available numeric;
  v_due numeric;
  v_to_apply numeric;
  v_total_applied numeric := 0;
  v_applied_details jsonb := '[]'::jsonb;
  v_existing boolean;
BEGIN
  -- Lock customer row to prevent concurrent race
  PERFORM 1 FROM public.customers
  WHERE id = p_customer_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  -- Iterate negative balance_adjustments with unused credit (FIFO)
  FOR v_adj IN
    SELECT ba.* FROM public.balance_adjustments ba
    WHERE ba.tenant_id = p_tenant_id
      AND ba.entity_type = 'customer'
      AND ba.entity_id = p_customer_id
      AND ba.amount < 0
      AND (abs(ba.amount) - COALESCE(ba.amount_used, 0)) > 0
    ORDER BY ba.created_at ASC
    FOR UPDATE
  LOOP
    v_available := abs(v_adj.amount) - COALESCE(v_adj.amount_used, 0);
    IF v_available <= 0 THEN CONTINUE; END IF;

    -- Apply to unpaid invoices (FIFO by creation date)
    FOR v_sale IN
      SELECT s.* FROM public.sales s
      WHERE s.tenant_id = p_tenant_id
        AND s.customer_id = p_customer_id
        AND s.status IN ('unpaid', 'partial')
        AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
      ORDER BY s.created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_available <= 0;

      -- Check idempotence: skip if already allocated this source to this target
      SELECT EXISTS(
        SELECT 1 FROM public.credit_allocations
        WHERE source_id = v_adj.id AND target_id = v_sale.id
          AND source_type = 'negative_adjustment' AND target_type = 'invoice'
      ) INTO v_existing;
      IF v_existing THEN CONTINUE; END IF;

      v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
      IF v_due <= 0 THEN CONTINUE; END IF;

      v_to_apply := LEAST(v_available, v_due);

      -- Create sale_payment (justification line, does NOT affect balance)
      INSERT INTO public.sale_payments (
        tenant_id, sale_id, payment_method_id, method_name, amount, reference,
        affects_balance
      ) VALUES (
        p_tenant_id, v_sale.id, NULL,
        'Règlement par solde créditeur', v_to_apply,
        COALESCE(v_adj.note, 'Report de solde'),
        false
      );

      -- Update invoice paid amount and status
      UPDATE public.sales
      SET paid = COALESCE(paid, 0) + v_to_apply,
          status = CASE
            WHEN COALESCE(paid, 0) + v_to_apply >= total THEN 'paid'
            ELSE 'partial'
          END
      WHERE id = v_sale.id;

      -- Increment amount_used on the source adjustment
      UPDATE public.balance_adjustments
      SET amount_used = COALESCE(amount_used, 0) + v_to_apply
      WHERE id = v_adj.id;

      -- Record allocation for traceability
      INSERT INTO public.credit_allocations (
        tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
      ) VALUES (
        p_tenant_id, p_customer_id, 'negative_adjustment', v_adj.id, 'invoice', v_sale.id, v_to_apply
      )
      ON CONFLICT ON CONSTRAINT uq_credit_allocation_source_target
      DO UPDATE SET amount = public.credit_allocations.amount + EXCLUDED.amount;

      v_available := v_available - v_to_apply;
      v_total_applied := v_total_applied + v_to_apply;
      v_applied_details := v_applied_details || jsonb_build_object(
        'sale_id', v_sale.id, 'adjustment_id', v_adj.id, 'amount', v_to_apply
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'total_applied', v_total_applied,
    'details', v_applied_details
  );
END;
$$;

-- Lock down internal function
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM authenticated;

-- ============================================================
-- 4. Update set_customer_balance to call allocator after negative adjustments
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_customer_balance(
  p_customer_id uuid,
  p_target_balance numeric,
  p_note text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_current_balance numeric;
  v_delta numeric;
  v_adj_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;

  -- Lock customer and read current balance
  SELECT balance INTO v_current_balance
  FROM public.customers
  WHERE id = p_customer_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'Client introuvable ou accès refusé';
  END IF;

  v_delta := p_target_balance - v_current_balance;
  IF v_delta = 0 THEN RETURN NULL; END IF;

  -- Create balance adjustment with the computed delta
  INSERT INTO public.balance_adjustments (
    id, tenant_id, entity_type, entity_id,
    previous_balance, new_balance, amount, note, kind, user_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'customer', p_customer_id,
    v_current_balance, p_target_balance, v_delta,
    COALESCE(p_note, ''), 'manual', auth.uid()
  ) RETURNING id INTO v_adj_id;

  -- Update balance atomically
  UPDATE public.customers
  SET balance = p_target_balance
  WHERE id = p_customer_id AND tenant_id = v_tenant_id;

  -- If the adjustment creates credit (negative delta), allocate to unpaid invoices
  IF v_delta < 0 THEN
    PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, v_tenant_id);
  END IF;

  -- Also run avoir allocations in case there are pending avoirs
  PERFORM public._apply_avoirs_internal(p_customer_id, v_tenant_id);

  RETURN v_adj_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_balance(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_customer_balance(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_customer_balance(uuid, numeric, text) TO authenticated;

-- ============================================================
-- 5. Update _apply_avoirs_internal: mark its sale_payments with affects_balance = false
-- ============================================================
CREATE OR REPLACE FUNCTION public._apply_avoirs_internal(
  p_customer_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credit record;
  v_sale record;
  v_adj record;
  v_available numeric;
  v_due numeric;
  v_to_apply numeric;
  v_total_applied numeric := 0;
  v_applied_details jsonb := '[]'::jsonb;
  v_origin_sale_id uuid;
  v_existing boolean;
  v_adj_remaining numeric;
BEGIN
  -- Lock customer row to prevent concurrent race
  PERFORM 1 FROM public.customers
  WHERE id = p_customer_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  -- Iterate eligible avoirs for this customer (FIFO)
  FOR v_credit IN
    SELECT sr.* FROM public.sale_returns sr
    WHERE sr.tenant_id = p_tenant_id
      AND sr.customer_id = p_customer_id
      AND sr.refund_method = 'avoir'
      AND sr.status = 'approved'
      AND (COALESCE(sr.total, 0) - COALESCE(sr.credit_used, 0)) > 0
    ORDER BY sr.created_at ASC
    FOR UPDATE
  LOOP
    v_available := COALESCE(v_credit.total, 0) - COALESCE(v_credit.credit_used, 0);
    IF v_available <= 0 THEN CONTINUE; END IF;

    -- Priority 1: Apply to originating invoice
    v_origin_sale_id := v_credit.sale_id;
    IF v_origin_sale_id IS NOT NULL AND v_available > 0 THEN
      SELECT * INTO v_sale FROM public.sales
      WHERE id = v_origin_sale_id AND tenant_id = p_tenant_id AND status <> 'cancelled'
      FOR UPDATE;

      IF v_sale.id IS NOT NULL THEN
        v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
        IF v_due > 0 THEN
          SELECT EXISTS(
            SELECT 1 FROM public.sale_payments
            WHERE source_return_id = v_credit.id AND sale_id = v_origin_sale_id
          ) INTO v_existing;

          IF NOT v_existing THEN
            v_to_apply := LEAST(v_available, v_due);

            INSERT INTO public.sale_payments (
              tenant_id, sale_id, payment_method_id, method_name, amount, reference,
              source_return_id, affects_balance
            ) VALUES (
              p_tenant_id, v_origin_sale_id, NULL,
              'Avoir ' || v_credit.return_number, v_to_apply,
              v_credit.return_number, v_credit.id, false
            );

            UPDATE public.sales
            SET paid = COALESCE(paid, 0) + v_to_apply,
                status = CASE
                  WHEN status = 'cancelled' THEN 'cancelled'
                  WHEN COALESCE(paid, 0) + v_to_apply >= total THEN 'paid'
                  ELSE 'partial'
                END
            WHERE id = v_origin_sale_id;

            UPDATE public.sale_returns
            SET credit_used = COALESCE(credit_used, 0) + v_to_apply
            WHERE id = v_credit.id;

            INSERT INTO public.credit_allocations (
              tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
            ) VALUES (
              p_tenant_id, p_customer_id, 'avoir', v_credit.id, 'invoice', v_origin_sale_id, v_to_apply
            )
            ON CONFLICT ON CONSTRAINT uq_credit_allocation_source_target
            DO UPDATE SET amount = public.credit_allocations.amount + EXCLUDED.amount;

            v_available := v_available - v_to_apply;
            v_total_applied := v_total_applied + v_to_apply;
            v_applied_details := v_applied_details || jsonb_build_object(
              'sale_id', v_origin_sale_id, 'return_id', v_credit.id, 'amount', v_to_apply, 'target', 'invoice'
            );
          END IF;
        END IF;
      END IF;
    END IF;

    -- Priority 2: Apply remaining to other unpaid invoices (FIFO)
    IF v_available > 0 THEN
      FOR v_sale IN
        SELECT s.* FROM public.sales s
        WHERE s.tenant_id = p_tenant_id
          AND s.customer_id = p_customer_id
          AND s.status <> 'cancelled'
          AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
          AND s.id <> COALESCE(v_origin_sale_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY s.created_at ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_available <= 0;

        SELECT EXISTS(
          SELECT 1 FROM public.sale_payments
          WHERE source_return_id = v_credit.id AND sale_id = v_sale.id
        ) INTO v_existing;
        IF v_existing THEN CONTINUE; END IF;

        v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
        IF v_due <= 0 THEN CONTINUE; END IF;

        v_to_apply := LEAST(v_available, v_due);

        INSERT INTO public.sale_payments (
          tenant_id, sale_id, payment_method_id, method_name, amount, reference,
          source_return_id, affects_balance
        ) VALUES (
          p_tenant_id, v_sale.id, NULL,
          'Avoir ' || v_credit.return_number, v_to_apply,
          v_credit.return_number, v_credit.id, false
        );

        UPDATE public.sales
        SET paid = COALESCE(paid, 0) + v_to_apply,
            status = CASE
              WHEN status = 'cancelled' THEN 'cancelled'
              WHEN COALESCE(paid, 0) + v_to_apply >= total THEN 'paid'
              ELSE 'partial'
            END
        WHERE id = v_sale.id;

        UPDATE public.sale_returns
        SET credit_used = COALESCE(credit_used, 0) + v_to_apply
        WHERE id = v_credit.id;

        INSERT INTO public.credit_allocations (
          tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
        ) VALUES (
          p_tenant_id, p_customer_id, 'avoir', v_credit.id, 'invoice', v_sale.id, v_to_apply
        )
        ON CONFLICT ON CONSTRAINT uq_credit_allocation_source_target
        DO UPDATE SET amount = public.credit_allocations.amount + EXCLUDED.amount;

        v_available := v_available - v_to_apply;
        v_total_applied := v_total_applied + v_to_apply;
        v_applied_details := v_applied_details || jsonb_build_object(
          'sale_id', v_sale.id, 'return_id', v_credit.id, 'amount', v_to_apply, 'target', 'invoice'
        );
      END LOOP;
    END IF;

    -- Priority 3: Apply remaining to positive balance_adjustments
    IF v_available > 0 THEN
      FOR v_adj IN
        SELECT ba.* FROM public.balance_adjustments ba
        WHERE ba.tenant_id = p_tenant_id
          AND ba.entity_type = 'customer'
          AND ba.entity_id = p_customer_id
          AND ba.amount > 0
          AND (ba.amount - COALESCE(ba.amount_used, 0)) > 0
        ORDER BY ba.created_at ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_available <= 0;

        v_adj_remaining := v_adj.amount - COALESCE(v_adj.amount_used, 0);
        IF v_adj_remaining <= 0 THEN CONTINUE; END IF;

        v_to_apply := LEAST(v_available, v_adj_remaining);

        UPDATE public.balance_adjustments
        SET amount_used = COALESCE(amount_used, 0) + v_to_apply
        WHERE id = v_adj.id;

        UPDATE public.sale_returns
        SET credit_used = COALESCE(credit_used, 0) + v_to_apply
        WHERE id = v_credit.id;

        INSERT INTO public.credit_allocations (
          tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
        ) VALUES (
          p_tenant_id, p_customer_id, 'avoir', v_credit.id, 'adjustment', v_adj.id, v_to_apply
        )
        ON CONFLICT ON CONSTRAINT uq_credit_allocation_source_target
        DO UPDATE SET amount = public.credit_allocations.amount + EXCLUDED.amount;

        v_available := v_available - v_to_apply;
        v_total_applied := v_total_applied + v_to_apply;
        v_applied_details := v_applied_details || jsonb_build_object(
          'adjustment_id', v_adj.id, 'return_id', v_credit.id, 'amount', v_to_apply, 'target', 'adjustment'
        );
      END LOOP;
    END IF;
  END LOOP;

  -- Also allocate negative adjustments (the new engine)
  PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, p_tenant_id);

  RETURN jsonb_build_object(
    'total_applied', v_total_applied,
    'details', v_applied_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM authenticated;

-- ============================================================
-- 6. Update apply_customer_prepayments to set affects_balance = false
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_customer_prepayments(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_prepay record;
  v_sale record;
  v_available numeric;
  v_due numeric;
  v_take numeric;
  v_new_paid numeric;
  v_new_status text;
  v_applied numeric := 0;
  v_method text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;
  IF p_customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;

  FOR v_prepay IN
    SELECT * FROM public.customer_prepayments
     WHERE tenant_id = v_tenant_id
       AND customer_id = p_customer_id
       AND amount_used < amount
     ORDER BY created_at ASC
     FOR UPDATE
  LOOP
    v_available := v_prepay.amount - v_prepay.amount_used;
    EXIT WHEN v_available <= 0;

    FOR v_sale IN
      SELECT * FROM public.sales
       WHERE tenant_id = v_tenant_id
         AND customer_id = p_customer_id
         AND status <> 'cancelled'
         AND COALESCE(paid, 0) < COALESCE(total, 0)
       ORDER BY created_at ASC
       FOR UPDATE
    LOOP
      v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
      v_take := LEAST(v_available, v_due);
      IF v_take <= 0 THEN CONTINUE; END IF;

      v_method := COALESCE(NULLIF(v_prepay.method_name, ''), 'Acompte client');

      INSERT INTO public.sale_payments (
        tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference,
        affects_balance
      ) VALUES (
        v_tenant_id, v_sale.id, NULL, v_prepay.payment_method_id,
        'Acompte · ' || v_method, v_take,
        COALESCE(NULLIF(v_prepay.reference, ''), 'Acompte client du ' || to_char(v_prepay.created_at, 'DD/MM/YYYY')),
        false
      );

      v_new_paid := COALESCE(v_sale.paid, 0) + v_take;
      v_new_status := CASE
        WHEN v_new_paid >= v_sale.total THEN 'paid'
        WHEN v_new_paid > 0 THEN 'partial'
        ELSE v_sale.status
      END;

      UPDATE public.sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

      UPDATE public.customer_prepayments
         SET amount_used = amount_used + v_take
       WHERE id = v_prepay.id;

      -- Record allocation for traceability
      INSERT INTO public.credit_allocations (
        tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
      ) VALUES (
        v_tenant_id, p_customer_id, 'prepay', v_prepay.id, 'invoice', v_sale.id, v_take
      )
      ON CONFLICT ON CONSTRAINT uq_credit_allocation_source_target
      DO UPDATE SET amount = public.credit_allocations.amount + EXCLUDED.amount;

      v_available := v_available - v_take;
      v_applied := v_applied + v_take;
      EXIT WHEN v_available <= 0;
    END LOOP;
  END LOOP;

  -- Also allocate any negative adjustments
  PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, v_tenant_id);

  RETURN jsonb_build_object('applied', v_applied);
END;
$$;

-- ============================================================
-- 7. Regularization: allocate all pending negative adjustments
-- ============================================================
DO $$
DECLARE
  v_cust record;
BEGIN
  FOR v_cust IN
    SELECT DISTINCT ba.entity_id AS customer_id, ba.tenant_id
    FROM public.balance_adjustments ba
    WHERE ba.entity_type = 'customer'
      AND ba.amount < 0
      AND (abs(ba.amount) - COALESCE(ba.amount_used, 0)) > 0
      AND EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.tenant_id = ba.tenant_id
          AND s.customer_id = ba.entity_id
          AND s.status IN ('unpaid', 'partial')
          AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
      )
  LOOP
    PERFORM public._allocate_negative_adjustments_to_invoices(v_cust.customer_id, v_cust.tenant_id);
  END LOOP;
END $$;
