/*
  # Master catalog export RPC

  1. Changes
    - New function `export_master_catalog_items()` returns all master catalog items
      joined with activity / catalog / category / subcategory names, for Excel export.

  2. Security
    - Restricted to super admins via `is_super_admin()` check.
*/

CREATE OR REPLACE FUNCTION public.export_master_catalog_items()
RETURNS TABLE (
  activity_slug text,
  catalog_name text,
  category_name text,
  subcategory_name text,
  brand text,
  manufacturer_ref text,
  designation text,
  model text,
  unit text,
  purchase_price numeric,
  sale_price numeric,
  vat_rate numeric,
  barcode text,
  description text,
  image_url text,
  source_url text,
  source_name text,
  reliability_level text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Accès refusé';
  END IF;

  RETURN QUERY
  SELECT
    bat.slug,
    mc.name,
    COALESCE(cat.name, ''),
    COALESCE(sub.name, ''),
    COALESCE(i.brand, ''),
    COALESCE(i.manufacturer_ref, ''),
    COALESCE(i.designation, ''),
    COALESCE(i.model, ''),
    COALESCE(i.unit, ''),
    COALESCE(i.purchase_price, 0),
    COALESCE(i.sale_price, 0),
    COALESCE(i.vat_rate, 0),
    COALESCE(i.barcode, ''),
    COALESCE(i.description, ''),
    COALESCE(i.image_url, ''),
    COALESCE(i.source_url, ''),
    COALESCE(i.source_name, ''),
    COALESCE(i.reliability_level, '')
  FROM master_catalog_items i
  JOIN master_catalogs mc ON mc.id = i.master_catalog_id
  JOIN business_activity_types bat ON bat.id = mc.business_activity_type_id
  LEFT JOIN master_catalog_categories cat ON cat.id = i.category_id
  LEFT JOIN master_catalog_categories sub ON sub.id = i.subcategory_id
  ORDER BY bat.slug, mc.name, cat.name NULLS FIRST, sub.name NULLS FIRST, i.designation;
END;
$$;

GRANT EXECUTE ON FUNCTION public.export_master_catalog_items() TO authenticated;
