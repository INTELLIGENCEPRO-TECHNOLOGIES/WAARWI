/*
  # Articles Batch 2 — Éclairage + Accessoires extérieurs
  Phares LED, feux arrière, DRL, clignotants, marchepied, caméras, chrome
*/
DO $$
DECLARE
  tid uuid := (SELECT id FROM tenants LIMIT 1);
  c_phaled uuid; c_feuar uuid; c_clig uuid; c_antibr uuid; c_drl uuid;
  c_march uuid; c_protpch uuid; c_grill uuid; c_logo uuid; c_retrov uuid;
  c_camrec uuid; c_radar uuid; c_bagchr uuid; c_kitled uuid; c_proj uuid;
  -- modèles
  m_prado uuid; m_lc200 uuid; m_lc uuid; m_hilux uuid; m_fortuner uuid;
  m_rav4 uuid; m_innova uuid; m_camry uuid; m_corolla uuid; m_hiace uuid;
  m_rrs uuid; m_rr uuid; m_def uuid; m_disco uuid; m_evoque uuid;
  m_x5 uuid; m_x6 uuid; m_s3 uuid; m_s5 uuid; m_m3 uuid;
  m_gle uuid; m_glc uuid; m_gls uuid; m_classc uuid; m_classe uuid;
  m_patrol uuid; m_navara uuid; m_qash uuid;
  m_ranger uuid; m_mustang uuid; m_explorer uuid;
  m_pajero uuid; m_l200 uuid; m_outlander uuid;
  m_q7 uuid; m_q5 uuid; m_a6 uuid; m_rs4 uuid;
  m_santafe uuid; m_tucson uuid; m_creta uuid; m_ix35 uuid;
  m_sorento uuid; m_sportage uuid;
  m_tiguan uuid; m_amarok uuid;
  m_hiluxold uuid;
BEGIN
  SELECT id INTO c_phaled FROM part_categories WHERE tenant_id=tid AND code='PHA-LED' LIMIT 1;
  SELECT id INTO c_feuar  FROM part_categories WHERE tenant_id=tid AND code='FEU-AR-LED' LIMIT 1;
  SELECT id INTO c_clig   FROM part_categories WHERE tenant_id=tid AND code='CLIG' LIMIT 1;
  SELECT id INTO c_antibr FROM part_categories WHERE tenant_id=tid AND code='ANTIBR' LIMIT 1;
  SELECT id INTO c_drl    FROM part_categories WHERE tenant_id=tid AND code='DRL' LIMIT 1;
  SELECT id INTO c_march  FROM part_categories WHERE tenant_id=tid AND code='MARCH' LIMIT 1;
  SELECT id INTO c_protpch FROM part_categories WHERE tenant_id=tid AND code='PROT-PCH' LIMIT 1;
  SELECT id INTO c_grill  FROM part_categories WHERE tenant_id=tid AND code='GRILL-SP' LIMIT 1;
  SELECT id INTO c_logo   FROM part_categories WHERE tenant_id=tid AND code='LOGO' LIMIT 1;
  SELECT id INTO c_retrov FROM part_categories WHERE tenant_id=tid AND code='RETROV' LIMIT 1;
  SELECT id INTO c_camrec FROM part_categories WHERE tenant_id=tid AND code='CAM-REC' LIMIT 1;
  SELECT id INTO c_radar  FROM part_categories WHERE tenant_id=tid AND code='RADAR' LIMIT 1;
  SELECT id INTO c_bagchr FROM part_categories WHERE tenant_id=tid AND code='BAG-CHR' LIMIT 1;
  SELECT id INTO c_kitled FROM part_categories WHERE tenant_id=tid AND code='KIT-LED' LIMIT 1;
  SELECT id INTO c_proj   FROM part_categories WHERE tenant_id=tid AND code='PROJ' LIMIT 1;

  SELECT id INTO m_prado   FROM vehicle_models WHERE tenant_id=tid AND name='Prado' LIMIT 1;
  SELECT id INTO m_lc200   FROM vehicle_models WHERE tenant_id=tid AND name='Land Cruiser 200' LIMIT 1;
  SELECT id INTO m_lc      FROM vehicle_models WHERE tenant_id=tid AND name='Land Cruiser' LIMIT 1;
  SELECT id INTO m_hilux   FROM vehicle_models WHERE tenant_id=tid AND name='Hilux' LIMIT 1;
  SELECT id INTO m_fortuner FROM vehicle_models WHERE tenant_id=tid AND name='Fortuner' LIMIT 1;
  SELECT id INTO m_rav4    FROM vehicle_models WHERE tenant_id=tid AND name='RAV4' LIMIT 1;
  SELECT id INTO m_innova  FROM vehicle_models WHERE tenant_id=tid AND name='Innova' LIMIT 1;
  SELECT id INTO m_camry   FROM vehicle_models WHERE tenant_id=tid AND name='Camry' LIMIT 1;
  SELECT id INTO m_corolla FROM vehicle_models WHERE tenant_id=tid AND name='Corolla' LIMIT 1;
  SELECT id INTO m_hiace   FROM vehicle_models WHERE tenant_id=tid AND name='HiAce' LIMIT 1;
  SELECT id INTO m_rrs     FROM vehicle_models WHERE tenant_id=tid AND name='Range Rover Sport' LIMIT 1;
  SELECT id INTO m_rr      FROM vehicle_models WHERE tenant_id=tid AND name='Range Rover' LIMIT 1;
  SELECT id INTO m_def     FROM vehicle_models WHERE tenant_id=tid AND name='Defender' LIMIT 1;
  SELECT id INTO m_disco   FROM vehicle_models WHERE tenant_id=tid AND name='Discovery' LIMIT 1;
  SELECT id INTO m_evoque  FROM vehicle_models WHERE tenant_id=tid AND name='Range Rover Evoque' LIMIT 1;
  SELECT id INTO m_x5      FROM vehicle_models WHERE tenant_id=tid AND name='X5' LIMIT 1;
  SELECT id INTO m_x6      FROM vehicle_models WHERE tenant_id=tid AND name='X6' LIMIT 1;
  SELECT id INTO m_s3      FROM vehicle_models WHERE tenant_id=tid AND name='Série 3' LIMIT 1;
  SELECT id INTO m_s5      FROM vehicle_models WHERE tenant_id=tid AND name='Série 5' LIMIT 1;
  SELECT id INTO m_m3      FROM vehicle_models WHERE tenant_id=tid AND name='M3' LIMIT 1;
  SELECT id INTO m_gle     FROM vehicle_models WHERE tenant_id=tid AND name='GLE' LIMIT 1;
  SELECT id INTO m_glc     FROM vehicle_models WHERE tenant_id=tid AND name='GLC' LIMIT 1;
  SELECT id INTO m_gls     FROM vehicle_models WHERE tenant_id=tid AND name='GLS' LIMIT 1;
  SELECT id INTO m_classc  FROM vehicle_models WHERE tenant_id=tid AND name='Classe C' LIMIT 1;
  SELECT id INTO m_classe  FROM vehicle_models WHERE tenant_id=tid AND name='Classe E' LIMIT 1;
  SELECT id INTO m_patrol  FROM vehicle_models WHERE tenant_id=tid AND name='Patrol' LIMIT 1;
  SELECT id INTO m_navara  FROM vehicle_models WHERE tenant_id=tid AND name='Navara' LIMIT 1;
  SELECT id INTO m_qash    FROM vehicle_models WHERE tenant_id=tid AND name='Qashqai' LIMIT 1;
  SELECT id INTO m_ranger  FROM vehicle_models WHERE tenant_id=tid AND name='Ranger' LIMIT 1;
  SELECT id INTO m_mustang FROM vehicle_models WHERE tenant_id=tid AND name='Mustang' LIMIT 1;
  SELECT id INTO m_explorer FROM vehicle_models WHERE tenant_id=tid AND name='Explorer' LIMIT 1;
  SELECT id INTO m_pajero  FROM vehicle_models WHERE tenant_id=tid AND name='Pajero' LIMIT 1;
  SELECT id INTO m_l200    FROM vehicle_models WHERE tenant_id=tid AND name='L200' LIMIT 1;
  SELECT id INTO m_outlander FROM vehicle_models WHERE tenant_id=tid AND name='Outlander' LIMIT 1;
  SELECT id INTO m_q7      FROM vehicle_models WHERE tenant_id=tid AND name='Q7' LIMIT 1;
  SELECT id INTO m_q5      FROM vehicle_models WHERE tenant_id=tid AND name='Q5' LIMIT 1;
  SELECT id INTO m_a6      FROM vehicle_models WHERE tenant_id=tid AND name='A6' LIMIT 1;
  SELECT id INTO m_rs4     FROM vehicle_models WHERE tenant_id=tid AND name='RS4' LIMIT 1;
  SELECT id INTO m_santafe FROM vehicle_models WHERE tenant_id=tid AND name='Santa Fe' LIMIT 1;
  SELECT id INTO m_tucson  FROM vehicle_models WHERE tenant_id=tid AND name='Tucson' LIMIT 1;
  SELECT id INTO m_creta   FROM vehicle_models WHERE tenant_id=tid AND name='Creta' LIMIT 1;
  SELECT id INTO m_ix35    FROM vehicle_models WHERE tenant_id=tid AND name='ix35' LIMIT 1;
  SELECT id INTO m_sorento FROM vehicle_models WHERE tenant_id=tid AND name='Sorento' LIMIT 1;
  SELECT id INTO m_sportage FROM vehicle_models WHERE tenant_id=tid AND name='Sportage' LIMIT 1;
  SELECT id INTO m_tiguan  FROM vehicle_models WHERE tenant_id=tid AND name='Tiguan' LIMIT 1;
  SELECT id INTO m_amarok  FROM vehicle_models WHERE tenant_id=tid AND name='Amarok' LIMIT 1;

  -- ===================== PHARES LED =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('PHA-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 15, 'pce', 'new', true
  FROM (VALUES
    ('Phares LED Toyota Prado 150 2014-2017 face-lift paire', c_phaled, 'Toyota','81145-60L10',148000,225000),
    ('Phares LED Toyota Land Cruiser 200 2016+ paire', c_phaled, 'Toyota','81145-60P60',178000,268000),
    ('Phares LED Toyota Hilux Revo 2018+ paire', c_phaled, 'Toyota','81145-0K370',128000,195000),
    ('Phares LED Toyota Fortuner 2016-2019 paire', c_phaled, 'Toyota','81145-0K830',138000,208000),
    ('Phares LED Toyota RAV4 2019+ paire', c_phaled, 'Toyota','81145-42B40',118000,178000),
    ('Phares LED Toyota Camry 2018+ paire', c_phaled, 'Toyota','81145-06680',115000,175000),
    ('Phares LED BMW X5 G05 Adaptive LED 2019+ paire', c_phaled, 'BMW','63118089702',235000,358000),
    ('Phares LED BMW Série 5 G30 2017+ paire', c_phaled, 'BMW','63118089500',198000,298000),
    ('Phares LED BMW Série 3 G20 2019+ paire', c_phaled, 'BMW','63118090900',178000,268000),
    ('Phares LED BMW X6 G06 laser 2020+ paire', c_phaled, 'BMW','63118095600',258000,388000),
    ('Phares LED Mercedes GLE W167 2020+ paire', c_phaled, 'Mercedes-Benz','A1679060000',248000,375000),
    ('Phares LED Mercedes GLC X253 2020+ paire', c_phaled, 'Mercedes-Benz','A2539060000',225000,340000),
    ('Phares LED Mercedes Classe C W205 2014-2018 paire', c_phaled, 'Mercedes-Benz','A2059060000',195000,295000),
    ('Phares LED Mercedes Classe E W213 2016+ paire', c_phaled, 'Mercedes-Benz','A2139060000',218000,328000),
    ('Phares LED Mercedes GLS X167 2020+ paire', c_phaled, 'Mercedes-Benz','A1679061000',268000,405000),
    ('Phares LED Land Rover Range Rover Sport L494 2014+ paire', c_phaled, 'Land Rover','LR037048',285000,428000),
    ('Phares LED Land Rover Defender L663 2020+ paire', c_phaled, 'Land Rover','LR141202',255000,385000),
    ('Phares LED Land Rover Discovery 5 2017+ paire', c_phaled, 'Land Rover','LR069686',268000,405000),
    ('Phares LED Nissan Patrol Y62 2019+ paire', c_phaled, 'Nissan','26010-1LA1A',198000,298000),
    ('Phares LED Nissan Navara NP300 2018+ paire', c_phaled, 'Nissan','26010-4KB1A',148000,225000),
    ('Phares LED Ford Ranger 2019+ paire', c_phaled, 'Ford','KB3Z13008AA',128000,195000),
    ('Phares LED Ford Explorer 2020+ paire', c_phaled, 'Ford','LB5Z13008AA',145000,218000),
    ('Phares LED Ford Mustang GT 2018+ paire', c_phaled, 'Ford','FR3Z13008AA',158000,238000),
    ('Phares LED Mitsubishi Pajero V97 2007+ paire', c_phaled, 'Mitsubishi','8301A345',138000,208000),
    ('Phares LED Mitsubishi L200 Triton 2019+ paire', c_phaled, 'Mitsubishi','8301F492',128000,195000),
    ('Phares LED Audi Q7 4M full LED 2016+ paire', c_phaled, 'Audi','4M0941035E',248000,375000),
    ('Phares LED Audi Q5 FY 2017+ paire', c_phaled, 'Audi','80A941035C',225000,340000),
    ('Phares LED Hyundai Santa Fe TM 2018+ paire', c_phaled, 'Hyundai','92101-S2050',168000,255000),
    ('Phares LED Hyundai Tucson NX4 2021+ paire', c_phaled, 'Hyundai','92101-N9100',158000,238000),
    ('Phares LED Kia Sportage NQ5 2022+ paire', c_phaled, 'Kia','92101-P1100',155000,235000),
    ('Phares LED Kia Sorento MQ4 2021+ paire', c_phaled, 'Kia','92101-R5100',162000,245000),
    ('Phares LED VW Tiguan 2017+ paire', c_phaled, 'Volkswagen','5NA941035B',138000,208000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== FEUX ARRIÈRE LED =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('FEU-AR-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 15, 'pce', 'new', true
  FROM (VALUES
    ('Feux arrière LED Toyota Prado 150 2014+ fumé paire', c_feuar, 'Toyota','81560-60E10',95000,145000),
    ('Feux arrière LED Toyota Land Cruiser 200 2016+ paire', c_feuar, 'Toyota','81560-60N10',118000,178000),
    ('Feux arrière LED Toyota Hilux Revo 2018+ fumé paire', c_feuar, 'Toyota','81560-0K360',88000,132000),
    ('Feux arrière LED Toyota Fortuner 2016+ paire', c_feuar, 'Toyota','81560-0K840',92000,138000),
    ('Feux arrière LED Toyota RAV4 2019+ paire', c_feuar, 'Toyota','81560-42D20',85000,128000),
    ('Feux arrière LED Toyota Camry 2018+ paire', c_feuar, 'Toyota','81560-33700',78000,118000),
    ('Feux arrière LED BMW X5 G05 2019+ paire', c_feuar, 'BMW','63218089700',138000,208000),
    ('Feux arrière LED BMW Série 5 G30 2017+ paire', c_feuar, 'BMW','63218071900',125000,188000),
    ('Feux arrière LED BMW Série 3 G20 2019+ paire', c_feuar, 'BMW','63218071100',112000,168000),
    ('Feux arrière LED Mercedes GLE W167 2020+ paire', c_feuar, 'Mercedes-Benz','A1679060800',148000,225000),
    ('Feux arrière LED Mercedes GLC X253 2020+ paire', c_feuar, 'Mercedes-Benz','A2539060800',135000,205000),
    ('Feux arrière LED Mercedes Classe C W205 2014+ paire', c_feuar, 'Mercedes-Benz','A2059060800',115000,175000),
    ('Feux arrière LED Land Rover Range Rover Sport 2014+ paire', c_feuar, 'Land Rover','LR042162',165000,250000),
    ('Feux arrière LED Land Rover Defender 2020+ paire', c_feuar, 'Land Rover','LR141218',148000,225000),
    ('Feux arrière LED Nissan Patrol Y62 2019+ paire', c_feuar, 'Nissan','26550-1LB0B',118000,178000),
    ('Feux arrière LED Hyundai Santa Fe TM 2018+ paire', c_feuar, 'Hyundai','92401-S2200',98000,148000),
    ('Feux arrière LED Hyundai Tucson NX4 2021+ paire', c_feuar, 'Hyundai','92401-N9200',92000,138000),
    ('Feux arrière LED Kia Sportage NQ5 2022+ paire', c_feuar, 'Kia','92401-P1200',88000,135000),
    ('Feux arrière LED Audi Q7 4M 2016+ paire', c_feuar, 'Audi','4M0945093D',128000,195000),
    ('Feux arrière LED VW Tiguan 2017+ paire', c_feuar, 'Volkswagen','5NA945091F',85000,128000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== DRL & CLIGNOTANTS =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('DRL-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 20, 'pce', 'new', true
  FROM (VALUES
    ('DRL Toyota Prado 150 2014+ feux de jour LED paire', c_drl, 'Toyota','81211-60070',35000,55000),
    ('DRL Toyota Hilux Revo 2018+ LED paire', c_drl, 'Toyota','81271-0K080',28000,42000),
    ('DRL Toyota Land Cruiser 200 2016+ paire', c_drl, 'Toyota','81271-60030',38000,58000),
    ('DRL BMW X5 G05 2019+ paire', c_drl, 'BMW','63118089702',32000,48000),
    ('DRL Mercedes GLE W167 2020+ paire', c_drl, 'Mercedes-Benz','A1678200056',35000,55000),
    ('DRL Mercedes GLC X253 2016+ paire', c_drl, 'Mercedes-Benz','A2538200100',32000,48000),
    ('DRL Nissan Patrol Y62 2019+ paire', c_drl, 'Nissan','26060-1LB0A',28000,42000),
    ('DRL Ford Ranger 2019+ paire', c_drl, 'Ford','KB3Z15K866AA',25000,38000),
    ('DRL Hyundai Santa Fe TM 2018+ paire', c_drl, 'Hyundai','92207-S2000',22000,35000),
    ('Clignotants latéraux Toyota Prado 150 LED paire', c_clig, 'Toyota','81740-60090',12000,18000),
    ('Clignotants latéraux Land Rover Defender 2020+ paire', c_clig, 'Land Rover','LR116476',15000,22000),
    ('Clignotants séquentiels BMW Série 3 G20 paire', c_clig, 'BMW','63145A36D58',18000,28000),
    ('Clignotants rétroviseur BMW X5 G05 paire', c_clig, 'BMW','51168488454',14000,22000),
    ('Clignotants séquentiels Mercedes GLE W167 paire', c_clig, 'Mercedes-Benz','A1679000400',16000,25000),
    ('Antibrouillards LED Toyota Prado 150 paire', c_antibr, 'Toyota','81220-60040',22000,35000),
    ('Antibrouillards LED Toyota Hilux Revo paire', c_antibr, 'Toyota','81221-0K030',18000,28000),
    ('Antibrouillards LED Nissan Navara NP300 paire', c_antibr, 'Nissan','26155-4KK0A',18000,28000),
    ('Antibrouillards LED Ford Ranger 2019+ paire', c_antibr, 'Ford','KB3Z15200AA',16000,25000),
    ('Antibrouillards LED BMW X5 G05 paire', c_antibr, 'BMW','63177300970',25000,38000),
    ('Projecteurs longue portée LED 4x4 universels 120W paire', c_proj, NULL,'PROJ-120W-LED',28000,42000),
    ('Projecteurs LED toit Toyota Land Cruiser 200 barre 120cm', c_proj, 'Toyota','PROJ-BAR-LC200',58000,88000),
    ('Projecteurs LED Toyota Hilux Revo barre de toit 4x4', c_proj, 'Toyota','PROJ-BAR-HILUX',52000,78000),
    ('Kit ampoules LED intérieur Toyota Prado 150 complet', c_kitled, 'Toyota','KIT-LED-PRADO',15000,24000),
    ('Kit ampoules LED intérieur BMW Série 5 G30', c_kitled, 'BMW','KIT-LED-G30',22000,35000),
    ('Kit ampoules LED intérieur Mercedes GLE W167', c_kitled, 'Mercedes-Benz','KIT-LED-GLE',22000,35000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== MARCHEPIED & BARRES =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('MARCH-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 1, 8, 'paire', 'new', true
  FROM (VALUES
    ('Marchepieds tubulaires inox Toyota Prado 150', c_march, 'Toyota','MARCH-PRADO-150',68000,105000),
    ('Marchepieds aluminium électriques Toyota Land Cruiser 200', c_march, 'Toyota','MARCH-EL-LC200',185000,278000),
    ('Marchepieds électriques Toyota Hilux Revo Rocco', c_march, 'Toyota','MARCH-EL-HILUX',165000,248000),
    ('Marchepieds tubulaires inox Toyota Fortuner', c_march, 'Toyota','MARCH-FORT-INX',62000,95000),
    ('Marchepieds platine aluminium Range Rover Sport L494', c_march, 'Land Rover','LR023447',95000,145000),
    ('Marchepieds électriques Range Rover L405 2013+', c_march, 'Land Rover','LR048041',225000,338000),
    ('Marchepieds tubulaires BMW X5 F15/G05', c_march, 'BMW','MARCH-X5-INX',78000,118000),
    ('Marchepieds platines BMW X5 G05 noir mat', c_march, 'BMW','MARCH-X5-PLAT',88000,135000),
    ('Marchepieds tubulaires Mercedes GLE W166/W167', c_march, 'Mercedes-Benz','MARCH-GLE-INX',85000,128000),
    ('Marchepieds électriques Mercedes GLS X167 2020+', c_march, 'Mercedes-Benz','MARCH-EL-GLS',215000,325000),
    ('Marchepieds tubulaires Nissan Patrol Y62', c_march, 'Nissan','MARCH-Y62-INX',75000,115000),
    ('Marchepieds tubulaires Nissan Navara NP300', c_march, 'Nissan','MARCH-NAV-INX',58000,88000),
    ('Marchepieds OEM Ford Ranger Wildtrak paire', c_march, 'Ford','KB3Z16450AA',65000,98000),
    ('Marchepieds tubulaires Mitsubishi Pajero V97', c_march, 'Mitsubishi','MARCH-PAJ-INX',62000,95000),
    ('Marchepieds tubulaires Mitsubishi L200 Triton', c_march, 'Mitsubishi','MARCH-L200-INX',55000,85000),
    ('Marchepieds platines Hyundai Santa Fe 2018+', c_march, 'Hyundai','MARCH-SANTAFE',58000,88000),
    ('Marchepieds tubulaires Kia Sorento MQ4', c_march, 'Kia','MARCH-SOR-INX',52000,82000),
    ('Marchepieds tubulaires VW Amarok', c_march, 'Volkswagen','MARCH-AMRK-INX',58000,88000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== CAMÉRAS & RADARS =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('CAM-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 20, 'pce', 'new', true
  FROM (VALUES
    ('Caméra de recul Toyota Prado 150 OEM look', c_camrec, 'Toyota','86790-60160',18000,28000),
    ('Caméra de recul Toyota Land Cruiser 200 2016+', c_camrec, 'Toyota','86790-60220',22000,35000),
    ('Caméra de recul Toyota Hilux Revo 2018+', c_camrec, 'Toyota','86790-0K060',15000,24000),
    ('Caméra 360° Toyota Land Cruiser 200 kit complet', c_camrec, 'Toyota','CAM360-LC200',85000,128000),
    ('Caméra de recul BMW X5 G05 HD', c_camrec, 'BMW','66205A39D83',35000,55000),
    ('Caméra 360° BMW X5 G05 OEM', c_camrec, 'BMW','66515A18697',98000,148000),
    ('Caméra de recul Mercedes GLE W167 HD', c_camrec, 'Mercedes-Benz','A0009009405',38000,58000),
    ('Caméra 360° Mercedes GLC X253 OEM', c_camrec, 'Mercedes-Benz','A0009009600',105000,158000),
    ('Caméra de recul Land Rover Range Rover Sport', c_camrec, 'Land Rover','LR055404',42000,65000),
    ('Caméra de recul Nissan Patrol Y62 2019+', c_camrec, 'Nissan','28442-1LB1A',22000,35000),
    ('Caméra de recul Nissan Navara NP300 2018+', c_camrec, 'Nissan','28442-4KB1A',18000,28000),
    ('Kit radar recul 4 capteurs universel noir', c_radar, NULL,'RADAR-4P-UNIV',15000,24000),
    ('Kit radar recul 8 capteurs avant+arrière universel', c_radar, NULL,'RADAR-8P-UNIV',25000,38000),
    ('Radar recul OEM Toyota Land Cruiser 200 arrière', c_radar, 'Toyota','89341-60140',18000,28000),
    ('Radar recul OEM BMW X5 G05 arrière', c_radar, 'BMW','66209261589',22000,35000),
    ('Radar recul OEM Mercedes GLE W167 jeu 4', c_radar, 'Mercedes-Benz','A0009055903',28000,42000),
    ('Rétroviseur ext rabattable électrique Toyota Prado 150 D', c_retrov, 'Toyota','87910-60N10',32000,48000),
    ('Rétroviseur ext rabattable électrique Toyota Prado 150 G', c_retrov, 'Toyota','87940-60N10',32000,48000),
    ('Rétroviseur ext Toyota Land Cruiser 200 D/G paire chauffant', c_retrov, 'Toyota','RETROV-LC200-PR',68000,105000),
    ('Rétroviseur ext BMW X5 G05 D chauffant avec caméra', c_retrov, 'BMW','51168491159',45000,68000),
    ('Rétroviseur ext Mercedes GLE W167 D repliable auto', c_retrov, 'Mercedes-Benz','A1679000701',48000,72000),
    ('Coque rétroviseur BMW X5 G05 M Performance carbone', c_retrov, 'BMW','51162464116',25000,38000),
    ('Coque rétroviseur Mercedes GLE W167 AMG noire', c_retrov, 'Mercedes-Benz','A1679009800',22000,35000),
    ('Logo Toyota Land Cruiser emblème coffre noir', c_logo, 'Toyota','75441-60230',8000,12500),
    ('Logo BMW capot roundel M Performance', c_logo, 'BMW','36136783536',12000,18000),
    ('Logo Mercedes GLE AMG arrière Noir/Chrome', c_logo, 'Mercedes-Benz','A0008173900',9500,14500),
    ('Baguettes chrome Toyota Prado 150 kit complet', c_bagchr, 'Toyota','BAGCHR-PRADO-KIT',22000,35000),
    ('Baguettes inox Nissan Navara NP300 portes kit', c_bagchr, 'Nissan','BAGCHR-NAV-KIT',18000,28000),
    ('Baguettes chrome Ford Ranger 2019+ kit complet', c_bagchr, 'Ford','BAGCHR-RNGR-KIT',15000,24000)
  ) AS t(nm, cat, br, oem, pp, sp);

END $$;
