/*
  # Nouvelles catégories automobiles

  Ajout des catégories manquantes pour couvrir :
  - Carrosserie (pare-chocs, ailes, capots, calandres, kits, spoilers, diffuseurs)
  - Éclairage (phares, feux, DRL, clignotants, antibrouillards)
  - Accessoires extérieurs (marchepied, protection, chrome)
  - Multimédia & Audio (écrans Android, audio, caméras)
  - Intérieur (tapis, volant, tableau de bord)
  - Kits sport & performance (kits AMG, M, SVR, RS)
*/

DO $$
DECLARE
  tid uuid := (SELECT id FROM tenants LIMIT 1);
  cat_carrosserie uuid;
  cat_eclairage uuid;
  cat_accessoires_ext uuid;
  cat_multimedia uuid;
  cat_interieur uuid;
  cat_kits_sport uuid;
BEGIN
  -- CARROSSERIE (parent)
  IF NOT EXISTS (SELECT 1 FROM part_categories WHERE tenant_id = tid AND name = 'Carrosserie') THEN
    INSERT INTO part_categories (tenant_id, name, code, is_active) VALUES (tid, 'Carrosserie', 'CARRO', true);
  END IF;
  SELECT id INTO cat_carrosserie FROM part_categories WHERE tenant_id = tid AND name = 'Carrosserie' LIMIT 1;

  -- sous-catégories carrosserie
  INSERT INTO part_categories (tenant_id, name, code, parent_id, is_active)
  SELECT tid, n, c, cat_carrosserie, true FROM (VALUES
    ('Pare-chocs avant','PCH-AV'),('Pare-chocs arrière','PCH-AR'),
    ('Ailes avant','AIL-AV'),('Ailes arrière','AIL-AR'),
    ('Capots','CAPO'),('Coffres et hayons','COFF'),
    ('Calandres','CAL'),('Calandres sportives','CAL-SP'),
    ('Kits carrosserie complets','KIT-CARRO'),('Bas de caisse','BDC'),
    ('Élargisseurs d''ailes','ELAR'),('Spoilers','SPOI'),
    ('Diffuseurs arrière','DIFF'),('Jupes latérales','JUPE'),
    ('Coques rétroviseurs','COQUE-RV'),('Poignées de porte','POIG')
  ) AS t(n,c)
  ON CONFLICT DO NOTHING;

  -- ÉCLAIRAGE (parent)
  IF NOT EXISTS (SELECT 1 FROM part_categories WHERE tenant_id = tid AND name = 'Éclairage') THEN
    INSERT INTO part_categories (tenant_id, name, code, is_active) VALUES (tid, 'Éclairage', 'ECLAI', true);
  END IF;
  SELECT id INTO cat_eclairage FROM part_categories WHERE tenant_id = tid AND name = 'Éclairage' LIMIT 1;

  INSERT INTO part_categories (tenant_id, name, code, parent_id, is_active)
  SELECT tid, n, c, cat_eclairage, true FROM (VALUES
    ('Phares avant LED','PHA-LED'),('Phares bi-xénon','PHA-XEN'),
    ('Feux arrière LED','FEU-AR-LED'),('Feux arrière fumés','FEU-AR-SMK'),
    ('Clignotants','CLIG'),('Antibrouillards','ANTIBR'),
    ('DRL — Feux de jour','DRL'),('Feux de recul','FEU-REC'),
    ('Projecteurs supplémentaires','PROJ'),('Kits ampoules LED','KIT-LED')
  ) AS t(n,c)
  ON CONFLICT DO NOTHING;

  -- ACCESSOIRES EXTÉRIEURS
  IF NOT EXISTS (SELECT 1 FROM part_categories WHERE tenant_id = tid AND name = 'Accessoires extérieurs') THEN
    INSERT INTO part_categories (tenant_id, name, code, is_active) VALUES (tid, 'Accessoires extérieurs', 'ACC-EXT', true);
  END IF;
  SELECT id INTO cat_accessoires_ext FROM part_categories WHERE tenant_id = tid AND name = 'Accessoires extérieurs' LIMIT 1;

  INSERT INTO part_categories (tenant_id, name, code, parent_id, is_active)
  SELECT tid, n, c, cat_accessoires_ext, true FROM (VALUES
    ('Marchepied & Barres latérales','MARCH'),('Protections pare-chocs','PROT-PCH'),
    ('Barres de toit','BARRE-TOIT'),('Grilles sport','GRILL-SP'),
    ('Déflecteurs de vent','DEFL'),('Baguettes chrome','BAG-CHR'),
    ('Logos & Emblèmes','LOGO'),('Rétroviseurs extérieurs','RETROV'),
    ('Caméras de recul','CAM-REC'),('Radars de recul','RADAR')
  ) AS t(n,c)
  ON CONFLICT DO NOTHING;

  -- MULTIMÉDIA & AUDIO
  IF NOT EXISTS (SELECT 1 FROM part_categories WHERE tenant_id = tid AND name = 'Multimédia & Audio') THEN
    INSERT INTO part_categories (tenant_id, name, code, is_active) VALUES (tid, 'Multimédia & Audio', 'MULTI', true);
  END IF;
  SELECT id INTO cat_multimedia FROM part_categories WHERE tenant_id = tid AND name = 'Multimédia & Audio' LIMIT 1;

  INSERT INTO part_categories (tenant_id, name, code, parent_id, is_active)
  SELECT tid, n, c, cat_multimedia, true FROM (VALUES
    ('Écrans Android autoradio','ECRAN-AND'),('Systèmes de navigation GPS','GPS'),
    ('Amplis & subwoofers','AMPLI'),('Haut-parleurs','HP'),
    ('Tweeters','TWEET'),('Kits audio JBL','KIT-JBL'),
    ('Caméras 360°','CAM-360'),('Commandes au volant','CMD-VOL')
  ) AS t(n,c)
  ON CONFLICT DO NOTHING;

  -- INTÉRIEUR
  IF NOT EXISTS (SELECT 1 FROM part_categories WHERE tenant_id = tid AND name = 'Intérieur') THEN
    INSERT INTO part_categories (tenant_id, name, code, is_active) VALUES (tid, 'Intérieur', 'INT', true);
  END IF;
  SELECT id INTO cat_interieur FROM part_categories WHERE tenant_id = tid AND name = 'Intérieur' LIMIT 1;

  INSERT INTO part_categories (tenant_id, name, code, parent_id, is_active)
  SELECT tid, n, c, cat_interieur, true FROM (VALUES
    ('Tapis de sol','TAPIS'),('Housses de siège','HOUS-SIE'),
    ('Volants sport','VOLAN-SP'),('Tableau de bord & garnissage','TDB'),
    ('Pommeau de levier de vitesse','POMM'),('Accessoires tableau de bord','ACC-TDB')
  ) AS t(n,c)
  ON CONFLICT DO NOTHING;

  -- KITS SPORT & PERFORMANCE
  IF NOT EXISTS (SELECT 1 FROM part_categories WHERE tenant_id = tid AND name = 'Kits sport & Performance') THEN
    INSERT INTO part_categories (tenant_id, name, code, is_active) VALUES (tid, 'Kits sport & Performance', 'KIT-SP', true);
  END IF;
  SELECT id INTO cat_kits_sport FROM part_categories WHERE tenant_id = tid AND name = 'Kits sport & Performance' LIMIT 1;

  INSERT INTO part_categories (tenant_id, name, code, parent_id, is_active)
  SELECT tid, n, c, cat_kits_sport, true FROM (VALUES
    ('Kits AMG Mercedes','KIT-AMG'),('Kits M Performance BMW','KIT-M'),
    ('Kits RS Audi','KIT-RS'),('Kits SVR Land Rover','KIT-SVR'),
    ('Kits sport universels SUV','KIT-UNIV'),('Kits GT-Line Kia','KIT-GT'),
    ('Kits N-Line Hyundai','KIT-NL'),('Kits TRD Toyota','KIT-TRD'),
    ('Kits Nismo Nissan','KIT-NISMO'),('Kits ST Ford','KIT-ST')
  ) AS t(n,c)
  ON CONFLICT DO NOTHING;

END $$;
