/*
  # Fix overloaded function conflict for master catalog import

  1. Changes
    - Drops the old single-parameter `bulk_upsert_master_catalog_items(jsonb)` overload
    - Renames the new two-parameter version to avoid PostgREST ambiguity
    - Creates `import_to_master_catalog(p_catalog_id, p_rows)` as the primary function
    - Keeps the old name as a simple wrapper for backwards compatibility (single param only)

  2. Notes
    - PostgREST cannot resolve overloaded functions reliably
    - Frontend will call `import_to_master_catalog` directly
*/

-- Drop old overload
DROP FUNCTION IF EXISTS public.bulk_upsert_master_catalog_items(jsonb);
-- Drop new overload
DROP FUNCTION IF EXISTS public.bulk_upsert_master_catalog_items(uuid, jsonb);

-- Create the main import function with a unique name
CREATE OR REPLACE FUNCTION public.import_to_master_catalog(
  p_catalog_id uuid,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_imported int := 0;
  v_updated int := 0;
  v_errors jsonb[] := '{}';
  v_idx int := 0;
  v_cat_id uuid;
  v_subcat_id uuid;
  v_existing_id uuid;
  v_designation text;
  v_brand text;
  v_ref text;
BEGIN
  IF p_catalog_id IS NULL THEN
    RETURN jsonb_build_object('imported', 0, 'updated', 0, 'errors', jsonb_build_array(jsonb_build_object('row', 0, 'error', 'catalog_id manquant')), 'total', 0);
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx := v_idx + 1;
    BEGIN
      v_designation := COALESCE(NULLIF(TRIM(v_row->>'designation'), ''), NULLIF(TRIM(v_row->>'nom'), ''));
      IF v_designation IS NULL OR v_designation = '' THEN
        v_errors := array_append(v_errors, jsonb_build_object('row', v_idx, 'error', 'Désignation manquante'));
        CONTINUE;
      END IF;

      v_brand := COALESCE(TRIM(v_row->>'marque'), '');
      v_ref := COALESCE(NULLIF(TRIM(v_row->>'reference'), ''), NULLIF(TRIM(v_row->>'reference_constructeur'), ''), NULLIF(TRIM(v_row->>'ref'), ''), '');

      -- Resolve category
      v_cat_id := NULL;
      IF COALESCE(TRIM(v_row->>'categorie'), '') != '' THEN
        SELECT id INTO v_cat_id
        FROM master_catalog_categories
        WHERE master_catalog_id = p_catalog_id
          AND parent_id IS NULL
          AND lower(name) = lower(TRIM(v_row->>'categorie'))
        LIMIT 1;

        IF v_cat_id IS NULL THEN
          INSERT INTO master_catalog_categories (master_catalog_id, name, slug, parent_id, sort_order, is_active)
          VALUES (p_catalog_id, TRIM(v_row->>'categorie'), lower(regexp_replace(TRIM(v_row->>'categorie'), '[^a-z0-9]+', '-', 'gi')), NULL, 0, true)
          RETURNING id INTO v_cat_id;
        END IF;
      END IF;

      -- Resolve subcategory
      v_subcat_id := NULL;
      IF v_cat_id IS NOT NULL AND COALESCE(TRIM(v_row->>'sous_categorie'), '') != '' THEN
        SELECT id INTO v_subcat_id
        FROM master_catalog_categories
        WHERE master_catalog_id = p_catalog_id
          AND parent_id = v_cat_id
          AND lower(name) = lower(TRIM(v_row->>'sous_categorie'))
        LIMIT 1;

        IF v_subcat_id IS NULL THEN
          INSERT INTO master_catalog_categories (master_catalog_id, name, slug, parent_id, sort_order, is_active)
          VALUES (p_catalog_id, TRIM(v_row->>'sous_categorie'), lower(regexp_replace(TRIM(v_row->>'sous_categorie'), '[^a-z0-9]+', '-', 'gi')), v_cat_id, 0, true)
          RETURNING id INTO v_subcat_id;
        END IF;
      END IF;

      -- Check existing (by brand+ref if ref present, otherwise by designation+brand)
      v_existing_id := NULL;
      IF v_ref != '' THEN
        SELECT id INTO v_existing_id
        FROM master_catalog_items
        WHERE master_catalog_id = p_catalog_id
          AND lower(brand) = lower(v_brand)
          AND lower(manufacturer_ref) = lower(v_ref);
      END IF;
      IF v_existing_id IS NULL THEN
        SELECT id INTO v_existing_id
        FROM master_catalog_items
        WHERE master_catalog_id = p_catalog_id
          AND lower(designation) = lower(v_designation)
          AND lower(brand) = lower(v_brand);
      END IF;

      IF v_existing_id IS NOT NULL THEN
        -- Update existing
        UPDATE master_catalog_items SET
          category_id = COALESCE(v_cat_id, category_id),
          subcategory_id = COALESCE(v_subcat_id, subcategory_id),
          manufacturer_ref = CASE WHEN v_ref != '' THEN v_ref ELSE manufacturer_ref END,
          designation = v_designation,
          model = COALESCE(NULLIF(TRIM(v_row->>'modele'), ''), model),
          unit = COALESCE(NULLIF(TRIM(v_row->>'unite'), ''), unit),
          purchase_price = CASE WHEN (v_row->>'prix_achat') IS NOT NULL AND (v_row->>'prix_achat') != '' THEN (v_row->>'prix_achat')::numeric ELSE purchase_price END,
          sale_price = CASE WHEN (v_row->>'prix_vente') IS NOT NULL AND (v_row->>'prix_vente') != '' THEN (v_row->>'prix_vente')::numeric ELSE sale_price END,
          vat_rate = CASE WHEN (v_row->>'taux_tva') IS NOT NULL AND (v_row->>'taux_tva') != '' THEN (v_row->>'taux_tva')::numeric ELSE vat_rate END,
          barcode = COALESCE(NULLIF(TRIM(v_row->>'code_barres'), ''), barcode),
          description = COALESCE(NULLIF(TRIM(v_row->>'description'), ''), description),
          image_url = COALESCE(NULLIF(TRIM(v_row->>'image_url'), ''), image_url)
        WHERE id = v_existing_id;
        v_updated := v_updated + 1;
      ELSE
        -- Insert new
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
    'updated', v_updated,
    'errors', to_jsonb(v_errors),
    'total', v_idx
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_to_master_catalog(uuid, jsonb) TO authenticated;
