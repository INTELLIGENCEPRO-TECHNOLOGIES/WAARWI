-- Attach available return credits to a new unpaid direct invoice in the same
-- transaction. The return already reduced the customer's net balance.
DO $migration$
DECLARE
  v_definition text := pg_get_functiondef(
    'public.create_billing_sale_with_items(jsonb,jsonb,jsonb)'::regprocedure
  );
  v_marker text := E'  RETURN v_sale_id;\n';
BEGIN
  IF strpos(v_definition, 'public.apply_credit_to_sale(') > 0 THEN
    RETURN;
  END IF;
  IF strpos(v_definition, v_marker) = 0 THEN
    RAISE EXCEPTION 'Point d’imputation de la facture introuvable.';
  END IF;
  EXECUTE replace(v_definition, v_marker, $allocation$
  IF v_customer_id IS NOT NULL
    AND (p_sale->>'status') = 'validated'
    AND COALESCE((p_sale->>'paid')::numeric, 0) = 0
    AND COALESCE((p_sale->>'total')::numeric, 0) > 0
    AND jsonb_array_length(p_payments) = 0
  THEN
    DECLARE
      v_avoir record;
      v_due numeric := (p_sale->>'total')::numeric;
      v_result jsonb;
    BEGIN
      FOR v_avoir IN
        SELECT id, total - COALESCE(credit_used, 0) AS available
        FROM public.sale_returns
        WHERE tenant_id = v_tenant_id AND site_id = v_site_id
          AND customer_id = v_customer_id AND status = 'approved'
          AND refund_method = 'avoir' AND total > COALESCE(credit_used, 0)
        ORDER BY created_at, id
        FOR UPDATE
      LOOP
        v_result := public.apply_credit_to_sale(
          v_avoir.id, v_sale_id, LEAST(v_due, v_avoir.available)
        );
        IF (v_result->>'success')::boolean IS DISTINCT FROM TRUE THEN
          RAISE EXCEPTION '%', COALESCE(v_result->>'error', 'L’avoir n’a pas été imputé.');
        END IF;
        v_due := v_due - (v_result->>'applied')::numeric;
        EXIT WHEN v_due <= 0;
      END LOOP;
    END;
  END IF;
  RETURN v_sale_id;
$allocation$);
END;
$migration$;
