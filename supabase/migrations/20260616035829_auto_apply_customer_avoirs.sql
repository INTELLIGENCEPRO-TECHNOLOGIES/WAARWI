-- Auto-apply all available customer avoirs to a given sale
CREATE OR REPLACE FUNCTION auto_apply_customer_avoirs(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale record;
  v_remaining numeric;
  v_credit record;
  v_available numeric;
  v_to_apply numeric;
  v_total_applied numeric := 0;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id;
  IF v_sale.id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;
  IF v_sale.customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;

  v_remaining := COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0);
  IF v_remaining <= 0 THEN RETURN jsonb_build_object('applied', 0); END IF;

  FOR v_credit IN
    SELECT * FROM sale_returns
    WHERE tenant_id = v_tenant_id
      AND customer_id = v_sale.customer_id
      AND refund_method = 'avoir'
      AND status = 'approved'
      AND (COALESCE(total, 0) - COALESCE(credit_used, 0)) > 0
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;

    v_available := COALESCE(v_credit.total, 0) - COALESCE(v_credit.credit_used, 0);
    v_to_apply := LEAST(v_available, v_remaining);

    IF v_to_apply <= 0 THEN CONTINUE; END IF;

    INSERT INTO sale_payments (
      tenant_id, sale_id, payment_method_id, method_name, amount, reference
    ) VALUES (
      v_tenant_id, p_sale_id, NULL, 'Avoir ' || v_credit.return_number,
      v_to_apply, v_credit.return_number
    );

    UPDATE sale_returns SET credit_used = COALESCE(credit_used, 0) + v_to_apply
    WHERE id = v_credit.id;

    v_remaining := v_remaining - v_to_apply;
    v_total_applied := v_total_applied + v_to_apply;
  END LOOP;

  IF v_total_applied > 0 THEN
    UPDATE sales
    SET paid = COALESCE(paid, 0) + v_total_applied,
        status = CASE
          WHEN status = 'cancelled' THEN 'cancelled'
          WHEN COALESCE(paid, 0) + v_total_applied >= total THEN 'paid'
          ELSE 'partial'
        END
    WHERE id = p_sale_id;
  END IF;

  RETURN jsonb_build_object('applied', v_total_applied);
END;
$$;
