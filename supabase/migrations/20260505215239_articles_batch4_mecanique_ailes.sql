/*
  # Articles Batch 4 — Mécanique rapide + Ailes + Coffres
  Filtres, plaquettes, amortisseurs, batteries, radiateurs, alternateurs, démarreurs
  + ailes avant/arrière sur toutes marques
*/
DO $$
DECLARE
  tid uuid := (SELECT id FROM tenants LIMIT 1);
  -- catégories méca
  c_flair uuid; c_flhui uuid; c_flcarb uuid; c_flhab uuid;
  c_plaq uuid; c_disc uuid; c_amor uuid; c_batt uuid;
  c_alt uuid; c_dem uuid;
  -- carrosserie ailes/coffre
  c_aiav uuid; c_aiar uuid; c_coff uuid;
  -- modèles Toyota
  m_prado uuid; m_lc200 uuid; m_hilux uuid; m_fortuner uuid; m_rav4 uuid;
  m_innova uuid; m_camry uuid; m_corolla uuid; m_auris uuid; m_avanza uuid;
  -- Land Rover
  m_rrs uuid; m_disco uuid; m_def uuid; m_evoque uuid;
  -- BMW
  m_x5 uuid; m_x3 uuid; m_s3 uuid; m_s5 uuid; m_s1 uuid;
  -- Mercedes
  m_gle uuid; m_glc uuid; m_classc uuid; m_classe uuid; m_classa uuid;
  -- Nissan
  m_patrol uuid; m_navara uuid; m_qash uuid; m_xtrail uuid;
  -- Ford
  m_ranger uuid; m_focus uuid; m_fiesta uuid; m_kuga uuid;
  -- Mitsubishi
  m_pajero uuid; m_pajsport uuid; m_l200 uuid; m_outlander uuid;
  -- Audi
  m_q5 uuid; m_a4 uuid; m_a6 uuid;
  -- Hyundai
  m_santafe uuid; m_tucson uuid; m_creta uuid; m_ix35 uuid; m_elantra uuid;
  -- Kia
  m_sorento uuid; m_sportage uuid; m_cerato uuid;
  -- VW
  m_golf uuid; m_tiguan uuid; m_passat uuid;
  -- Renault
  m_clio uuid; m_megane uuid; m_duster uuid; m_sandero uuid; m_captur uuid;
  -- Peugeot
  m_207 uuid; m_208 uuid; m_307 uuid; m_308 uuid; m_3008 uuid;
  -- Honda
  m_crv uuid; m_hrv uuid; m_civic uuid;
  -- Suzuki
  m_jimny uuid; m_swift uuid; m_vitara uuid;
  -- Mazda
  m_cx5 uuid; m_mazda3 uuid;
  -- Chevrolet
  m_colorado uuid; m_captiva uuid; m_cruze uuid;
BEGIN
  SELECT id INTO c_flair FROM part_categories WHERE tenant_id=tid AND code='Filtre à air' LIMIT 1;
  IF c_flair IS NULL THEN SELECT id INTO c_flair FROM part_categories WHERE tenant_id=tid AND name='Filtre à air' LIMIT 1; END IF;
  SELECT id INTO c_flhui FROM part_categories WHERE tenant_id=tid AND name='Filtre à huile' LIMIT 1;
  SELECT id INTO c_flcarb FROM part_categories WHERE tenant_id=tid AND name='Filtre à carburant' LIMIT 1;
  SELECT id INTO c_flhab FROM part_categories WHERE tenant_id=tid AND name='Filtre habitacle' LIMIT 1;
  SELECT id INTO c_plaq FROM part_categories WHERE tenant_id=tid AND name='Plaquettes' LIMIT 1;
  SELECT id INTO c_disc FROM part_categories WHERE tenant_id=tid AND name='Disques' LIMIT 1;
  SELECT id INTO c_amor FROM part_categories WHERE tenant_id=tid AND name='Amortisseurs' LIMIT 1;
  SELECT id INTO c_batt FROM part_categories WHERE tenant_id=tid AND name='Batterie' LIMIT 1;
  SELECT id INTO c_alt  FROM part_categories WHERE tenant_id=tid AND name='Alternateur' LIMIT 1;
  SELECT id INTO c_dem  FROM part_categories WHERE tenant_id=tid AND name='Démarreur' LIMIT 1;
  SELECT id INTO c_aiav FROM part_categories WHERE tenant_id=tid AND code='AIL-AV' LIMIT 1;
  SELECT id INTO c_aiar FROM part_categories WHERE tenant_id=tid AND code='AIL-AR' LIMIT 1;
  SELECT id INTO c_coff FROM part_categories WHERE tenant_id=tid AND code='COFF' LIMIT 1;

  -- Modèles
  SELECT id INTO m_prado   FROM vehicle_models WHERE tenant_id=tid AND name='Prado' LIMIT 1;
  SELECT id INTO m_lc200   FROM vehicle_models WHERE tenant_id=tid AND name='Land Cruiser 200' LIMIT 1;
  SELECT id INTO m_hilux   FROM vehicle_models WHERE tenant_id=tid AND name='Hilux' LIMIT 1;
  SELECT id INTO m_fortuner FROM vehicle_models WHERE tenant_id=tid AND name='Fortuner' LIMIT 1;
  SELECT id INTO m_rav4    FROM vehicle_models WHERE tenant_id=tid AND name='RAV4' LIMIT 1;
  SELECT id INTO m_innova  FROM vehicle_models WHERE tenant_id=tid AND name='Innova' LIMIT 1;
  SELECT id INTO m_camry   FROM vehicle_models WHERE tenant_id=tid AND name='Camry' LIMIT 1;
  SELECT id INTO m_corolla FROM vehicle_models WHERE tenant_id=tid AND name='Corolla' LIMIT 1;
  SELECT id INTO m_auris   FROM vehicle_models WHERE tenant_id=tid AND name='Auris' LIMIT 1;
  SELECT id INTO m_avanza  FROM vehicle_models WHERE tenant_id=tid AND name='Avanza' LIMIT 1;
  SELECT id INTO m_rrs     FROM vehicle_models WHERE tenant_id=tid AND name='Range Rover Sport' LIMIT 1;
  SELECT id INTO m_disco   FROM vehicle_models WHERE tenant_id=tid AND name='Discovery' LIMIT 1;
  SELECT id INTO m_def     FROM vehicle_models WHERE tenant_id=tid AND name='Defender' LIMIT 1;
  SELECT id INTO m_evoque  FROM vehicle_models WHERE tenant_id=tid AND name='Range Rover Evoque' LIMIT 1;
  SELECT id INTO m_x5      FROM vehicle_models WHERE tenant_id=tid AND name='X5' LIMIT 1;
  SELECT id INTO m_x3      FROM vehicle_models WHERE tenant_id=tid AND name='X3' LIMIT 1;
  SELECT id INTO m_s3      FROM vehicle_models WHERE tenant_id=tid AND name='Série 3' LIMIT 1;
  SELECT id INTO m_s5      FROM vehicle_models WHERE tenant_id=tid AND name='Série 5' LIMIT 1;
  SELECT id INTO m_s1      FROM vehicle_models WHERE tenant_id=tid AND name='Série 1' LIMIT 1;
  SELECT id INTO m_gle     FROM vehicle_models WHERE tenant_id=tid AND name='GLE' LIMIT 1;
  SELECT id INTO m_glc     FROM vehicle_models WHERE tenant_id=tid AND name='GLC' LIMIT 1;
  SELECT id INTO m_classc  FROM vehicle_models WHERE tenant_id=tid AND name='Classe C' LIMIT 1;
  SELECT id INTO m_classe  FROM vehicle_models WHERE tenant_id=tid AND name='Classe E' LIMIT 1;
  SELECT id INTO m_classa  FROM vehicle_models WHERE tenant_id=tid AND name='Classe A' LIMIT 1;
  SELECT id INTO m_patrol  FROM vehicle_models WHERE tenant_id=tid AND name='Patrol' LIMIT 1;
  SELECT id INTO m_navara  FROM vehicle_models WHERE tenant_id=tid AND name='Navara' LIMIT 1;
  SELECT id INTO m_qash    FROM vehicle_models WHERE tenant_id=tid AND name='Qashqai' LIMIT 1;
  SELECT id INTO m_xtrail  FROM vehicle_models WHERE tenant_id=tid AND name='X-Trail' LIMIT 1;
  SELECT id INTO m_ranger  FROM vehicle_models WHERE tenant_id=tid AND name='Ranger' LIMIT 1;
  SELECT id INTO m_focus   FROM vehicle_models WHERE tenant_id=tid AND name='Focus' LIMIT 1;
  SELECT id INTO m_fiesta  FROM vehicle_models WHERE tenant_id=tid AND name='Fiesta' LIMIT 1;
  SELECT id INTO m_kuga    FROM vehicle_models WHERE tenant_id=tid AND name='Kuga' LIMIT 1;
  SELECT id INTO m_pajero  FROM vehicle_models WHERE tenant_id=tid AND name='Pajero' LIMIT 1;
  SELECT id INTO m_pajsport FROM vehicle_models WHERE tenant_id=tid AND name='Pajero Sport' LIMIT 1;
  SELECT id INTO m_l200    FROM vehicle_models WHERE tenant_id=tid AND name='L200' LIMIT 1;
  SELECT id INTO m_outlander FROM vehicle_models WHERE tenant_id=tid AND name='Outlander' LIMIT 1;
  SELECT id INTO m_q5      FROM vehicle_models WHERE tenant_id=tid AND name='Q5' LIMIT 1;
  SELECT id INTO m_a4      FROM vehicle_models WHERE tenant_id=tid AND name='A4' LIMIT 1;
  SELECT id INTO m_a6      FROM vehicle_models WHERE tenant_id=tid AND name='A6' LIMIT 1;
  SELECT id INTO m_santafe FROM vehicle_models WHERE tenant_id=tid AND name='Santa Fe' LIMIT 1;
  SELECT id INTO m_tucson  FROM vehicle_models WHERE tenant_id=tid AND name='Tucson' LIMIT 1;
  SELECT id INTO m_creta   FROM vehicle_models WHERE tenant_id=tid AND name='Creta' LIMIT 1;
  SELECT id INTO m_ix35    FROM vehicle_models WHERE tenant_id=tid AND name='ix35' LIMIT 1;
  SELECT id INTO m_elantra FROM vehicle_models WHERE tenant_id=tid AND name='Elantra' LIMIT 1;
  SELECT id INTO m_sorento FROM vehicle_models WHERE tenant_id=tid AND name='Sorento' LIMIT 1;
  SELECT id INTO m_sportage FROM vehicle_models WHERE tenant_id=tid AND name='Sportage' LIMIT 1;
  SELECT id INTO m_cerato  FROM vehicle_models WHERE tenant_id=tid AND name='Cerato' LIMIT 1;
  SELECT id INTO m_golf    FROM vehicle_models WHERE tenant_id=tid AND name='Golf' LIMIT 1;
  SELECT id INTO m_tiguan  FROM vehicle_models WHERE tenant_id=tid AND name='Tiguan' LIMIT 1;
  SELECT id INTO m_passat  FROM vehicle_models WHERE tenant_id=tid AND name='Passat' LIMIT 1;
  SELECT id INTO m_clio    FROM vehicle_models WHERE tenant_id=tid AND name='Clio' LIMIT 1;
  SELECT id INTO m_megane  FROM vehicle_models WHERE tenant_id=tid AND name='Megane' LIMIT 1;
  SELECT id INTO m_duster  FROM vehicle_models WHERE tenant_id=tid AND name='Duster' LIMIT 1;
  SELECT id INTO m_sandero FROM vehicle_models WHERE tenant_id=tid AND name='Sandero' LIMIT 1;
  SELECT id INTO m_captur  FROM vehicle_models WHERE tenant_id=tid AND name='Captur' LIMIT 1;
  SELECT id INTO m_207     FROM vehicle_models WHERE tenant_id=tid AND name='207' LIMIT 1;
  SELECT id INTO m_208     FROM vehicle_models WHERE tenant_id=tid AND name='208' LIMIT 1;
  SELECT id INTO m_307     FROM vehicle_models WHERE tenant_id=tid AND name='307' LIMIT 1;
  SELECT id INTO m_308     FROM vehicle_models WHERE tenant_id=tid AND name='308' LIMIT 1;
  SELECT id INTO m_3008    FROM vehicle_models WHERE tenant_id=tid AND name='3008' LIMIT 1;
  SELECT id INTO m_crv     FROM vehicle_models WHERE tenant_id=tid AND name='CR-V' LIMIT 1;
  SELECT id INTO m_hrv     FROM vehicle_models WHERE tenant_id=tid AND name='HR-V' LIMIT 1;
  SELECT id INTO m_civic   FROM vehicle_models WHERE tenant_id=tid AND name='Civic' LIMIT 1;
  SELECT id INTO m_jimny   FROM vehicle_models WHERE tenant_id=tid AND name='Jimny' LIMIT 1;
  SELECT id INTO m_swift   FROM vehicle_models WHERE tenant_id=tid AND name='Swift' LIMIT 1;
  SELECT id INTO m_vitara  FROM vehicle_models WHERE tenant_id=tid AND name='Grand Vitara' LIMIT 1;
  SELECT id INTO m_cx5     FROM vehicle_models WHERE tenant_id=tid AND name='CX-5' LIMIT 1;
  SELECT id INTO m_mazda3  FROM vehicle_models WHERE tenant_id=tid AND name='Mazda3' LIMIT 1;
  SELECT id INTO m_colorado FROM vehicle_models WHERE tenant_id=tid AND name='Colorado' LIMIT 1;
  SELECT id INTO m_captiva FROM vehicle_models WHERE tenant_id=tid AND name='Captiva' LIMIT 1;
  SELECT id INTO m_cruze   FROM vehicle_models WHERE tenant_id=tid AND name='Cruze' LIMIT 1;

  -- ===================== FILTRES =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('FIL-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 5, 50, 'pce', 'new', true
  FROM (VALUES
    ('Filtre à air Toyota Land Cruiser 200 1VD/2UZ',c_flair,'Toyota','17801-51020',8500,13000),
    ('Filtre à air Toyota Prado 150 2.8D 1GD',c_flair,'Toyota','17801-30080',7500,11500),
    ('Filtre à air Toyota Hilux 2.4D 2GD 2016+',c_flair,'Toyota','17801-0L050',7000,10500),
    ('Filtre à air Toyota Fortuner 2.4D 2016+',c_flair,'Toyota','17801-0L090',7000,10500),
    ('Filtre à air Toyota Corolla 1.6 1ZR 2007+',c_flair,'Toyota','17801-0D040',5500,8500),
    ('Filtre à air Toyota Camry 2.5 2AR 2012+',c_flair,'Toyota','17801-0V020',6000,9000),
    ('Filtre à air BMW X5 G05 3.0d B57 2019+',c_flair,'BMW','13718576101',12000,18000),
    ('Filtre à air BMW Série 5 G30 2.0d B47 2017+',c_flair,'BMW','13718576398',10000,15000),
    ('Filtre à air BMW Série 3 G20 2.0i B48 2019+',c_flair,'BMW','13717609922',9500,14500),
    ('Filtre à air Mercedes GLE W167 3.0d OM656',c_flair,'Mercedes-Benz','A6540940200',12500,18500),
    ('Filtre à air Mercedes GLC X253 2.0d OM654',c_flair,'Mercedes-Benz','A6540940000',11000,16500),
    ('Filtre à air Mercedes Classe C W205 2.0d',c_flair,'Mercedes-Benz','A6540940100',10500,15500),
    ('Filtre à air Nissan Patrol Y62 5.6 VK56VD',c_flair,'Nissan','16546-1LA0A',9000,13500),
    ('Filtre à air Nissan Navara NP300 2.5D YD25',c_flair,'Nissan','16546-EC00A',6500,9800),
    ('Filtre à air Ford Ranger 3.2D Duratorq 2012+',c_flair,'Ford','BC3Z9601AA',7500,11500),
    ('Filtre à air Mitsubishi Pajero 3.2D 4M41',c_flair,'Mitsubishi','MR968274',8000,12000),
    ('Filtre à air Audi Q5 2.0 TFSI EA888',c_flair,'Audi','06K133843',9000,13500),
    ('Filtre à air Hyundai Santa Fe 2.2 CRDi D4HB',c_flair,'Hyundai','28113-2W300',7500,11500),
    ('Filtre à air Hyundai Tucson 1.6 CRDi D4FE',c_flair,'Hyundai','28113-D3000',6500,9800),
    ('Filtre à air Kia Sportage 1.6 CRDi 2022+',c_flair,'Kia','28113-2M000',6500,9800),
    ('Filtre à air VW Golf 2.0 TDI EA288',c_flair,'Volkswagen','5Q0129620',6000,9000),
    ('Filtre à air VW Tiguan 2.0 TDI EA288',c_flair,'Volkswagen','5NA129620B',7000,10500),
    ('Filtre à air Renault Clio IV 0.9 TCe H4BT',c_flair,'Renault','8200954994',5000,7800),
    ('Filtre à air Peugeot 308 1.6 HDi DV6',c_flair,'Peugeot','1444XY',5500,8500),
    ('Filtre à huile Toyota Land Cruiser 200 1VD diesel',c_flhui,'Toyota','90915-10004',4500,7000),
    ('Filtre à huile Toyota Prado 150 2.8D 2016+',c_flhui,'Toyota','90915-YZZD4',4200,6500),
    ('Filtre à huile Toyota Hilux 2.4D 2GD',c_flhui,'Toyota','90915-10004',4000,6200),
    ('Filtre à huile BMW X5 G05 3.0d B57',c_flhui,'BMW','11428681038',7500,11500),
    ('Filtre à huile Mercedes GLE W167 OM656',c_flhui,'Mercedes-Benz','A0001802609',8500,13000),
    ('Filtre à huile Nissan Patrol Y62 5.6',c_flhui,'Nissan','15208-65F00',5500,8500),
    ('Filtre à huile Ford Ranger 3.2D',c_flhui,'Ford','1720700',4200,6500),
    ('Filtre à carburant Toyota Land Cruiser 200 1VD diesel',c_flcarb,'Toyota','23303-0L050',8500,13000),
    ('Filtre à carburant Toyota Hilux 2.4D 2GD',c_flcarb,'Toyota','23303-0L030',7000,10500),
    ('Filtre à carburant Nissan Navara NP300 2.5D',c_flcarb,'Nissan','16400-5X00A',6500,9800),
    ('Filtre à carburant BMW X5 G05 3.0d B57',c_flcarb,'BMW','13328594675',8000,12000),
    ('Filtre habitacle Toyota Prado 150',c_flhab,'Toyota','87139-YZZ08',3500,5500),
    ('Filtre habitacle BMW X5 G05',c_flhab,'BMW','64316945996',5500,8500),
    ('Filtre habitacle Mercedes GLE W167',c_flhab,'Mercedes-Benz','A1668300318',6000,9200),
    ('Filtre habitacle Hyundai Santa Fe TM 2018+',c_flhab,'Hyundai','97133-S2000',3500,5500),
    ('Filtre habitacle VW Tiguan 2017+',c_flhab,'Volkswagen','5Q0819653C',4000,6200)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== FREINAGE =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('FRN-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 3, 30, 'pce', 'new', true
  FROM (VALUES
    ('Plaquettes freins avant Toyota Land Cruiser 200 Premium',c_plaq,'Toyota','04465-60400',18000,27000),
    ('Plaquettes freins avant Toyota Prado 150 2.8D',c_plaq,'Toyota','04465-60380',14000,21000),
    ('Plaquettes freins avant Toyota Hilux Revo 2015+',c_plaq,'Toyota','04465-0K370',11000,16500),
    ('Plaquettes freins avant BMW X5 G05 M Sport',c_plaq,'BMW','34116897410',22000,33000),
    ('Plaquettes freins avant BMW Série 5 G30',c_plaq,'BMW','34116891640',18000,27000),
    ('Plaquettes freins avant Mercedes GLE W167 AMG',c_plaq,'Mercedes-Benz','A0074207020',25000,38000),
    ('Plaquettes freins avant Mercedes GLC X253',c_plaq,'Mercedes-Benz','A0064204920',20000,30000),
    ('Plaquettes freins arrière BMW X5 G05',c_plaq,'BMW','34216885762',18000,27000),
    ('Plaquettes freins arrière Mercedes GLE W167',c_plaq,'Mercedes-Benz','A0074208020',20000,30000),
    ('Plaquettes freins avant Nissan Patrol Y62',c_plaq,'Nissan','41060-1LB0A',16000,24000),
    ('Plaquettes freins avant Ford Ranger 2015+',c_plaq,'Ford','EB3Z2001AA',10000,15000),
    ('Plaquettes freins avant Mitsubishi Pajero V97',c_plaq,'Mitsubishi','MN116378',12000,18000),
    ('Plaquettes freins avant Hyundai Santa Fe TM',c_plaq,'Hyundai','58101-S2A30',13000,19500),
    ('Plaquettes freins avant Kia Sportage NQ5',c_plaq,'Kia','58101-P1A30',12000,18000),
    ('Plaquettes freins avant Toyota Corolla 2019+',c_plaq,'Toyota','04465-02320',8500,13000),
    ('Plaquettes freins avant VW Golf/Tiguan 2.0 TDI',c_plaq,'Volkswagen','5Q0698151G',9500,14500),
    ('Disques freins avant Toyota Land Cruiser 200 355mm paire',c_disc,'Toyota','43512-60290',32000,48000),
    ('Disques freins avant BMW X5 G05 348mm paire',c_disc,'BMW','34106864053',35000,52000),
    ('Disques freins avant Mercedes GLE W167 360mm paire',c_disc,'Mercedes-Benz','A0004210912',38000,58000),
    ('Disques freins avant Nissan Patrol Y62 340mm paire',c_disc,'Nissan','40206-1LA0A',28000,42000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== AMORTISSEURS =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('AMOR-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 15, 'pce', 'new', true
  FROM (VALUES
    ('Amortisseur avant Toyota Land Cruiser 200 Bilstein B6',c_amor,'Toyota','48530-60H50',38000,58000),
    ('Amortisseur arrière Toyota Land Cruiser 200 Bilstein',c_amor,'Toyota','48530-60H60',35000,52000),
    ('Amortisseur avant Toyota Prado 150 2.8D 2016+',c_amor,'Toyota','48530-60H30',28000,42000),
    ('Amortisseur arrière Toyota Prado 150',c_amor,'Toyota','48530-60H40',26000,39000),
    ('Amortisseur avant Toyota Hilux Revo 2015+',c_amor,'Toyota','48510-0K280',22000,33000),
    ('Amortisseur arrière Toyota Hilux Revo',c_amor,'Toyota','48531-0K330',20000,30000),
    ('Amortisseur avant BMW X5 G05 Adaptive',c_amor,'BMW','37106869955',52000,78000),
    ('Amortisseur arrière BMW X5 G05 Adaptive',c_amor,'BMW','37106869956',48000,72000),
    ('Amortisseur avant Mercedes GLE W167 Airmatic',c_amor,'Mercedes-Benz','A1673204830',65000,98000),
    ('Amortisseur arrière Mercedes GLE W167 Airmatic',c_amor,'Mercedes-Benz','A1673206230',62000,95000),
    ('Amortisseur avant Nissan Patrol Y62 2010+',c_amor,'Nissan','56110-1LB0A',32000,48000),
    ('Amortisseur arrière Nissan Patrol Y62',c_amor,'Nissan','56200-1LB0A',28000,42000),
    ('Amortisseur avant Mitsubishi Pajero V97',c_amor,'Mitsubishi','MN185888',25000,38000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== BATTERIES =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('BATT-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 3, 20, 'pce', 'new', true
  FROM (VALUES
    ('Batterie 100Ah 800A Toyota Land Cruiser 200 diesel',c_batt,'Toyota','28800-31031',55000,82000),
    ('Batterie 80Ah 760A Toyota Prado 150 2.8D',c_batt,'Toyota','28800-28312',45000,68000),
    ('Batterie 70Ah 600A Toyota Hilux 2.4D',c_batt,'Toyota','28800-0V010',38000,58000),
    ('Batterie AGM 80Ah 800A BMW X5 G05',c_batt,'BMW','61217604807',68000,102000),
    ('Batterie AGM 90Ah 850A BMW Série 5 G30',c_batt,'BMW','61217604804',65000,98000),
    ('Batterie AGM 95Ah 900A Mercedes GLE W167',c_batt,'Mercedes-Benz','A0009828108',72000,108000),
    ('Batterie EFB 70Ah 720A Nissan Navara NP300',c_batt,'Nissan','24410-9FT1A',42000,65000),
    ('Batterie 75Ah 680A Ford Ranger 3.2D',c_batt,'Ford','BK2110655AA',40000,62000),
    ('Batterie 60Ah 540A Renault Clio/Megane',c_batt,'Renault','7711238597',28000,42000),
    ('Batterie 65Ah 600A Peugeot 307/308',c_batt,'Peugeot','9646555480',30000,45000),
    ('Batterie 75Ah 740A Hyundai Santa Fe 2.2 CRDi',c_batt,'Hyundai','37110-3Z200',40000,62000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== ALTERNATEUR & DÉMARREUR =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('ALT-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 1, 8, 'pce', 'new', true
  FROM (VALUES
    ('Alternateur Toyota Land Cruiser 200 1VD 130A',c_alt,'Toyota','27060-51020',72000,108000),
    ('Alternateur Toyota Prado 150 2.8D 130A',c_alt,'Toyota','27060-0L100',65000,98000),
    ('Alternateur Toyota Hilux 2.4D 2016+ 120A',c_alt,'Toyota','27060-0L070',58000,88000),
    ('Alternateur BMW X5 G05 3.0d 180A Valeo',c_alt,'BMW','12318604480',88000,132000),
    ('Alternateur Mercedes GLE W167 OM656 180A',c_alt,'Mercedes-Benz','A0009067100',95000,145000),
    ('Alternateur Nissan Patrol Y62 5.6 150A',c_alt,'Nissan','23100-1LA0A',75000,115000),
    ('Démarreur Toyota Land Cruiser 200 1VD',c_dem,'Toyota','28100-51010',55000,85000),
    ('Démarreur Toyota Prado 150 2.8D',c_dem,'Toyota','28100-0L010',48000,72000),
    ('Démarreur BMW X5 G05 3.0d Bosch',c_dem,'BMW','12418583555',65000,98000),
    ('Démarreur Mercedes GLE W167 OM656',c_dem,'Mercedes-Benz','A6541510001',72000,108000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== AILES =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('AIL-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 1, 8, 'pce', 'new', true
  FROM (VALUES
    ('Aile avant droite Toyota Prado 150 2010-2017',c_aiav,'Toyota','53801-60200',55000,85000),
    ('Aile avant gauche Toyota Prado 150 2010-2017',c_aiav,'Toyota','53701-60200',55000,85000),
    ('Aile avant droite Toyota Land Cruiser 200 2008+',c_aiav,'Toyota','53801-60260',72000,108000),
    ('Aile avant gauche Toyota Land Cruiser 200',c_aiav,'Toyota','53701-60260',72000,108000),
    ('Aile avant droite Toyota Hilux Revo 2015+',c_aiav,'Toyota','53801-0K400',42000,65000),
    ('Aile avant gauche Toyota Hilux Revo 2015+',c_aiav,'Toyota','53701-0K400',42000,65000),
    ('Aile avant droite Toyota Fortuner 2016+',c_aiav,'Toyota','53801-0K890',45000,68000),
    ('Aile avant gauche Toyota Fortuner 2016+',c_aiav,'Toyota','53701-0K890',45000,68000),
    ('Aile avant droite Land Rover Range Rover Sport L494',c_aiav,'Land Rover','LR038975',85000,128000),
    ('Aile avant gauche Land Rover Range Rover Sport L494',c_aiav,'Land Rover','LR038974',85000,128000),
    ('Aile avant droite BMW X5 G05 2019+',c_aiav,'BMW','41007483000',72000,108000),
    ('Aile avant gauche BMW X5 G05 2019+',c_aiav,'BMW','41007483001',72000,108000),
    ('Aile avant droite Mercedes GLE W167 2019+',c_aiav,'Mercedes-Benz','A1678800200',88000,135000),
    ('Aile avant gauche Mercedes GLE W167 2019+',c_aiav,'Mercedes-Benz','A1678800100',88000,135000),
    ('Aile avant droite Nissan Patrol Y62 2010+',c_aiav,'Nissan','63100-1LA0A',62000,95000),
    ('Aile avant gauche Nissan Patrol Y62 2010+',c_aiav,'Nissan','63001-1LA0A',62000,95000),
    ('Aile avant droite Nissan Navara NP300',c_aiav,'Nissan','63100-4KB0A',42000,65000),
    ('Aile avant gauche Nissan Navara NP300',c_aiav,'Nissan','63001-4KB0A',42000,65000),
    ('Aile avant droite Ford Ranger 2019+',c_aiav,'Ford','KB3Z16006AA',38000,58000),
    ('Aile avant gauche Ford Ranger 2019+',c_aiav,'Ford','KB3Z16007AA',38000,58000),
    ('Aile avant droite Hyundai Santa Fe TM 2018+',c_aiav,'Hyundai','66321-S2000',45000,68000),
    ('Aile avant gauche Hyundai Santa Fe TM 2018+',c_aiav,'Hyundai','66311-S2000',45000,68000),
    ('Aile avant droite Kia Sportage NQ5 2022+',c_aiav,'Kia','66321-P1000',38000,58000),
    ('Aile avant gauche Kia Sportage NQ5 2022+',c_aiav,'Kia','66311-P1000',38000,58000),
    ('Coffre Hayon Toyota Prado 150 2010-2013',c_coff,'Toyota','67005-60310',85000,128000),
    ('Coffre Hayon Toyota Land Cruiser 200 2008-2015',c_coff,'Toyota','67005-60290',112000,168000),
    ('Coffre Hayon Toyota Hilux Revo 2015+',c_coff,'Toyota','65700-0K390',55000,85000),
    ('Coffre Hayon Land Rover Discovery 5 2017+',c_coff,'Land Rover','LR073500',95000,145000),
    ('Coffre Hayon BMW X5 G05 2019+',c_coff,'BMW','41007488000',108000,162000),
    ('Coffre Hayon Mercedes GLE W167 2019+',c_coff,'Mercedes-Benz','A1678400105',115000,172000)
  ) AS t(nm, cat, br, oem, pp, sp);

END $$;
