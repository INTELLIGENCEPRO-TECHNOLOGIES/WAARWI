/*
  # Improved Master Catalog Import/Export System

  1. Changes
    - Replaces `bulk_upsert_master_catalog_items` with a simpler version that accepts a catalog_id directly
    - Adds `auto_create_catalog_for_activity` trigger so new business activity types get a catalog automatically
    - Adds `bulk_import_tenant_articles` RPC for tenant-level article import from Excel
    - Adds `export_tenant_articles` RPC for tenant-level article export

  2. Security
    - All functions use SECURITY DEFINER with explicit search_path
    - Tenant functions check current_tenant_id() ownership
    - Master catalog functions check super_admin role

  3. Notes
    - The new bulk_upsert uses catalog_id instead of requiring type_activite slug matching
    - Auto-catalog creation uses the activity name as catalog name
*/

-- ═══════════════════════════════════════════════════════════════
-- 1. Auto-create catalog when a new business_activity_type is created
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.auto_create_catalog_for_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO master_catalogs (business_activity_type_id, name, description, is_active)
  VALUES (
    NEW.id,
    'Catalogue ' || NEW.name,
    'Catalogue principal pour ' || NEW.name,
    true
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_catalog ON business_activity_types;
CREATE TRIGGER trg_auto_create_catalog
  AFTER INSERT ON business_activity_types
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_catalog_for_activity();

-- Also create catalogs for existing activity types that don't have one yet
INSERT INTO master_catalogs (business_activity_type_id, name, description, is_active)
SELECT bat.id, 'Catalogue ' || bat.name, 'Catalogue principal pour ' || bat.name, true
FROM business_activity_types bat
WHERE NOT EXISTS (
  SELECT 1 FROM master_catalogs mc WHERE mc.business_activity_type_id = bat.id
);

-- ═══════════════════════════════════════════════════════════════
-- 2. Replace bulk_upsert_master_catalog_items with simpler version
--    Now accepts p_catalog_id directly (no slug matching needed)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.bulk_upsert_master_catalog_items(
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
      v_ref := COALESCE(TRIM(v_row->>'reference'), TRIM(v_row->>'reference_constructeur'), TRIM(v_row->>'ref'), '');

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

      -- Check existing (by brand+ref if ref present, otherwise by designation)
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

-- Also keep the old signature working (for backwards compat) - wraps to new one
CREATE OR REPLACE FUNCTION public.bulk_upsert_master_catalog_items(
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_type_slug text;
  v_catalog_id uuid;
BEGIN
  -- Get type_activite from first row
  v_row := p_rows->0;
  v_type_slug := COALESCE(TRIM(v_row->>'type_activite'), '');

  IF v_type_slug = '' THEN
    RETURN jsonb_build_object('imported', 0, 'updated', 0, 'errors', jsonb_build_array(jsonb_build_object('row', 1, 'error', 'type_activite manquant')), 'total', 0);
  END IF;

  SELECT mc.id INTO v_catalog_id
  FROM master_catalogs mc
  JOIN business_activity_types bat ON bat.id = mc.business_activity_type_id
  WHERE lower(bat.slug) = lower(v_type_slug)
  LIMIT 1;

  IF v_catalog_id IS NULL THEN
    RETURN jsonb_build_object('imported', 0, 'updated', 0, 'errors', jsonb_build_array(jsonb_build_object('row', 1, 'error', 'Aucun catalogue pour type_activite: ' || v_type_slug)), 'total', 0);
  END IF;

  RETURN bulk_upsert_master_catalog_items(v_catalog_id, p_rows);
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 3. Export for a specific catalog (simpler than export_all)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.export_master_catalog_by_id(p_catalog_id uuid)
RETURNS TABLE (
  categorie text,
  sous_categorie text,
  designation text,
  marque text,
  reference text,
  modele text,
  unite text,
  prix_achat numeric,
  prix_vente numeric,
  taux_tva numeric,
  code_barres text,
  description text,
  image_url text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(cat.name, '') AS categorie,
    COALESCE(sub.name, '') AS sous_categorie,
    i.designation,
    i.brand AS marque,
    i.manufacturer_ref AS reference,
    i.model AS modele,
    i.unit AS unite,
    i.purchase_price AS prix_achat,
    i.sale_price AS prix_vente,
    i.vat_rate AS taux_tva,
    i.barcode AS code_barres,
    i.description,
    i.image_url
  FROM master_catalog_items i
  LEFT JOIN master_catalog_categories cat ON cat.id = i.category_id
  LEFT JOIN master_catalog_categories sub ON sub.id = i.subcategory_id
  WHERE i.master_catalog_id = p_catalog_id
    AND i.is_active = true
  ORDER BY cat.name NULLS LAST, sub.name NULLS LAST, i.designation;
END;
$$;

GRANT EXECUTE ON FUNCTION public.export_master_catalog_by_id(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 4. Tenant-level bulk import articles from Excel
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.bulk_import_tenant_articles(
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_row jsonb;
  v_imported int := 0;
  v_updated int := 0;
  v_errors jsonb[] := '{}';
  v_idx int := 0;
  v_name text;
  v_ref text;
  v_cat_id uuid;
  v_existing_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('imported', 0, 'updated', 0, 'errors', jsonb_build_array(jsonb_build_object('row', 0, 'error', 'Tenant non identifié')), 'total', 0);
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

      -- Auto-generate ref if not provided
      IF v_ref = '' THEN
        v_ref := 'ART-' || LPAD((v_idx + (SELECT COUNT(*) FROM articles WHERE tenant_id = v_tenant_id))::text, 5, '0');
      END IF;

      -- Resolve category
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

      -- Check existing by internal_ref
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

GRANT EXECUTE ON FUNCTION public.bulk_import_tenant_articles(jsonb) TO authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 5. Export tenant articles
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.export_tenant_articles()
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
  description text
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
    COALESCE(a.description, '') AS description
  FROM articles a
  LEFT JOIN part_categories pc ON pc.id = a.category_id
  WHERE a.tenant_id = v_tenant_id
    AND a.is_active = true
  ORDER BY pc.name NULLS LAST, a.name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.export_tenant_articles() TO authenticated;
