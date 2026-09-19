/*
# Fix return customer resolution, allocation exclusions, and withdrawal cap

1. **approve_return_as_avoir**: When return has NULL customer_id, resolve from linked sale.
   Validates customer link before crediting. Rejects approval if sale has a customer but return doesn't match.

2. **_apply_avoirs_internal**: Add `AND s.deleted_at IS NULL` to exclude logically deleted invoices
   from receiving avoir allocations.

3. **apply_customer_prepayments**: Same fix — exclude deleted invoices from prepayment allocations.

4. **record_cash_movement**: Fix withdrawal cap formula.
   Old: `v_net = available - balance` (doubles credit when balance is negative).
   New: `v_net = available - GREATEST(balance, 0)` (only deducts actual debt from available).

5. **Data repair**: Fix 9 orphaned returns (customer_id IS NULL but sale has customer).
   For the 2 avoir-approved orphans, credit customer balance and run allocation.
*/

-- 1. approve_return_as_avoir: resolve customer from sale if missing
CREATE OR REPLACE FUNCTION public.approve_return_as_avoir(p_return_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_ret record;
  v_sale_customer_id uuid;
  v_alloc_result jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT * INTO v_ret FROM public.sale_returns
  WHERE id = p_return_id AND tenant_id = v_tenant_id FOR UPDATE;

  IF v_ret.id IS NULL THEN RAISE EXCEPTION 'Retour introuvable'; END IF;

  -- IDEMPOTENCY: if already approved, do nothing
  IF v_ret.status = 'approved' THEN
    RETURN jsonb_build_object(
      'success', true, 'idempotent', true,
      'credit_balance', v_ret.total,
      'message', 'Avoir déjà approuvé — aucune modification'
    );
  END IF;

  IF v_ret.status <> 'pending' THEN
    RAISE EXCEPTION 'Seuls les retours en attente peuvent être convertis en avoir';
  END IF;

  -- Resolve customer from sale if return has no customer
  IF v_ret.customer_id IS NULL AND v_ret.sale_id IS NOT NULL THEN
    SELECT customer_id INTO v_sale_customer_id
    FROM public.sales WHERE id = v_ret.sale_id AND tenant_id = v_tenant_id;
    IF v_sale_customer_id IS NOT NULL THEN
      UPDATE public.sale_returns SET customer_id = v_sale_customer_id
      WHERE id = p_return_id;
      v_ret.customer_id := v_sale_customer_id;
    END IF;
  END IF;

  UPDATE public.sale_returns
  SET status = 'approved', refund_method = 'avoir',
      refunded_at = now(), approved_by = auth.uid()
  WHERE id = p_return_id;

  IF v_ret.customer_id IS NOT NULL AND COALESCE(v_ret.total, 0) > 0 THEN
    UPDATE public.customers
    SET balance = COALESCE(balance, 0) - v_ret.total
    WHERE id = v_ret.customer_id AND tenant_id = v_tenant_id;

    v_alloc_result := public._apply_avoirs_internal(v_ret.customer_id, v_tenant_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'idempotent', false,
    'credit_balance', v_ret.total,
    'customer_id', v_ret.customer_id,
    'allocation', COALESCE(v_alloc_result, '{}'::jsonb)
  );
END;
$$;

-- 2. _apply_avoirs_internal: exclude deleted invoices
CREATE OR REPLACE FUNCTION public._apply_avoirs_internal(p_customer_id uuid, p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_credit record; v_sale record; v_adj record;
  v_available numeric; v_due numeric; v_to_apply numeric;
  v_total_applied numeric := 0; v_applied_details jsonb := '[]'::jsonb;
  v_origin_sale_id uuid; v_existing boolean; v_adj_remaining numeric;
  v_new_paid numeric; v_new_status text; v_method text;
BEGIN
  PERFORM 1 FROM public.customers WHERE id = p_customer_id AND tenant_id = p_tenant_id FOR UPDATE;

  FOR v_credit IN
    SELECT sr.* FROM public.sale_returns sr
    WHERE sr.tenant_id = p_tenant_id AND sr.customer_id = p_customer_id
      AND sr.refund_method = 'avoir' AND sr.status = 'approved'
      AND (COALESCE(sr.total, 0) - COALESCE(sr.credit_used, 0)) > 0
    ORDER BY sr.created_at ASC FOR UPDATE
  LOOP
    v_available := COALESCE(v_credit.total, 0) - COALESCE(v_credit.credit_used, 0);
    IF v_available <= 0 THEN CONTINUE; END IF;

    -- Priority 1: originating invoice (exclude cancelled AND deleted)
    v_origin_sale_id := v_credit.sale_id;
    IF v_origin_sale_id IS NOT NULL AND v_available > 0 THEN
      SELECT * INTO v_sale FROM public.sales
      WHERE id = v_origin_sale_id AND tenant_id = p_tenant_id
        AND status <> 'cancelled' AND deleted_at IS NULL
      FOR UPDATE;

      IF FOUND AND COALESCE(v_sale.paid, 0) < COALESCE(v_sale.total, 0) THEN
        v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
        v_to_apply := LEAST(v_available, v_due);
        IF v_to_apply > 0 THEN
          SELECT COALESCE(pm.name, 'Avoir') INTO v_method FROM public.payment_methods pm
          WHERE pm.tenant_id = p_tenant_id AND pm.payment_type = 'credit' LIMIT 1;
          v_method := COALESCE(v_method, 'Avoir');

          INSERT INTO public.sale_payments (tenant_id, sale_id, payment_method_id, method_name, amount, reference, affects_balance)
          VALUES (p_tenant_id, v_sale.id, NULL, 'Avoir ' || v_credit.return_number, v_to_apply,
                  'Imputation avoir ' || v_credit.return_number, false);

          v_new_paid := COALESCE(v_sale.paid, 0) + v_to_apply;
          v_new_status := CASE WHEN v_new_paid >= COALESCE(v_sale.total, 0) THEN 'paid' ELSE 'partial' END;
          UPDATE public.sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

          UPDATE public.sale_returns SET credit_used = COALESCE(credit_used, 0) + v_to_apply
          WHERE id = v_credit.id;

          INSERT INTO public.credit_allocations (tenant_id, credit_type, credit_id, sale_id, amount)
          VALUES (p_tenant_id, 'avoir', v_credit.id, v_sale.id, v_to_apply)
          ON CONFLICT DO NOTHING;

          v_available := v_available - v_to_apply;
          v_total_applied := v_total_applied + v_to_apply;
          v_applied_details := v_applied_details || jsonb_build_object(
            'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_to_apply, 'source', 'avoir');
        END IF;
      END IF;
    END IF;

    -- Priority 2: other unpaid invoices (FIFO, exclude cancelled AND deleted)
    IF v_available > 0 THEN
      FOR v_sale IN
        SELECT s.* FROM public.sales s
        WHERE s.tenant_id = p_tenant_id AND s.customer_id = p_customer_id
          AND s.status <> 'cancelled' AND s.deleted_at IS NULL
          AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
          AND s.id <> COALESCE(v_origin_sale_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ORDER BY s.created_at ASC FOR UPDATE
      LOOP
        v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
        v_to_apply := LEAST(v_available, v_due);
        IF v_to_apply <= 0 THEN CONTINUE; END IF;

        INSERT INTO public.sale_payments (tenant_id, sale_id, payment_method_id, method_name, amount, reference, affects_balance)
        VALUES (p_tenant_id, v_sale.id, NULL, 'Avoir ' || v_credit.return_number, v_to_apply,
                'Imputation avoir ' || v_credit.return_number, false);

        v_new_paid := COALESCE(v_sale.paid, 0) + v_to_apply;
        v_new_status := CASE WHEN v_new_paid >= COALESCE(v_sale.total, 0) THEN 'paid' ELSE 'partial' END;
        UPDATE public.sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

        UPDATE public.sale_returns SET credit_used = COALESCE(credit_used, 0) + v_to_apply
        WHERE id = v_credit.id;

        INSERT INTO public.credit_allocations (tenant_id, credit_type, credit_id, sale_id, amount)
        VALUES (p_tenant_id, 'avoir', v_credit.id, v_sale.id, v_to_apply)
        ON CONFLICT DO NOTHING;

        v_available := v_available - v_to_apply;
        v_total_applied := v_total_applied + v_to_apply;
        v_applied_details := v_applied_details || jsonb_build_object(
          'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_to_apply, 'source', 'avoir');
        EXIT WHEN v_available <= 0;
      END LOOP;
    END IF;

    -- Priority 3: positive balance_adjustments
    IF v_available > 0 THEN
      FOR v_adj IN
        SELECT ba.* FROM public.balance_adjustments ba
        WHERE ba.tenant_id = p_tenant_id AND ba.entity_type = 'customer'
          AND ba.entity_id = p_customer_id AND ba.amount > 0
          AND (ba.amount - COALESCE(ba.amount_used, 0)) > 0
        ORDER BY ba.created_at ASC FOR UPDATE
      LOOP
        v_adj_remaining := v_adj.amount - COALESCE(v_adj.amount_used, 0);
        v_to_apply := LEAST(v_available, v_adj_remaining);
        IF v_to_apply <= 0 THEN CONTINUE; END IF;

        UPDATE public.balance_adjustments SET amount_used = COALESCE(amount_used, 0) + v_to_apply
        WHERE id = v_adj.id;

        UPDATE public.sale_returns SET credit_used = COALESCE(credit_used, 0) + v_to_apply
        WHERE id = v_credit.id;

        v_available := v_available - v_to_apply;
        v_total_applied := v_total_applied + v_to_apply;
        EXIT WHEN v_available <= 0;
      END LOOP;
    END IF;
  END LOOP;

  PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, p_tenant_id);

  RETURN jsonb_build_object('total_applied', v_total_applied, 'details', v_applied_details);
END;
$$;

-- 3. apply_customer_prepayments: exclude deleted invoices
CREATE OR REPLACE FUNCTION public.apply_customer_prepayments(p_customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid; v_prepay record; v_sale record;
  v_available numeric; v_due numeric; v_take numeric;
  v_new_paid numeric; v_new_status text; v_applied numeric := 0; v_method text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;
  IF p_customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;

  FOR v_prepay IN
    SELECT * FROM public.customer_prepayments
    WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id AND amount_used < amount
    ORDER BY created_at ASC FOR UPDATE
  LOOP
    v_available := v_prepay.amount - v_prepay.amount_used;
    EXIT WHEN v_available <= 0;

    FOR v_sale IN
      SELECT * FROM public.sales
      WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id
        AND status <> 'cancelled' AND deleted_at IS NULL
        AND COALESCE(paid, 0) < COALESCE(total, 0)
      ORDER BY created_at ASC FOR UPDATE
    LOOP
      v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
      v_take := LEAST(v_available, v_due);
      IF v_take <= 0 THEN CONTINUE; END IF;

      SELECT COALESCE(pm.name, 'Acompte') INTO v_method FROM public.payment_methods pm
      WHERE pm.tenant_id = v_tenant_id AND pm.payment_type = 'credit' LIMIT 1;
      v_method := COALESCE(v_method, 'Acompte');

      INSERT INTO public.sale_payments (tenant_id, sale_id, payment_method_id, method_name, amount, reference, affects_balance)
      VALUES (v_tenant_id, v_sale.id, NULL, 'Acompte · ' || COALESCE(v_prepay.method_name, 'Caisse'),
              v_take, 'Imputation acompte ' || COALESCE(v_prepay.reference, ''), false);

      v_new_paid := COALESCE(v_sale.paid, 0) + v_take;
      v_new_status := CASE WHEN v_new_paid >= COALESCE(v_sale.total, 0) THEN 'paid' ELSE 'partial' END;
      UPDATE public.sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

      UPDATE public.customer_prepayments SET amount_used = amount_used + v_take WHERE id = v_prepay.id;

      INSERT INTO public.credit_allocations (tenant_id, credit_type, credit_id, sale_id, amount)
      VALUES (v_tenant_id, 'prepayment', v_prepay.id, v_sale.id, v_take)
      ON CONFLICT DO NOTHING;

      v_available := v_available - v_take;
      v_applied := v_applied + v_take;
      EXIT WHEN v_available <= 0;
    END LOOP;
  END LOOP;

  PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, v_tenant_id);
  RETURN jsonb_build_object('applied', v_applied);
END;
$$;

-- 4. record_cash_movement: fix withdrawal cap
-- Only redefine the function to fix the v_net calculation
CREATE OR REPLACE FUNCTION record_cash_movement(
  p_cash_session_id uuid, p_site_id uuid, p_kind text, p_amount numeric,
  p_reason text DEFAULT '', p_note text DEFAULT '', p_reference text DEFAULT '',
  p_customer_id uuid DEFAULT NULL, p_payment_method_id uuid DEFAULT NULL,
  p_method_name text DEFAULT '', p_expense_category_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = 'public'
AS $$
DECLARE
  v_tenant_id uuid; v_movement_id uuid; v_prepay_id uuid; v_applied jsonb;
  v_pm_type text; v_available numeric; v_balance numeric; v_net numeric;
  v_remaining numeric; v_prepay record; v_take numeric; v_credit_limit numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_kind NOT IN ('expense','income','customer_prepayment','customer_withdrawal','customer_loan','refund') THEN
    RAISE EXCEPTION 'Type de mouvement invalide';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  IF p_kind IN ('customer_prepayment','customer_withdrawal','customer_loan') THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
    IF p_payment_method_id IS NOT NULL THEN
      SELECT payment_type INTO v_pm_type FROM payment_methods
      WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
      IF COALESCE(v_pm_type,'') = 'credit' THEN
        RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
      END IF;
    END IF;
  END IF;

  -- WITHDRAWAL CAP: available prepayments minus actual debt (ignore existing credit)
  IF p_kind = 'customer_withdrawal' THEN
    SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_available
    FROM customer_prepayments
    WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id AND amount_used < amount;

    SELECT COALESCE(balance, 0) INTO v_balance
    FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id;

    -- FIX: only deduct positive balance (debt). Negative balance (credit) should not inflate withdrawable amount.
    v_net := COALESCE(v_available, 0) - GREATEST(COALESCE(v_balance, 0), 0);

    IF v_available IS NULL OR v_available <= 0 THEN
      RAISE EXCEPTION 'Le client n''a aucun acompte disponible';
    END IF;
    IF v_net <= 0 THEN
      RAISE EXCEPTION 'Le client a une dette de % qui couvre son acompte de %. Retrait impossible.', v_balance, v_available;
    END IF;
    IF p_amount > v_net THEN
      RAISE EXCEPTION 'Montant supérieur au retrait maximum (%). Le client a un acompte de % et une dette de % à déduire.', v_net, v_available, GREATEST(v_balance, 0);
    END IF;
  END IF;

  -- LOAN CAP
  IF p_kind = 'customer_loan' THEN
    SELECT COALESCE(balance, 0), COALESCE(credit_limit, 0)
    INTO v_balance, v_credit_limit
    FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id;

    IF v_credit_limit > 0 AND (v_balance + p_amount) > v_credit_limit THEN
      RAISE EXCEPTION 'Plafond crédit dépassé (%). Solde actuel : %. Maximum prêt possible : %.',
        v_credit_limit, v_balance, GREATEST(0, v_credit_limit - v_balance);
    END IF;
  END IF;

  INSERT INTO cash_movements (tenant_id, cash_session_id, site_id, user_id, kind, amount,
    reason, note, reference, customer_id, payment_method_id, method_name, expense_category_id)
  VALUES (v_tenant_id, p_cash_session_id, p_site_id, auth.uid(), p_kind, p_amount,
    p_reason, p_note, p_reference, p_customer_id, p_payment_method_id, p_method_name, p_expense_category_id)
  RETURNING id INTO v_movement_id;

  IF p_cash_session_id IS NOT NULL THEN
    IF p_kind IN ('expense','customer_withdrawal','customer_loan','refund') THEN
      UPDATE cash_sessions SET theoretical_amount = COALESCE(theoretical_amount, 0) - p_amount
      WHERE id = p_cash_session_id;
    ELSE
      UPDATE cash_sessions SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
      WHERE id = p_cash_session_id;
    END IF;
  END IF;

  -- PREPAYMENT
  IF p_kind = 'customer_prepayment' THEN
    INSERT INTO customer_prepayments (tenant_id, customer_id, amount, amount_used, method_name, reference)
    VALUES (v_tenant_id, p_customer_id, p_amount, 0, p_method_name, p_reference)
    RETURNING id INTO v_prepay_id;

    UPDATE customers SET balance = COALESCE(balance, 0) - p_amount
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;

    v_applied := apply_customer_prepayments(p_customer_id);
    RETURN jsonb_build_object('movement_id', v_movement_id, 'prepayment_id', v_prepay_id,
      'auto_applied', COALESCE((v_applied->>'applied')::numeric, 0));
  END IF;

  -- WITHDRAWAL: FIFO consume prepayments
  IF p_kind = 'customer_withdrawal' THEN
    v_remaining := p_amount;
    FOR v_prepay IN
      SELECT * FROM customer_prepayments
      WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id AND amount_used < amount
      ORDER BY created_at ASC FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_remaining, v_prepay.amount - v_prepay.amount_used);
      IF v_take <= 0 THEN CONTINUE; END IF;
      UPDATE customer_prepayments SET amount_used = amount_used + v_take WHERE id = v_prepay.id;
      v_remaining := v_remaining - v_take;
    END LOOP;
    UPDATE customers SET balance = COALESCE(balance, 0) + p_amount
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;
    RETURN jsonb_build_object('movement_id', v_movement_id, 'withdrawn', p_amount - v_remaining);
  END IF;

  -- LOAN
  IF p_kind = 'customer_loan' THEN
    UPDATE customers SET balance = COALESCE(balance, 0) + p_amount
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;
    RETURN jsonb_build_object('movement_id', v_movement_id, 'loan_amount', p_amount);
  END IF;

  RETURN jsonb_build_object('movement_id', v_movement_id);
END;
$$;
