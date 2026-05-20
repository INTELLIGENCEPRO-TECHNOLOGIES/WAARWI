/*
  # Correction du compteur dans create_credit_sale

  Utilise `next_doc_number` (et non `next_document_number` qui n'existe pas)
  pour générer le numéro de vente d'une vente à crédit.
*/

CREATE OR REPLACE FUNCTION create_credit_sale(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_discount numeric DEFAULT 0,
  p_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale_id uuid;
  v_sale_number text;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_line_total numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire pour une vente à crédit'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Panier vide'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line_total := (COALESCE((v_item->>'quantity')::numeric, 0)
                     * COALESCE((v_item->>'unit_price')::numeric, 0))
                    - COALESCE((v_item->>'discount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;
  v_total := GREATEST(0, v_subtotal - COALESCE(p_discount, 0));

  v_sale_number := public.next_doc_number(v_tenant_id, 'sale', 'V');

  INSERT INTO sales (
    tenant_id, site_id, cash_session_id, customer_id, sale_number,
    subtotal, discount, total, paid, status, source, note
  ) VALUES (
    v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_sale_number,
    v_subtotal, COALESCE(p_discount, 0), v_total, 0, 'validated', 'pos', COALESCE(p_note, '')
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line_total := (COALESCE((v_item->>'quantity')::numeric, 0)
                     * COALESCE((v_item->>'unit_price')::numeric, 0))
                    - COALESCE((v_item->>'discount')::numeric, 0);

    INSERT INTO sale_items (
      tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost
    ) VALUES (
      v_tenant_id, v_sale_id,
      NULLIF(v_item->>'article_id','')::uuid,
      COALESCE(v_item->>'name',''),
      COALESCE((v_item->>'quantity')::numeric, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'discount')::numeric, 0),
      v_line_total,
      COALESCE((v_item->>'purchase_cost')::numeric, 0)
    );

    IF NULLIF(v_item->>'article_id','') IS NOT NULL THEN
      UPDATE articles
        SET stock_qty = GREATEST(0, stock_qty - COALESCE((v_item->>'quantity')::numeric, 0))
        WHERE id = (v_item->>'article_id')::uuid AND tenant_id = v_tenant_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total);
END;
$$;