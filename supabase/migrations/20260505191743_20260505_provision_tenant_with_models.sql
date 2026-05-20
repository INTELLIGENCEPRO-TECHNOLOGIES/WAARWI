/*
  # Mise à jour provision_tenant: ajout des modèles de véhicules

  La fonction provision_tenant insère maintenant automatiquement tous les modèles
  populaires pour chaque marque lors de la création d'un nouveau tenant.
  (~330 modèles couvrant 22 marques)
*/

CREATE OR REPLACE FUNCTION provision_vehicle_models(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b_toyota uuid; b_nissan uuid; b_hyundai uuid; b_kia uuid;
  b_renault uuid; b_peugeot uuid; b_citroen uuid; b_vw uuid;
  b_mercedes uuid; b_bmw uuid; b_ford uuid; b_opel uuid;
  b_mitsubishi uuid; b_honda uuid; b_suzuki uuid; b_isuzu uuid;
  b_landrover uuid; b_fiat uuid; b_dacia uuid; b_mazda uuid;
  b_audi uuid; b_chevrolet uuid;
BEGIN
  SELECT id INTO b_toyota     FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Toyota'        LIMIT 1;
  SELECT id INTO b_nissan     FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Nissan'        LIMIT 1;
  SELECT id INTO b_hyundai    FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Hyundai'       LIMIT 1;
  SELECT id INTO b_kia        FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Kia'           LIMIT 1;
  SELECT id INTO b_renault    FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Renault'       LIMIT 1;
  SELECT id INTO b_peugeot    FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Peugeot'       LIMIT 1;
  SELECT id INTO b_citroen    FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Citroën'       LIMIT 1;
  SELECT id INTO b_vw         FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Volkswagen'    LIMIT 1;
  SELECT id INTO b_mercedes   FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Mercedes-Benz' LIMIT 1;
  SELECT id INTO b_bmw        FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'BMW'           LIMIT 1;
  SELECT id INTO b_ford       FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Ford'          LIMIT 1;
  SELECT id INTO b_opel       FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Opel'          LIMIT 1;
  SELECT id INTO b_mitsubishi FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Mitsubishi'    LIMIT 1;
  SELECT id INTO b_honda      FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Honda'         LIMIT 1;
  SELECT id INTO b_suzuki     FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Suzuki'        LIMIT 1;
  SELECT id INTO b_isuzu      FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Isuzu'         LIMIT 1;
  SELECT id INTO b_landrover  FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Land Rover'    LIMIT 1;
  SELECT id INTO b_fiat       FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Fiat'          LIMIT 1;
  SELECT id INTO b_dacia      FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Dacia'         LIMIT 1;
  SELECT id INTO b_mazda      FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Mazda'         LIMIT 1;
  SELECT id INTO b_audi       FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Audi'          LIMIT 1;
  SELECT id INTO b_chevrolet  FROM vehicle_brands WHERE tenant_id = p_tenant_id AND name = 'Chevrolet'     LIMIT 1;

  IF b_toyota IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_toyota,'Corolla',1966,NULL,'Essence'),(p_tenant_id,b_toyota,'Camry',1982,NULL,'Essence'),
      (p_tenant_id,b_toyota,'Yaris',1999,NULL,'Essence'),(p_tenant_id,b_toyota,'Auris',2006,2019,'Essence'),
      (p_tenant_id,b_toyota,'Avensis',1997,2018,'Essence'),(p_tenant_id,b_toyota,'Prius',1997,NULL,'Hybride'),
      (p_tenant_id,b_toyota,'RAV4',1994,NULL,'Essence'),(p_tenant_id,b_toyota,'Land Cruiser',1951,NULL,'Diesel'),
      (p_tenant_id,b_toyota,'Land Cruiser 70',1984,NULL,'Diesel'),(p_tenant_id,b_toyota,'Land Cruiser 200',2007,NULL,'Diesel'),
      (p_tenant_id,b_toyota,'Hilux',1968,NULL,'Diesel'),(p_tenant_id,b_toyota,'HiAce',1967,NULL,'Diesel'),
      (p_tenant_id,b_toyota,'Prado',1990,NULL,'Diesel'),(p_tenant_id,b_toyota,'Fortuner',2005,NULL,'Diesel'),
      (p_tenant_id,b_toyota,'Innova',2004,NULL,'Essence'),(p_tenant_id,b_toyota,'Rush',2006,NULL,'Essence'),
      (p_tenant_id,b_toyota,'Vitz',1999,NULL,'Essence'),(p_tenant_id,b_toyota,'Verso',2009,2018,'Essence'),
      (p_tenant_id,b_toyota,'Probox',2002,NULL,'Essence'),(p_tenant_id,b_toyota,'Succeed',2002,NULL,'Essence'),
      (p_tenant_id,b_toyota,'C-HR',2016,NULL,'Hybride'),(p_tenant_id,b_toyota,'Highlander',2001,NULL,'Essence'),
      (p_tenant_id,b_toyota,'Sequoia',2001,NULL,'Essence'),(p_tenant_id,b_toyota,'Tundra',1999,NULL,'Essence'),
      (p_tenant_id,b_toyota,'Sienna',1997,NULL,'Essence'),(p_tenant_id,b_toyota,'Alphard',2002,NULL,'Essence'),
      (p_tenant_id,b_toyota,'Previa',1990,NULL,'Essence'),(p_tenant_id,b_toyota,'Avanza',2003,NULL,'Essence'),
      (p_tenant_id,b_toyota,'Dyna',1959,NULL,'Diesel') ON CONFLICT DO NOTHING;
  END IF;

  IF b_nissan IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_nissan,'Micra',1982,NULL,'Essence'),(p_tenant_id,b_nissan,'Note',2004,NULL,'Essence'),
      (p_tenant_id,b_nissan,'Tiida',2004,2014,'Essence'),(p_tenant_id,b_nissan,'Almera',1995,2018,'Essence'),
      (p_tenant_id,b_nissan,'Sentra',1982,NULL,'Essence'),(p_tenant_id,b_nissan,'Sunny',1966,2006,'Essence'),
      (p_tenant_id,b_nissan,'Primera',1990,2007,'Essence'),(p_tenant_id,b_nissan,'X-Trail',2001,NULL,'Diesel'),
      (p_tenant_id,b_nissan,'Qashqai',2006,NULL,'Essence'),(p_tenant_id,b_nissan,'Juke',2010,NULL,'Essence'),
      (p_tenant_id,b_nissan,'Pathfinder',1986,NULL,'Diesel'),(p_tenant_id,b_nissan,'Patrol',1951,NULL,'Diesel'),
      (p_tenant_id,b_nissan,'Navara',1997,NULL,'Diesel'),(p_tenant_id,b_nissan,'Terrano',1985,2007,'Diesel'),
      (p_tenant_id,b_nissan,'Murano',2002,NULL,'Essence'),(p_tenant_id,b_nissan,'Armada',2003,NULL,'Essence'),
      (p_tenant_id,b_nissan,'Urvan',1980,NULL,'Diesel'),(p_tenant_id,b_nissan,'Cabstar',1969,NULL,'Diesel'),
      (p_tenant_id,b_nissan,'Serena',1991,NULL,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_hyundai IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_hyundai,'i10',2007,NULL,'Essence'),(p_tenant_id,b_hyundai,'i20',2008,NULL,'Essence'),
      (p_tenant_id,b_hyundai,'i30',2007,NULL,'Essence'),(p_tenant_id,b_hyundai,'Accent',1994,NULL,'Essence'),
      (p_tenant_id,b_hyundai,'Elantra',1990,NULL,'Essence'),(p_tenant_id,b_hyundai,'Sonata',1985,NULL,'Essence'),
      (p_tenant_id,b_hyundai,'Tucson',2004,NULL,'Diesel'),(p_tenant_id,b_hyundai,'Santa Fe',2001,NULL,'Diesel'),
      (p_tenant_id,b_hyundai,'ix35',2009,2017,'Diesel'),(p_tenant_id,b_hyundai,'Creta',2015,NULL,'Essence'),
      (p_tenant_id,b_hyundai,'Kona',2017,NULL,'Essence'),(p_tenant_id,b_hyundai,'Palisade',2018,NULL,'Diesel'),
      (p_tenant_id,b_hyundai,'H-1',2007,NULL,'Diesel'),(p_tenant_id,b_hyundai,'H100',1993,NULL,'Diesel'),
      (p_tenant_id,b_hyundai,'Porter',1996,NULL,'Diesel'),(p_tenant_id,b_hyundai,'Atos',1997,2014,'Essence'),
      (p_tenant_id,b_hyundai,'Getz',2002,2011,'Essence'),(p_tenant_id,b_hyundai,'Galloper',1991,2003,'Diesel') ON CONFLICT DO NOTHING;
  END IF;

  IF b_kia IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_kia,'Picanto',2004,NULL,'Essence'),(p_tenant_id,b_kia,'Rio',2000,NULL,'Essence'),
      (p_tenant_id,b_kia,'Cerato',2003,NULL,'Essence'),(p_tenant_id,b_kia,'Sportage',1993,NULL,'Diesel'),
      (p_tenant_id,b_kia,'Sorento',2002,NULL,'Diesel'),(p_tenant_id,b_kia,'Carnival',1998,NULL,'Diesel'),
      (p_tenant_id,b_kia,'Ceed',2006,NULL,'Essence'),(p_tenant_id,b_kia,'Soul',2008,NULL,'Essence'),
      (p_tenant_id,b_kia,'Optima',2000,2020,'Essence'),(p_tenant_id,b_kia,'Mohave',2008,NULL,'Diesel'),
      (p_tenant_id,b_kia,'Telluride',2019,NULL,'Essence'),(p_tenant_id,b_kia,'Bongo',1980,NULL,'Diesel'),
      (p_tenant_id,b_kia,'Pregio',1995,2006,'Diesel'),(p_tenant_id,b_kia,'Pride',1987,2002,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_renault IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_renault,'Clio',1990,NULL,'Essence'),(p_tenant_id,b_renault,'Megane',1995,NULL,'Essence'),
      (p_tenant_id,b_renault,'Laguna',1993,2015,'Essence'),(p_tenant_id,b_renault,'Scenic',1996,NULL,'Essence'),
      (p_tenant_id,b_renault,'Espace',1984,NULL,'Diesel'),(p_tenant_id,b_renault,'Trafic',1980,NULL,'Diesel'),
      (p_tenant_id,b_renault,'Master',1980,NULL,'Diesel'),(p_tenant_id,b_renault,'Kangoo',1997,NULL,'Diesel'),
      (p_tenant_id,b_renault,'Duster',2010,NULL,'Diesel'),(p_tenant_id,b_renault,'Captur',2013,NULL,'Essence'),
      (p_tenant_id,b_renault,'Kadjar',2015,2022,'Diesel'),(p_tenant_id,b_renault,'Koleos',2008,NULL,'Diesel'),
      (p_tenant_id,b_renault,'Twingo',1992,NULL,'Essence'),(p_tenant_id,b_renault,'Symbol',1999,NULL,'Essence'),
      (p_tenant_id,b_renault,'Logan',2004,NULL,'Essence'),(p_tenant_id,b_renault,'Sandero',2007,NULL,'Essence'),
      (p_tenant_id,b_renault,'19',1988,2000,'Essence'),(p_tenant_id,b_renault,'21',1986,1994,'Essence'),
      (p_tenant_id,b_renault,'Fluence',2009,2017,'Diesel'),(p_tenant_id,b_renault,'Zoe',2012,NULL,'Electrique') ON CONFLICT DO NOTHING;
  END IF;

  IF b_peugeot IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_peugeot,'106',1991,2004,'Essence'),(p_tenant_id,b_peugeot,'205',1983,1998,'Essence'),
      (p_tenant_id,b_peugeot,'206',1998,2013,'Essence'),(p_tenant_id,b_peugeot,'207',2006,2015,'Essence'),
      (p_tenant_id,b_peugeot,'208',2012,NULL,'Essence'),(p_tenant_id,b_peugeot,'301',2012,NULL,'Essence'),
      (p_tenant_id,b_peugeot,'306',1993,2002,'Diesel'),(p_tenant_id,b_peugeot,'307',2001,2008,'Diesel'),
      (p_tenant_id,b_peugeot,'308',2007,NULL,'Diesel'),(p_tenant_id,b_peugeot,'405',1987,1997,'Essence'),
      (p_tenant_id,b_peugeot,'406',1995,2004,'Diesel'),(p_tenant_id,b_peugeot,'407',2004,2011,'Diesel'),
      (p_tenant_id,b_peugeot,'408',2010,NULL,'Diesel'),(p_tenant_id,b_peugeot,'2008',2013,NULL,'Diesel'),
      (p_tenant_id,b_peugeot,'3008',2009,NULL,'Diesel'),(p_tenant_id,b_peugeot,'5008',2009,NULL,'Diesel'),
      (p_tenant_id,b_peugeot,'Partner',1996,NULL,'Diesel'),(p_tenant_id,b_peugeot,'Expert',1995,NULL,'Diesel'),
      (p_tenant_id,b_peugeot,'Boxer',1994,NULL,'Diesel'),(p_tenant_id,b_peugeot,'504',1968,1983,'Essence'),
      (p_tenant_id,b_peugeot,'505',1979,1992,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_citroen IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_citroen,'C1',2005,NULL,'Essence'),(p_tenant_id,b_citroen,'C3',2002,NULL,'Essence'),
      (p_tenant_id,b_citroen,'C3 Aircross',2017,NULL,'Essence'),(p_tenant_id,b_citroen,'C4',2004,NULL,'Diesel'),
      (p_tenant_id,b_citroen,'C4 Cactus',2014,2021,'Diesel'),(p_tenant_id,b_citroen,'C5',2001,2017,'Diesel'),
      (p_tenant_id,b_citroen,'C5 Aircross',2017,NULL,'Diesel'),(p_tenant_id,b_citroen,'C-Elysée',2012,NULL,'Diesel'),
      (p_tenant_id,b_citroen,'Berlingo',1996,NULL,'Diesel'),(p_tenant_id,b_citroen,'Jumpy',1994,NULL,'Diesel'),
      (p_tenant_id,b_citroen,'Jumper',1994,NULL,'Diesel'),(p_tenant_id,b_citroen,'Saxo',1996,2004,'Essence'),
      (p_tenant_id,b_citroen,'Xsara',1997,2004,'Diesel'),(p_tenant_id,b_citroen,'Xsara Picasso',1999,2010,'Diesel'),
      (p_tenant_id,b_citroen,'ZX',1991,1997,'Essence'),(p_tenant_id,b_citroen,'AX',1986,1998,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_vw IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_vw,'Golf',1974,NULL,'Essence'),(p_tenant_id,b_vw,'Polo',1975,NULL,'Essence'),
      (p_tenant_id,b_vw,'Passat',1973,NULL,'Diesel'),(p_tenant_id,b_vw,'Jetta',1979,NULL,'Essence'),
      (p_tenant_id,b_vw,'Tiguan',2007,NULL,'Diesel'),(p_tenant_id,b_vw,'Touareg',2002,NULL,'Diesel'),
      (p_tenant_id,b_vw,'Touran',2003,NULL,'Diesel'),(p_tenant_id,b_vw,'Caddy',1979,NULL,'Diesel'),
      (p_tenant_id,b_vw,'Transporter T4',1990,2003,'Diesel'),(p_tenant_id,b_vw,'Transporter T5',2003,2015,'Diesel'),
      (p_tenant_id,b_vw,'Transporter T6',2015,NULL,'Diesel'),(p_tenant_id,b_vw,'Crafter',2006,NULL,'Diesel'),
      (p_tenant_id,b_vw,'LT',1975,2006,'Diesel'),(p_tenant_id,b_vw,'Bora',1998,2005,'Essence'),
      (p_tenant_id,b_vw,'Amarok',2010,NULL,'Diesel'),(p_tenant_id,b_vw,'Sharan',1995,2022,'Diesel') ON CONFLICT DO NOTHING;
  END IF;

  IF b_mercedes IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_mercedes,'Classe A',1997,NULL,'Essence'),(p_tenant_id,b_mercedes,'Classe B',2005,NULL,'Essence'),
      (p_tenant_id,b_mercedes,'Classe C',1993,NULL,'Diesel'),(p_tenant_id,b_mercedes,'Classe E',1953,NULL,'Diesel'),
      (p_tenant_id,b_mercedes,'Classe S',1954,NULL,'Essence'),(p_tenant_id,b_mercedes,'Classe ML',1997,2015,'Diesel'),
      (p_tenant_id,b_mercedes,'GLC',2015,NULL,'Diesel'),(p_tenant_id,b_mercedes,'GLE',2015,NULL,'Diesel'),
      (p_tenant_id,b_mercedes,'GLS',2015,NULL,'Diesel'),(p_tenant_id,b_mercedes,'GLK',2008,2015,'Diesel'),
      (p_tenant_id,b_mercedes,'GLA',2013,NULL,'Essence'),(p_tenant_id,b_mercedes,'CLA',2013,NULL,'Essence'),
      (p_tenant_id,b_mercedes,'Sprinter',1995,NULL,'Diesel'),(p_tenant_id,b_mercedes,'Vito',1996,NULL,'Diesel'),
      (p_tenant_id,b_mercedes,'Viano',2003,2014,'Diesel'),(p_tenant_id,b_mercedes,'Actros',1995,NULL,'Diesel'),
      (p_tenant_id,b_mercedes,'190',1982,1993,'Essence'),(p_tenant_id,b_mercedes,'200-300 W124',1984,1997,'Diesel'),
      (p_tenant_id,b_mercedes,'CLS',2004,NULL,'Diesel') ON CONFLICT DO NOTHING;
  END IF;

  IF b_bmw IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_bmw,'Série 1',2004,NULL,'Diesel'),(p_tenant_id,b_bmw,'Série 2',2014,NULL,'Diesel'),
      (p_tenant_id,b_bmw,'Série 3',1975,NULL,'Diesel'),(p_tenant_id,b_bmw,'Série 4',2013,NULL,'Diesel'),
      (p_tenant_id,b_bmw,'Série 5',1972,NULL,'Diesel'),(p_tenant_id,b_bmw,'Série 7',1977,NULL,'Diesel'),
      (p_tenant_id,b_bmw,'X1',2009,NULL,'Diesel'),(p_tenant_id,b_bmw,'X3',2003,NULL,'Diesel'),
      (p_tenant_id,b_bmw,'X5',1999,NULL,'Diesel'),(p_tenant_id,b_bmw,'X6',2008,NULL,'Diesel'),
      (p_tenant_id,b_bmw,'X7',2019,NULL,'Diesel'),(p_tenant_id,b_bmw,'Z4',2002,NULL,'Essence'),
      (p_tenant_id,b_bmw,'M3',1986,NULL,'Essence'),(p_tenant_id,b_bmw,'M5',1985,NULL,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_ford IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_ford,'Fiesta',1976,2023,'Essence'),(p_tenant_id,b_ford,'Focus',1998,NULL,'Diesel'),
      (p_tenant_id,b_ford,'Mondeo',1993,2022,'Diesel'),(p_tenant_id,b_ford,'Ka',1996,2021,'Essence'),
      (p_tenant_id,b_ford,'Kuga',2008,NULL,'Diesel'),(p_tenant_id,b_ford,'EcoSport',2003,NULL,'Essence'),
      (p_tenant_id,b_ford,'Explorer',1990,NULL,'Essence'),(p_tenant_id,b_ford,'Ranger',1983,NULL,'Diesel'),
      (p_tenant_id,b_ford,'Transit',1965,NULL,'Diesel'),(p_tenant_id,b_ford,'Transit Connect',2002,NULL,'Diesel'),
      (p_tenant_id,b_ford,'Tourneo',1995,NULL,'Diesel'),(p_tenant_id,b_ford,'Mustang',1964,NULL,'Essence'),
      (p_tenant_id,b_ford,'F-150',1948,NULL,'Essence'),(p_tenant_id,b_ford,'Escape',2000,NULL,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_opel IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_opel,'Corsa',1982,NULL,'Essence'),(p_tenant_id,b_opel,'Astra',1991,NULL,'Diesel'),
      (p_tenant_id,b_opel,'Vectra',1988,2008,'Diesel'),(p_tenant_id,b_opel,'Insignia',2008,NULL,'Diesel'),
      (p_tenant_id,b_opel,'Meriva',2003,2017,'Diesel'),(p_tenant_id,b_opel,'Zafira',1999,2019,'Diesel'),
      (p_tenant_id,b_opel,'Mokka',2012,NULL,'Diesel'),(p_tenant_id,b_opel,'Antara',2006,2015,'Diesel'),
      (p_tenant_id,b_opel,'Frontera',1991,2004,'Diesel'),(p_tenant_id,b_opel,'Vivaro',2001,NULL,'Diesel'),
      (p_tenant_id,b_opel,'Movano',1998,NULL,'Diesel'),(p_tenant_id,b_opel,'Combo',1986,NULL,'Diesel') ON CONFLICT DO NOTHING;
  END IF;

  IF b_mitsubishi IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_mitsubishi,'Lancer',1973,2017,'Essence'),(p_tenant_id,b_mitsubishi,'Colt',1962,2012,'Essence'),
      (p_tenant_id,b_mitsubishi,'Galant',1969,2012,'Essence'),(p_tenant_id,b_mitsubishi,'Outlander',2001,NULL,'Diesel'),
      (p_tenant_id,b_mitsubishi,'ASX',2010,NULL,'Diesel'),(p_tenant_id,b_mitsubishi,'Pajero',1982,NULL,'Diesel'),
      (p_tenant_id,b_mitsubishi,'Pajero Sport',1996,NULL,'Diesel'),(p_tenant_id,b_mitsubishi,'L200',1978,NULL,'Diesel'),
      (p_tenant_id,b_mitsubishi,'L300',1979,NULL,'Diesel'),(p_tenant_id,b_mitsubishi,'Space Star',1998,NULL,'Essence'),
      (p_tenant_id,b_mitsubishi,'Eclipse Cross',2017,NULL,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_honda IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_honda,'Jazz',2001,NULL,'Essence'),(p_tenant_id,b_honda,'Civic',1972,NULL,'Essence'),
      (p_tenant_id,b_honda,'Accord',1976,NULL,'Diesel'),(p_tenant_id,b_honda,'CR-V',1995,NULL,'Diesel'),
      (p_tenant_id,b_honda,'HR-V',1999,NULL,'Essence'),(p_tenant_id,b_honda,'Pilot',2002,NULL,'Essence'),
      (p_tenant_id,b_honda,'City',1981,NULL,'Essence'),(p_tenant_id,b_honda,'Fit',2001,NULL,'Essence'),
      (p_tenant_id,b_honda,'Freed',2008,NULL,'Essence'),(p_tenant_id,b_honda,'Odyssey',1994,NULL,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_suzuki IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_suzuki,'Alto',1979,NULL,'Essence'),(p_tenant_id,b_suzuki,'Swift',1983,NULL,'Essence'),
      (p_tenant_id,b_suzuki,'Baleno',1995,NULL,'Essence'),(p_tenant_id,b_suzuki,'Celerio',2014,NULL,'Essence'),
      (p_tenant_id,b_suzuki,'Ignis',2000,NULL,'Essence'),(p_tenant_id,b_suzuki,'Vitara',1988,NULL,'Diesel'),
      (p_tenant_id,b_suzuki,'Grand Vitara',1997,2015,'Diesel'),(p_tenant_id,b_suzuki,'Jimny',1970,NULL,'Essence'),
      (p_tenant_id,b_suzuki,'Wagon R',1993,NULL,'Essence'),(p_tenant_id,b_suzuki,'S-Cross',2013,NULL,'Diesel'),
      (p_tenant_id,b_suzuki,'SX4',2006,NULL,'Diesel'),(p_tenant_id,b_suzuki,'Ertiga',2012,NULL,'Essence'),
      (p_tenant_id,b_suzuki,'Carry',1965,NULL,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_isuzu IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_isuzu,'D-Max',2002,NULL,'Diesel'),(p_tenant_id,b_isuzu,'MU-X',2013,NULL,'Diesel'),
      (p_tenant_id,b_isuzu,'Trooper',1981,2002,'Diesel'),(p_tenant_id,b_isuzu,'NKR',1985,NULL,'Diesel'),
      (p_tenant_id,b_isuzu,'NPR',1985,NULL,'Diesel'),(p_tenant_id,b_isuzu,'NQR',1996,NULL,'Diesel'),
      (p_tenant_id,b_isuzu,'Forward',1987,NULL,'Diesel'),(p_tenant_id,b_isuzu,'Elf',1959,NULL,'Diesel'),
      (p_tenant_id,b_isuzu,'Bighorn',1981,2002,'Diesel') ON CONFLICT DO NOTHING;
  END IF;

  IF b_landrover IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_landrover,'Defender',1983,NULL,'Diesel'),(p_tenant_id,b_landrover,'Discovery',1989,NULL,'Diesel'),
      (p_tenant_id,b_landrover,'Discovery Sport',2014,NULL,'Diesel'),(p_tenant_id,b_landrover,'Freelander',1997,2014,'Diesel'),
      (p_tenant_id,b_landrover,'Range Rover',1970,NULL,'Diesel'),(p_tenant_id,b_landrover,'Range Rover Sport',2005,NULL,'Diesel'),
      (p_tenant_id,b_landrover,'Range Rover Evoque',2011,NULL,'Diesel'),(p_tenant_id,b_landrover,'Range Rover Velar',2017,NULL,'Diesel') ON CONFLICT DO NOTHING;
  END IF;

  IF b_fiat IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_fiat,'Punto',1993,2018,'Essence'),(p_tenant_id,b_fiat,'Grande Punto',2005,2012,'Diesel'),
      (p_tenant_id,b_fiat,'Bravo',1995,2014,'Diesel'),(p_tenant_id,b_fiat,'Linea',2006,2015,'Diesel'),
      (p_tenant_id,b_fiat,'Tipo',1988,NULL,'Diesel'),(p_tenant_id,b_fiat,'Panda',1980,NULL,'Essence'),
      (p_tenant_id,b_fiat,'500',1957,NULL,'Essence'),(p_tenant_id,b_fiat,'Doblo',2000,NULL,'Diesel'),
      (p_tenant_id,b_fiat,'Ducato',1981,NULL,'Diesel'),(p_tenant_id,b_fiat,'Scudo',1995,NULL,'Diesel'),
      (p_tenant_id,b_fiat,'Strada',1998,NULL,'Diesel') ON CONFLICT DO NOTHING;
  END IF;

  IF b_dacia IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_dacia,'Logan',2004,NULL,'Essence'),(p_tenant_id,b_dacia,'Sandero',2008,NULL,'Essence'),
      (p_tenant_id,b_dacia,'Duster',2010,NULL,'Diesel'),(p_tenant_id,b_dacia,'Lodgy',2012,NULL,'Diesel'),
      (p_tenant_id,b_dacia,'Dokker',2012,NULL,'Diesel'),(p_tenant_id,b_dacia,'Spring',2021,NULL,'Electrique'),
      (p_tenant_id,b_dacia,'Jogger',2021,NULL,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_mazda IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_mazda,'Mazda2',2007,NULL,'Essence'),(p_tenant_id,b_mazda,'Mazda3',2003,NULL,'Essence'),
      (p_tenant_id,b_mazda,'Mazda6',2002,NULL,'Diesel'),(p_tenant_id,b_mazda,'CX-3',2015,NULL,'Diesel'),
      (p_tenant_id,b_mazda,'CX-5',2012,NULL,'Diesel'),(p_tenant_id,b_mazda,'CX-9',2006,NULL,'Essence'),
      (p_tenant_id,b_mazda,'BT-50',2006,NULL,'Diesel'),(p_tenant_id,b_mazda,'MX-5',1989,NULL,'Essence'),
      (p_tenant_id,b_mazda,'323',1977,2003,'Essence'),(p_tenant_id,b_mazda,'626',1979,2002,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_audi IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_audi,'A1',2010,NULL,'Essence'),(p_tenant_id,b_audi,'A2',1999,2005,'Diesel'),
      (p_tenant_id,b_audi,'A3',1996,NULL,'Diesel'),(p_tenant_id,b_audi,'A4',1994,NULL,'Diesel'),
      (p_tenant_id,b_audi,'A5',2007,NULL,'Diesel'),(p_tenant_id,b_audi,'A6',1994,NULL,'Diesel'),
      (p_tenant_id,b_audi,'A7',2010,NULL,'Diesel'),(p_tenant_id,b_audi,'A8',1994,NULL,'Diesel'),
      (p_tenant_id,b_audi,'Q3',2011,NULL,'Diesel'),(p_tenant_id,b_audi,'Q5',2008,NULL,'Diesel'),
      (p_tenant_id,b_audi,'Q7',2005,NULL,'Diesel'),(p_tenant_id,b_audi,'Q8',2018,NULL,'Diesel'),
      (p_tenant_id,b_audi,'TT',1998,NULL,'Essence'),(p_tenant_id,b_audi,'S3',1999,NULL,'Essence'),
      (p_tenant_id,b_audi,'S4',1991,NULL,'Essence'),(p_tenant_id,b_audi,'RS4',2000,NULL,'Essence'),
      (p_tenant_id,b_audi,'80',1972,1996,'Essence'),(p_tenant_id,b_audi,'100',1968,1994,'Essence') ON CONFLICT DO NOTHING;
  END IF;

  IF b_chevrolet IS NOT NULL THEN
    INSERT INTO vehicle_models (tenant_id, brand_id, name, year_start, year_end, fuel) VALUES
      (p_tenant_id,b_chevrolet,'Aveo',2002,2017,'Essence'),(p_tenant_id,b_chevrolet,'Spark',2005,NULL,'Essence'),
      (p_tenant_id,b_chevrolet,'Cruze',2009,2019,'Diesel'),(p_tenant_id,b_chevrolet,'Malibu',1964,NULL,'Essence'),
      (p_tenant_id,b_chevrolet,'Captiva',2006,2018,'Diesel'),(p_tenant_id,b_chevrolet,'Trax',2012,NULL,'Diesel'),
      (p_tenant_id,b_chevrolet,'Equinox',2004,NULL,'Essence'),(p_tenant_id,b_chevrolet,'Tahoe',1995,NULL,'Essence'),
      (p_tenant_id,b_chevrolet,'Silverado',1999,NULL,'Essence'),(p_tenant_id,b_chevrolet,'Colorado',2004,NULL,'Diesel'),
      (p_tenant_id,b_chevrolet,'Orlando',2010,2018,'Diesel'),(p_tenant_id,b_chevrolet,'Optra',2002,2013,'Essence'),
      (p_tenant_id,b_chevrolet,'Niva',2002,NULL,'Essence'),(p_tenant_id,b_chevrolet,'Express',1996,NULL,'Essence') ON CONFLICT DO NOTHING;
  END IF;

END;
$$;
