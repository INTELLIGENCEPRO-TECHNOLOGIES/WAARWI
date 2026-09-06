/*
# Idempotency guard for register_sale_payment

## Problem
Double-clicks on the "Régler" button can fire register_sale_payment twice before
React disables the button. The second call inserts a duplicate sale_payment,
inflates sales.paid beyond sales.total, and creates a spurious cash_movement.

## Fix
Add a guard inside register_sale_payment that rejects the payment if the sale
is already fully paid (paid >= total) or cancelled. This makes the RPC safe to
call multiple times — only the first call succeeds, subsequent calls raise an
error that the frontend can display.

## Changes
- Modified function: register_sale_payment — added early guard after loading
  the sale row: IF v_sale.paid >= v_sale.total AND v_sale.status = 'paid' THEN
  RAISE EXCEPTION 'Cette facture est déjà entièrement réglée'.
*/

CREATE OR REPLACE FUNCTION public.register_sale_payment(
  p_sale_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT NULL,
  p_cash_session_id uuid DEFAULT NULL
) RETURNS jsonb
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

  -- Idempotency guard: reject if already fully paid or cancelled
  IF v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'Cette facture est annulée — aucun règlement possible';
  END IF;
  IF COALESCE(v_sale.paid, 0) >= v_sale.total AND v_sale.status = 'paid' THEN
    RAISE EXCEPTION 'Cette facture est déjà entièrement réglée';
  END IF;

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
