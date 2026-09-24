/*
# RS1 Section B — Create register_customer_balance_payment RPC

## Purpose
Dedicated SECURITY DEFINER function for paying the "report de solde" (balance carryover).
Unlike register_customer_payment, this function NEVER creates sale_payments and NEVER
runs FIFO distribution across unpaid invoices. It operates exclusively on the customer
balance via balance_adjustments, customer_payments, and cash_movements.

## What the function does (in order)
1. Validates inputs (customer, amount > 0, payment method not credit, open cash session)
2. Checks idempotency: if the key already exists, returns the existing result
3. Locks customer row + cash session FOR UPDATE (prevents concurrent double-payments)
4. Calculates report_due (positive balance adjustments minus amount_used minus negative adjustments)
5. Caps payment at report_due (cannot overpay the balance report)
6. Reduces customer.balance by v_take
7. Creates a cash_movement (kind='income', reason='Règlement solde client')
8. Updates cash_session.theoretical_amount
9. Creates a negative balance_adjustment (kind='balance_payment')
10. FIFO imputation: distributes v_take across positive balance_adjustments (oldest first)
    by increasing their amount_used
11. Creates a customer_payment record linking everything together
12. Returns JSON with the payment details

## Security
- SECURITY DEFINER (runs as owner, bypasses RLS)
- search_path locked to public
- EXECUTE granted to authenticated and service_role only

## Important notes
1. No sale_payments are created — this is the core fix for the RS1 bug
2. The idempotency_key prevents duplicate payments from rapid clicks
3. FOR UPDATE locks prevent concurrent race conditions
4. amount_used tracking on positive adjustments enables accurate reporting
*/

CREATE OR REPLACE FUNCTION public.register_customer_balance_payment(
  p_customer_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT '',
  p_cash_session_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_pm_type text;
  v_session_status text;
  v_site_id uuid;
  v_user_id uuid;
  v_customer_balance numeric;
  v_report_due numeric;
  v_pos_sum numeric;
  v_used_sum numeric;
  v_neg_sum numeric;
  v_take numeric;
  v_prev_balance numeric;
  v_new_balance numeric;
  v_cm_id uuid;
  v_ba_id uuid;
  v_cp_id uuid;
  v_adj record;
  v_remaining numeric;
  v_alloc numeric;
  v_existing jsonb;
BEGIN
  -- ============================================================
  -- 1. Validate inputs
  -- ============================================================
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  v_user_id := auth.uid();

  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  IF p_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;

  -- Payment method validation
  IF p_payment_method_id IS NOT NULL THEN
    SELECT payment_type INTO v_pm_type FROM payment_methods
      WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
    IF COALESCE(v_pm_type, '') = 'credit' THEN
      RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
    END IF;
  END IF;

  -- ============================================================
  -- 2. Idempotency check
  -- ============================================================
  IF p_idempotency_key IS NOT NULL THEN
    SELECT jsonb_build_object(
      'customer_payment_id', cp.id,
      'amount', cp.amount,
      'cash_movement_id', cp.cash_movement_id,
      'already_existed', true
    ) INTO v_existing
    FROM customer_payments cp
    WHERE cp.tenant_id = v_tenant_id AND cp.idempotency_key = p_idempotency_key;

    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  -- ============================================================
  -- 3. Lock customer + cash session FOR UPDATE
  -- ============================================================
  SELECT balance INTO v_customer_balance
    FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id
    FOR UPDATE;
  IF v_customer_balance IS NULL THEN RAISE EXCEPTION 'Client introuvable'; END IF;

  SELECT status, site_id INTO v_session_status, v_site_id
    FROM cash_sessions WHERE id = p_cash_session_id
    FOR UPDATE;
  IF v_session_status IS NULL OR v_session_status <> 'open' THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;

  -- ============================================================
  -- 4. Calculate report_due
  -- ============================================================
  -- Positive adjustments total (carryover + manual positives)
  SELECT COALESCE(SUM(amount), 0) INTO v_pos_sum
    FROM balance_adjustments
    WHERE tenant_id = v_tenant_id AND entity_type = 'customer' AND entity_id = p_customer_id
      AND amount > 0 AND kind NOT IN ('reconciliation', 'cancel_reversal');

  -- Already-used amount on those positive adjustments
  SELECT COALESCE(SUM(amount_used), 0) INTO v_used_sum
    FROM balance_adjustments
    WHERE tenant_id = v_tenant_id AND entity_type = 'customer' AND entity_id = p_customer_id
      AND amount > 0 AND kind NOT IN ('reconciliation', 'cancel_reversal');

  -- Negative adjustments total (prior balance payments)
  SELECT COALESCE(SUM(-amount), 0) INTO v_neg_sum
    FROM balance_adjustments
    WHERE tenant_id = v_tenant_id AND entity_type = 'customer' AND entity_id = p_customer_id
      AND amount < 0 AND kind NOT IN ('reconciliation', 'cancel_reversal');

  v_report_due := GREATEST(0, v_pos_sum - v_used_sum - v_neg_sum);
  v_take := LEAST(p_amount, v_report_due);

  IF v_take <= 0 THEN
    RAISE EXCEPTION 'Aucun report de solde à régler (report dû = 0)';
  END IF;

  -- ============================================================
  -- 5. Reduce customer balance
  -- ============================================================
  v_prev_balance := v_customer_balance;
  v_new_balance := v_customer_balance - v_take;

  UPDATE customers SET balance = v_new_balance
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;

  -- ============================================================
  -- 6. Create cash_movement
  -- ============================================================
  INSERT INTO cash_movements (
    tenant_id, cash_session_id, site_id, user_id, kind, amount,
    reason, note, reference, customer_id, payment_method_id, method_name
  ) VALUES (
    v_tenant_id, p_cash_session_id, v_site_id, v_user_id, 'income', v_take,
    'Règlement solde client', '', COALESCE(p_reference, ''),
    p_customer_id, p_payment_method_id, COALESCE(p_method_name, '')
  )
  RETURNING id INTO v_cm_id;

  -- ============================================================
  -- 7. Update cash session theoretical_amount
  -- ============================================================
  UPDATE cash_sessions
    SET theoretical_amount = COALESCE(theoretical_amount, 0) + v_take
    WHERE id = p_cash_session_id;

  -- ============================================================
  -- 8. Create negative balance_adjustment (kind='balance_payment')
  -- ============================================================
  INSERT INTO balance_adjustments (
    tenant_id, entity_type, entity_id,
    previous_balance, new_balance, amount,
    kind, note, user_id
  ) VALUES (
    v_tenant_id, 'customer', p_customer_id,
    v_prev_balance, v_new_balance, -v_take,
    'balance_payment',
    'Règlement solde · ' || COALESCE(p_method_name, ''),
    v_user_id
  )
  RETURNING id INTO v_ba_id;

  -- ============================================================
  -- 9. FIFO imputation on positive balance_adjustments
  -- ============================================================
  v_remaining := v_take;

  FOR v_adj IN
    SELECT id, amount, amount_used
    FROM balance_adjustments
    WHERE tenant_id = v_tenant_id AND entity_type = 'customer' AND entity_id = p_customer_id
      AND amount > 0 AND kind NOT IN ('reconciliation', 'cancel_reversal')
      AND amount_used < amount
    ORDER BY created_at ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_alloc := LEAST(v_remaining, v_adj.amount - v_adj.amount_used);
    IF v_alloc > 0 THEN
      UPDATE balance_adjustments SET amount_used = amount_used + v_alloc
        WHERE id = v_adj.id;
      v_remaining := v_remaining - v_alloc;
    END IF;
  END LOOP;

  -- ============================================================
  -- 10. Create customer_payment record
  -- ============================================================
  INSERT INTO customer_payments (
    tenant_id, customer_id, amount, method, method_name,
    payment_method_id, reference, cash_session_id, cash_movement_id,
    target_adjustment_id, site_id, user_id, idempotency_key, status
  ) VALUES (
    v_tenant_id, p_customer_id, v_take, COALESCE(p_method_name, 'cash'), COALESCE(p_method_name, ''),
    p_payment_method_id, COALESCE(p_reference, ''), p_cash_session_id, v_cm_id,
    v_ba_id, v_site_id, v_user_id, p_idempotency_key, 'confirmed'
  )
  RETURNING id INTO v_cp_id;

  -- ============================================================
  -- 11. Return result
  -- ============================================================
  RETURN jsonb_build_object(
    'customer_payment_id', v_cp_id,
    'amount', v_take,
    'report_due', v_report_due,
    'requested', p_amount,
    'capped', v_take < p_amount,
    'cash_movement_id', v_cm_id,
    'balance_adjustment_id', v_ba_id,
    'previous_balance', v_prev_balance,
    'new_balance', v_new_balance,
    'already_existed', false
  );
END;
$$;

-- Security: only authenticated + service_role can call
REVOKE ALL ON FUNCTION public.register_customer_balance_payment(uuid, uuid, text, numeric, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_customer_balance_payment(uuid, uuid, text, numeric, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_customer_balance_payment(uuid, uuid, text, numeric, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_customer_balance_payment(uuid, uuid, text, numeric, text, uuid, text) TO service_role;
