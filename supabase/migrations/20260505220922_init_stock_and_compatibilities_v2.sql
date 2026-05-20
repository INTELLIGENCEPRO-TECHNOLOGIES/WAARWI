/*
  # Initialisation des stocks et compatibilités véhicules (v2)

  1. stock_levels — quantité initiale réaliste par article, sur le site principal
  2. article_compatibilities — liaison article ↔ modèle via parsing du nom
*/

DO $$
DECLARE
  tid  uuid := (SELECT id FROM tenants LIMIT 1);
  sid  uuid := (SELECT id FROM sites WHERE tenant_id = (SELECT id FROM tenants LIMIT 1) LIMIT 1);
BEGIN

  -- =====================================================================
  -- STOCK LEVELS
  -- =====================================================================
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity, reserved)
  SELECT
    a.tenant_id,
    a.id,
    sid,
    CASE
      WHEN a.internal_ref ILIKE 'FIL-%'   THEN (8  + (random()*12)::int)
      WHEN a.internal_ref ILIKE 'FRN-%'   THEN (6  + (random()*10)::int)
      WHEN a.internal_ref ILIKE 'AMOR-%'  THEN (3  + (random()*5)::int)
      WHEN a.internal_ref ILIKE 'BATT-%'  THEN (4  + (random()*8)::int)
      WHEN a.internal_ref ILIKE 'ALT-%'   THEN (2  + (random()*4)::int)
      WHEN a.internal_ref ILIKE 'PCH-%'   THEN (3  + (random()*5)::int)
      WHEN a.internal_ref ILIKE 'CAL-%'   THEN (3  + (random()*6)::int)
      WHEN a.internal_ref ILIKE 'CAPO-%'  THEN (2  + (random()*3)::int)
      WHEN a.internal_ref ILIKE 'AIL-%'   THEN (2  + (random()*4)::int)
      WHEN a.internal_ref ILIKE 'SPOI-%'  THEN (2  + (random()*4)::int)
      WHEN a.internal_ref ILIKE 'KIT-%'   THEN (1  + (random()*3)::int)
      WHEN a.internal_ref ILIKE 'PHA-%'   THEN (3  + (random()*5)::int)
      WHEN a.internal_ref ILIKE 'FEU-%'   THEN (3  + (random()*5)::int)
      WHEN a.internal_ref ILIKE 'DRL-%'   THEN (4  + (random()*6)::int)
      WHEN a.internal_ref ILIKE 'MARCH-%' THEN (2  + (random()*4)::int)
      WHEN a.internal_ref ILIKE 'CAM-%'   THEN (4  + (random()*8)::int)
      WHEN a.internal_ref ILIKE 'AND-%'   THEN (3  + (random()*5)::int)
      WHEN a.internal_ref ILIKE 'AUD-%'   THEN (2  + (random()*4)::int)
      WHEN a.internal_ref ILIKE 'INT-%'   THEN (4  + (random()*6)::int)
      WHEN a.unit = 'kit'                 THEN (1  + (random()*3)::int)
      ELSE (3 + (random()*7)::int)
    END::numeric,
    0
  FROM articles a
  WHERE a.tenant_id = tid
    AND NOT EXISTS (
      SELECT 1 FROM stock_levels sl WHERE sl.article_id = a.id
    );

  -- =====================================================================
  -- ARTICLE COMPATIBILITIES
  -- =====================================================================
  INSERT INTO article_compatibilities (tenant_id, article_id, brand_id, model_id)
  SELECT DISTINCT
    a.tenant_id,
    a.id,
    vb.id,
    vm.id
  FROM articles a
  JOIN vehicle_brands vb
    ON vb.tenant_id = tid
    AND (
      a.name ILIKE '%' || vb.name || '%'
      OR a.brand = vb.name
    )
  JOIN vehicle_models vm
    ON vm.tenant_id = tid
    AND vm.brand_id = vb.id
    AND a.name ILIKE '%' || vm.name || '%'
  WHERE a.tenant_id = tid
    AND length(vm.name) >= 3
    AND NOT EXISTS (
      SELECT 1 FROM article_compatibilities ac
      WHERE ac.article_id = a.id AND ac.model_id = vm.id
    );

END $$;
