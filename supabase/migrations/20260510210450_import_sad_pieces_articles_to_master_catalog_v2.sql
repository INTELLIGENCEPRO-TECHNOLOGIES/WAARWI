/*
  # Import SAD PIECES AUTO articles into master catalog (retry v2)

  Same as v1 but coalesces `model` to '' (NOT NULL constraint in
  master_catalog_items). Idempotent: de-duplicates on manufacturer_ref.
*/

WITH tenant_cats AS (
  SELECT DISTINCT pc.id, pc.parent_id, pc.name,
         lower(regexp_replace(coalesce(pc.code, pc.name), '[^a-zA-Z0-9]+', '-', 'g')) AS slug
    FROM public.part_categories pc
    JOIN public.articles a ON a.category_id = pc.id
   WHERE pc.tenant_id = '66ce2dfd-96bb-4ab6-815e-1b583e064fbc'
     AND a.tenant_id = '66ce2dfd-96bb-4ab6-815e-1b583e064fbc'
)
INSERT INTO public.master_catalog_categories (master_catalog_id, name, slug, sort_order, is_active)
SELECT 'b97801ff-0ce7-42d8-9258-5d81560d8291', tc.name, tc.slug, 0, true
  FROM tenant_cats tc
 WHERE NOT EXISTS (
   SELECT 1 FROM public.master_catalog_categories mcc
    WHERE mcc.master_catalog_id = 'b97801ff-0ce7-42d8-9258-5d81560d8291'
      AND mcc.slug = tc.slug
 );

UPDATE public.master_catalog_categories mcc
   SET parent_id = parent_mcc.id
  FROM public.part_categories child_pc
  JOIN public.part_categories parent_pc ON parent_pc.id = child_pc.parent_id
  JOIN public.master_catalog_categories parent_mcc
    ON parent_mcc.master_catalog_id = 'b97801ff-0ce7-42d8-9258-5d81560d8291'
   AND parent_mcc.slug = lower(regexp_replace(coalesce(parent_pc.code, parent_pc.name), '[^a-zA-Z0-9]+', '-', 'g'))
 WHERE mcc.master_catalog_id = 'b97801ff-0ce7-42d8-9258-5d81560d8291'
   AND mcc.slug = lower(regexp_replace(coalesce(child_pc.code, child_pc.name), '[^a-zA-Z0-9]+', '-', 'g'))
   AND child_pc.tenant_id = '66ce2dfd-96bb-4ab6-815e-1b583e064fbc'
   AND parent_pc.tenant_id = '66ce2dfd-96bb-4ab6-815e-1b583e064fbc'
   AND mcc.parent_id IS DISTINCT FROM parent_mcc.id;

INSERT INTO public.master_catalog_items (
  master_catalog_id, category_id, manufacturer_ref, designation, brand, model,
  unit, purchase_price, sale_price, vat_rate, barcode, description, image_url,
  source_name, reliability_level, is_active
)
SELECT DISTINCT ON (coalesce(nullif(a.manufacturer_ref,''), nullif(a.oem_ref,''), nullif(a.internal_ref,''), a.id::text))
  'b97801ff-0ce7-42d8-9258-5d81560d8291',
  mcc.id,
  coalesce(nullif(a.manufacturer_ref,''), nullif(a.oem_ref,''), nullif(a.internal_ref,''), a.id::text),
  a.name,
  coalesce(nullif(a.brand,''), ''),
  coalesce(nullif(a.model,''), ''),
  coalesce(nullif(a.unit,''), 'unite'),
  coalesce(a.purchase_price, 0),
  coalesce(a.sale_price, 0),
  coalesce(a.vat_rate, 0),
  nullif(a.barcode,''),
  nullif(a.description,''),
  nullif(a.image_url,''),
  'SAD PIECES AUTO',
  'verified',
  coalesce(a.is_active, true)
  FROM public.articles a
  LEFT JOIN public.part_categories pc ON pc.id = a.category_id
  LEFT JOIN public.master_catalog_categories mcc
    ON mcc.master_catalog_id = 'b97801ff-0ce7-42d8-9258-5d81560d8291'
   AND mcc.slug = lower(regexp_replace(coalesce(pc.code, pc.name, ''), '[^a-zA-Z0-9]+', '-', 'g'))
 WHERE a.tenant_id = '66ce2dfd-96bb-4ab6-815e-1b583e064fbc'
   AND NOT EXISTS (
     SELECT 1 FROM public.master_catalog_items mci
      WHERE mci.master_catalog_id = 'b97801ff-0ce7-42d8-9258-5d81560d8291'
        AND mci.manufacturer_ref = coalesce(nullif(a.manufacturer_ref,''), nullif(a.oem_ref,''), nullif(a.internal_ref,''), a.id::text)
   );
