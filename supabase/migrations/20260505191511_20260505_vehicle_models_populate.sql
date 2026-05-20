/*
  # Peuplement des modèles de véhicules par marque

  Pour chaque tenant existant, insère les modèles populaires pour toutes les marques.
  Marché prioritaire: Afrique de l'Ouest / Sénégal.

  Marques couvertes (20): Toyota, Nissan, Hyundai, Kia, Renault, Peugeot,
  Citroën, Volkswagen, Mercedes-Benz, BMW, Ford, Opel, Mitsubishi, Honda,
  Suzuki, Isuzu, Land Rover, Fiat, Dacia, Mazda

  ~300 modèles au total.
*/

DO $$
DECLARE
  r RECORD;
  b_toyota uuid; b_nissan uuid; b_hyundai uuid; b_kia uuid;
  b_renault uuid; b_peugeot uuid; b_citroen uuid; b_vw uuid;
  b_mercedes uuid; b_bmw uuid; b_ford uuid; b_opel uuid;
  b_mitsubishi uuid; b_honda uuid; b_suzuki uuid; b_isuzu uuid;
  b_landrover uuid; b_fiat uuid; b_dacia uuid; b_mazda uuid;
BEGIN
  FOR r IN SELECT id AS tenant_id FROM tenants LOOP

    -- Récupérer les IDs de marques pour ce tenant
    SELECT id INTO b_toyota     FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Toyota'       LIMIT 1;
    SELECT id INTO b_nissan     FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Nissan'       LIMIT 1;
    SELECT id INTO b_hyundai    FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Hyundai'      LIMIT 1;
    SELECT id INTO b_kia        FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Kia'          LIMIT 1;
    SELECT id INTO b_renault    FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Renault'      LIMIT 1;
    SELECT id INTO b_peugeot    FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Peugeot'      LIMIT 1;
    SELECT id INTO b_citroen    FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Citroën'      LIMIT 1;
    SELECT id INTO b_vw         FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Volkswagen'   LIMIT 1;
    SELECT id INTO b_mercedes   FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Mercedes-Benz' LIMIT 1;
    SELECT id INTO b_bmw        FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'BMW'          LIMIT 1;
    SELECT id INTO b_ford       FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Ford'         LIMIT 1;
    SELECT id INTO b_opel       FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Opel'         LIMIT 1;
    SELECT id INTO b_mitsubishi FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Mitsubishi'   LIMIT 1;
    SELECT id INTO b_honda      FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Honda'        LIMIT 1;
    SELECT id INTO b_suzuki     FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Suzuki'       LIMIT 1;
    SELECT id INTO b_isuzu      FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Isuzu'        LIMIT 1;
    SELECT id INTO b_landrover  FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Land Rover'   LIMIT 1;
    SELECT id INTO b_fiat       FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Fiat'         LIMIT 1;
    SELECT id INTO b_dacia      FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Dacia'        LIMIT 1;
    SELECT id INTO b_mazda      FROM vehicle_brands WHERE tenant_id = r.tenant_id AND name = 'Mazda'        LIMIT 1;

    -- ── TOYOTA ──────────────────────────────────────────────────────────────
    IF b_toyota IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_toyota, 'Corolla',        1966, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Camry',          1982, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Yaris',          1999, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Auris',          2006, 2019, 'Essence'),
        (r.tenant_id, b_toyota, 'Avensis',        1997, 2018, 'Essence'),
        (r.tenant_id, b_toyota, 'Prius',          1997, NULL, 'Hybride'),
        (r.tenant_id, b_toyota, 'RAV4',           1994, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Land Cruiser',   1951, NULL, 'Diesel'),
        (r.tenant_id, b_toyota, 'Land Cruiser 70',1984, NULL, 'Diesel'),
        (r.tenant_id, b_toyota, 'Land Cruiser 200',2007,NULL, 'Diesel'),
        (r.tenant_id, b_toyota, 'Hilux',          1968, NULL, 'Diesel'),
        (r.tenant_id, b_toyota, 'HiAce',          1967, NULL, 'Diesel'),
        (r.tenant_id, b_toyota, 'Prado',          1990, NULL, 'Diesel'),
        (r.tenant_id, b_toyota, 'Fortuner',       2005, NULL, 'Diesel'),
        (r.tenant_id, b_toyota, 'Innova',         2004, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Rush',           2006, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Vitz',           1999, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Verso',          2009, 2018, 'Essence'),
        (r.tenant_id, b_toyota, 'Probox',         2002, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Succeed',        2002, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Rav4 Hybrid',    2016, NULL, 'Hybride'),
        (r.tenant_id, b_toyota, 'C-HR',           2016, NULL, 'Hybride'),
        (r.tenant_id, b_toyota, 'Highlander',     2001, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Sequoia',        2001, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Tundra',         1999, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Sienna',         1997, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Alphard',        2002, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Previa',         1990, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Avanza',         2003, NULL, 'Essence'),
        (r.tenant_id, b_toyota, 'Dyna',           1959, NULL, 'Diesel')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── NISSAN ──────────────────────────────────────────────────────────────
    IF b_nissan IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_nissan, 'Micra',          1982, NULL, 'Essence'),
        (r.tenant_id, b_nissan, 'Note',           2004, NULL, 'Essence'),
        (r.tenant_id, b_nissan, 'Tiida',          2004, 2014, 'Essence'),
        (r.tenant_id, b_nissan, 'Almera',         1995, 2018, 'Essence'),
        (r.tenant_id, b_nissan, 'Sentra',         1982, NULL, 'Essence'),
        (r.tenant_id, b_nissan, 'Sunny',          1966, 2006, 'Essence'),
        (r.tenant_id, b_nissan, 'Primera',        1990, 2007, 'Essence'),
        (r.tenant_id, b_nissan, 'Bluebird',       1957, 2006, 'Essence'),
        (r.tenant_id, b_nissan, 'X-Trail',        2001, NULL, 'Diesel'),
        (r.tenant_id, b_nissan, 'Qashqai',        2006, NULL, 'Essence'),
        (r.tenant_id, b_nissan, 'Juke',           2010, NULL, 'Essence'),
        (r.tenant_id, b_nissan, 'Pathfinder',     1986, NULL, 'Diesel'),
        (r.tenant_id, b_nissan, 'Patrol',         1951, NULL, 'Diesel'),
        (r.tenant_id, b_nissan, 'Navara',         1997, NULL, 'Diesel'),
        (r.tenant_id, b_nissan, 'Frontier',       1997, NULL, 'Diesel'),
        (r.tenant_id, b_nissan, 'Terrano',        1985, 2007, 'Diesel'),
        (r.tenant_id, b_nissan, 'Murano',         2002, NULL, 'Essence'),
        (r.tenant_id, b_nissan, 'Armada',         2003, NULL, 'Essence'),
        (r.tenant_id, b_nissan, 'Urvan',          1980, NULL, 'Diesel'),
        (r.tenant_id, b_nissan, 'Vanette',        1978, 2011, 'Essence'),
        (r.tenant_id, b_nissan, 'Cabstar',        1969, NULL, 'Diesel'),
        (r.tenant_id, b_nissan, 'Serena',         1991, NULL, 'Essence'),
        (r.tenant_id, b_nissan, 'Prairie',        1982, 1998, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── HYUNDAI ─────────────────────────────────────────────────────────────
    IF b_hyundai IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_hyundai, 'i10',           2007, NULL, 'Essence'),
        (r.tenant_id, b_hyundai, 'i20',           2008, NULL, 'Essence'),
        (r.tenant_id, b_hyundai, 'i30',           2007, NULL, 'Essence'),
        (r.tenant_id, b_hyundai, 'Accent',        1994, NULL, 'Essence'),
        (r.tenant_id, b_hyundai, 'Elantra',       1990, NULL, 'Essence'),
        (r.tenant_id, b_hyundai, 'Sonata',        1985, NULL, 'Essence'),
        (r.tenant_id, b_hyundai, 'Tucson',        2004, NULL, 'Diesel'),
        (r.tenant_id, b_hyundai, 'Santa Fe',      2001, NULL, 'Diesel'),
        (r.tenant_id, b_hyundai, 'ix35',          2009, 2017, 'Diesel'),
        (r.tenant_id, b_hyundai, 'Creta',         2015, NULL, 'Essence'),
        (r.tenant_id, b_hyundai, 'Kona',          2017, NULL, 'Essence'),
        (r.tenant_id, b_hyundai, 'Palisade',      2018, NULL, 'Diesel'),
        (r.tenant_id, b_hyundai, 'H-1',           2007, NULL, 'Diesel'),
        (r.tenant_id, b_hyundai, 'H100',          1993, NULL, 'Diesel'),
        (r.tenant_id, b_hyundai, 'Porter',        1996, NULL, 'Diesel'),
        (r.tenant_id, b_hyundai, 'Atos',          1997, 2014, 'Essence'),
        (r.tenant_id, b_hyundai, 'Getz',          2002, 2011, 'Essence'),
        (r.tenant_id, b_hyundai, 'Matrix',        2001, 2010, 'Essence'),
        (r.tenant_id, b_hyundai, 'Terracan',      2001, 2007, 'Diesel'),
        (r.tenant_id, b_hyundai, 'Galloper',      1991, 2003, 'Diesel')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── KIA ─────────────────────────────────────────────────────────────────
    IF b_kia IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_kia, 'Picanto',          2004, NULL, 'Essence'),
        (r.tenant_id, b_kia, 'Rio',              2000, NULL, 'Essence'),
        (r.tenant_id, b_kia, 'Cerato',           2003, NULL, 'Essence'),
        (r.tenant_id, b_kia, 'Sportage',         1993, NULL, 'Diesel'),
        (r.tenant_id, b_kia, 'Sorento',          2002, NULL, 'Diesel'),
        (r.tenant_id, b_kia, 'Stinger',          2017, NULL, 'Essence'),
        (r.tenant_id, b_kia, 'Carnival',         1998, NULL, 'Diesel'),
        (r.tenant_id, b_kia, 'Ceed',             2006, NULL, 'Essence'),
        (r.tenant_id, b_kia, 'Soul',             2008, NULL, 'Essence'),
        (r.tenant_id, b_kia, 'Optima',           2000, 2020, 'Essence'),
        (r.tenant_id, b_kia, 'Mohave',           2008, NULL, 'Diesel'),
        (r.tenant_id, b_kia, 'Telluride',        2019, NULL, 'Essence'),
        (r.tenant_id, b_kia, 'Bongo',            1980, NULL, 'Diesel'),
        (r.tenant_id, b_kia, 'Pregio',           1995, 2006, 'Diesel'),
        (r.tenant_id, b_kia, 'Pride',            1987, 2002, 'Essence'),
        (r.tenant_id, b_kia, 'Sephia',           1992, 2003, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── RENAULT ─────────────────────────────────────────────────────────────
    IF b_renault IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_renault, 'Clio',          1990, NULL, 'Essence'),
        (r.tenant_id, b_renault, 'Megane',        1995, NULL, 'Essence'),
        (r.tenant_id, b_renault, 'Laguna',        1993, 2015, 'Essence'),
        (r.tenant_id, b_renault, 'Scenic',        1996, NULL, 'Essence'),
        (r.tenant_id, b_renault, 'Espace',        1984, NULL, 'Diesel'),
        (r.tenant_id, b_renault, 'Trafic',        1980, NULL, 'Diesel'),
        (r.tenant_id, b_renault, 'Master',        1980, NULL, 'Diesel'),
        (r.tenant_id, b_renault, 'Kangoo',        1997, NULL, 'Diesel'),
        (r.tenant_id, b_renault, 'Duster',        2010, NULL, 'Diesel'),
        (r.tenant_id, b_renault, 'Captur',        2013, NULL, 'Essence'),
        (r.tenant_id, b_renault, 'Kadjar',        2015, 2022, 'Diesel'),
        (r.tenant_id, b_renault, 'Koleos',        2008, NULL, 'Diesel'),
        (r.tenant_id, b_renault, 'Twingo',        1992, NULL, 'Essence'),
        (r.tenant_id, b_renault, 'Symbol',        1999, NULL, 'Essence'),
        (r.tenant_id, b_renault, 'Logan',         2004, NULL, 'Essence'),
        (r.tenant_id, b_renault, 'Sandero',       2007, NULL, 'Essence'),
        (r.tenant_id, b_renault, '19',            1988, 2000, 'Essence'),
        (r.tenant_id, b_renault, '21',            1986, 1994, 'Essence'),
        (r.tenant_id, b_renault, 'Fluence',       2009, 2017, 'Diesel'),
        (r.tenant_id, b_renault, 'Zoe',           2012, NULL, 'Electrique')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── PEUGEOT ─────────────────────────────────────────────────────────────
    IF b_peugeot IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_peugeot, '106',           1991, 2004, 'Essence'),
        (r.tenant_id, b_peugeot, '107',           2005, 2014, 'Essence'),
        (r.tenant_id, b_peugeot, '108',           2014, 2021, 'Essence'),
        (r.tenant_id, b_peugeot, '205',           1983, 1998, 'Essence'),
        (r.tenant_id, b_peugeot, '206',           1998, 2013, 'Essence'),
        (r.tenant_id, b_peugeot, '207',           2006, 2015, 'Essence'),
        (r.tenant_id, b_peugeot, '208',           2012, NULL, 'Essence'),
        (r.tenant_id, b_peugeot, '301',           2012, NULL, 'Essence'),
        (r.tenant_id, b_peugeot, '306',           1993, 2002, 'Diesel'),
        (r.tenant_id, b_peugeot, '307',           2001, 2008, 'Diesel'),
        (r.tenant_id, b_peugeot, '308',           2007, NULL, 'Diesel'),
        (r.tenant_id, b_peugeot, '405',           1987, 1997, 'Essence'),
        (r.tenant_id, b_peugeot, '406',           1995, 2004, 'Diesel'),
        (r.tenant_id, b_peugeot, '407',           2004, 2011, 'Diesel'),
        (r.tenant_id, b_peugeot, '408',           2010, NULL, 'Diesel'),
        (r.tenant_id, b_peugeot, '2008',          2013, NULL, 'Diesel'),
        (r.tenant_id, b_peugeot, '3008',          2009, NULL, 'Diesel'),
        (r.tenant_id, b_peugeot, '5008',          2009, NULL, 'Diesel'),
        (r.tenant_id, b_peugeot, '4008',          2012, 2017, 'Diesel'),
        (r.tenant_id, b_peugeot, 'Partner',       1996, NULL, 'Diesel'),
        (r.tenant_id, b_peugeot, 'Expert',        1995, NULL, 'Diesel'),
        (r.tenant_id, b_peugeot, 'Boxer',         1994, NULL, 'Diesel'),
        (r.tenant_id, b_peugeot, '504',           1968, 1983, 'Essence'),
        (r.tenant_id, b_peugeot, '505',           1979, 1992, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── CITROËN ─────────────────────────────────────────────────────────────
    IF b_citroen IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_citroen, 'C1',            2005, NULL, 'Essence'),
        (r.tenant_id, b_citroen, 'C2',            2003, 2009, 'Essence'),
        (r.tenant_id, b_citroen, 'C3',            2002, NULL, 'Essence'),
        (r.tenant_id, b_citroen, 'C3 Aircross',   2017, NULL, 'Essence'),
        (r.tenant_id, b_citroen, 'C4',            2004, NULL, 'Diesel'),
        (r.tenant_id, b_citroen, 'C4 Cactus',     2014, 2021, 'Diesel'),
        (r.tenant_id, b_citroen, 'C5',            2001, 2017, 'Diesel'),
        (r.tenant_id, b_citroen, 'C5 Aircross',   2017, NULL, 'Diesel'),
        (r.tenant_id, b_citroen, 'C-Elysée',      2012, NULL, 'Diesel'),
        (r.tenant_id, b_citroen, 'Berlingo',       1996, NULL, 'Diesel'),
        (r.tenant_id, b_citroen, 'Jumpy',          1994, NULL, 'Diesel'),
        (r.tenant_id, b_citroen, 'Jumper',         1994, NULL, 'Diesel'),
        (r.tenant_id, b_citroen, 'Saxo',           1996, 2004, 'Essence'),
        (r.tenant_id, b_citroen, 'Xsara',          1997, 2004, 'Diesel'),
        (r.tenant_id, b_citroen, 'Xsara Picasso',  1999, 2010, 'Diesel'),
        (r.tenant_id, b_citroen, 'Picasso',        2013, 2017, 'Diesel'),
        (r.tenant_id, b_citroen, 'ZX',             1991, 1997, 'Essence'),
        (r.tenant_id, b_citroen, 'AX',             1986, 1998, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── VOLKSWAGEN ──────────────────────────────────────────────────────────
    IF b_vw IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_vw, 'Golf',              1974, NULL, 'Essence'),
        (r.tenant_id, b_vw, 'Polo',              1975, NULL, 'Essence'),
        (r.tenant_id, b_vw, 'Passat',            1973, NULL, 'Diesel'),
        (r.tenant_id, b_vw, 'Jetta',             1979, NULL, 'Essence'),
        (r.tenant_id, b_vw, 'Tiguan',            2007, NULL, 'Diesel'),
        (r.tenant_id, b_vw, 'Touareg',           2002, NULL, 'Diesel'),
        (r.tenant_id, b_vw, 'Touran',            2003, NULL, 'Diesel'),
        (r.tenant_id, b_vw, 'Caddy',             1979, NULL, 'Diesel'),
        (r.tenant_id, b_vw, 'Transporter T4',    1990, 2003, 'Diesel'),
        (r.tenant_id, b_vw, 'Transporter T5',    2003, 2015, 'Diesel'),
        (r.tenant_id, b_vw, 'Transporter T6',    2015, NULL, 'Diesel'),
        (r.tenant_id, b_vw, 'Crafter',           2006, NULL, 'Diesel'),
        (r.tenant_id, b_vw, 'LT',                1975, 2006, 'Diesel'),
        (r.tenant_id, b_vw, 'Bora',              1998, 2005, 'Essence'),
        (r.tenant_id, b_vw, 'Beetle',            1997, 2019, 'Essence'),
        (r.tenant_id, b_vw, 'Amarok',            2010, NULL, 'Diesel'),
        (r.tenant_id, b_vw, 'Scirocco',          2008, 2017, 'Essence'),
        (r.tenant_id, b_vw, 'Sharan',            1995, 2022, 'Diesel')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── MERCEDES-BENZ ───────────────────────────────────────────────────────
    IF b_mercedes IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_mercedes, 'Classe A',     1997, NULL, 'Essence'),
        (r.tenant_id, b_mercedes, 'Classe B',     2005, NULL, 'Essence'),
        (r.tenant_id, b_mercedes, 'Classe C',     1993, NULL, 'Diesel'),
        (r.tenant_id, b_mercedes, 'Classe E',     1953, NULL, 'Diesel'),
        (r.tenant_id, b_mercedes, 'Classe S',     1954, NULL, 'Essence'),
        (r.tenant_id, b_mercedes, 'Classe ML',    1997, 2015, 'Diesel'),
        (r.tenant_id, b_mercedes, 'GLC',          2015, NULL, 'Diesel'),
        (r.tenant_id, b_mercedes, 'GLE',          2015, NULL, 'Diesel'),
        (r.tenant_id, b_mercedes, 'GLS',          2015, NULL, 'Diesel'),
        (r.tenant_id, b_mercedes, 'GLK',          2008, 2015, 'Diesel'),
        (r.tenant_id, b_mercedes, 'GLA',          2013, NULL, 'Essence'),
        (r.tenant_id, b_mercedes, 'CLA',          2013, NULL, 'Essence'),
        (r.tenant_id, b_mercedes, 'Sprinter',     1995, NULL, 'Diesel'),
        (r.tenant_id, b_mercedes, 'Vito',         1996, NULL, 'Diesel'),
        (r.tenant_id, b_mercedes, 'Viano',        2003, 2014, 'Diesel'),
        (r.tenant_id, b_mercedes, 'Citan',        2012, NULL, 'Diesel'),
        (r.tenant_id, b_mercedes, 'Actros',       1995, NULL, 'Diesel'),
        (r.tenant_id, b_mercedes, '190',          1982, 1993, 'Essence'),
        (r.tenant_id, b_mercedes, '200-300 W124', 1984, 1997, 'Diesel'),
        (r.tenant_id, b_mercedes, 'CLS',          2004, NULL, 'Diesel')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── BMW ─────────────────────────────────────────────────────────────────
    IF b_bmw IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_bmw, 'Série 1',          2004, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'Série 2',          2014, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'Série 3',          1975, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'Série 4',          2013, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'Série 5',          1972, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'Série 6',          1976, NULL, 'Essence'),
        (r.tenant_id, b_bmw, 'Série 7',          1977, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'X1',               2009, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'X3',               2003, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'X5',               1999, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'X6',               2008, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'X7',               2019, NULL, 'Diesel'),
        (r.tenant_id, b_bmw, 'Z3',               1995, 2002, 'Essence'),
        (r.tenant_id, b_bmw, 'Z4',               2002, NULL, 'Essence'),
        (r.tenant_id, b_bmw, 'M3',               1986, NULL, 'Essence'),
        (r.tenant_id, b_bmw, 'M5',               1985, NULL, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── FORD ────────────────────────────────────────────────────────────────
    IF b_ford IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_ford, 'Fiesta',          1976, 2023, 'Essence'),
        (r.tenant_id, b_ford, 'Focus',           1998, NULL, 'Diesel'),
        (r.tenant_id, b_ford, 'Mondeo',          1993, 2022, 'Diesel'),
        (r.tenant_id, b_ford, 'Ka',              1996, 2021, 'Essence'),
        (r.tenant_id, b_ford, 'Kuga',            2008, NULL, 'Diesel'),
        (r.tenant_id, b_ford, 'EcoSport',        2003, NULL, 'Essence'),
        (r.tenant_id, b_ford, 'Edge',            2007, NULL, 'Essence'),
        (r.tenant_id, b_ford, 'Explorer',        1990, NULL, 'Essence'),
        (r.tenant_id, b_ford, 'Ranger',          1983, NULL, 'Diesel'),
        (r.tenant_id, b_ford, 'Transit',         1965, NULL, 'Diesel'),
        (r.tenant_id, b_ford, 'Transit Connect', 2002, NULL, 'Diesel'),
        (r.tenant_id, b_ford, 'Tourneo',         1995, NULL, 'Diesel'),
        (r.tenant_id, b_ford, 'Mustang',         1964, NULL, 'Essence'),
        (r.tenant_id, b_ford, 'F-150',           1948, NULL, 'Essence'),
        (r.tenant_id, b_ford, 'Fusion',          2002, 2020, 'Essence'),
        (r.tenant_id, b_ford, 'Escape',          2000, NULL, 'Essence'),
        (r.tenant_id, b_ford, 'Maverick',        1993, 2008, 'Diesel')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── OPEL ────────────────────────────────────────────────────────────────
    IF b_opel IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_opel, 'Corsa',           1982, NULL, 'Essence'),
        (r.tenant_id, b_opel, 'Astra',           1991, NULL, 'Diesel'),
        (r.tenant_id, b_opel, 'Vectra',          1988, 2008, 'Diesel'),
        (r.tenant_id, b_opel, 'Insignia',        2008, NULL, 'Diesel'),
        (r.tenant_id, b_opel, 'Meriva',          2003, 2017, 'Diesel'),
        (r.tenant_id, b_opel, 'Zafira',          1999, 2019, 'Diesel'),
        (r.tenant_id, b_opel, 'Mokka',           2012, NULL, 'Diesel'),
        (r.tenant_id, b_opel, 'Antara',          2006, 2015, 'Diesel'),
        (r.tenant_id, b_opel, 'Frontera',        1991, 2004, 'Diesel'),
        (r.tenant_id, b_opel, 'Vivaro',          2001, NULL, 'Diesel'),
        (r.tenant_id, b_opel, 'Movano',          1998, NULL, 'Diesel'),
        (r.tenant_id, b_opel, 'Combo',           1986, NULL, 'Diesel'),
        (r.tenant_id, b_opel, 'Omega',           1986, 2003, 'Diesel'),
        (r.tenant_id, b_opel, 'Kadett',          1936, 1991, 'Essence'),
        (r.tenant_id, b_opel, 'Tigra',           1994, 2010, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── MITSUBISHI ──────────────────────────────────────────────────────────
    IF b_mitsubishi IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_mitsubishi, 'Lancer',        1973, 2017, 'Essence'),
        (r.tenant_id, b_mitsubishi, 'Colt',          1962, 2012, 'Essence'),
        (r.tenant_id, b_mitsubishi, 'Carisma',       1995, 2004, 'Essence'),
        (r.tenant_id, b_mitsubishi, 'Galant',        1969, 2012, 'Essence'),
        (r.tenant_id, b_mitsubishi, 'Outlander',     2001, NULL, 'Diesel'),
        (r.tenant_id, b_mitsubishi, 'ASX',           2010, NULL, 'Diesel'),
        (r.tenant_id, b_mitsubishi, 'Pajero',        1982, NULL, 'Diesel'),
        (r.tenant_id, b_mitsubishi, 'Pajero Sport',  1996, NULL, 'Diesel'),
        (r.tenant_id, b_mitsubishi, 'L200',          1978, NULL, 'Diesel'),
        (r.tenant_id, b_mitsubishi, 'L300',          1979, NULL, 'Diesel'),
        (r.tenant_id, b_mitsubishi, 'Space Star',    1998, NULL, 'Essence'),
        (r.tenant_id, b_mitsubishi, 'Eclipse Cross', 2017, NULL, 'Essence'),
        (r.tenant_id, b_mitsubishi, 'Sigma',         1990, 1996, 'Essence'),
        (r.tenant_id, b_mitsubishi, 'Santamo',       1995, 2004, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── HONDA ───────────────────────────────────────────────────────────────
    IF b_honda IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_honda, 'Jazz',            2001, NULL, 'Essence'),
        (r.tenant_id, b_honda, 'Civic',           1972, NULL, 'Essence'),
        (r.tenant_id, b_honda, 'Accord',          1976, NULL, 'Diesel'),
        (r.tenant_id, b_honda, 'CR-V',            1995, NULL, 'Diesel'),
        (r.tenant_id, b_honda, 'HR-V',            1999, NULL, 'Essence'),
        (r.tenant_id, b_honda, 'Pilot',           2002, NULL, 'Essence'),
        (r.tenant_id, b_honda, 'City',            1981, NULL, 'Essence'),
        (r.tenant_id, b_honda, 'Fit',             2001, NULL, 'Essence'),
        (r.tenant_id, b_honda, 'Freed',           2008, NULL, 'Essence'),
        (r.tenant_id, b_honda, 'Element',         2003, 2011, 'Essence'),
        (r.tenant_id, b_honda, 'Ridgeline',       2005, NULL, 'Essence'),
        (r.tenant_id, b_honda, 'Odyssey',         1994, NULL, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── SUZUKI ──────────────────────────────────────────────────────────────
    IF b_suzuki IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_suzuki, 'Alto',           1979, NULL, 'Essence'),
        (r.tenant_id, b_suzuki, 'Swift',          1983, NULL, 'Essence'),
        (r.tenant_id, b_suzuki, 'Baleno',         1995, NULL, 'Essence'),
        (r.tenant_id, b_suzuki, 'Celerio',        2014, NULL, 'Essence'),
        (r.tenant_id, b_suzuki, 'Ignis',          2000, NULL, 'Essence'),
        (r.tenant_id, b_suzuki, 'Vitara',         1988, NULL, 'Diesel'),
        (r.tenant_id, b_suzuki, 'Grand Vitara',   1997, 2015, 'Diesel'),
        (r.tenant_id, b_suzuki, 'Jimny',          1970, NULL, 'Essence'),
        (r.tenant_id, b_suzuki, 'Liana',          2001, 2007, 'Essence'),
        (r.tenant_id, b_suzuki, 'Wagon R',        1993, NULL, 'Essence'),
        (r.tenant_id, b_suzuki, 'S-Cross',        2013, NULL, 'Diesel'),
        (r.tenant_id, b_suzuki, 'SX4',            2006, NULL, 'Diesel'),
        (r.tenant_id, b_suzuki, 'Ertiga',         2012, NULL, 'Essence'),
        (r.tenant_id, b_suzuki, 'Carry',          1965, NULL, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── ISUZU ───────────────────────────────────────────────────────────────
    IF b_isuzu IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_isuzu, 'D-Max',          2002, NULL, 'Diesel'),
        (r.tenant_id, b_isuzu, 'MU-X',           2013, NULL, 'Diesel'),
        (r.tenant_id, b_isuzu, 'Trooper',        1981, 2002, 'Diesel'),
        (r.tenant_id, b_isuzu, 'Rodeo',          1988, 2004, 'Diesel'),
        (r.tenant_id, b_isuzu, 'NKR',            1985, NULL, 'Diesel'),
        (r.tenant_id, b_isuzu, 'NPR',            1985, NULL, 'Diesel'),
        (r.tenant_id, b_isuzu, 'NQR',            1996, NULL, 'Diesel'),
        (r.tenant_id, b_isuzu, 'FRR',            1996, NULL, 'Diesel'),
        (r.tenant_id, b_isuzu, 'Forward',        1987, NULL, 'Diesel'),
        (r.tenant_id, b_isuzu, 'Elf',            1959, NULL, 'Diesel'),
        (r.tenant_id, b_isuzu, 'Bighorn',        1981, 2002, 'Diesel'),
        (r.tenant_id, b_isuzu, 'Crosswind',      1997, NULL, 'Diesel')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── LAND ROVER ──────────────────────────────────────────────────────────
    IF b_landrover IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_landrover, 'Defender',         1983, NULL, 'Diesel'),
        (r.tenant_id, b_landrover, 'Discovery',        1989, NULL, 'Diesel'),
        (r.tenant_id, b_landrover, 'Discovery Sport',  2014, NULL, 'Diesel'),
        (r.tenant_id, b_landrover, 'Freelander',       1997, 2014, 'Diesel'),
        (r.tenant_id, b_landrover, 'Range Rover',      1970, NULL, 'Diesel'),
        (r.tenant_id, b_landrover, 'Range Rover Sport',2005, NULL, 'Diesel'),
        (r.tenant_id, b_landrover, 'Range Rover Evoque',2011,NULL, 'Diesel'),
        (r.tenant_id, b_landrover, 'Range Rover Velar',2017,NULL, 'Diesel')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── FIAT ────────────────────────────────────────────────────────────────
    IF b_fiat IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_fiat, 'Punto',           1993, 2018, 'Essence'),
        (r.tenant_id, b_fiat, 'Grande Punto',    2005, 2012, 'Diesel'),
        (r.tenant_id, b_fiat, 'Bravo',           1995, 2014, 'Diesel'),
        (r.tenant_id, b_fiat, 'Stilo',           2001, 2010, 'Diesel'),
        (r.tenant_id, b_fiat, 'Linea',           2006, 2015, 'Diesel'),
        (r.tenant_id, b_fiat, 'Tipo',            1988, NULL, 'Diesel'),
        (r.tenant_id, b_fiat, 'Panda',           1980, NULL, 'Essence'),
        (r.tenant_id, b_fiat, '500',             1957, NULL, 'Essence'),
        (r.tenant_id, b_fiat, 'Sedici',          2005, 2014, 'Diesel'),
        (r.tenant_id, b_fiat, 'Freemont',        2011, 2016, 'Diesel'),
        (r.tenant_id, b_fiat, 'Doblo',           2000, NULL, 'Diesel'),
        (r.tenant_id, b_fiat, 'Ducato',          1981, NULL, 'Diesel'),
        (r.tenant_id, b_fiat, 'Scudo',           1995, NULL, 'Diesel'),
        (r.tenant_id, b_fiat, 'Strada',          1998, NULL, 'Diesel'),
        (r.tenant_id, b_fiat, 'Tempra',          1990, 1999, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── DACIA ───────────────────────────────────────────────────────────────
    IF b_dacia IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_dacia, 'Logan',          2004, NULL, 'Essence'),
        (r.tenant_id, b_dacia, 'Sandero',        2008, NULL, 'Essence'),
        (r.tenant_id, b_dacia, 'Duster',         2010, NULL, 'Diesel'),
        (r.tenant_id, b_dacia, 'Lodgy',          2012, NULL, 'Diesel'),
        (r.tenant_id, b_dacia, 'Dokker',         2012, NULL, 'Diesel'),
        (r.tenant_id, b_dacia, 'Spring',         2021, NULL, 'Electrique'),
        (r.tenant_id, b_dacia, 'Jogger',         2021, NULL, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

    -- ── MAZDA ───────────────────────────────────────────────────────────────
    IF b_mazda IS NOT NULL THEN
      INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
        (r.tenant_id, b_mazda, 'Mazda2',         2007, NULL, 'Essence'),
        (r.tenant_id, b_mazda, 'Mazda3',         2003, NULL, 'Essence'),
        (r.tenant_id, b_mazda, 'Mazda6',         2002, NULL, 'Diesel'),
        (r.tenant_id, b_mazda, 'CX-3',           2015, NULL, 'Diesel'),
        (r.tenant_id, b_mazda, 'CX-5',           2012, NULL, 'Diesel'),
        (r.tenant_id, b_mazda, 'CX-7',           2006, 2012, 'Diesel'),
        (r.tenant_id, b_mazda, 'CX-9',           2006, NULL, 'Essence'),
        (r.tenant_id, b_mazda, 'BT-50',          2006, NULL, 'Diesel'),
        (r.tenant_id, b_mazda, 'MX-5',           1989, NULL, 'Essence'),
        (r.tenant_id, b_mazda, '323',            1977, 2003, 'Essence'),
        (r.tenant_id, b_mazda, '626',            1979, 2002, 'Essence')
      ON CONFLICT DO NOTHING;
    END IF;

  END LOOP;
END $$;
