/*
# Financial Engine Core: Fix avoir balance semantics and allocation model

## Summary
Implements the unified financial rule: "one financial event modifies balance once,
allocations never modify balance." This migration:

1. Modifies process_sale_return: when refund_method='avoir', immediately credits
   customers.balance (the financial event). The allocation step no longer touches balance.

2. Rewrites _apply_avoirs_internal: removes all UPDATE customers SET balance lines.
   This function now ONLY allocates credits to targets (invoices and adjustments),
   updating sales.paid, credit_used, amount_used, and creating credit_allocations.
   It never modifies customers.balance.

3. Adds priority 3 allocation to balance_adjustments (positive ones with open amounts).

4. The allocation engine searches open targets directly (remaining_due > 0 or
   amount - amount_used > 0) -- it never checks customers.balance > 0.

5. Handles overpayment safety: imputation is always min(available, remaining).

## Modified Functions

### _apply_avoirs_internal(p_customer_id, p_tenant_id)
  - REMOVED: all UPDATE customers SET balance lines
  - ADDED: priority 3 allocation to positive balance_adjustments
  - ADDED: INSERT INTO credit_allocations for each allocation
  - ADDED: UPDATE balance_adjustments SET amount_used for adjustment targets
  - Idempotence via ON CONFLICT DO UPDATE on credit_allocations unique constraint

### process_sale_return (9-param version)
  - When refund_method='avoir': now executes customers.balance -= return_total
    BEFORE calling _apply_avoirs_internal (the single financial event)
  - The _apply_avoirs_internal call then only allocates without touching balance

## Security
  - Same SECURITY DEFINER + tenant isolation as before
  - credit_allocations written only via internal function (REVOKE enforced at schema level)
*/

-- ============================================================
-- 1. Grant INSERT on credit_allocations to the DEFINER functions
--    (The table has REVOKE INSERT from authenticated/anon, but
--     SECURITY DEFINER functions run as the table owner and can insert)
-- ============================================================
-- No explicit GRANT needed: SECURITY DEFINER functions run as owner (postgres/supabase_admin)

-- ============================================================
-- 2. Rewrite _apply_avoirs_internal: NO balance modification, WITH credit_allocations
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
          -- Check no duplicate via existing allocation
          SELECT EXISTS(
            SELECT 1 FROM public.sale_payments
            WHERE source_return_id = v_credit.id AND sale_id = v_origin_sale_id
          ) INTO v_existing;

          IF NOT v_existing THEN
            v_to_apply := LEAST(v_available, v_due);

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

            -- Record allocation (ON CONFLICT = aggregate for idempotence)
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

    -- Priority 3: Apply remaining to positive balance_adjustments (carryovers/manual debits)
    IF v_available > 0 THEN
      FOR v_adj IN
        SELECT ba.* FROM public.balance_adjustments ba
        WHERE ba.tenant_id = p_tenant_id
          AND ba.entity_type = 'customer'
          AND ba.entity_id = p_customer_id
          AND ba.amount > 0
          AND (ba.amount - ba.amount_used) > 0
        ORDER BY ba.created_at ASC
        FOR UPDATE
      LOOP
        EXIT WHEN v_available <= 0;

        v_adj_remaining := v_adj.amount - v_adj.amount_used;
        IF v_adj_remaining <= 0 THEN CONTINUE; END IF;

        v_to_apply := LEAST(v_available, v_adj_remaining);

        UPDATE public.balance_adjustments
        SET amount_used = amount_used + v_to_apply
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

  RETURN jsonb_build_object(
    'total_applied', v_total_applied,
    'details', v_applied_details
  );
END;
$$;

-- Lock down internal function
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._apply_avoirs_internal(uuid, uuid) FROM authenticated;

-- ============================================================
-- 3. Rewrite process_sale_return: avoir credits balance FIRST
-- ============================================================
DROP FUNCTION IF EXISTS public.process_sale_return(uuid, uuid, uuid, jsonb, text, boolean, boolean, text, text);

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

    -- Restock if requested
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
    -- FINANCIAL EVENT: credit the customer balance (single modification)
    UPDATE public.customers
    SET balance = COALESCE(balance, 0) - v_return_total
    WHERE id = v_sale.customer_id AND tenant_id = v_tenant_id;

    -- ALLOCATION: distribute credit to open targets (does NOT touch balance)
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
-- 4. Also fix the public wrapper and backward-compat function
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

-- Backward-compat wrapper
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
