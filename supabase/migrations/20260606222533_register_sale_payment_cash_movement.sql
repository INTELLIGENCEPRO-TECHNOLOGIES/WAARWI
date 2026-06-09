-- Drop and recreate register_sale_payment to add cash_movement creation
DROP FUNCTION IF EXISTS public.register_sale_payment(uuid,uuid,text,numeric,text,uuid);

CREATE OR REPLACE FUNCTION public.register_sale_payment(
  p_sale_id uuid,
  p_payment_method_id uuid DEFAULT NULL,
  p_method_name text DEFAULT '',
  p_amount numeric DEFAULT 0,
  p_reference text DEFAULT '',
  p_cash_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
v_tenant_id uuid;
v_sale record;
v_new_paid numeric;
v_new_status text;
v_pm_type text;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

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
  -- Update cash session theoretical_amount
  UPDATE cash_sessions
  SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
  WHERE id = p_cash_session_id;

  -- Create cash movement entry so payment appears in cash session history
  INSERT INTO cash_movements (
    tenant_id, site_id, cash_session_id, user_id,
    kind, amount, reason, note, reference,
    customer_id, payment_method_id, method_name
  ) VALUES (
    v_tenant_id, v_sale.site_id, p_cash_session_id, auth.uid(),
    'income', p_amount,
    'Reglement ' || v_sale.sale_number,
    COALESCE(p_reference, ''),
    v_sale.sale_number,
    v_sale.customer_id, p_payment_method_id,
    COALESCE(p_method_name, '')
  );
END IF;

IF v_sale.customer_id IS NOT NULL THEN
  UPDATE customers
  SET balance = GREATEST(0, COALESCE(balance, 0) - p_amount)
  WHERE id = v_sale.customer_id;
END IF;

RETURN jsonb_build_object('paid', v_new_paid, 'status', v_new_status);
END;
$$;
