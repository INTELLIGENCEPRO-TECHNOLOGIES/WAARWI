/*
# Remove balance check from customer/sale payments (income, not outflow)

## Summary

Customer payments and sale payments are INCOME — they feed the cash register, not
withdraw from it. The "Solde caisse insuffisant" balance check was incorrectly
applied to `register_sale_payment` and `register_customer_payment` in the previous
migration. This migration removes that check from both functions while keeping
the cash session guard (session must be open).

The balance check remains in `register_supplier_payment` because supplier
payments are outflows (expenses) that withdraw money from the register.

## Changes

### 1. `register_sale_payment` (modified)
- Removed the balance sufficiency check (`opening_amount + theoretical_amount < p_amount`).
- Kept the cash session guard: `p_cash_session_id` must be provided and the session
  must be open.
- Rationale: a sale payment adds money to the register, so there is no need to
  verify that the register has enough funds.

### 2. `register_customer_payment` (modified)
- Removed the balance sufficiency check at the top of the function.
- Kept the cash session guard: `p_cash_session_id` must be provided and the session
  must be open.
- Rationale: a customer payment adds money to the register (either directly or via
  `register_sale_payment`), so there is no need to verify register funds.

### 3. `register_supplier_payment` (unchanged)
- The balance check remains here because supplier payments are outflows.

## Security
- No RLS policy changes.
*/

-- ============================================================
-- 1. register_sale_payment — remove balance check (income, not outflow)
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_sale_payment(
  p_sale_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT NULL,
  p_cash_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_sale record;
  v_new_paid numeric;
  v_new_status text;
  v_pm_type text;
  v_session_status text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  -- Cash session guard: every sale payment requires an open cash session
  IF p_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;
  SELECT status INTO v_session_status FROM cash_sessions WHERE id = p_cash_session_id;
  IF v_session_status IS NULL OR v_session_status <> 'open' THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;

  IF p_payment_method_id IS NOT NULL THEN
    SELECT payment_type INTO v_pm_type FROM payment_methods
    WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
    IF COALESCE(v_pm_type, '') = 'credit' THEN
      RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
    END IF;
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Facture introuvable'; END IF;

  INSERT INTO sale_payments (
    tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference
  ) VALUES (
    v_tenant_id, p_sale_id, p_cash_session_id, p_payment_method_id,
    COALESCE(p_method_name, ''), p_amount, COALESCE(p_reference, '')
  );

  v_new_paid := COALESCE(v_sale.paid, 0) + p_amount;
  v_new_status := CASE
    WHEN v_sale.status = 'cancelled' THEN 'cancelled'
    WHEN v_new_paid >= v_sale.total THEN 'paid'
    ELSE 'partial'
  END;

  UPDATE sales SET paid = v_new_paid, status = v_new_status WHERE id = p_sale_id;

  IF p_cash_session_id IS NOT NULL THEN
    UPDATE cash_sessions
    SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
    WHERE id = p_cash_session_id;

    INSERT INTO cash_movements (
      tenant_id, site_id, cash_session_id, user_id,
      kind, amount, reason, note, reference,
      customer_id, payment_method_id, method_name
    ) VALUES (
      v_tenant_id, v_sale.site_id, p_cash_session_id, auth.uid(),
      'income', p_amount,
      'Règlement ' || v_sale.sale_number,
      '',
      v_sale.sale_number,
      v_sale.customer_id, p_payment_method_id,
      COALESCE(p_method_name, '')
    );
  END IF;

  -- Decrease customer balance (allow negative = overpayment/avoir)
  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE customers
    SET balance = COALESCE(balance, 0) - p_amount
    WHERE id = v_sale.customer_id;
  END IF;

  RETURN jsonb_build_object('paid', v_new_paid, 'status', v_new_status);
END;
$function$;

-- ============================================================
-- 2. register_customer_payment — remove balance check (income, not outflow)
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_customer_payment(
  p_customer_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT '',
  p_cash_session_id uuid DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_pm_type text;
  v_remaining numeric;
  v_sale record;
  v_due numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_applied_sales jsonb := '[]'::jsonb;
  v_site_id uuid;
  v_session_status text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  -- Cash session guard: every customer payment requires an open cash session
  IF p_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;
  SELECT status INTO v_session_status FROM cash_sessions WHERE id = p_cash_session_id;
  IF v_session_status IS NULL OR v_session_status <> 'open' THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;

  IF p_payment_method_id IS NOT NULL THEN
    SELECT payment_type INTO v_pm_type FROM payment_methods
    WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
    IF COALESCE(v_pm_type, '') = 'credit' THEN
      RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
    END IF;
  END IF;

  v_remaining := p_amount;

  -- Si une facture précise est ciblée, la traiter d'abord
  IF p_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales
    WHERE id = p_sale_id AND tenant_id = v_tenant_id
    AND customer_id = p_customer_id AND status <> 'cancelled';
    IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
    v_due := GREATEST(0, COALESCE(v_sale.total,0) - COALESCE(v_sale.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      PERFORM register_sale_payment(v_sale.id, p_payment_method_id, p_method_name,
        v_take, p_reference, p_cash_session_id);
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_sales := v_applied_sales || jsonb_build_object(
        'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_take);
    END IF;
  END IF;

  -- Imputation FIFO sur les autres factures impayées
  FOR v_sale IN
    SELECT * FROM sales
    WHERE tenant_id = v_tenant_id
    AND customer_id = p_customer_id
    AND status <> 'cancelled'
    AND COALESCE(paid,0) < COALESCE(total,0)
    AND (p_sale_id IS NULL OR id <> p_sale_id)
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(0, COALESCE(v_sale.total,0) - COALESCE(v_sale.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      PERFORM register_sale_payment(v_sale.id, p_payment_method_id, p_method_name,
        v_take, p_reference, p_cash_session_id);
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_sales := v_applied_sales || jsonb_build_object(
        'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_take);
    END IF;
  END LOOP;

  -- If there's unapplied amount (positioned balance without matching invoices):
  -- 1. Reduce customer balance
  -- 2. Create a cash_movement so it appears in the cash session
  -- 3. Create a negative balance_adjustment so it appears in the customer ledger
  IF v_remaining > 0 THEN
    UPDATE customers
    SET balance = COALESCE(balance, 0) - v_remaining
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;

    -- Get site_id from cash session
    IF p_cash_session_id IS NOT NULL THEN
      SELECT site_id INTO v_site_id FROM cash_sessions WHERE id = p_cash_session_id;
    END IF;

    -- Record cash movement (income) so it appears in the cash session
    INSERT INTO cash_movements (
      tenant_id, cash_session_id, site_id, user_id, kind, amount,
      reason, note, reference, customer_id, payment_method_id, method_name
    ) VALUES (
      v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'income', v_remaining,
      'Règlement solde client', '', COALESCE(p_reference, ''),
      p_customer_id, p_payment_method_id, COALESCE(p_method_name, '')
    );

    -- Update session theoretical_amount for the unapplied portion
    IF p_cash_session_id IS NOT NULL THEN
      UPDATE cash_sessions
      SET theoretical_amount = COALESCE(theoretical_amount, 0) + v_remaining
      WHERE id = p_cash_session_id;
    END IF;

    -- Record negative balance_adjustment so it shows in customer ledger
    INSERT INTO balance_adjustments (
      tenant_id, entity_type, entity_id,
      previous_balance, new_balance, amount,
      note, user_id
    ) VALUES (
      v_tenant_id, 'customer', p_customer_id,
      (SELECT COALESCE(balance, 0) + v_remaining FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id),
      (SELECT COALESCE(balance, 0) FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id),
      -v_remaining,
      'Règlement solde · ' || COALESCE(p_method_name, ''),
      auth.uid()
    );
  END IF;

  RETURN jsonb_build_object(
    'applied', v_applied,
    'unapplied', v_remaining,
    'sales', v_applied_sales
  );
END;
$function$;
