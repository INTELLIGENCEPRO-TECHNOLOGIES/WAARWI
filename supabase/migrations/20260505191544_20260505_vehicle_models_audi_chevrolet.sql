/*
  # Modèles Audi et Chevrolet + mise à jour provision_tenant

  Ajoute les modèles manquants pour Audi et Chevrolet sur tous les tenants existants.
*/

DO $$
DECLARE
  r RECORD;
  b_audi uuid;
  b_chevrolet uuid;
BEGIN
  FOR r IN SELECT id AS tenant_id FROM tenants LOOP

    SELECT id INTO b_audi      FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Audi'      LIMIT 1;
    SELECT id INTO b_chevrolet FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Chevrolet' LIMIT 1;

    -- ── AUDI ────────────────────────────────────────────────────────────────
    IF b_audi IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_audi, 'A1',           2010, NULL, 'Essence'),
        (r.tenant_id, b_audi, 'A2',           1999, 2005, 'Diesel'),
        (r.tenant_id, b_audi, 'A3',           1996, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'A4',           1994, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'A5',           2007, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'A6',           1994, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'A7',           2010, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'A8',           1994, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'Q2',           2016, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'Q3',           2011, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'Q5',           2008, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'Q7',           2005, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'Q8',           2018, NULL, 'Diesel'),
        (r.tenant_id, b_audi, 'TT',           1998, NULL, 'Essence'),
        (r.tenant_id, b_audi, 'R8',           2006, NULL, 'Essence'),
        (r.tenant_id, b_audi, 'S3',           1999, NULL, 'Essence'),
        (r.tenant_id, b_audi, 'S4',           1991, NULL, 'Essence'),
        (r.tenant_id, b_audi, 'RS4',          2000, NULL, 'Essence'),
        (r.tenant_id, b_audi, '80',           1972, 1996, 'Essence'),
        (r.tenant_id, b_audi, '100',          1968, 1994, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── CHEVROLET ───────────────────────────────────────────────────────────
    IF b_chevrolet IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_chevrolet, 'Aveo',          2002, 2017, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Spark',         2005, NULL, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Cruze',         2009, 2019, 'Diesel'),
        (r.tenant_id, b_chevrolet, 'Malibu',        1964, NULL, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Captiva',       2006, 2018, 'Diesel'),
        (r.tenant_id, b_chevrolet, 'Trax',          2012, NULL, 'Diesel'),
        (r.tenant_id, b_chevrolet, 'Equinox',       2004, NULL, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Traverse',      2008, NULL, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Tahoe',         1995, NULL, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Suburban',      1935, NULL, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Silverado',     1999, NULL, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Colorado',      2004, NULL, 'Diesel'),
        (r.tenant_id, b_chevrolet, 'Blazer',        1969, NULL, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Orlando',       2010, 2018, 'Diesel'),
        (r.tenant_id, b_chevrolet, 'Optra',         2002, 2013, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Lacetti',       2004, 2013, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Niva',          2002, NULL, 'Essence'),
        (r.tenant_id, b_chevrolet, 'Express',       1996, NULL, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

  END LOOP;
END $$;
