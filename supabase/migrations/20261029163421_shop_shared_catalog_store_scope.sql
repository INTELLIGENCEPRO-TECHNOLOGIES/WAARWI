/*
# Catalogue partage : la boutique n'inclut jamais les articles propres a un autre magasin

## Resume
En mode « catalogue partage », un article peut etre commun (site_id vide) ou rattache a un
magasin precis. La boutique n'expose desormais que :
- les articles communs (site_id vide),
- les articles du magasin source,
- les articles des depots actifs explicitement rattaches au magasin source.
Un nouveau magasin cree plus tard n'ajoute donc jamais ses articles a une boutique existante.
Le mode « catalogues independants » reste strictement limite au magasin source.

## Modifications
- Nouvelle fonction interne shop_article_in_scope(...) (IMMUTABLE, sans acces aux donnees).
- shop_public_article_visible, get_public_shop_catalog, create_online_order : utilisent cette regle.
- Policy « articles public read active shop » : meme regle.

## Notes
1. Aucune donnee d'articles, de stock ou de commande n'est modifiee.
*/

CREATE OR REPLACE FUNCTION public.shop_article_in_scope(p_article_site uuid, p_scope_site uuid, p_shared boolean, p_stock_sites uuid[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p_scope_site IS NOT NULL AND (
    p_article_site = p_scope_site
    OR (coalesce(p_shared, false) AND (p_article_site IS NULL OR p_article_site = ANY (coalesce(p_stock_sites, '{}'::uuid[]))))
  );
$$;
REVOKE EXECUTE ON FUNCTION public.shop_article_in_scope(uuid, uuid, boolean, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shop_article_in_scope(uuid, uuid, boolean, uuid[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.shop_public_article_visible(p_article_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM articles a
    CROSS JOIN LATERAL public.shop_scope(a.tenant_id, true) sc
    WHERE a.id = p_article_id AND a.is_active = true
      AND public.shop_article_in_scope(a.site_id, sc.scope_site_id, sc.scope_shared, sc.scope_stock_site_ids)
  );
$$;

DROP POLICY IF EXISTS "articles public read active shop" ON public.articles;
CREATE POLICY "articles public read active shop" ON public.articles FOR SELECT
  TO anon, authenticated
  USING (
    is_active = true
    AND public.shop_article_in_scope(site_id, public.shop_public_catalog_site(tenant_id),
          public.shop_public_catalog_shared(tenant_id), public.shop_public_stock_site_ids(tenant_id))
  );

CREATE OR REPLACE FUNCTION public.get_public_shop_catalog(p_slug text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant tenants%ROWTYPE;
  v_ss shop_settings%ROWTYPE;
  v_scope record;
  v_preview boolean := false;
  v_site_name text;
  v_result jsonb;
BEGIN
  IF p_slug IS NULL OR length(p_slug) > 120 THEN RETURN NULL; END IF;

  SELECT * INTO v_tenant FROM tenants WHERE public_slug = p_slug LIMIT 1;
  IF v_tenant.id IS NULL OR NOT public.is_shop_active(v_tenant.id) THEN RETURN NULL; END IF;

  SELECT * INTO v_ss FROM shop_settings WHERE tenant_id = v_tenant.id;
  IF v_ss.id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_scope FROM public.shop_scope(v_tenant.id, false);
  IF v_scope.scope_site_id IS NULL THEN RETURN NULL; END IF;

  IF NOT v_scope.scope_shop_active THEN
    IF auth.uid() IS NOT NULL AND public.current_tenant_id() = v_tenant.id THEN
      v_preview := true;
    ELSE
      RETURN NULL;
    END IF;
  END IF;

  SELECT name INTO v_site_name FROM sites WHERE id = v_scope.scope_site_id;

  WITH arts AS (
    SELECT a.id, a.name, a.internal_ref, a.oem_ref, a.brand, a.category_id, a.sale_price,
           a.old_price, a.image_url, a.description, a.unit, a.condition
    FROM articles a
    WHERE a.tenant_id = v_tenant.id AND a.is_active = true
      AND public.shop_article_in_scope(a.site_id, v_scope.scope_site_id, v_scope.scope_shared, v_scope.scope_stock_site_ids)
  ),
  stk AS (
    SELECT sl.article_id, sum(sl.quantity) AS q
    FROM stock_levels sl
    WHERE sl.tenant_id = v_tenant.id
      AND sl.site_id = ANY (v_scope.scope_stock_site_ids)
      AND sl.article_id IN (SELECT id FROM arts)
    GROUP BY sl.article_id
  ),
  compat AS (
    SELECT c.article_id, c.brand_id, c.model_id, c.year_start, c.year_end
    FROM article_compatibilities c
    WHERE c.tenant_id = v_tenant.id AND c.article_id IN (SELECT id FROM arts)
  ),
  cats AS (
    WITH RECURSIVE tree AS (
      SELECT pc.id, pc.name, pc.parent_id FROM part_categories pc
      WHERE pc.tenant_id = v_tenant.id AND pc.is_active = true
        AND pc.id IN (SELECT category_id FROM arts WHERE category_id IS NOT NULL)
      UNION
      SELECT p.id, p.name, p.parent_id FROM part_categories p
      JOIN tree ON tree.parent_id = p.id
      WHERE p.tenant_id = v_tenant.id AND p.is_active = true
    )
    SELECT DISTINCT id, name, parent_id FROM tree
  ),
  brands AS (
    SELECT b.id, b.name FROM vehicle_brands b
    WHERE b.tenant_id = v_tenant.id AND b.is_active = true
      AND b.id IN (SELECT brand_id FROM compat WHERE brand_id IS NOT NULL)
  ),
  models AS (
    SELECT m.id, m.name, m.brand_id FROM vehicle_models m
    WHERE m.tenant_id = v_tenant.id
      AND m.id IN (SELECT model_id FROM compat WHERE model_id IS NOT NULL)
  ),
  sold AS (
    SELECT si.article_id, sum(si.quantity) AS q
    FROM sale_items si JOIN sales s ON s.id = si.sale_id
    WHERE si.tenant_id = v_tenant.id AND s.site_id = v_scope.scope_site_id AND s.deleted_at IS NULL
      AND si.article_id IN (SELECT id FROM arts)
    GROUP BY si.article_id
    UNION ALL
    SELECT oi.article_id, sum(oi.quantity)
    FROM online_order_items oi JOIN online_orders o ON o.id = oi.order_id
    WHERE oi.tenant_id = v_tenant.id AND o.site_id = v_scope.scope_site_id AND o.status <> 'annulee'
      AND oi.article_id IN (SELECT id FROM arts)
    GROUP BY oi.article_id
  ),
  featured AS (
    SELECT article_id FROM sold GROUP BY article_id ORDER BY sum(q) DESC LIMIT 8
  )
  SELECT jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id, 'name', v_tenant.name, 'legal_name', v_tenant.legal_name,
      'logo_url', v_tenant.logo_url, 'phone', v_tenant.phone, 'email', v_tenant.email,
      'address', v_tenant.address, 'website', v_tenant.website, 'currency', v_tenant.currency,
      'business_type', v_tenant.business_type),
    'settings', to_jsonb(v_ss) - 'tenant_id',
    'site', jsonb_build_object('id', v_scope.scope_site_id, 'name', v_site_name),
    'preview', v_preview,
    'articles', coalesce((SELECT jsonb_agg(to_jsonb(a) || jsonb_build_object('stock_qty', coalesce(stk.q, 0)) ORDER BY a.name)
                          FROM arts a LEFT JOIN stk ON stk.article_id = a.id), '[]'::jsonb),
    'categories', coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name) FROM cats c), '[]'::jsonb),
    'brands', coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.name) FROM brands b), '[]'::jsonb),
    'models', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.name) FROM models m), '[]'::jsonb),
    'compatibilities', coalesce((SELECT jsonb_agg(to_jsonb(x)) FROM compat x), '[]'::jsonb),
    'featured_ids', coalesce((SELECT jsonb_agg(article_id) FROM featured), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END $$;
REVOKE EXECUTE ON FUNCTION public.get_public_shop_catalog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_shop_catalog(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_online_order(p_tenant_id uuid, p_customer jsonb, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_scope record;
  v_order_id uuid;
  v_order_number text;
  v_subtotal numeric := 0;
  v_line record;
  v_article record;
  v_available numeric;
  v_lines jsonb := '[]'::jsonb;
  v_l jsonb;
  v_delivery_mode text;
  v_payment_mode text;
  v_payment_status text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Boutique indisponible' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_scope FROM public.shop_scope(p_tenant_id, true);
  IF v_scope.scope_site_id IS NULL THEN
    RAISE EXCEPTION 'Boutique indisponible' USING ERRCODE = '42501';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Panier vide';
  END IF;
  IF jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'Panier trop volumineux';
  END IF;

  IF coalesce(trim(p_customer ->> 'customer_name'), '') = ''
     OR coalesce(trim(p_customer ->> 'customer_phone'), '') = '' THEN
    RAISE EXCEPTION 'Nom et telephone obligatoires';
  END IF;

  FOR v_line IN
    SELECT x.aid, sum(x.qty) AS qty
    FROM (
      SELECT e ->> 'article_id' AS aid,
             CASE WHEN (e ->> 'quantity') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$'
                  THEN floor((e ->> 'quantity')::numeric) ELSE 0 END AS qty
      FROM jsonb_array_elements(p_items) e
    ) x
    GROUP BY x.aid
  LOOP
    IF v_line.qty IS NULL OR v_line.qty < 1 THEN
      RAISE EXCEPTION 'Quantite invalide';
    END IF;
    IF v_line.qty > 10000 THEN
      RAISE EXCEPTION 'Quantite trop elevee';
    END IF;
    IF v_line.aid IS NULL OR v_line.aid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Article indisponible dans cette boutique';
    END IF;

    SELECT a.id, a.name, a.internal_ref, coalesce(a.sale_price, 0) AS sale_price,
           coalesce(a.track_stock, true) AS track_stock
    INTO v_article
    FROM articles a
    WHERE a.id = v_line.aid::uuid
      AND a.tenant_id = p_tenant_id
      AND a.is_active = true
      AND public.shop_article_in_scope(a.site_id, v_scope.scope_site_id, v_scope.scope_shared, v_scope.scope_stock_site_ids);

    IF v_article.id IS NULL THEN
      RAISE EXCEPTION 'Article indisponible dans cette boutique';
    END IF;

    IF v_article.track_stock THEN
      SELECT coalesce(sum(sl.quantity), 0) INTO v_available
      FROM stock_levels sl
      WHERE sl.tenant_id = p_tenant_id AND sl.article_id = v_article.id
        AND sl.site_id = ANY (v_scope.scope_stock_site_ids);
      IF v_available < v_line.qty THEN
        RAISE EXCEPTION 'Stock insuffisant pour « % » (disponible : %)', v_article.name, greatest(v_available, 0);
      END IF;
    END IF;

    v_lines := v_lines || jsonb_build_object(
      'article_id', v_article.id, 'name', v_article.name, 'internal_ref', v_article.internal_ref,
      'qty', v_line.qty, 'price', v_article.sale_price);
    v_subtotal := v_subtotal + v_article.sale_price * v_line.qty;
  END LOOP;

  v_delivery_mode := CASE WHEN coalesce(p_customer ->> 'delivery_mode', 'retrait') = 'livraison'
                          THEN 'livraison' ELSE 'retrait' END;
  v_payment_mode := coalesce(nullif(p_customer ->> 'payment_mode', ''), 'retrait');
  IF v_payment_mode NOT IN ('wave','orange_money','free_money','livraison','retrait','especes','virement') THEN
    v_payment_mode := 'retrait';
  END IF;
  v_payment_status := CASE WHEN v_payment_mode IN ('wave','orange_money','free_money')
                           THEN 'en_attente' ELSE 'non_paye' END;

  v_order_number := public.next_online_order_number(p_tenant_id);
  IF v_order_number IS NULL THEN
    v_order_number := 'WEB-' || to_char(now(), 'YYYYMMDDHH24MISS');
  END IF;

  INSERT INTO online_orders (
    tenant_id, site_id, order_number, customer_name, customer_phone, customer_whatsapp,
    customer_email, customer_address, customer_note, delivery_mode, delivery_address,
    delivery_fee, payment_mode, payment_status, subtotal, total, status, internal_note, sale_id
  ) VALUES (
    p_tenant_id, v_scope.scope_site_id, v_order_number,
    left(coalesce(trim(p_customer ->> 'customer_name'), ''), 160),
    left(coalesce(trim(p_customer ->> 'customer_phone'), ''), 40),
    left(coalesce(trim(p_customer ->> 'customer_whatsapp'), ''), 40),
    left(coalesce(trim(p_customer ->> 'customer_email'), ''), 160),
    left(coalesce(trim(p_customer ->> 'customer_address'), ''), 400),
    left(coalesce(trim(p_customer ->> 'customer_note'), ''), 1000),
    v_delivery_mode,
    CASE WHEN v_delivery_mode = 'livraison'
         THEN left(coalesce(trim(p_customer ->> 'delivery_address'), ''), 400) ELSE '' END,
    0, v_payment_mode, v_payment_status, v_subtotal, v_subtotal, 'nouvelle', '', NULL
  ) RETURNING id INTO v_order_id;

  FOR v_l IN SELECT * FROM jsonb_array_elements(v_lines) LOOP
    INSERT INTO online_order_items (
      tenant_id, order_id, article_id, article_name, internal_ref, quantity, unit_price, line_total
    ) VALUES (
      p_tenant_id, v_order_id, (v_l ->> 'article_id')::uuid, v_l ->> 'name', v_l ->> 'internal_ref',
      (v_l ->> 'qty')::numeric, (v_l ->> 'price')::numeric,
      (v_l ->> 'price')::numeric * (v_l ->> 'qty')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_order_id, 'order_number', v_order_number, 'total', v_subtotal);
END $$;
REVOKE EXECUTE ON FUNCTION public.create_online_order(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_online_order(uuid, jsonb, jsonb) TO anon, authenticated;

REVOKE TRUNCATE ON public.online_orders, public.online_order_items FROM anon, authenticated;
