/*
  Fix register_customer_payment: when payment is applied against positioned balance
  (no matching invoices), create a cash_movement record AND a negative balance_adjustment
  so the payment is visible in both the customer ledger and the cash session.
*/
CREATE OR REPLACE FUNCTION register_customer_payment(
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
AS $$
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
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  IF p_payment_method_id IS NOT NULL THEN
    SELECT payment_type INTO v_pm_type FROM payment_methods
      WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
    IF COALESCE(v_pm_type, '') = 'credit' THEN
      RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
    END IF;
  END IF;

  v_remaining := p_amount;

  -- Si une facture precise est ciblee, la traiter d'abord
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

  -- Imputation FIFO sur les autres factures impayees
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

    -- Get site_id from cash session if available
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
  ELSE
    -- All applied to invoices - just update session for the full amount
    -- (register_sale_payment already handles session for each payment)
    -- No additional session update needed here
    NULL;
  END IF;

  RETURN jsonb_build_object(
    'applied', v_applied,
    'unapplied', v_remaining,
    'sales', v_applied_sales
  );
END;
$$;
