/*
  # Correction stock dans create_credit_sale

  La version précédente tentait de modifier `articles.stock_qty`
  (colonne inexistante). On aligne la logique sur `create_pos_sale` :
  décrément de `stock_levels` par site avec trace dans `stock_movements`.
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
  v_article_id uuid;
  v_qty numeric;
  v_previous numeric;
  v_new numeric;
  v_user_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire pour une vente à crédit'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Panier vide'; END IF;

  v_user_id := auth.uid();

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
    v_article_id := NULLIF(v_item->>'article_id','')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);

    INSERT INTO sale_items (
      tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost
    ) VALUES (
      v_tenant_id, v_sale_id,
      v_article_id,
      COALESCE(v_item->>'name',''),
      v_qty,
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'discount')::numeric, 0),
      v_line_total,
      COALESCE((v_item->>'purchase_cost')::numeric, 0)
    );

    IF v_article_id IS NOT NULL THEN
      SELECT quantity INTO v_previous FROM stock_levels
        WHERE article_id = v_article_id AND site_id = p_site_id;

      IF v_previous IS NULL THEN
        v_previous := 0;
        INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
        VALUES (v_tenant_id, v_article_id, p_site_id, 0);
      END IF;

      v_new := v_previous - v_qty;

      UPDATE stock_levels SET quantity = v_new, updated_at = now()
        WHERE article_id = v_article_id AND site_id = p_site_id;

      INSERT INTO stock_movements (
        tenant_id, article_id, site_id, movement_type, quantity,
        previous_qty, new_qty, reference_type, reference_id, user_id, note
      ) VALUES (
        v_tenant_id, v_article_id, p_site_id, 'sale',
        -v_qty, v_previous, v_new, 'sale', v_sale_id, v_user_id,
        'Vente à crédit ' || v_sale_number
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total);
END;
$$;