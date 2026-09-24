/*
  # Articles Batch 1 — Carrosserie
  Pare-chocs, ailes, capots, calandres, kits carrosserie, spoilers, diffuseurs
  ~250 articles liés aux modèles Toyota, Land Rover, BMW, Mercedes, Audi, Nissan, Ford, Mitsubishi
*/
DO $$
DECLARE
  tid uuid := (SELECT id FROM tenants LIMIT 1);
  -- Catégories
  c_pcav uuid; c_pcar uuid; c_aiav uuid; c_aiar uuid;
  c_capo uuid; c_coff uuid; c_cal uuid; c_calsp uuid;
  c_kitc uuid; c_bdc uuid; c_spoi uuid; c_diff uuid;
  c_jupe uuid; c_elar uuid;
  -- Modèles Toyota
  m_prado uuid; m_lc200 uuid; m_lc uuid; m_lc70 uuid;
  m_hilux uuid; m_fortuner uuid; m_rav4 uuid; m_innova uuid;
  m_avanza uuid; m_camry uuid; m_corolla uuid; m_hiace uuid;
  -- Modèles Land Rover
  m_rrs uuid; m_rr uuid; m_def uuid; m_disco uuid; m_evoque uuid; m_velar uuid;
  -- Modèles BMW
  m_x5 uuid; m_x6 uuid; m_s3 uuid; m_s5 uuid; m_m3 uuid; m_m5 uuid;
  m_s7 uuid; m_s1 uuid; m_s4 uuid; m_x3 uuid;
  -- Modèles Mercedes
  m_gle uuid; m_glc uuid; m_gls uuid; m_classc uuid; m_classe uuid;
  m_classa uuid; m_gla uuid; m_glk uuid; m_sprinter uuid;
  -- Modèles Nissan
  m_patrol uuid; m_navara uuid; m_qash uuid; m_xtrail uuid; m_juke uuid;
  -- Modèles Ford
  m_ranger uuid; m_edge uuid; m_explorer uuid; m_kuga uuid; m_mustang uuid;
  -- Modèles Mitsubishi
  m_pajero uuid; m_pajerosport uuid; m_l200 uuid; m_outlander uuid;
  -- Modèles Audi
  m_q7 uuid; m_q5 uuid; m_q3 uuid; m_a6 uuid; m_a5 uuid; m_a4 uuid; m_rs4 uuid; m_q8 uuid;
  -- Modèles Hyundai
  m_santafe uuid; m_tucson uuid; m_creta uuid; m_palisade uuid;
  -- Modèles Kia
  m_sorento uuid; m_sportage uuid; m_telluride uuid;
  -- Modèles VW
  m_tiguan uuid; m_touareg uuid; m_amarok uuid;
  -- Modèles Chevrolet
  m_colorado uuid; m_captiva uuid;
  seq int := 1;
BEGIN
  -- Récupère catégories
  SELECT id INTO c_pcav FROM part_categories WHERE tenant_id=tid AND code='PCH-AV' LIMIT 1;
  SELECT id INTO c_pcar FROM part_categories WHERE tenant_id=tid AND code='PCH-AR' LIMIT 1;
  SELECT id INTO c_aiav FROM part_categories WHERE tenant_id=tid AND code='AIL-AV' LIMIT 1;
  SELECT id INTO c_aiar FROM part_categories WHERE tenant_id=tid AND code='AIL-AR' LIMIT 1;
  SELECT id INTO c_capo FROM part_categories WHERE tenant_id=tid AND code='CAPO' LIMIT 1;
  SELECT id INTO c_coff FROM part_categories WHERE tenant_id=tid AND code='COFF' LIMIT 1;
  SELECT id INTO c_cal  FROM part_categories WHERE tenant_id=tid AND code='CAL' LIMIT 1;
  SELECT id INTO c_calsp FROM part_categories WHERE tenant_id=tid AND code='CAL-SP' LIMIT 1;
  SELECT id INTO c_kitc FROM part_categories WHERE tenant_id=tid AND code='KIT-CARRO' LIMIT 1;
  SELECT id INTO c_bdc  FROM part_categories WHERE tenant_id=tid AND code='BDC' LIMIT 1;
  SELECT id INTO c_spoi FROM part_categories WHERE tenant_id=tid AND code='SPOI' LIMIT 1;
  SELECT id INTO c_diff FROM part_categories WHERE tenant_id=tid AND code='DIFF' LIMIT 1;
  SELECT id INTO c_jupe FROM part_categories WHERE tenant_id=tid AND code='JUPE' LIMIT 1;
  SELECT id INTO c_elar FROM part_categories WHERE tenant_id=tid AND code='ELAR' LIMIT 1;

  -- Modèles Toyota
  SELECT id INTO m_prado FROM vehicle_models WHERE tenant_id=tid AND name='Prado' LIMIT 1;
  SELECT id INTO m_lc200 FROM vehicle_models WHERE tenant_id=tid AND name='Land Cruiser 200' LIMIT 1;
  SELECT id INTO m_lc   FROM vehicle_models WHERE tenant_id=tid AND name='Land Cruiser' LIMIT 1;
  SELECT id INTO m_lc70 FROM vehicle_models WHERE tenant_id=tid AND name='Land Cruiser 70' LIMIT 1;
  SELECT id INTO m_hilux FROM vehicle_models WHERE tenant_id=tid AND name='Hilux' LIMIT 1;
  SELECT id INTO m_fortuner FROM vehicle_models WHERE tenant_id=tid AND name='Fortuner' LIMIT 1;
  SELECT id INTO m_rav4 FROM vehicle_models WHERE tenant_id=tid AND name='RAV4' LIMIT 1;
  SELECT id INTO m_innova FROM vehicle_models WHERE tenant_id=tid AND name='Innova' LIMIT 1;
  SELECT id INTO m_avanza FROM vehicle_models WHERE tenant_id=tid AND name='Avanza' LIMIT 1;
  SELECT id INTO m_camry FROM vehicle_models WHERE tenant_id=tid AND name='Camry' LIMIT 1;
  SELECT id INTO m_corolla FROM vehicle_models WHERE tenant_id=tid AND name='Corolla' LIMIT 1;
  SELECT id INTO m_hiace FROM vehicle_models WHERE tenant_id=tid AND name='HiAce' LIMIT 1;
  -- Land Rover
  SELECT id INTO m_rrs FROM vehicle_models WHERE tenant_id=tid AND name='Range Rover Sport' LIMIT 1;
  SELECT id INTO m_rr  FROM vehicle_models WHERE tenant_id=tid AND name='Range Rover' LIMIT 1;
  SELECT id INTO m_def FROM vehicle_models WHERE tenant_id=tid AND name='Defender' LIMIT 1;
  SELECT id INTO m_disco FROM vehicle_models WHERE tenant_id=tid AND name='Discovery' LIMIT 1;
  SELECT id INTO m_evoque FROM vehicle_models WHERE tenant_id=tid AND name='Range Rover Evoque' LIMIT 1;
  SELECT id INTO m_velar FROM vehicle_models WHERE tenant_id=tid AND name='Range Rover Velar' LIMIT 1;
  -- BMW
  SELECT id INTO m_x5 FROM vehicle_models WHERE tenant_id=tid AND name='X5' LIMIT 1;
  SELECT id INTO m_x6 FROM vehicle_models WHERE tenant_id=tid AND name='X6' LIMIT 1;
  SELECT id INTO m_s3 FROM vehicle_models WHERE tenant_id=tid AND name='Série 3' LIMIT 1;
  SELECT id INTO m_s5 FROM vehicle_models WHERE tenant_id=tid AND name='Série 5' LIMIT 1;
  SELECT id INTO m_m3 FROM vehicle_models WHERE tenant_id=tid AND name='M3' LIMIT 1;
  SELECT id INTO m_m5 FROM vehicle_models WHERE tenant_id=tid AND name='M5' LIMIT 1;
  SELECT id INTO m_s7 FROM vehicle_models WHERE tenant_id=tid AND name='Série 7' LIMIT 1;
  SELECT id INTO m_s1 FROM vehicle_models WHERE tenant_id=tid AND name='Série 1' LIMIT 1;
  SELECT id INTO m_s4 FROM vehicle_models WHERE tenant_id=tid AND name='Série 4' LIMIT 1;
  SELECT id INTO m_x3 FROM vehicle_models WHERE tenant_id=tid AND name='X3' LIMIT 1;
  -- Mercedes
  SELECT id INTO m_gle FROM vehicle_models WHERE tenant_id=tid AND name='GLE' LIMIT 1;
  SELECT id INTO m_glc FROM vehicle_models WHERE tenant_id=tid AND name='GLC' LIMIT 1;
  SELECT id INTO m_gls FROM vehicle_models WHERE tenant_id=tid AND name='GLS' LIMIT 1;
  SELECT id INTO m_classc FROM vehicle_models WHERE tenant_id=tid AND name='Classe C' LIMIT 1;
  SELECT id INTO m_classe FROM vehicle_models WHERE tenant_id=tid AND name='Classe E' LIMIT 1;
  SELECT id INTO m_classa FROM vehicle_models WHERE tenant_id=tid AND name='Classe A' LIMIT 1;
  SELECT id INTO m_gla FROM vehicle_models WHERE tenant_id=tid AND name='GLA' LIMIT 1;
  SELECT id INTO m_glk FROM vehicle_models WHERE tenant_id=tid AND name='GLK' LIMIT 1;
  SELECT id INTO m_sprinter FROM vehicle_models WHERE tenant_id=tid AND name='Sprinter' LIMIT 1;
  -- Nissan
  SELECT id INTO m_patrol FROM vehicle_models WHERE tenant_id=tid AND name='Patrol' LIMIT 1;
  SELECT id INTO m_navara FROM vehicle_models WHERE tenant_id=tid AND name='Navara' LIMIT 1;
  SELECT id INTO m_qash FROM vehicle_models WHERE tenant_id=tid AND name='Qashqai' LIMIT 1;
  SELECT id INTO m_xtrail FROM vehicle_models WHERE tenant_id=tid AND name='X-Trail' LIMIT 1;
  SELECT id INTO m_juke FROM vehicle_models WHERE tenant_id=tid AND name='Juke' LIMIT 1;
  -- Ford
  SELECT id INTO m_ranger FROM vehicle_models WHERE tenant_id=tid AND name='Ranger' LIMIT 1;
  SELECT id INTO m_edge FROM vehicle_models WHERE tenant_id=tid AND name='Edge' LIMIT 1;
  SELECT id INTO m_explorer FROM vehicle_models WHERE tenant_id=tid AND name='Explorer' LIMIT 1;
  SELECT id INTO m_kuga FROM vehicle_models WHERE tenant_id=tid AND name='Kuga' LIMIT 1;
  SELECT id INTO m_mustang FROM vehicle_models WHERE tenant_id=tid AND name='Mustang' LIMIT 1;
  -- Mitsubishi
  SELECT id INTO m_pajero FROM vehicle_models WHERE tenant_id=tid AND name='Pajero' LIMIT 1;
  SELECT id INTO m_pajerosport FROM vehicle_models WHERE tenant_id=tid AND name='Pajero Sport' LIMIT 1;
  SELECT id INTO m_l200 FROM vehicle_models WHERE tenant_id=tid AND name='L200' LIMIT 1;
  SELECT id INTO m_outlander FROM vehicle_models WHERE tenant_id=tid AND name='Outlander' LIMIT 1;
  -- Audi
  SELECT id INTO m_q7 FROM vehicle_models WHERE tenant_id=tid AND name='Q7' LIMIT 1;
  SELECT id INTO m_q5 FROM vehicle_models WHERE tenant_id=tid AND name='Q5' LIMIT 1;
  SELECT id INTO m_q3 FROM vehicle_models WHERE tenant_id=tid AND name='Q3' LIMIT 1;
  SELECT id INTO m_a6 FROM vehicle_models WHERE tenant_id=tid AND name='A6' LIMIT 1;
  SELECT id INTO m_a5 FROM vehicle_models WHERE tenant_id=tid AND name='A5' LIMIT 1;
  SELECT id INTO m_a4 FROM vehicle_models WHERE tenant_id=tid AND name='A4' LIMIT 1;
  SELECT id INTO m_rs4 FROM vehicle_models WHERE tenant_id=tid AND name='RS4' LIMIT 1;
  SELECT id INTO m_q8 FROM vehicle_models WHERE tenant_id=tid AND name='Q8' LIMIT 1;
  -- Hyundai
  SELECT id INTO m_santafe FROM vehicle_models WHERE tenant_id=tid AND name='Santa Fe' LIMIT 1;
  SELECT id INTO m_tucson FROM vehicle_models WHERE tenant_id=tid AND name='Tucson' LIMIT 1;
  SELECT id INTO m_creta FROM vehicle_models WHERE tenant_id=tid AND name='Creta' LIMIT 1;
  SELECT id INTO m_palisade FROM vehicle_models WHERE tenant_id=tid AND name='Palisade' LIMIT 1;
  -- Kia
  SELECT id INTO m_sorento FROM vehicle_models WHERE tenant_id=tid AND name='Sorento' LIMIT 1;
  SELECT id INTO m_sportage FROM vehicle_models WHERE tenant_id=tid AND name='Sportage' LIMIT 1;
  SELECT id INTO m_telluride FROM vehicle_models WHERE tenant_id=tid AND name='Telluride' LIMIT 1;
  -- VW
  SELECT id INTO m_tiguan FROM vehicle_models WHERE tenant_id=tid AND name='Tiguan' LIMIT 1;
  SELECT id INTO m_touareg FROM vehicle_models WHERE tenant_id=tid AND name='Touareg' LIMIT 1;
  SELECT id INTO m_amarok FROM vehicle_models WHERE tenant_id=tid AND name='Amarok' LIMIT 1;
  -- Chevrolet
  SELECT id INTO m_colorado FROM vehicle_models WHERE tenant_id=tid AND name='Colorado' LIMIT 1;
  SELECT id INTO m_captiva FROM vehicle_models WHERE tenant_id=tid AND name='Captiva' LIMIT 1;

  -- ===================== PARE-CHOCS AVANT =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('PCH-AV-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 20, 'pce', 'new', true
  FROM (VALUES
    ('Pare-chocs avant Toyota Prado 150 2010-2013', c_pcav, 'Toyota','53101-60B50',95000,145000),
    ('Pare-chocs avant Toyota Prado 150 2014-2017 face-lift', c_pcav, 'Toyota','53101-60D50',105000,155000),
    ('Pare-chocs avant Toyota Land Cruiser 200 2008-2015', c_pcav, 'Toyota','52119-60900',135000,185000),
    ('Pare-chocs avant Toyota Land Cruiser 200 2016-2021 face-lift', c_pcav, 'Toyota','52119-60A10',145000,199000),
    ('Pare-chocs avant Toyota Hilux Revo 2015-2020', c_pcav, 'Toyota','52119-0K050',85000,125000),
    ('Pare-chocs avant Toyota Hilux Rocco 2021+', c_pcav, 'Toyota','52119-0K270',98000,145000),
    ('Pare-chocs avant Toyota Fortuner 2015-2020', c_pcav, 'Toyota','52119-0K900',88000,130000),
    ('Pare-chocs avant Toyota RAV4 2019-2023', c_pcav, 'Toyota','52119-42A60',72000,115000),
    ('Pare-chocs avant Toyota Innova 2016-2022', c_pcav, 'Toyota','52119-0D460',65000,99000),
    ('Pare-chocs avant Land Rover Range Rover Sport 2014-2017', c_pcav, 'Land Rover','LR058106',165000,245000),
    ('Pare-chocs avant Land Rover Range Rover Sport SVR 2018+', c_pcav, 'Land Rover','LR087890',195000,295000),
    ('Pare-chocs avant Land Rover Range Rover L405 2013-2017', c_pcav, 'Land Rover','LR044717',185000,275000),
    ('Pare-chocs avant Land Rover Defender 90/110 2020+', c_pcav, 'Land Rover','LR116437',175000,255000),
    ('Pare-chocs avant Land Rover Discovery 5 2017+', c_pcav, 'Land Rover','LR069696',155000,235000),
    ('Pare-chocs avant Land Rover Evoque 2019+', c_pcav, 'Land Rover','LR099015',128000,195000),
    ('Pare-chocs avant BMW X5 G05 2019+', c_pcav, 'BMW','51118059930',115000,175000),
    ('Pare-chocs avant BMW X5 F15 2014-2018', c_pcav, 'BMW','51117294000',108000,162000),
    ('Pare-chocs avant BMW X6 G06 2020+', c_pcav, 'BMW','51118068472',120000,180000),
    ('Pare-chocs avant BMW Série 5 G30 2017+', c_pcav, 'BMW','51118069704',95000,145000),
    ('Pare-chocs avant BMW Série 3 G20 2019+', c_pcav, 'BMW','51118066000',88000,135000),
    ('Pare-chocs avant BMW M3/M4 G80/G82 2021+', c_pcav, 'BMW','51118093100',145000,215000),
    ('Pare-chocs avant BMW Série 7 G11 2016+', c_pcav, 'BMW','51118069900',110000,168000),
    ('Pare-chocs avant Mercedes GLE W167 2020+', c_pcav, 'Mercedes-Benz','A1678852800',128000,195000),
    ('Pare-chocs avant Mercedes GLC X253 2016-2019', c_pcav, 'Mercedes-Benz','A2538853125',115000,175000),
    ('Pare-chocs avant Mercedes GLC X253 2020+', c_pcav, 'Mercedes-Benz','A2538855200',125000,188000),
    ('Pare-chocs avant Mercedes GLS X167 2020+', c_pcav, 'Mercedes-Benz','A1678850000',145000,218000),
    ('Pare-chocs avant Mercedes Classe C W205 AMG Line', c_pcav, 'Mercedes-Benz','A2058851838',105000,158000),
    ('Pare-chocs avant Mercedes Classe E W213 AMG Line', c_pcav, 'Mercedes-Benz','A2138851538',112000,168000),
    ('Pare-chocs avant Nissan Patrol Y62 2010-2019', c_pcav, 'Nissan','62022-1LA0H',98000,148000),
    ('Pare-chocs avant Nissan Patrol Y62 2020+', c_pcav, 'Nissan','62022-5ZV0H',108000,162000),
    ('Pare-chocs avant Nissan Navara NP300 2015+', c_pcav, 'Nissan','62022-4JB0H',78000,115000),
    ('Pare-chocs avant Ford Ranger Raptor 2019+', c_pcav, 'Ford','KB3Z17757AA',92000,138000),
    ('Pare-chocs avant Ford Ranger Wildtrak 2022+', c_pcav, 'Ford','MB3Z17757AA',85000,128000),
    ('Pare-chocs avant Ford Explorer 2020+', c_pcav, 'Ford','LB5Z17757AA',88000,132000),
    ('Pare-chocs avant Ford Mustang GT 2018+', c_pcav, 'Ford','FR3Z17757AA',98000,148000),
    ('Pare-chocs avant Mitsubishi Pajero V97 2007-2020', c_pcav, 'Mitsubishi','6400A151XB',85000,128000),
    ('Pare-chocs avant Mitsubishi Pajero Sport 2016-2019', c_pcav, 'Mitsubishi','6400B802XA',78000,118000),
    ('Pare-chocs avant Mitsubishi L200 Triton 2019+', c_pcav, 'Mitsubishi','6400F454XA',72000,108000),
    ('Pare-chocs avant Audi Q7 4M 2016+', c_pcav, 'Audi','4M0807437G',118000,178000),
    ('Pare-chocs avant Audi Q5 FY 2017+', c_pcav, 'Audi','80A807437G',105000,158000),
    ('Pare-chocs avant Audi Q8 4M 2019+', c_pcav, 'Audi','4M8807437G',125000,188000),
    ('Pare-chocs avant Hyundai Santa Fe TM 2018+', c_pcav, 'Hyundai','86511-S2000',85000,128000),
    ('Pare-chocs avant Hyundai Tucson NX4 2021+', c_pcav, 'Hyundai','86511-N9200',78000,118000),
    ('Pare-chocs avant Hyundai Palisade 2019+', c_pcav, 'Hyundai','86511-S8000',88000,135000),
    ('Pare-chocs avant Kia Sorento MQ4 2021+', c_pcav, 'Kia','86511-R5500',82000,125000),
    ('Pare-chocs avant Kia Sportage NQ5 2022+', c_pcav, 'Kia','86511-P1100',75000,115000),
    ('Pare-chocs avant VW Tiguan 2017+', c_pcav, 'Volkswagen','5NA807221D',72000,112000),
    ('Pare-chocs avant VW Touareg 2019+', c_pcav, 'Volkswagen','760807217B',92000,138000),
    ('Pare-chocs avant Chevrolet Colorado 2016+', c_pcav, 'Chevrolet','23142038',68000,105000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== PARE-CHOCS ARRIÈRE =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('PCH-AR-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 15, 'pce', 'new', true
  FROM (VALUES
    ('Pare-chocs arrière Toyota Prado 150 2010-2017', c_pcar, 'Toyota','52159-60220',88000,132000),
    ('Pare-chocs arrière Toyota Land Cruiser 200 2008-2015', c_pcar, 'Toyota','52159-60450',118000,175000),
    ('Pare-chocs arrière Toyota Land Cruiser 200 2016+ face-lift', c_pcar, 'Toyota','52159-60560',128000,188000),
    ('Pare-chocs arrière Toyota Hilux Revo 2015+', c_pcar, 'Toyota','52159-0K100',78000,115000),
    ('Pare-chocs arrière Toyota Fortuner 2016+', c_pcar, 'Toyota','52159-0K840',82000,122000),
    ('Pare-chocs arrière Land Rover Range Rover Sport L494 2014-2017', c_pcar, 'Land Rover','LR047490',155000,228000),
    ('Pare-chocs arrière Land Rover Range Rover Sport SVR 2018+', c_pcar, 'Land Rover','LR088100',175000,258000),
    ('Pare-chocs arrière Land Rover Defender 110 2020+', c_pcar, 'Land Rover','LR116468',158000,235000),
    ('Pare-chocs arrière Land Rover Discovery 5 2017+', c_pcar, 'Land Rover','LR073220',138000,205000),
    ('Pare-chocs arrière BMW X5 G05 2019+', c_pcar, 'BMW','51128069700',108000,165000),
    ('Pare-chocs arrière BMW Série 5 G30 M-Pack 2017+', c_pcar, 'BMW','51128068100',95000,145000),
    ('Pare-chocs arrière BMW Série 3 G20 M-Pack 2019+', c_pcar, 'BMW','51128069900',88000,135000),
    ('Pare-chocs arrière Mercedes GLE W167 AMG 2020+', c_pcar, 'Mercedes-Benz','A1678854700',118000,178000),
    ('Pare-chocs arrière Mercedes GLC X253 AMG 2020+', c_pcar, 'Mercedes-Benz','A2538856300',105000,158000),
    ('Pare-chocs arrière Mercedes Classe C W205 AMG 2014+', c_pcar, 'Mercedes-Benz','A2058852000',98000,148000),
    ('Pare-chocs arrière Nissan Patrol Y62 2010-2019', c_pcar, 'Nissan','85022-1LB0H',88000,132000),
    ('Pare-chocs arrière Nissan Navara NP300 2015+', c_pcar, 'Nissan','85022-4KK0H',72000,108000),
    ('Pare-chocs arrière Ford Ranger 2019+', c_pcar, 'Ford','KB3Z17906BA',75000,112000),
    ('Pare-chocs arrière Mitsubishi Pajero V97 2007-2020', c_pcar, 'Mitsubishi','6410A149XB',78000,118000),
    ('Pare-chocs arrière Mitsubishi L200 Triton 2019+', c_pcar, 'Mitsubishi','6410F424XA',68000,102000),
    ('Pare-chocs arrière Audi Q7 4M 2016+', c_pcar, 'Audi','4M0807521D',108000,162000),
    ('Pare-chocs arrière Hyundai Santa Fe TM 2018+', c_pcar, 'Hyundai','86611-S2500',78000,118000),
    ('Pare-chocs arrière Hyundai Tucson NX4 2021+', c_pcar, 'Hyundai','86611-N9300',72000,108000),
    ('Pare-chocs arrière Kia Sorento MQ4 2021+', c_pcar, 'Kia','86611-R5000',75000,115000),
    ('Pare-chocs arrière VW Tiguan 2017+', c_pcar, 'Volkswagen','5NA807421C',68000,105000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== CALANDRES =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('CAL-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 20, 'pce', 'new', true
  FROM (VALUES
    ('Calandre Toyota Prado 150 style TRD Noir mat 2010-2017', c_calsp, 'Toyota','53101-60460',45000,72000),
    ('Calandre Toyota Land Cruiser 200 Executive Noir 2016+', c_calsp, 'Toyota','53101-60C30',55000,85000),
    ('Calandre Toyota Hilux Revo TRD Sport 2018+', c_calsp, 'Toyota','53101-0K080',38000,58000),
    ('Calandre Toyota Fortuner TRD Noire 2016+', c_calsp, 'Toyota','53101-0K920',42000,65000),
    ('Calandre Land Rover Range Rover Sport SVR Style 2018+', c_calsp, 'Land Rover','LR086726',85000,128000),
    ('Calandre Land Rover Defender Noire mat 2020+', c_calsp, 'Land Rover','LR116402',75000,115000),
    ('Calandre BMW X5 G05 M Performance 2019+', c_calsp, 'BMW','51138091095',65000,98000),
    ('Calandre BMW X5 G05 Shadow Line Noire 2019+', c_calsp, 'BMW','51138063170',58000,88000),
    ('Calandre BMW Série 5 G30 M Performance 2017+', c_calsp, 'BMW','51138069402',55000,85000),
    ('Calandre BMW Série 3 G20 M340i 2019+', c_calsp, 'BMW','51137499573',48000,75000),
    ('Calandre BMW X6 G06 M Sport 2020+', c_calsp, 'BMW','51117477802',68000,105000),
    ('Calandre Mercedes GLE W167 AMG Noire 2020+', c_calsp, 'Mercedes-Benz','A1678800083',72000,108000),
    ('Calandre Mercedes GLC AMG Line Noire brillante 2016+', c_calsp, 'Mercedes-Benz','A2538800006',65000,98000),
    ('Calandre Mercedes Classe C W205 AMG 63 style 2014+', c_calsp, 'Mercedes-Benz','A2058800005',55000,85000),
    ('Calandre Mercedes Classe E W213 AMG 2016+', c_calsp, 'Mercedes-Benz','A2138800000',58000,88000),
    ('Calandre Nissan Patrol Y62 Nisan Sport Noire 2019+', c_calsp, 'Nissan','62310-1LA3A',52000,78000),
    ('Calandre Nissan Navara NP300 sport noire 2017+', c_calsp, 'Nissan','62310-4KB1A',38000,58000),
    ('Calandre Ford Ranger Raptor 2019+ noire mat', c_calsp, 'Ford','KB3Z8200BA',45000,68000),
    ('Calandre Ford Mustang GT350 Style 2018+', c_calsp, 'Ford','FR3Z8200AA',55000,85000),
    ('Calandre Mitsubishi Pajero V97 Chrome/noir 2007-2020', c_calsp, 'Mitsubishi','7450A009XA',42000,65000),
    ('Calandre Mitsubishi L200 Triton Sport 2019+', c_calsp, 'Mitsubishi','7450F413XA',38000,58000),
    ('Calandre Audi Q7 S-Line 2016+ noire', c_calsp, 'Audi','4M0853651ABS',62000,95000),
    ('Calandre Audi Q5 S-Line 2017+ noire brillante', c_calsp, 'Audi','80A853651BS',55000,85000),
    ('Calandre Hyundai Santa Fe Palisade Style 2021+', c_calsp, 'Hyundai','86351-S8000',45000,68000),
    ('Calandre Kia Sportage GT-Line 2022+', c_calsp, 'Kia','86351-P1200',42000,65000),
    ('Calandre VW Tiguan R-Line 2017+', c_calsp, 'Volkswagen','5NA853651B',38000,58000),
    ('Calandre Chevrolet Colorado Z71 Style 2016+', c_calsp, 'Chevrolet','84215060',35000,55000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== CAPOTS =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('CAPO-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 1, 8, 'pce', 'new', true
  FROM (VALUES
    ('Capot Toyota Prado 150 2010-2017', c_capo, 'Toyota','53301-60440',115000,168000),
    ('Capot Toyota Land Cruiser 200 2008-2015', c_capo, 'Toyota','53301-60420',145000,215000),
    ('Capot Toyota Land Cruiser 200 2016+', c_capo, 'Toyota','53301-60520',155000,228000),
    ('Capot Toyota Hilux Revo 2015+', c_capo, 'Toyota','53301-0K010',95000,142000),
    ('Capot Toyota Fortuner 2016+', c_capo, 'Toyota','53301-0K870',105000,155000),
    ('Capot Toyota RAV4 2019+', c_capo, 'Toyota','53301-42B10',88000,132000),
    ('Capot Land Rover Range Rover Sport L494 2014+', c_capo, 'Land Rover','LR064453',195000,285000),
    ('Capot Land Rover Defender 110 2020+', c_capo, 'Land Rover','LR116444',185000,275000),
    ('Capot BMW X5 G05 2019+', c_capo, 'BMW','41007488396',145000,215000),
    ('Capot BMW Série 5 G30 2017+', c_capo, 'BMW','41007491500',128000,192000),
    ('Capot BMW Série 3 G20 2019+', c_capo, 'BMW','41007496000',115000,175000),
    ('Capot Mercedes GLE W167 2019+', c_capo, 'Mercedes-Benz','A1678800400',158000,235000),
    ('Capot Mercedes GLC X253 2016+', c_capo, 'Mercedes-Benz','A2538800400',138000,205000),
    ('Capot Mercedes Classe C W205 2014+', c_capo, 'Mercedes-Benz','A2058800100',125000,188000),
    ('Capot Nissan Patrol Y62 2010+', c_capo, 'Nissan','65100-1LA0A',135000,202000),
    ('Capot Nissan Navara NP300 2015+', c_capo, 'Nissan','65100-4KK0A',98000,148000),
    ('Capot Ford Ranger 2019+', c_capo, 'Ford','KB3Z16612AA',92000,138000),
    ('Capot Mitsubishi Pajero V97 2007+', c_capo, 'Mitsubishi','5900A201',115000,172000),
    ('Capot Audi Q7 4M 2016+', c_capo, 'Audi','4M0823029F',145000,218000),
    ('Capot Hyundai Santa Fe TM 2018+', c_capo, 'Hyundai','664001S000',105000,158000),
    ('Capot Kia Sorento MQ4 2021+', c_capo, 'Kia','664101U000',98000,148000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== SPOILERS & DIFFUSEURS =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('SPOI-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 15, 'pce', 'new', true
  FROM (VALUES
    ('Spoiler de coffre Toyota Prado 150 noir mat', c_spoi, 'Toyota','76085-60181',32000,48000),
    ('Spoiler de coffre Toyota Hilux Revo', c_spoi, 'Toyota','76085-0K250',28000,42000),
    ('Aileron de toit BMW Série 3 G20 M Performance noir brillant', c_spoi, 'BMW','51622473523',42000,65000),
    ('Aileron de coffre BMW Série 5 G30 M Performance', c_spoi, 'BMW','51627398714',45000,68000),
    ('Spoiler BMW X5 G05 M Performance lip avant', c_spoi, 'BMW','51192465528',38000,58000),
    ('Spoiler de coffre Mercedes CLA AMG', c_spoi, 'Mercedes-Benz','A1177900188',35000,55000),
    ('Aileron Audi A5 Sportback S-Line noir', c_spoi, 'Audi','8W6827933B',45000,68000),
    ('Aileron Audi Q5 S-Line toit noir brillant', c_spoi, 'Audi','80A827933B',38000,58000),
    ('Spoiler de toit Range Rover Evoque 2019+', c_spoi, 'Land Rover','LR097812',42000,65000),
    ('Diffuseur arrière BMW Série 5 G30 M Performance noir mat', c_diff, 'BMW','51197397985',52000,78000),
    ('Diffuseur arrière BMW X5 G05 M Performance', c_diff, 'BMW','51192465606',58000,88000),
    ('Diffuseur arrière Mercedes Classe C W205 AMG 63 style', c_diff, 'Mercedes-Benz','A2058856325',55000,85000),
    ('Diffuseur arrière Mercedes GLE W167 AMG', c_diff, 'Mercedes-Benz','A1678854925',65000,98000),
    ('Diffuseur arrière Audi Q7 S-Line 2016+', c_diff, 'Audi','4M0807521T',58000,88000),
    ('Diffuseur arrière Nissan Patrol Nismo style', c_diff, 'Nissan','85025-6WK0H',48000,72000),
    ('Diffuseur arrière Ford Mustang GT500 style', c_diff, 'Ford','FR3Z17D957BA',52000,78000),
    ('Jupe latérale BMW X5 G05 M Performance droite', c_jupe, 'BMW','51778083620',45000,68000),
    ('Jupe latérale BMW X5 G05 M Performance gauche', c_jupe, 'BMW','51778083619',45000,68000),
    ('Jupe latérale Mercedes GLE AMG droite 2020+', c_jupe, 'Mercedes-Benz','A1679002500',55000,85000),
    ('Jupe latérale Mercedes GLE AMG gauche 2020+', c_jupe, 'Mercedes-Benz','A1679001500',55000,85000),
    ('Bas de caisse Toyota Land Cruiser 200 finition noire', c_bdc, 'Toyota','75870-60030',35000,55000),
    ('Bas de caisse Toyota Prado 150 protection', c_bdc, 'Toyota','75870-60040',30000,48000),
    ('Bas de caisse Range Rover Sport SVR style', c_bdc, 'Land Rover','LR087892',52000,78000),
    ('Élargisseurs d''ailes Toyota Hilux Revo noir mat (jeu 4)', c_elar, 'Toyota','75867-0K110',48000,72000),
    ('Élargisseurs d''ailes Nissan Navara NP300 (jeu 4)', c_elar, 'Nissan','63070-4KG0H',42000,65000),
    ('Élargisseurs d''ailes Ford Ranger Raptor (jeu 4)', c_elar, 'Ford','KB3Z16039BA',45000,68000),
    ('Élargisseurs d''ailes Mitsubishi L200 Triton (jeu 4)', c_elar, 'Mitsubishi','MZ314548XA',40000,62000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== KITS CARROSSERIE =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('KIT-C-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 1, 5, 'kit', 'new', true
  FROM (VALUES
    ('Kit carrosserie complet SVR Range Rover Sport 2018+ (bumper+side+rear)', c_kitc, 'Land Rover','KSVR-RRS-18',425000,650000),
    ('Kit carrosserie AMG GLE 63 style W167 2020+ (6 pièces)', c_kitc, 'Mercedes-Benz','KAMG-GLE-W167',385000,595000),
    ('Kit carrosserie AMG C63 style W205 2014+ (pare-chocs+jupes+diffuseur)', c_kitc, 'Mercedes-Benz','KAMG-W205',295000,445000),
    ('Kit carrosserie AMG GLC 63 style X253 2020+ (complet)', c_kitc, 'Mercedes-Benz','KAMG-GLC-X253',345000,525000),
    ('Kit M Performance BMW X5 G05 2019+ complet', c_kitc, 'BMW','KMP-X5-G05',365000,555000),
    ('Kit M Performance BMW Série 5 G30 2017+ (4 pièces)', c_kitc, 'BMW','KMP-G30',285000,435000),
    ('Kit M Performance BMW Série 3 G20 2019+ complet', c_kitc, 'BMW','KMP-G20',265000,405000),
    ('Kit carrosserie TRD Sport Toyota Land Cruiser 200', c_kitc, 'Toyota','KIT-TRD-LC200',355000,540000),
    ('Kit carrosserie TRD Toyota Prado 150 sport complet', c_kitc, 'Toyota','KIT-TRD-PRADO',295000,445000),
    ('Kit carrosserie TRD Toyota Hilux Revo Sport', c_kitc, 'Toyota','KIT-TRD-HILUX',225000,345000),
    ('Kit carrosserie Nismo Nissan Patrol Y62', c_kitc, 'Nissan','KIT-NISMO-Y62',315000,478000),
    ('Kit carrosserie Raptor Style Ford Ranger 2019+', c_kitc, 'Ford','KIT-RAPT-RNGR',268000,405000),
    ('Kit carrosserie RS Audi Q7 4M sport complet', c_kitc, 'Audi','KIT-RS-Q7',335000,510000),
    ('Kit carrosserie N-Line Hyundai Santa Fe TM', c_kitc, 'Hyundai','KIT-NL-SANTAFE',245000,375000),
    ('Kit carrosserie GT-Line Kia Sportage NQ5 2022+', c_kitc, 'Kia','KIT-GTL-SPORT',235000,358000)
  ) AS t(nm, cat, br, oem, pp, sp);

END $$;
