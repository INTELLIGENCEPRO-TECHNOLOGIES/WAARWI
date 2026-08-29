/*
# Atomic auto-application of customer avoirs (credit notes) to unpaid invoices

## Summary
Replaces the old non-atomic `auto_apply_customer_avoirs` (which only applied avoirs
to a single new sale and was called client-side) with a robust server-side system
that imputates avoirs to ALL unpaid invoices of a customer, prioritizing the
originating invoice.

## Changes

### 1. New column: sale_payments.source_return_id
  - Nullable FK to sale_returns(id)
  - Identifies payments that are avoir imputations (more reliable than method_name text)
  - Unique partial index on (source_return_id, sale_id) WHERE source_return_id IS NOT NULL
    prevents duplicate imputations of the same avoir on the same invoice

### 2. New private function: _apply_avoirs_internal(p_customer_id, p_tenant_id)
  - SECURITY DEFINER, no GRANT to any role (callable only from other DEFINER functions)
  - Receives tenant_id explicitly (works during migrations where current_tenant_id() is NULL)
  - Locks customer, avoirs, and sales FOR UPDATE in stable order
  - Priority: originating invoice first, then FIFO on remaining unpaid invoices
  - For each imputation: inserts sale_payments, updates sales.paid/status, decrements customers.balance
  - No cash_movement created (avoir is not a cash event)
  - Idempotent via unique partial index check before each insert

### 3. New public function: apply_avoirs_to_customer_sales(p_customer_id)
  - SECURITY DEFINER, GRANT EXECUTE TO authenticated only
  - Validates current_tenant_id(), verifies customer belongs to tenant
  - Delegates to _apply_avoirs_internal

### 4. Modified function: process_sale_return
  - New parameter: p_refund_method text DEFAULT NULL
  - When 'avoir': sets refund_method='avoir' and calls _apply_avoirs_internal at the end
  - Existing behavior (p_refund_now=true → cash) unchanged
  - DROP + CREATE to avoid ambiguous overload

### 5. Backfill: link old avoir payments to their source returns
  - Matches existing sale_payments with method_name LIKE 'Avoir %' to the corresponding
    sale_returns via return_number, and sets source_return_id

### 6. Regularization: apply all pending avoirs to unpaid invoices
  - Iterates all customers with eligible avoirs (approved, refund_method='avoir', credit_used < total)
  - Calls _apply_avoirs_internal for each customer
  - Fixes AMADOU GUENE and all similar cases immediately

## Security
  - _apply_avoirs_internal: REVOKE ALL FROM PUBLIC, anon; no direct GRANT
  - apply_avoirs_to_customer_sales: REVOKE ALL FROM PUBLIC, anon; GRANT TO authenticated
  - process_sale_return: GRANT TO authenticated (re-applied after DROP+CREATE)
  - All functions use SET search_path = public
  - Multi-tenant isolation via explicit tenant_id checks on every row
*/

-- ============================================================
-- 1. Add source_return_id column to sale_payments
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'sale_payments' AND column_name = 'source_return_id'
  ) THEN
    ALTER TABLE public.sale_payments ADD COLUMN source_return_id uuid REFERENCES public.sale_returns(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Unique partial index: one avoir can be applied to many invoices, but not twice to the same one
CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_payments_source_return_sale
  ON public.sale_payments (source_return_id, sale_id)
  WHERE source_return_id IS NOT NULL;

-- ============================================================
-- 2. Internal function (no public access)
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
  v_available numeric;
  v_remaining numeric;
  v_due numeric;
  v_to_apply numeric;
  v_total_applied numeric := 0;
  v_applied_details jsonb := '[]'::jsonb;
  v_origin_sale_id uuid;
  v_origin_due numeric;
  v_existing boolean;
BEGIN
  -- Lock customer row to prevent concurrent payment race
  PERFORM 1 FROM public.customers
  WHERE id = p_customer_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  -- Iterate eligible avoirs for this customer
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

    -- Priority 1: Apply to originating invoice (the sale that generated this return)
    v_origin_sale_id := v_credit.sale_id;
    IF v_origin_sale_id IS NOT NULL THEN
      SELECT * INTO v_sale FROM public.sales
      WHERE id = v_origin_sale_id AND tenant_id = p_tenant_id AND status <> 'cancelled'
      FOR UPDATE;

      IF v_sale.id IS NOT NULL THEN
        v_origin_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
        IF v_origin_due > 0 THEN
          -- Check no duplicate
          SELECT EXISTS(
            SELECT 1 FROM public.sale_payments
            WHERE source_return_id = v_credit.id AND sale_id = v_origin_sale_id
          ) INTO v_existing;

          IF NOT v_existing THEN
            v_to_apply := LEAST(v_available, v_origin_due);

            INSERT INTO public.sale_payments (
              tenant_id, sale_id, payment_method_id, method_name, amount, reference, source_return_id
            ) VALUES (
              p_tenant_id, v_origin_sale_id, NULL,
              'Avoir ' || v_credit.return_number, v_to_apply,
              v_credit.return_number, v_credit.id
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

            UPDATE public.customers
            SET balance = COALESCE(balance, 0) - v_to_apply
            WHERE id = p_customer_id;

            v_available := v_available - v_to_apply;
            v_total_applied := v_total_applied + v_to_apply;
            v_applied_details := v_applied_details || jsonb_build_object(
              'sale_id', v_origin_sale_id, 'return_id', v_credit.id, 'amount', v_to_apply
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

        -- Re-check duplicate
        SELECT EXISTS(
          SELECT 1 FROM public.sale_payments
          WHERE source_return_id = v_credit.id AND sale_id = v_sale.id
        ) INTO v_existing;
        IF v_existing THEN CONTINUE; END IF;

        v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
        IF v_due <= 0 THEN CONTINUE; END IF;

        v_to_apply := LEAST(v_available, v_due);

        INSERT INTO public.sale_payments (
          tenant_id, sale_id, payment_method_id, method_name, amount, reference, source_return_id
        ) VALUES (
          p_tenant_id, v_sale.id, NULL,
          'Avoir ' || v_credit.return_number, v_to_apply,
          v_credit.return_number, v_credit.id
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

        UPDATE public.customers
        SET balance = COALESCE(balance, 0) - v_to_apply
        WHERE id = p_customer_id;

        v_available := v_available - v_to_apply;
        v_total_applied := v_total_applied + v_to_apply;
        v_applied_details := v_applied_details || jsonb_build_object(
          'sale_id', v_sale.id, 'return_id', v_credit.id, 'amount', v_to_apply
        );
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'total_applied', v_total_applied,
    'details', v_applied_details
  );
END;
$$;

-- Lock down internal function: no public access
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM authenticated;

-- ============================================================
-- 3. Public wrapper function
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_avoirs_to_customer_sales(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_cust_tenant uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;

  -- Verify customer belongs to this tenant
  SELECT tenant_id INTO v_cust_tenant FROM public.customers WHERE id = p_customer_id;
  IF v_cust_tenant IS NULL OR v_cust_tenant <> v_tenant_id THEN
    RAISE EXCEPTION 'Client introuvable ou accès refusé';
  END IF;

  RETURN public._apply_avoirs_internal(p_customer_id, v_tenant_id);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_avoirs_to_customer_sales(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_avoirs_to_customer_sales(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_avoirs_to_customer_sales(uuid) TO authenticated;

-- ============================================================
-- 4. Replace process_sale_return with p_refund_method parameter
-- ============================================================
DROP FUNCTION IF EXISTS public.process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text);

CREATE OR REPLACE FUNCTION public.process_sale_return(
  p_sale_id uuid,
  p_site_id uuid,
  p_cash_session_id uuid,
  p_items jsonb,
  p_reason text DEFAULT 'Retour au POS',
  p_refund_now boolean DEFAULT true,
  p_restock boolean DEFAULT true,
  p_request_id text DEFAULT NULL,
  p_refund_method text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale record;
  v_session record;
  v_site record;
  v_item jsonb;
  v_si record;
  v_already_returned numeric;
  v_remaining numeric;
  v_req_qty numeric;
  v_return_total numeric := 0;
  v_return_id uuid;
  v_return_number text;
  v_article_names text[] := '{}';
  v_prev_stock numeric;
  v_new_stock numeric;
  v_track boolean;
  v_existing_return_id uuid;
  v_effective_method text;
BEGIN
  -- 0. Auth
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  -- Determine effective refund method
  IF p_refund_method = 'avoir' THEN
    v_effective_method := 'avoir';
  ELSIF p_refund_now THEN
    v_effective_method := 'cash';
  ELSE
    v_effective_method := 'none';
  END IF;

  -- 1. Idempotency check
  IF p_request_id IS NOT NULL THEN
    SELECT id INTO v_existing_return_id
    FROM public.sale_returns
    WHERE tenant_id = v_tenant_id AND request_id = p_request_id;

    IF v_existing_return_id IS NOT NULL THEN
      RETURN (
        SELECT jsonb_build_object(
          'success', true,
          'return_id', sr.id,
          'return_number', sr.return_number,
          'total', sr.total,
          'refunded', sr.refunded_at IS NOT NULL,
          'idempotent', true
        )
        FROM public.sale_returns sr WHERE sr.id = v_existing_return_id
      );
    END IF;
  END IF;

  -- 2. Validate sale
  SELECT * INTO v_sale FROM public.sales
  WHERE id = p_sale_id AND tenant_id = v_tenant_id;
  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Vente introuvable ou accès refusé';
  END IF;
  IF v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'Impossible de retourner une vente annulée';
  END IF;

  -- 3. Validate site
  SELECT * INTO v_site FROM public.sites
  WHERE id = p_site_id AND tenant_id = v_tenant_id;
  IF v_site.id IS NULL THEN
    RAISE EXCEPTION 'Site introuvable ou accès refusé';
  END IF;

  -- 4. Validate cash session
  SELECT * INTO v_session FROM public.cash_sessions
  WHERE id = p_cash_session_id AND tenant_id = v_tenant_id AND site_id = p_site_id AND status = 'open';
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session de caisse invalide ou fermée';
  END IF;

  -- 5. Validate items array
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Aucun article à retourner';
  END IF;

  -- 6. Generate return number
  v_return_number := next_doc_number(v_tenant_id, 'return', 'RET');

  -- 7. Create sale_returns header
  INSERT INTO public.sale_returns (
    id, tenant_id, site_id, sale_id, customer_id, user_id,
    cash_session_id, return_number, total, refund_method,
    status, reason, restock, request_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, p_site_id, p_sale_id, v_sale.customer_id, auth.uid(),
    p_cash_session_id, v_return_number, 0,
    v_effective_method,
    'approved', COALESCE(p_reason, 'Retour au POS'), p_restock, p_request_id
  ) RETURNING id INTO v_return_id;

  -- 8. Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT * INTO v_si FROM public.sale_items
    WHERE id = (v_item->>'sale_item_id')::uuid
      AND sale_id = p_sale_id
      AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF v_si.id IS NULL THEN
      RAISE EXCEPTION 'Article (sale_item_id %) ne fait pas partie de cette vente', v_item->>'sale_item_id';
    END IF;

    v_req_qty := (v_item->>'quantity')::numeric;
    IF v_req_qty <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(SUM(sri.quantity), 0) INTO v_already_returned
    FROM public.sale_return_items sri
    JOIN public.sale_returns sr ON sr.id = sri.return_id
    WHERE sri.sale_item_id = v_si.id
      AND sr.status IN ('approved', 'pending');

    v_remaining := v_si.quantity - v_already_returned;

    IF v_req_qty > v_remaining THEN
      RAISE EXCEPTION 'Quantité retournée (%) dépasse le disponible (%) pour article %',
        v_req_qty, v_remaining, v_si.name;
    END IF;

    INSERT INTO public.sale_return_items (
      id, tenant_id, return_id, article_id, sale_item_id,
      name, quantity, unit_price, purchase_cost, total
    ) VALUES (
      gen_random_uuid(), v_tenant_id, v_return_id, v_si.article_id, v_si.id,
      v_si.name, v_req_qty, v_si.unit_price, COALESCE(v_si.purchase_cost, 0),
      v_req_qty * v_si.unit_price
    );

    v_return_total := v_return_total + (v_req_qty * v_si.unit_price);
    v_article_names := v_article_names || (v_si.name || CASE WHEN v_req_qty > 1 THEN ' x' || v_req_qty ELSE '' END);

    -- Restock if requested and article tracks stock
    IF p_restock AND v_si.article_id IS NOT NULL THEN
      SELECT COALESCE(a.track_stock, true) INTO v_track
      FROM public.articles a WHERE a.id = v_si.article_id;

      IF v_track THEN
        SELECT COALESCE(sl.quantity, 0) INTO v_prev_stock
        FROM public.stock_levels sl
        WHERE sl.article_id = v_si.article_id AND sl.site_id = p_site_id;

        IF v_prev_stock IS NULL THEN
          v_prev_stock := 0;
          INSERT INTO public.stock_levels (tenant_id, article_id, site_id, quantity)
          VALUES (v_tenant_id, v_si.article_id, p_site_id, 0);
        END IF;

        v_new_stock := v_prev_stock + v_req_qty;

        UPDATE public.stock_levels
        SET quantity = v_new_stock, updated_at = now()
        WHERE article_id = v_si.article_id AND site_id = p_site_id;

        INSERT INTO public.stock_movements (
          tenant_id, article_id, site_id, movement_type, quantity,
          previous_qty, new_qty, user_id, note
        ) VALUES (
          v_tenant_id, v_si.article_id, p_site_id, 'return_customer', v_req_qty,
          v_prev_stock, v_new_stock, auth.uid(),
          'Retour ' || v_return_number
        );
      END IF;
    END IF;
  END LOOP;

  -- 9. Update return total
  UPDATE public.sale_returns SET total = v_return_total WHERE id = v_return_id;

  -- 10. Refund handling
  IF v_effective_method = 'cash' AND v_return_total > 0 THEN
    -- Cash refund: create cash movement
    INSERT INTO public.cash_movements (
      tenant_id, site_id, cash_session_id, user_id,
      kind, amount, reason, reference, sale_return_id
    ) VALUES (
      v_tenant_id, p_site_id, p_cash_session_id, auth.uid(),
      'refund', v_return_total,
      'Retour ' || v_return_number || ': ' || array_to_string(v_article_names, ', '),
      v_return_number, v_return_id
    );

    UPDATE public.cash_sessions
    SET theoretical_amount = GREATEST(0, COALESCE(theoretical_amount, 0) - v_return_total)
    WHERE id = p_cash_session_id;

    UPDATE public.sale_returns
    SET refunded_at = now(),
        refund_cash_session_id = p_cash_session_id,
        approved_by = auth.uid()
    WHERE id = v_return_id;

  ELSIF v_effective_method = 'avoir' AND v_return_total > 0 AND v_sale.customer_id IS NOT NULL THEN
    -- Avoir: apply credit to unpaid invoices atomically
    PERFORM public._apply_avoirs_internal(v_sale.customer_id, v_tenant_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'total', v_return_total,
    'refunded', v_effective_method = 'cash',
    'refund_method', v_effective_method,
    'items_count', jsonb_array_length(p_items),
    'article_names', array_to_string(v_article_names, ', '),
    'idempotent', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text, text) TO authenticated;

-- ============================================================
-- 5. Replace old auto_apply_customer_avoirs to call the new internal
--    (keeps backward compat for any remaining frontend calls during rollout)
-- ============================================================
CREATE OR REPLACE FUNCTION public.auto_apply_customer_avoirs(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_customer_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT customer_id INTO v_customer_id FROM public.sales
  WHERE id = p_sale_id AND tenant_id = v_tenant_id;

  IF v_customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;

  RETURN public._apply_avoirs_internal(v_customer_id, v_tenant_id);
END;
$$;

-- ============================================================
-- 6. Backfill: link old avoir payments to their source_return_id
-- ============================================================
DO $$
DECLARE
  v_payment record;
  v_return_id uuid;
  v_return_number text;
BEGIN
  FOR v_payment IN
    SELECT sp.id, sp.tenant_id, sp.sale_id, sp.reference, sp.method_name
    FROM public.sale_payments sp
    WHERE sp.source_return_id IS NULL
      AND sp.payment_method_id IS NULL
      AND sp.method_name LIKE 'Avoir %'
  LOOP
    -- Try to find the matching return by return_number
    v_return_number := COALESCE(v_payment.reference, '');
    IF v_return_number = '' THEN
      v_return_number := substring(v_payment.method_name FROM 'Avoir (.+)');
    END IF;

    IF v_return_number IS NOT NULL AND v_return_number <> '' THEN
      SELECT id INTO v_return_id FROM public.sale_returns
      WHERE return_number = v_return_number AND tenant_id = v_payment.tenant_id
      LIMIT 1;

      IF v_return_id IS NOT NULL THEN
        UPDATE public.sale_payments
        SET source_return_id = v_return_id
        WHERE id = v_payment.id
          AND NOT EXISTS (
            SELECT 1 FROM public.sale_payments sp2
            WHERE sp2.source_return_id = v_return_id AND sp2.sale_id = v_payment.sale_id
              AND sp2.id <> v_payment.id
          );
      END IF;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 7. Regularization: apply all pending avoirs to unpaid invoices
-- ============================================================
DO $$
DECLARE
  v_cust record;
BEGIN
  FOR v_cust IN
    SELECT DISTINCT sr.customer_id, sr.tenant_id
    FROM public.sale_returns sr
    WHERE sr.refund_method = 'avoir'
      AND sr.status = 'approved'
      AND (COALESCE(sr.total, 0) - COALESCE(sr.credit_used, 0)) > 0
      AND sr.customer_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.tenant_id = sr.tenant_id
          AND s.customer_id = sr.customer_id
          AND s.status <> 'cancelled'
          AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
      )
  LOOP
    PERFORM public._apply_avoirs_internal(v_cust.customer_id, v_cust.tenant_id);
  END LOOP;
END $$;
