-- Full set-based rewrite of import_to_master_catalog
-- Eliminates per-row loops for upsert: resolves categories, finds existing items,
-- and performs INSERT + UPDATE in bulk using CTEs.
-- For 10 000 articles this drops from ~70 000 SQL statements to ~6 total.

CREATE OR REPLACE FUNCTION public.import_to_master_catalog(
  p_catalog_id uuid,
  p_rows jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_imported  int;
  v_updated   int;
  v_errors    jsonb;
  v_skipped   int;
BEGIN
  IF p_catalog_id IS NULL THEN
    RETURN jsonb_build_object('imported', 0, 'updated', 0,
      'errors', jsonb_build_array(jsonb_build_object('row', 0, 'error', 'catalog_id manquant')), 'total', 0);
  END IF;

  -- 1. Materialize & validate input rows into a temp table
  CREATE TEMP TABLE _import_rows ON COMMIT DROP AS
  SELECT
    (row_number() OVER ())::int                                        AS idx,
    COALESCE(NULLIF(TRIM(r->>'designation'), ''),
             NULLIF(TRIM(r->>'nom'), ''))                              AS designation,
    COALESCE(TRIM(r->>'marque'), '')                                   AS brand,
    COALESCE(NULLIF(TRIM(r->>'reference'), ''),
             NULLIF(TRIM(r->>'reference_constructeur'), ''),
             NULLIF(TRIM(r->>'ref'), ''), '')                          AS manufacturer_ref,
    COALESCE(TRIM(r->>'categorie'), '')                                AS cat_name,
    COALESCE(TRIM(r->>'sous_categorie'), '')                           AS subcat_name,
    COALESCE(NULLIF(TRIM(r->>'modele'), ''), '')                       AS model,
    COALESCE(NULLIF(TRIM(r->>'unite'), ''), 'piece')                   AS unit,
    COALESCE(NULLIF(r->>'prix_achat', '')::numeric,  0)                AS purchase_price,
    COALESCE(NULLIF(r->>'prix_vente', '')::numeric,  0)                AS sale_price,
    COALESCE(NULLIF(r->>'taux_tva',   '')::numeric,  0)                AS vat_rate,
    COALESCE(TRIM(r->>'code_barres'), '')                              AS barcode,
    COALESCE(TRIM(r->>'description'),  '')                             AS description,
    COALESCE(TRIM(r->>'image_url'),    '')                             AS image_url
  FROM jsonb_array_elements(p_rows) AS r;

  -- Collect error rows: missing designation
  SELECT jsonb_agg(jsonb_build_object('row', idx, 'error', 'Designation manquante'))
  INTO   v_errors
  FROM   _import_rows
  WHERE  designation IS NULL OR designation = '';

  v_skipped := COALESCE((SELECT COUNT(*) FROM _import_rows WHERE designation IS NULL OR designation = ''), 0);

  DELETE FROM _import_rows WHERE designation IS NULL OR designation = '';

  -- 2. Ensure all root categories exist (single INSERT)
  INSERT INTO master_catalog_categories (master_catalog_id, name, slug, parent_id, sort_order, is_active)
  SELECT DISTINCT ON (lower(cat_name))
    p_catalog_id, cat_name,
    lower(regexp_replace(cat_name, '[^a-z0-9]+', '-', 'gi')),
    NULL, 0, true
  FROM   _import_rows
  WHERE  cat_name != ''
  ON CONFLICT DO NOTHING;

  -- 3. Ensure all sub-categories exist (single INSERT)
  INSERT INTO master_catalog_categories (master_catalog_id, name, slug, parent_id, sort_order, is_active)
  SELECT DISTINCT ON (parent.id, lower(ir.subcat_name))
    p_catalog_id, ir.subcat_name,
    lower(regexp_replace(ir.subcat_name, '[^a-z0-9]+', '-', 'gi')),
    parent.id, 0, true
  FROM   _import_rows ir
  JOIN   master_catalog_categories parent
           ON parent.master_catalog_id = p_catalog_id
          AND parent.parent_id IS NULL
          AND lower(parent.name) = lower(ir.cat_name)
  WHERE  ir.cat_name != '' AND ir.subcat_name != ''
  ON CONFLICT DO NOTHING;

  -- 4. Add resolved category ids to temp table
  ALTER TABLE _import_rows ADD COLUMN cat_id    uuid;
  ALTER TABLE _import_rows ADD COLUMN subcat_id uuid;

  UPDATE _import_rows ir
  SET    cat_id = cat.id
  FROM   master_catalog_categories cat
  WHERE  cat.master_catalog_id = p_catalog_id
    AND  cat.parent_id IS NULL
    AND  lower(cat.name) = lower(ir.cat_name)
    AND  ir.cat_name != '';

  UPDATE _import_rows ir
  SET    subcat_id = sub.id
  FROM   master_catalog_categories sub
  WHERE  sub.master_catalog_id = p_catalog_id
    AND  sub.parent_id = ir.cat_id
    AND  lower(sub.name) = lower(ir.subcat_name)
    AND  ir.subcat_id IS NULL
    AND  ir.subcat_name != '';

  -- 5. Match existing items (ref first, then designation fallback)
  ALTER TABLE _import_rows ADD COLUMN existing_id uuid;

  -- By manufacturer_ref + brand (priority match)
  UPDATE _import_rows ir
  SET    existing_id = mci.id
  FROM   master_catalog_items mci
  WHERE  mci.master_catalog_id = p_catalog_id
    AND  lower(mci.manufacturer_ref) = lower(ir.manufacturer_ref)
    AND  lower(mci.brand) = lower(ir.brand)
    AND  ir.manufacturer_ref != '';

  -- By designation + brand (fallback)
  UPDATE _import_rows ir
  SET    existing_id = mci.id
  FROM   master_catalog_items mci
  WHERE  mci.master_catalog_id = p_catalog_id
    AND  lower(mci.designation) = lower(ir.designation)
    AND  lower(mci.brand) = lower(ir.brand)
    AND  ir.existing_id IS NULL;

  -- 6. Bulk UPDATE existing items
  UPDATE master_catalog_items mci
  SET
    category_id      = COALESCE(ir.cat_id,    mci.category_id),
    subcategory_id   = COALESCE(ir.subcat_id, mci.subcategory_id),
    manufacturer_ref = CASE WHEN ir.manufacturer_ref != '' THEN ir.manufacturer_ref ELSE mci.manufacturer_ref END,
    designation      = ir.designation,
    model            = CASE WHEN ir.model        != '' THEN ir.model        ELSE mci.model        END,
    unit             = CASE WHEN ir.unit         != '' THEN ir.unit         ELSE mci.unit         END,
    purchase_price   = CASE WHEN ir.purchase_price != 0 THEN ir.purchase_price ELSE mci.purchase_price END,
    sale_price       = CASE WHEN ir.sale_price   != 0 THEN ir.sale_price   ELSE mci.sale_price   END,
    vat_rate         = CASE WHEN ir.vat_rate     != 0 THEN ir.vat_rate     ELSE mci.vat_rate     END,
    barcode          = CASE WHEN ir.barcode      != '' THEN ir.barcode      ELSE mci.barcode      END,
    description      = CASE WHEN ir.description  != '' THEN ir.description  ELSE mci.description  END,
    image_url        = CASE WHEN ir.image_url    != '' THEN ir.image_url    ELSE mci.image_url    END
  FROM _import_rows ir
  WHERE mci.id = ir.existing_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  -- 7. Bulk INSERT new items
  INSERT INTO master_catalog_items (
    master_catalog_id, category_id, subcategory_id,
    manufacturer_ref, designation, brand, model, unit,
    purchase_price, sale_price, vat_rate,
    barcode, description, image_url, is_active
  )
  SELECT
    p_catalog_id, ir.cat_id, ir.subcat_id,
    ir.manufacturer_ref, ir.designation, ir.brand, ir.model, ir.unit,
    ir.purchase_price, ir.sale_price, ir.vat_rate,
    ir.barcode, ir.description, ir.image_url, true
  FROM _import_rows ir
  WHERE ir.existing_id IS NULL;

  GET DIAGNOSTICS v_imported = ROW_COUNT;

  RETURN jsonb_build_object(
    'imported', v_imported,
    'updated',  v_updated,
    'skipped',  v_skipped,
    'errors',   COALESCE(v_errors, '[]'::jsonb),
    'total',    (SELECT COUNT(*) FROM _import_rows) + v_skipped
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.import_to_master_catalog(uuid, jsonb) TO authenticated;
