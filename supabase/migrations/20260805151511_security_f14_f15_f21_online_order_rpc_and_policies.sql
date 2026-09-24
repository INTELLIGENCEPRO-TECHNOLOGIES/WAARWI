-- F14, F15, F21: the storefront wrote orders directly with client-supplied prices and
-- status, and the anon SELECT policies exposed every customer's contact details and
-- every order line of every active shop. Replace direct table access with a server
-- side function that recomputes prices from the catalogue and forces the initial state.

CREATE OR REPLACE FUNCTION public.create_online_order(
  p_tenant_id uuid,
  p_customer jsonb,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric := 0;
  v_item jsonb;
  v_article record;
  v_qty numeric;
  v_delivery_mode text;
  v_payment_mode text;
  v_payment_status text;
BEGIN
  IF p_tenant_id IS NULL OR NOT public.is_shop_active(p_tenant_id) THEN
    RAISE EXCEPTION 'Boutique indisponible' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Panier vide';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'Panier trop volumineux';
  END IF;

  v_delivery_mode := CASE WHEN coalesce(p_customer ->> 'delivery_mode', 'retrait') = 'livraison'
                          THEN 'livraison' ELSE 'retrait' END;
  v_payment_mode := coalesce(nullif(p_customer ->> 'payment_mode', ''), 'retrait');
  IF v_payment_mode NOT IN ('wave','orange_money','free_money','livraison','retrait','especes','virement') THEN
    v_payment_mode := 'retrait';
  END IF;
  v_payment_status := CASE WHEN v_payment_mode IN ('wave','orange_money','free_money')
                           THEN 'en_attente' ELSE 'non_paye' END;

  IF coalesce(trim(p_customer ->> 'customer_name'), '') = ''
     OR coalesce(trim(p_customer ->> 'customer_phone'), '') = '' THEN
    RAISE EXCEPTION 'Nom et telephone obligatoires';
  END IF;

  v_order_number := public.next_online_order_number(p_tenant_id);
  IF v_order_number IS NULL THEN
    v_order_number := 'WEB-' || to_char(now(), 'YYYYMMDDHH24MISS');
  END IF;

  INSERT INTO online_orders (
    tenant_id, order_number, customer_name, customer_phone, customer_whatsapp,
    customer_email, customer_address, customer_note, delivery_mode, delivery_address,
    delivery_fee, payment_mode, payment_status, subtotal, total, status, internal_note, sale_id
  ) VALUES (
    p_tenant_id, v_order_number,
    left(coalesce(trim(p_customer ->> 'customer_name'), ''), 160),
    left(coalesce(trim(p_customer ->> 'customer_phone'), ''), 40),
    left(coalesce(trim(p_customer ->> 'customer_whatsapp'), ''), 40),
    left(coalesce(trim(p_customer ->> 'customer_email'), ''), 160),
    left(coalesce(trim(p_customer ->> 'customer_address'), ''), 400),
    left(coalesce(trim(p_customer ->> 'customer_note'), ''), 1000),
    v_delivery_mode,
    CASE WHEN v_delivery_mode = 'livraison'
         THEN left(coalesce(trim(p_customer ->> 'delivery_address'), ''), 400) ELSE '' END,
    0, v_payment_mode, v_payment_status, 0, 0, 'nouvelle', '', NULL
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := coalesce((v_item ->> 'quantity')::numeric, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION 'Quantite invalide';
    END IF;
    IF v_qty > 10000 THEN
      RAISE EXCEPTION 'Quantite trop elevee';
    END IF;
    v_qty := floor(v_qty);

    SELECT id, name, internal_ref, coalesce(sale_price, 0) AS sale_price
      INTO v_article
    FROM articles
    WHERE id = (v_item ->> 'article_id')::uuid
      AND tenant_id = p_tenant_id
      AND coalesce(is_active, true) = true;

    IF v_article.id IS NULL THEN
      RAISE EXCEPTION 'Article indisponible';
    END IF;

    INSERT INTO online_order_items (
      tenant_id, order_id, article_id, article_name, internal_ref,
      quantity, unit_price, line_total
    ) VALUES (
      p_tenant_id, v_order_id, v_article.id, v_article.name, v_article.internal_ref,
      v_qty, v_article.sale_price, v_article.sale_price * v_qty
    );

    v_subtotal := v_subtotal + (v_article.sale_price * v_qty);
  END LOOP;

  UPDATE online_orders
     SET subtotal = v_subtotal, total = v_subtotal
   WHERE id = v_order_id;

  RETURN jsonb_build_object('id', v_order_id, 'order_number', v_order_number, 'total', v_subtotal);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_online_order(uuid, jsonb, jsonb) TO anon, authenticated;

-- F14 / F15: remove the unrestricted public reads and the unrestricted public inserts.
DROP POLICY IF EXISTS "online_orders public select active" ON public.online_orders;
DROP POLICY IF EXISTS "online_order_items public select active" ON public.online_order_items;
DROP POLICY IF EXISTS "online_orders public insert" ON public.online_orders;
DROP POLICY IF EXISTS "online_order_items public insert" ON public.online_order_items;
DROP POLICY IF EXISTS "online_orders anon insert" ON public.online_orders;
DROP POLICY IF EXISTS "online_order_items anon insert" ON public.online_order_items;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.online_orders FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.online_order_items FROM anon;

-- Keep the storefront "most sold" row working: anon may read only the aggregate
-- columns of order lines, never the order they belong to nor any customer data.
CREATE POLICY "online_order_items public aggregate select" ON public.online_order_items
  FOR SELECT TO anon USING (public.is_shop_active(tenant_id));

GRANT SELECT (tenant_id, article_id, quantity) ON public.online_order_items TO anon;
