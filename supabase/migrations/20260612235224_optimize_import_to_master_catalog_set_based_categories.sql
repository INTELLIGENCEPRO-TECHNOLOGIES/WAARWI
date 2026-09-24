-- Rewrite import_to_master_catalog to resolve categories in one pass
-- instead of per-row lookups, drastically reducing query count for large imports.
CREATE OR REPLACE FUNCTION public.import_to_master_catalog(
  p_catalog_id uuid,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row        jsonb;
  v_imported   int := 0;
  v_updated    int := 0;
  v_errors     jsonb[] := '{}';
  v_idx        int := 0;
  v_cat_id     uuid;
  v_subcat_id  uuid;
  v_existing_id uuid;
  v_designation text;
  v_brand      text;
  v_ref        text;
  v_cat_name   text;
  v_subcat_name text;
BEGIN
  IF p_catalog_id IS NULL THEN
    RETURN jsonb_build_object('imported', 0, 'updated', 0,
      'errors', jsonb_build_array(jsonb_build_object('row', 0, 'error', 'catalog_id manquant')), 'total', 0);
  END IF;

  -- ── 1. Pre-create all categories referenced in this batch (one pass) ──────
  --    Root categories first
  INSERT INTO master_catalog_categories (master_catalog_id, name, slug, parent_id, sort_order, is_active)
  SELECT DISTINCT ON (lower(cat_name))
    p_catalog_id,
    cat_name,
    lower(regexp_replace(cat_name, '[^a-z0-9]+', '-', 'gi')),
    NULL, 0, true
  FROM (
    SELECT trim(r->>'categorie') AS cat_name
    FROM   jsonb_array_elements(p_rows) AS r
    WHERE  trim(r->>'categorie') != ''
  ) sub
  WHERE NOT EXISTS (
    SELECT 1 FROM master_catalog_categories
    WHERE master_catalog_id = p_catalog_id
      AND parent_id IS NULL
      AND lower(name) = lower(sub.cat_name)
  )
  ON CONFLICT DO NOTHING;

  --    Sub-categories (parent must exist by now)
  INSERT INTO master_catalog_categories (master_catalog_id, name, slug, parent_id, sort_order, is_active)
  SELECT DISTINCT ON (parent.id, lower(sub_name))
    p_catalog_id,
    sub_name,
    lower(regexp_replace(sub_name, '[^a-z0-9]+', '-', 'gi')),
    parent.id, 0, true
  FROM (
    SELECT trim(r->>'categorie') AS cat_name, trim(r->>'sous_categorie') AS sub_name
    FROM   jsonb_array_elements(p_rows) AS r
    WHERE  trim(r->>'categorie') != ''
      AND  trim(r->>'sous_categorie') != ''
  ) pairs
  JOIN master_catalog_categories parent
    ON parent.master_catalog_id = p_catalog_id
   AND parent.parent_id IS NULL
   AND lower(parent.name) = lower(pairs.cat_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM master_catalog_categories c2
    WHERE c2.master_catalog_id = p_catalog_id
      AND c2.parent_id = parent.id
      AND lower(c2.name) = lower(pairs.sub_name)
  )
  ON CONFLICT DO NOTHING;

  -- ── 2. Row-by-row upsert (categories now guaranteed to exist) ────────────
  --    Category lookups hit the index created by the previous migration.
  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_designation := COALESCE(NULLIF(TRIM(v_row->>'designation'), ''), NULLIF(TRIM(v_row->>'nom'), ''));
      IF v_designation IS NULL THEN
        v_errors := array_append(v_errors, jsonb_build_object('row', v_idx, 'error', 'Désignation manquante'));
        CONTINUE;
      END IF;

      v_brand     := COALESCE(TRIM(v_row->>'marque'), '');
      v_ref       := COALESCE(NULLIF(TRIM(v_row->>'reference'), ''),
                              NULLIF(TRIM(v_row->>'reference_constructeur'), ''),
                              NULLIF(TRIM(v_row->>'ref'), ''), '');
      v_cat_name  := COALESCE(TRIM(v_row->>'categorie'), '');
      v_subcat_name := COALESCE(TRIM(v_row->>'sous_categorie'), '');

      -- Resolve category id (index hit)
      v_cat_id := NULL;
      IF v_cat_name != '' THEN
        SELECT id INTO v_cat_id
        FROM master_catalog_categories
        WHERE master_catalog_id = p_catalog_id
          AND parent_id IS NULL
          AND lower(name) = lower(v_cat_name)
        LIMIT 1;
      END IF;

      -- Resolve subcategory id (index hit)
      v_subcat_id := NULL;
      IF v_cat_id IS NOT NULL AND v_subcat_name != '' THEN
        SELECT id INTO v_subcat_id
        FROM master_catalog_categories
        WHERE master_catalog_id = p_catalog_id
          AND parent_id = v_cat_id
          AND lower(name) = lower(v_subcat_name)
        LIMIT 1;
      END IF;

      -- Check duplicate (index hit)
      v_existing_id := NULL;
      IF v_ref != '' THEN
        SELECT id INTO v_existing_id
        FROM master_catalog_items
        WHERE master_catalog_id = p_catalog_id
          AND lower(manufacturer_ref) = lower(v_ref)
          AND lower(brand) = lower(v_brand)
        LIMIT 1;
      END IF;
      IF v_existing_id IS NULL THEN
        SELECT id INTO v_existing_id
        FROM master_catalog_items
        WHERE master_catalog_id = p_catalog_id
          AND lower(designation) = lower(v_designation)
          AND lower(brand) = lower(v_brand)
        LIMIT 1;
      END IF;

      IF v_existing_id IS NOT NULL THEN
        UPDATE master_catalog_items SET
          category_id    = COALESCE(v_cat_id, category_id),
          subcategory_id = COALESCE(v_subcat_id, subcategory_id),
          manufacturer_ref = CASE WHEN v_ref != '' THEN v_ref ELSE manufacturer_ref END,
          designation    = v_designation,
          model          = COALESCE(NULLIF(TRIM(v_row->>'modele'), ''), model),
          unit           = COALESCE(NULLIF(TRIM(v_row->>'unite'), ''), unit),
          purchase_price = CASE WHEN (v_row->>'prix_achat') IS NOT NULL AND (v_row->>'prix_achat') != ''
                                THEN (v_row->>'prix_achat')::numeric ELSE purchase_price END,
          sale_price     = CASE WHEN (v_row->>'prix_vente') IS NOT NULL AND (v_row->>'prix_vente') != ''
                                THEN (v_row->>'prix_vente')::numeric ELSE sale_price END,
          vat_rate       = CASE WHEN (v_row->>'taux_tva') IS NOT NULL AND (v_row->>'taux_tva') != ''
                                THEN (v_row->>'taux_tva')::numeric ELSE vat_rate END,
          barcode        = COALESCE(NULLIF(TRIM(v_row->>'code_barres'), ''), barcode),
          description    = COALESCE(NULLIF(TRIM(v_row->>'description'), ''), description),
          image_url      = COALESCE(NULLIF(TRIM(v_row->>'image_url'), ''), image_url)
        WHERE id = v_existing_id;
        v_updated := v_updated + 1;
      ELSE
        INSERT INTO master_catalog_items (
          master_catalog_id, category_id, subcategory_id,
          manufacturer_ref, designation, brand, model, unit,
          purchase_price, sale_price, vat_rate,
          barcode, description, image_url, is_active
        ) VALUES (
          p_catalog_id, v_cat_id, v_subcat_id,
          v_ref, v_designation, v_brand,
          COALESCE(TRIM(v_row->>'modele'), ''),
          COALESCE(NULLIF(TRIM(v_row->>'unite'), ''), 'pièce'),
          COALESCE(NULLIF(v_row->>'prix_achat', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'prix_vente', '')::numeric, 0),
          COALESCE(NULLIF(v_row->>'taux_tva', '')::numeric, 0),
          COALESCE(TRIM(v_row->>'code_barres'), ''),
          COALESCE(TRIM(v_row->>'description'), ''),
          COALESCE(TRIM(v_row->>'image_url'), ''),
          true
        );
        v_imported := v_imported + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := array_append(v_errors, jsonb_build_object('row', v_idx, 'error', SQLERRM));
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'updated',  v_updated,
    'errors',   to_jsonb(v_errors),
    'total',    v_idx
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_to_master_catalog(uuid, jsonb) TO authenticated;
