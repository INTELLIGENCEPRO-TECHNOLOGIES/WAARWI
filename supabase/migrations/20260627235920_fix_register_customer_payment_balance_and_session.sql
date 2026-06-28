-- Fix register_customer_payment: reduce customer balance even when no invoices found
-- (handles positioned/carry-over balance without matching invoices)
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

  -- If there's unapplied amount (no matching invoices but customer has positioned balance),
  -- directly reduce the customer balance for the unapplied portion.
  -- register_sale_payment already reduced balance for the applied portion.
  IF v_remaining > 0 THEN
    UPDATE customers
    SET balance = COALESCE(balance, 0) - v_remaining
    WHERE id = p_customer_id;
  END IF;

  -- Update cash session theoretical_amount for the full payment amount
  IF p_cash_session_id IS NOT NULL THEN
    UPDATE cash_sessions
    SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
    WHERE id = p_cash_session_id;
  END IF;

  RETURN jsonb_build_object(
    'applied', v_applied,
    'unapplied', v_remaining,
    'sales', v_applied_sales
  );
END;
$$;