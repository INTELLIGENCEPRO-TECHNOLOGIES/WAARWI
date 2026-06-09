
CREATE OR REPLACE FUNCTION convert_quote_to_sale(
  p_quote_id uuid,
  p_site_id uuid,
  p_cash_session_id uuid DEFAULT NULL,
  p_payments jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_quote record;
  v_sale_id uuid;
  v_sale_number text;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_payment jsonb;
  v_item record;
BEGIN
  v_tenant_id := current_tenant_id();
  v_user_id := auth.uid();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT * INTO v_quote FROM quotes
  WHERE id = p_quote_id AND tenant_id = v_tenant_id;

  IF v_quote.id IS NULL THEN RAISE EXCEPTION 'Devis introuvable'; END IF;
  IF v_quote.converted_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Devis déjà converti';
  END IF;

  v_subtotal := COALESCE(v_quote.subtotal, 0);
  v_total := COALESCE(v_quote.total, 0);

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_paid := v_paid + COALESCE((v_payment->>'amount')::numeric, 0);
  END LOOP;

  v_sale_number := public.next_doc_number(v_tenant_id, 'invoice', 'F');

  INSERT INTO sales (
    tenant_id, site_id, cash_session_id, customer_id, user_id,
    sale_number, subtotal, discount, total, paid, status, source, note
  ) VALUES (
    v_tenant_id, p_site_id, p_cash_session_id, v_quote.customer_id, v_user_id,
    v_sale_number, v_subtotal, COALESCE(v_quote.discount, 0), v_total, v_paid,
    CASE WHEN v_paid >= v_total THEN 'paid' ELSE 'partial' END,
    'quote', COALESCE(v_quote.note, '')
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM quote_items WHERE quote_id = p_quote_id LOOP
    INSERT INTO sale_items (
      tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total
    ) VALUES (
      v_tenant_id, v_sale_id, v_item.article_id, v_item.name,
      v_item.quantity, v_item.unit_price, v_item.discount, v_item.total
    );
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO sale_payments (
      tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference
    ) VALUES (
      v_tenant_id, v_sale_id, p_cash_session_id,
      NULLIF(v_payment->>'payment_method_id','')::uuid,
      v_payment->>'method_name',
      (v_payment->>'amount')::numeric,
      COALESCE(v_payment->>'reference', '')
    );

    IF p_cash_session_id IS NOT NULL THEN
      UPDATE cash_sessions
      SET theoretical_amount = COALESCE(theoretical_amount, 0) + (v_payment->>'amount')::numeric
      WHERE id = p_cash_session_id;
    END IF;
  END LOOP;

  UPDATE quotes SET status = 'converted', converted_sale_id = v_sale_id
  WHERE id = p_quote_id;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number);
END;
$$;
