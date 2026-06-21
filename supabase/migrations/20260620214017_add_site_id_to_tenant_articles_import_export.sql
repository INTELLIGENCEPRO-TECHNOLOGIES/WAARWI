-- Allow importing/exporting tenant articles for a specific site/depot

-- Drop old export function and create version that accepts optional site_id
DROP FUNCTION IF EXISTS public.export_tenant_articles();
DROP FUNCTION IF EXISTS public.export_tenant_articles(uuid);

CREATE OR REPLACE FUNCTION public.export_tenant_articles(p_site_id uuid DEFAULT NULL)
RETURNS TABLE (
  reference_interne text,
  designation text,
  categorie text,
  marque text,
  ref_oem text,
  ref_fournisseur text,
  code_barres text,
  unite text,
  prix_achat numeric,
  prix_vente numeric,
  prix_minimum numeric,
  prix_gros numeric,
  taux_tva numeric,
  stock_min numeric,
  stock_max numeric,
  emplacement text,
  description text,
  stock_initial numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();

  RETURN QUERY
  SELECT
    a.internal_ref AS reference_interne,
    a.name AS designation,
    COALESCE(pc.name, '') AS categorie,
    COALESCE(a.brand, '') AS marque,
    COALESCE(a.oem_ref, '') AS ref_oem,
    COALESCE(a.supplier_ref, '') AS ref_fournisseur,
    COALESCE(a.barcode, '') AS code_barres,
    COALESCE(a.unit, 'pièce') AS unite,
    COALESCE(a.purchase_price, 0) AS prix_achat,
    COALESCE(a.sale_price, 0) AS prix_vente,
    COALESCE(a.min_price, 0) AS prix_minimum,
    COALESCE(a.wholesale_price, 0) AS prix_gros,
    COALESCE(a.vat_rate, 0) AS taux_tva,
    COALESCE(a.stock_min, 0) AS stock_min,
    COALESCE(a.stock_max, 0) AS stock_max,
    COALESCE(a.location, '') AS emplacement,
    COALESCE(a.description, '') AS description,
    COALESCE(SUM(sl.quantity) FILTER (WHERE p_site_id IS NULL OR sl.site_id = p_site_id), 0)::numeric AS stock_initial
  FROM articles a
  LEFT JOIN part_categories pc ON pc.id = a.category_id
  LEFT JOIN stock_levels sl ON sl.article_id = a.id
  WHERE a.tenant_id = v_tenant_id
    AND a.is_active = true
  GROUP BY a.id, pc.name
  ORDER BY pc.name NULLS LAST, a.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.export_tenant_articles(uuid) TO authenticated;

-- Update bulk_import_tenant_articles to accept an optional p_site_id parameter
DROP FUNCTION IF EXISTS public.bulk_import_tenant_articles(jsonb);
DROP FUNCTION IF EXISTS public.bulk_import_tenant_articles(jsonb, uuid);

CREATE OR REPLACE FUNCTION public.bulk_import_tenant_articles(p_rows jsonb, p_site_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_site_id   uuid;
  v_row jsonb;
  v_imported int := 0;
  v_updated int := 0;
  v_errors jsonb[] := '{}';
  v_idx int := 0;
  v_name text;
  v_ref text;
  v_cat_id uuid;
  v_existing_id uuid;
  v_new_id uuid;
  v_stock_init numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('imported', 0, 'updated', 0, 'errors', jsonb_build_array(jsonb_build_object('row', 0, 'error', 'Tenant non identifié')), 'total', 0);
  END IF;

  -- Resolve target site for stock movements
  IF p_site_id IS NOT NULL THEN
    SELECT id INTO v_site_id FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id LIMIT 1;
    IF v_site_id IS NULL THEN
      RETURN jsonb_build_object('imported', 0, 'updated', 0, 'errors', jsonb_build_array(jsonb_build_object('row', 0, 'error', 'Emplacement invalide')), 'total', 0);
    END IF;
  ELSE
    SELECT id INTO v_site_id FROM sites WHERE tenant_id = v_tenant_id LIMIT 1;
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_name := COALESCE(NULLIF(TRIM(v_row->>'designation'), ''), NULLIF(TRIM(v_row->>'nom'), ''));
      IF v_name IS NULL OR v_name = '' THEN
        v_errors := array_append(v_errors, jsonb_build_object('row', v_idx, 'error', 'Désignation manquante'));
        CONTINUE;
      END IF;

      v_ref := COALESCE(NULLIF(TRIM(v_row->>'reference_interne'), ''), NULLIF(TRIM(v_row->>'ref'), ''), '');

      IF v_ref = '' THEN
        v_ref := 'ART-' || LPAD((v_idx + (SELECT COUNT(*) FROM articles WHERE tenant_id = v_tenant_id))::text, 5, '0');
      END IF;

      v_cat_id := NULL;
      IF COALESCE(TRIM(v_row->>'categorie'), '') != '' THEN
        SELECT id INTO v_cat_id
        FROM part_categories
        WHERE tenant_id = v_tenant_id
          AND lower(name) = lower(TRIM(v_row->>'categorie'))
          AND is_active = true
        LIMIT 1;

        IF v_cat_id IS NULL THEN
          INSERT INTO part_categories (tenant_id, name, code, is_active)
          VALUES (v_tenant_id, TRIM(v_row->>'categorie'), upper(left(regexp_replace(TRIM(v_row->>'categorie'), '[^a-zA-Z]', '', 'g'), 3)), true)
          RETURNING id INTO v_cat_id;
        END IF;
      END IF;

      v_existing_id := NULL;
      SELECT id INTO v_existing_id
      FROM articles
      WHERE tenant_id = v_tenant_id AND lower(internal_ref) = lower(v_ref)
      LIMIT 1;

      IF v_existing_id IS NOT NULL THEN
        UPDATE articles SET
          name = v_name,
          category_id = COALESCE(v_cat_id, category_id),
          brand = COALESCE(NULLIF(TRIM(v_row->>'marque'), ''), brand),
          oem_ref = COALESCE(NULLIF(TRIM(v_row->>'ref_oem'), ''), oem_ref),
          supplier_ref = COALESCE(NULLIF(TRIM(v_row->>'ref_fournisseur'), ''), supplier_ref),
          barcode = COALESCE(NULLIF(TRIM(v_row->>'code_barres'), ''), barcode),
          unit = COALESCE(NULLIF(TRIM(v_row->>'unite'), ''), unit),
          purchase_price = CASE WHEN (v_row->>'prix_achat') IS NOT NULL AND (v_row->>'prix_achat') != '' THEN (v_row->>'prix_achat')::numeric ELSE purchase_price END,
          sale_price = CASE WHEN (v_row->>'prix_vente') IS NOT NULL AND (v_row->>'prix_vente') != '' THEN (v_row->>'prix_vente')::numeric ELSE sale_price END,
          min_price = CASE WHEN (v_row->>'prix_minimum') IS NOT NULL AND (v_row->>'prix_minimum') != '' THEN (v_row->>'prix_minimum')::numeric ELSE min_price END,
          wholesale_price = CASE WHEN (v_row->>'prix_gros') IS NOT NULL AND (v_row->>'prix_gros') != '' THEN (v_row->>'prix_gros')::numeric ELSE wholesale_price END,
          vat_rate = CASE WHEN (v_row->>'taux_tva') IS NOT NULL AND (v_row->>'taux_tva') != '' THEN (v_row->>'taux_tva')::numeric ELSE vat_rate END,
          stock_min = CASE WHEN (v_row->>'stock_min') IS NOT NULL AND (v_row->>'stock_min') != '' THEN (v_row->>'stock_min')::numeric ELSE stock_min END,
          stock_max = CASE WHEN (v_row->>'stock_max') IS NOT NULL AND (v_row->>'stock_max') != '' THEN (v_row->>'stock_max')::numeric ELSE stock_max END,
          location = COALESCE(NULLIF(TRIM(v_row->>'emplacement'), ''), location),
          description = COALESCE(NULLIF(TRIM(v_row->>'description'), ''), description)
        WHERE id = v_existing_id;
        v_updated := v_updated + 1;

        -- If a target site is provided and stock_initial > 0 on update, apply it as adjustment
        v_stock_init := COALESCE(NULLIF(TRIM(v_row->>'stock_initial'), '')::numeric, 0);
        IF p_site_id IS NOT NULL AND v_stock_init > 0 AND v_site_id IS NOT NULL THEN
          INSERT INTO stock_movements (
            tenant_id, article_id, site_id, quantity, movement_type, note
          ) VALUES (
            v_tenant_id, v_existing_id, v_site_id, v_stock_init, 'adjustment_in', 'Stock ajout (import)'
          );
          INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
          VALUES (v_tenant_id, v_existing_id, v_site_id, v_stock_init)
          ON CONFLICT (article_id, site_id)
          DO UPDATE SET quantity = stock_levels.quantity + v_stock_init;
        END IF;
      ELSE
        INSERT INTO articles (
          tenant_id, internal_ref, name, category_id, brand,
          oem_ref, supplier_ref, barcode, unit,
          purchase_price, sale_price, min_price, wholesale_price,
          vat_rate, stock_min, stock_max, location, description, is_active
        ) VALUES (
          v_tenant_id, v_ref, v_name, v_cat_id,
          COALESCE(TRIM(v_row->>'marque'), ''),
          COALESCE(TRIM(v_row->>'ref_oem'), ''),
          COALESCE(TRIM(v_row->>'ref_fournisseur'), ''),
          COALESCE(TRIM(v_row->>'code_barres'), ''),
          COALESCE(NULLIF(TRIM(v_row->>'unite'), ''), 'pièce'),
          COALESCE(NULLIF(v_row->>'prix_achat', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'prix_vente', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'prix_minimum', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'prix_gros', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'taux_tva', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'stock_min', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'stock_max', '')::numeric, 0),
          COALESCE(TRIM(v_row->>'emplacement'), ''),
          COALESCE(TRIM(v_row->>'description'), ''),
          true
        )
        RETURNING id INTO v_new_id;

        -- Apply initial stock if provided and site exists
        v_stock_init := COALESCE(NULLIF(TRIM(v_row->>'stock_initial'), '')::numeric, 0);
        IF v_stock_init > 0 AND v_site_id IS NOT NULL AND v_new_id IS NOT NULL THEN
          INSERT INTO stock_movements (
            tenant_id, article_id, site_id, quantity, movement_type, note
          ) VALUES (
            v_tenant_id, v_new_id, v_site_id, v_stock_init, 'initial', 'Stock initial (import)'
          );
          INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
          VALUES (v_tenant_id, v_new_id, v_site_id, v_stock_init)
          ON CONFLICT (article_id, site_id)
          DO UPDATE SET quantity = stock_levels.quantity + v_stock_init;
        END IF;

        v_imported := v_imported + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, jsonb_build_object('row', v_idx, 'error', SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'updated', v_updated,
    'errors', to_jsonb(v_errors),
    'total', v_idx
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_import_tenant_articles(jsonb, uuid) TO authenticated;
