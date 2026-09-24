/*
  # Articles Batch 3 — Multimédia, Intérieur, Kits Sport & Performance
  Écrans Android, audio JBL, tapis, volants, kits AMG/M/SVR/TRD/RS
*/
DO $$
DECLARE
  tid uuid := (SELECT id FROM tenants LIMIT 1);
  c_ecran uuid; c_gps uuid; c_ampli uuid; c_hp uuid;
  c_tweet uuid; c_jbl uuid; c_cmd uuid; c_cam360 uuid;
  c_tapis uuid; c_hous uuid; c_volan uuid; c_tdb uuid;
  c_kamg uuid; c_km uuid; c_krs uuid; c_ksvr uuid;
  c_ktrd uuid; c_knismo uuid; c_kst uuid; c_kuniv uuid;
  c_kgt uuid; c_knl uuid;
  -- modèles
  m_prado uuid; m_lc200 uuid; m_lc uuid; m_hilux uuid; m_fortuner uuid;
  m_rav4 uuid; m_innova uuid; m_camry uuid; m_corolla uuid;
  m_rrs uuid; m_rr uuid; m_def uuid; m_disco uuid; m_evoque uuid;
  m_x5 uuid; m_x6 uuid; m_s3 uuid; m_s5 uuid; m_m3 uuid; m_s7 uuid;
  m_gle uuid; m_glc uuid; m_gls uuid; m_classc uuid; m_classe uuid;
  m_patrol uuid; m_navara uuid; m_qash uuid;
  m_ranger uuid; m_mustang uuid;
  m_pajero uuid; m_l200 uuid; m_outlander uuid; m_pajsport uuid;
  m_q7 uuid; m_q5 uuid; m_q8 uuid; m_a6 uuid; m_rs4 uuid;
  m_santafe uuid; m_tucson uuid; m_creta uuid;
  m_sorento uuid; m_sportage uuid;
  m_tiguan uuid; m_amarok uuid;
  m_accord uuid; m_hrv uuid; m_crv uuid;
  m_clio uuid; m_megane uuid; m_duster uuid;
BEGIN
  SELECT id INTO c_ecran FROM part_categories WHERE tenant_id=tid AND code='ECRAN-AND' LIMIT 1;
  SELECT id INTO c_gps   FROM part_categories WHERE tenant_id=tid AND code='GPS' LIMIT 1;
  SELECT id INTO c_ampli FROM part_categories WHERE tenant_id=tid AND code='AMPLI' LIMIT 1;
  SELECT id INTO c_hp    FROM part_categories WHERE tenant_id=tid AND code='HP' LIMIT 1;
  SELECT id INTO c_tweet FROM part_categories WHERE tenant_id=tid AND code='TWEET' LIMIT 1;
  SELECT id INTO c_jbl   FROM part_categories WHERE tenant_id=tid AND code='KIT-JBL' LIMIT 1;
  SELECT id INTO c_cmd   FROM part_categories WHERE tenant_id=tid AND code='CMD-VOL' LIMIT 1;
  SELECT id INTO c_cam360 FROM part_categories WHERE tenant_id=tid AND code='CAM-360' LIMIT 1;
  SELECT id INTO c_tapis FROM part_categories WHERE tenant_id=tid AND code='TAPIS' LIMIT 1;
  SELECT id INTO c_hous  FROM part_categories WHERE tenant_id=tid AND code='HOUS-SIE' LIMIT 1;
  SELECT id INTO c_volan FROM part_categories WHERE tenant_id=tid AND code='VOLAN-SP' LIMIT 1;
  SELECT id INTO c_tdb   FROM part_categories WHERE tenant_id=tid AND code='ACC-TDB' LIMIT 1;
  SELECT id INTO c_kamg  FROM part_categories WHERE tenant_id=tid AND code='KIT-AMG' LIMIT 1;
  SELECT id INTO c_km    FROM part_categories WHERE tenant_id=tid AND code='KIT-M' LIMIT 1;
  SELECT id INTO c_krs   FROM part_categories WHERE tenant_id=tid AND code='KIT-RS' LIMIT 1;
  SELECT id INTO c_ksvr  FROM part_categories WHERE tenant_id=tid AND code='KIT-SVR' LIMIT 1;
  SELECT id INTO c_ktrd  FROM part_categories WHERE tenant_id=tid AND code='KIT-TRD' LIMIT 1;
  SELECT id INTO c_knismo FROM part_categories WHERE tenant_id=tid AND code='KIT-NISMO' LIMIT 1;
  SELECT id INTO c_kst   FROM part_categories WHERE tenant_id=tid AND code='KIT-ST' LIMIT 1;
  SELECT id INTO c_kuniv FROM part_categories WHERE tenant_id=tid AND code='KIT-UNIV' LIMIT 1;
  SELECT id INTO c_kgt   FROM part_categories WHERE tenant_id=tid AND code='KIT-GT' LIMIT 1;
  SELECT id INTO c_knl   FROM part_categories WHERE tenant_id=tid AND code='KIT-NL' LIMIT 1;

  SELECT id INTO m_prado   FROM vehicle_models WHERE tenant_id=tid AND name='Prado' LIMIT 1;
  SELECT id INTO m_lc200   FROM vehicle_models WHERE tenant_id=tid AND name='Land Cruiser 200' LIMIT 1;
  SELECT id INTO m_lc      FROM vehicle_models WHERE tenant_id=tid AND name='Land Cruiser' LIMIT 1;
  SELECT id INTO m_hilux   FROM vehicle_models WHERE tenant_id=tid AND name='Hilux' LIMIT 1;
  SELECT id INTO m_fortuner FROM vehicle_models WHERE tenant_id=tid AND name='Fortuner' LIMIT 1;
  SELECT id INTO m_rav4    FROM vehicle_models WHERE tenant_id=tid AND name='RAV4' LIMIT 1;
  SELECT id INTO m_innova  FROM vehicle_models WHERE tenant_id=tid AND name='Innova' LIMIT 1;
  SELECT id INTO m_camry   FROM vehicle_models WHERE tenant_id=tid AND name='Camry' LIMIT 1;
  SELECT id INTO m_corolla FROM vehicle_models WHERE tenant_id=tid AND name='Corolla' LIMIT 1;
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
  SELECT id INTO m_s7      FROM vehicle_models WHERE tenant_id=tid AND name='Série 7' LIMIT 1;
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
  SELECT id INTO m_pajero  FROM vehicle_models WHERE tenant_id=tid AND name='Pajero' LIMIT 1;
  SELECT id INTO m_pajsport FROM vehicle_models WHERE tenant_id=tid AND name='Pajero Sport' LIMIT 1;
  SELECT id INTO m_l200    FROM vehicle_models WHERE tenant_id=tid AND name='L200' LIMIT 1;
  SELECT id INTO m_outlander FROM vehicle_models WHERE tenant_id=tid AND name='Outlander' LIMIT 1;
  SELECT id INTO m_q7      FROM vehicle_models WHERE tenant_id=tid AND name='Q7' LIMIT 1;
  SELECT id INTO m_q5      FROM vehicle_models WHERE tenant_id=tid AND name='Q5' LIMIT 1;
  SELECT id INTO m_q8      FROM vehicle_models WHERE tenant_id=tid AND name='Q8' LIMIT 1;
  SELECT id INTO m_a6      FROM vehicle_models WHERE tenant_id=tid AND name='A6' LIMIT 1;
  SELECT id INTO m_rs4     FROM vehicle_models WHERE tenant_id=tid AND name='RS4' LIMIT 1;
  SELECT id INTO m_santafe FROM vehicle_models WHERE tenant_id=tid AND name='Santa Fe' LIMIT 1;
  SELECT id INTO m_tucson  FROM vehicle_models WHERE tenant_id=tid AND name='Tucson' LIMIT 1;
  SELECT id INTO m_creta   FROM vehicle_models WHERE tenant_id=tid AND name='Creta' LIMIT 1;
  SELECT id INTO m_sorento FROM vehicle_models WHERE tenant_id=tid AND name='Sorento' LIMIT 1;
  SELECT id INTO m_sportage FROM vehicle_models WHERE tenant_id=tid AND name='Sportage' LIMIT 1;
  SELECT id INTO m_tiguan  FROM vehicle_models WHERE tenant_id=tid AND name='Tiguan' LIMIT 1;
  SELECT id INTO m_amarok  FROM vehicle_models WHERE tenant_id=tid AND name='Amarok' LIMIT 1;
  SELECT id INTO m_accord  FROM vehicle_models WHERE tenant_id=tid AND name='Accord' LIMIT 1;
  SELECT id INTO m_hrv     FROM vehicle_models WHERE tenant_id=tid AND name='HR-V' LIMIT 1;
  SELECT id INTO m_crv     FROM vehicle_models WHERE tenant_id=tid AND name='CR-V' LIMIT 1;
  SELECT id INTO m_clio    FROM vehicle_models WHERE tenant_id=tid AND name='Clio' LIMIT 1;
  SELECT id INTO m_megane  FROM vehicle_models WHERE tenant_id=tid AND name='Megane' LIMIT 1;
  SELECT id INTO m_duster  FROM vehicle_models WHERE tenant_id=tid AND name='Duster' LIMIT 1;

  -- ===================== ÉCRANS ANDROID =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('AND-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 15, 'pce', 'new', true
  FROM (VALUES
    ('Écran Android 13 Toyota Land Cruiser 200 12.3" 8Go RAM GPS',c_ecran,'Toyota','AND-LC200-12',185000,278000),
    ('Écran Android 13 Toyota Prado 150 10.1" 4Go RAM GPS',c_ecran,'Toyota','AND-PRADO-10',135000,205000),
    ('Écran Android 13 Toyota Hilux Revo 9" 4Go RAM GPS WiFi',c_ecran,'Toyota','AND-HILUX-9',115000,175000),
    ('Écran Android 13 Toyota Fortuner 2016+ 10.1" GPS',c_ecran,'Toyota','AND-FORT-10',128000,195000),
    ('Écran Android 13 Toyota Innova 2016+ 9" GPS',c_ecran,'Toyota','AND-INN-9',108000,165000),
    ('Écran Android 13 Toyota Camry 2018+ 10.1" GPS',c_ecran,'Toyota','AND-CAMRY-10',122000,185000),
    ('Écran Android 13 Toyota Corolla 2019+ 9"',c_ecran,'Toyota','AND-CORO-9',98000,148000),
    ('Écran Android 13 Land Rover Range Rover Sport 10.25" GPS',c_ecran,'Land Rover','AND-RRS-10',165000,248000),
    ('Écran Android 13 Land Rover Defender 2020+ 10.25"',c_ecran,'Land Rover','AND-DEF-10',158000,238000),
    ('Écran Android 13 BMW X5 G05 12.3" iDrive compatible',c_ecran,'BMW','AND-X5-G05-12',195000,295000),
    ('Écran Android 13 BMW Série 5 G30 10.25" iDrive',c_ecran,'BMW','AND-S5-G30-10',168000,255000),
    ('Écran Android 13 BMW Série 3 G20 10.25"',c_ecran,'BMW','AND-S3-G20-10',155000,235000),
    ('Écran Android 13 Mercedes GLE W167 10.25" MBUX',c_ecran,'Mercedes-Benz','AND-GLE-W167-10',175000,265000),
    ('Écran Android 13 Mercedes GLC X253 10.25" MBUX',c_ecran,'Mercedes-Benz','AND-GLC-X253-10',162000,245000),
    ('Écran Android 13 Mercedes Classe C W205 10.25"',c_ecran,'Mercedes-Benz','AND-W205-10',148000,225000),
    ('Écran Android 13 Nissan Patrol Y62 10.1" GPS',c_ecran,'Nissan','AND-Y62-10',138000,208000),
    ('Écran Android 13 Nissan Navara NP300 9" GPS',c_ecran,'Nissan','AND-NAV-9',108000,165000),
    ('Écran Android 13 Ford Ranger 2019+ 9" GPS',c_ecran,'Ford','AND-RNGR-9',112000,168000),
    ('Écran Android 13 Mitsubishi Pajero 10.1" GPS',c_ecran,'Mitsubishi','AND-PAJ-10',125000,188000),
    ('Écran Android 13 Audi Q7 4M 10.1" MMI compatible',c_ecran,'Audi','AND-Q7-10',148000,225000),
    ('Écran Android 13 Hyundai Santa Fe TM 10.1" GPS',c_ecran,'Hyundai','AND-SANTAFE-10',128000,195000),
    ('Écran Android 13 Hyundai Tucson NX4 10.1"',c_ecran,'Hyundai','AND-TUCSON-10',118000,178000),
    ('Écran Android 13 Kia Sportage NQ5 10.1" GPS',c_ecran,'Kia','AND-SPORT-10',115000,175000),
    ('Écran Android 13 Honda CR-V 2017+ 10.1"',c_ecran,'Honda','AND-CRV-10',108000,165000),
    ('Écran Android 13 Renault Duster 2018+ 9"',c_ecran,'Renault','AND-DUST-9',88000,135000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== AUDIO JBL & SYSTÈMES =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('AUD-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 10, 'pce', 'new', true
  FROM (VALUES
    ('Kit audio JBL Toyota Land Cruiser 200 — 12 haut-parleurs premium',c_jbl,'Toyota','JBL-LC200-KIT12',325000,495000),
    ('Kit audio JBL Toyota Prado 150 — 8 hp + ampli',c_jbl,'Toyota','JBL-PRADO-KIT8',245000,375000),
    ('Kit audio JBL Toyota Hilux Revo — 6 hp + ampli',c_jbl,'Toyota','JBL-HILUX-KIT6',185000,278000),
    ('Kit audio JBL Land Rover Range Rover Sport 14 hp Meridian upgrade',c_jbl,'Land Rover','JBL-RRS-MER14',395000,598000),
    ('Kit audio JBL BMW X5 G05 Harman Kardon upgrade 16 hp',c_jbl,'BMW','JBL-X5-HK16',365000,555000),
    ('Kit audio JBL BMW Série 5 G30 Harman Kardon 10 hp',c_jbl,'BMW','JBL-S5-HK10',298000,448000),
    ('Kit audio JBL Mercedes GLE W167 Burmester upgrade 13 hp',c_jbl,'Mercedes-Benz','JBL-GLE-BUR13',418000,635000),
    ('Kit audio JBL Nissan Patrol Y62 Bose upgrade 10 hp',c_jbl,'Nissan','JBL-Y62-BOSE10',285000,435000),
    ('Amplificateur Pioneer 4 canaux 1200W DSP universel',c_ampli,NULL,'AMPLI-PIO-1200W',68000,105000),
    ('Amplificateur JBL Club 4 canaux 1200W',c_ampli,NULL,'AMPLI-JBL-1200W',75000,115000),
    ('Subwoofer actif JBL 12" 800W universel',c_ampli,NULL,'SUB-JBL-12-800',88000,135000),
    ('Subwoofer actif Pioneer 10" 600W',c_ampli,NULL,'SUB-PIO-10-600',72000,110000),
    ('Haut-parleurs Alpine 6.5" 300W coaxiaux paire',c_hp,NULL,'HP-ALP-65-300',35000,55000),
    ('Haut-parleurs JBL Club 6.5" 280W coaxiaux paire',c_hp,NULL,'HP-JBL-65-280',32000,48000),
    ('Haut-parleurs Focal 6x9" 250W 2 voies paire',c_hp,NULL,'HP-FOC-69-250',38000,58000),
    ('Tweeters JBL Club 40W paire',c_tweet,NULL,'TWT-JBL-40',15000,24000),
    ('Tweeters Focal TN52 165W paire',c_tweet,NULL,'TWT-FOC-165',25000,38000),
    ('Interface commandes volant universel Toyota/Lexus',c_cmd,NULL,'CMD-VOL-TOY',12000,18500),
    ('Interface commandes volant BMW F/G série Can-Bus',c_cmd,NULL,'CMD-VOL-BMW',15000,23000),
    ('Interface commandes volant Mercedes NTG5 Can-Bus',c_cmd,NULL,'CMD-VOL-MERC',16000,25000),
    ('Interface commandes volant Nissan/Infiniti Can-Bus',c_cmd,NULL,'CMD-VOL-NIS',12000,18500)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== INTÉRIEUR =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('INT-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 2, 20, 'pce', 'new', true
  FROM (VALUES
    ('Tapis caoutchouc 3D Toyota Prado 150 jeu complet 5 pièces',c_tapis,'Toyota','TAPIS-PRADO-5P',22000,35000),
    ('Tapis caoutchouc 3D Toyota Land Cruiser 200 7 places',c_tapis,'Toyota','TAPIS-LC200-7P',28000,42000),
    ('Tapis caoutchouc 3D Toyota Hilux Revo double cab',c_tapis,'Toyota','TAPIS-HILUX-DC',18000,28000),
    ('Tapis caoutchouc 3D Toyota Fortuner 2016+ 5 pièces',c_tapis,'Toyota','TAPIS-FORT-5P',22000,35000),
    ('Tapis caoutchouc 3D Land Rover Range Rover Sport L494',c_tapis,'Land Rover','TAPIS-RRS-5P',35000,55000),
    ('Tapis caoutchouc 3D Land Rover Defender 110 2020+',c_tapis,'Land Rover','TAPIS-DEF-5P',32000,48000),
    ('Tapis caoutchouc 3D BMW X5 G05 5 places',c_tapis,'BMW','TAPIS-X5-G05',35000,55000),
    ('Tapis caoutchouc 3D BMW Série 5 G30',c_tapis,'BMW','TAPIS-S5-G30',28000,42000),
    ('Tapis velours premium Mercedes GLE W167 5 pièces',c_tapis,'Mercedes-Benz','TAPIS-GLE-VEL',42000,65000),
    ('Tapis 3D Nissan Patrol Y62 7 places',c_tapis,'Nissan','TAPIS-Y62-7P',28000,42000),
    ('Tapis 3D Ford Ranger double cab 4 pièces',c_tapis,'Ford','TAPIS-RNGR-4P',18000,28000),
    ('Tapis 3D Hyundai Santa Fe TM 5 places',c_tapis,'Hyundai','TAPIS-SANTAFE-5P',22000,35000),
    ('Tapis 3D Kia Sorento 2021+ 5 places',c_tapis,'Kia','TAPIS-SOR-5P',22000,35000),
    ('Housses de siège cuir Toyota Land Cruiser 200 7 places',c_hous,'Toyota','HOUS-LC200-CUI7',78000,118000),
    ('Housses de siège cuir Toyota Prado 150 5 places',c_hous,'Toyota','HOUS-PRADO-CUI5',62000,95000),
    ('Housses de siège cuir Land Rover Range Rover Sport 5 places',c_hous,'Land Rover','HOUS-RRS-CUI5',88000,135000),
    ('Housses de siège cuir BMW X5 G05 5 places',c_hous,'BMW','HOUS-X5-CUI5',85000,128000),
    ('Housses de siège cuir Mercedes GLE W167 5 places',c_hous,'Mercedes-Benz','HOUS-GLE-CUI5',95000,145000),
    ('Housses de siège néoprène Toyota Hilux Revo double cab',c_hous,'Toyota','HOUS-HILUX-NEO',42000,65000),
    ('Volant sport cuir BMW M Performance G20/G30 M3 look',c_volan,'BMW','VOLAN-M-G20',65000,98000),
    ('Volant sport cuir Mercedes AMG Classe C W205',c_volan,'Mercedes-Benz','VOLAN-AMG-W205',72000,108000),
    ('Volant sport Momo cuir 350mm universel noir',c_volan,NULL,'VOLAN-MOMO-350',18000,28000),
    ('Console centrale Toyota Land Cruiser 200 avec chargeur sans fil',c_tdb,'Toyota','TDB-LC200-CONS',35000,55000),
    ('Tableau de bord Toyota Prado 150 boiserie intérieure',c_tdb,'Toyota','TDB-PRADO-BOI',22000,35000),
    ('Pommeau de levier BMW M Performance noir Alcantara',c_tdb,'BMW','POMM-BMW-M-ALC',28000,42000)
  ) AS t(nm, cat, br, oem, pp, sp);

  -- ===================== KITS SPORT & PERFORMANCE =====================
  INSERT INTO articles (tenant_id,internal_ref,name,category_id,brand,oem_ref,purchase_price,sale_price,min_price,stock_min,stock_max,unit,condition,is_active)
  SELECT tid, format('KSP-%03s', ROW_NUMBER() OVER (ORDER BY nm)), nm, cat, br, oem, pp, sp, pp*1.1, 1, 5, 'kit', 'new', true
  FROM (VALUES
    ('Kit AMG GLE 63 W167 2020+ carrosserie complète 8 pièces',c_kamg,'Mercedes-Benz','KIT-AMG-GLE63-W167',485000,738000),
    ('Kit AMG GLC 63 X253 2019+ pack complet pare-chocs+jupes+diffuseur',c_kamg,'Mercedes-Benz','KIT-AMG-GLC63',395000,598000),
    ('Kit AMG C63 W205 Classe C pack sport 2014-2021',c_kamg,'Mercedes-Benz','KIT-AMG-C63-W205',345000,525000),
    ('Kit AMG GLS 63 X167 carrosserie sport 2020+',c_kamg,'Mercedes-Benz','KIT-AMG-GLS63',418000,635000),
    ('Kit M Performance X5 G05 pack carrosserie noir mat',c_km,'BMW','KIT-M-X5-G05-NM',425000,645000),
    ('Kit M Performance X6 G06 pack complet',c_km,'BMW','KIT-M-X6-G06',438000,665000),
    ('Kit M Performance Série 5 G30 2017+ pack',c_km,'BMW','KIT-M-S5-G30',355000,538000),
    ('Kit M Performance Série 3 G20 2019+ pack sport',c_km,'BMW','KIT-M-S3-G20',325000,495000),
    ('Kit M3 Competition Look G80 2021+',c_km,'BMW','KIT-M3-COMP-G80',445000,675000),
    ('Kit RS Audi Q7 4M sport carrosserie noir 2016+',c_krs,'Audi','KIT-RS-Q7-4M',398000,605000),
    ('Kit RS Audi Q5 S-Line FY 2017+',c_krs,'Audi','KIT-RS-Q5-FY',355000,538000),
    ('Kit RS Audi Q8 S Sport 2019+',c_krs,'Audi','KIT-RS-Q8',415000,630000),
    ('Kit SVR Range Rover Sport L494 2018+ full body',c_ksvr,'Land Rover','KIT-SVR-RRS-L494',558000,848000),
    ('Kit SVR Range Rover L405 Supercharged style 2013+',c_ksvr,'Land Rover','KIT-SVR-RR-L405',495000,750000),
    ('Kit Black Pack Range Rover Defender 2020+',c_ksvr,'Land Rover','KIT-BLACK-DEF',285000,435000),
    ('Kit TRD Sport Toyota Land Cruiser 200 Performance Pack',c_ktrd,'Toyota','KIT-TRD-LC200-PP',398000,605000),
    ('Kit TRD Pro Toyota Prado 150 sport complet',c_ktrd,'Toyota','KIT-TRD-PRO-PRADO',345000,525000),
    ('Kit TRD Pro Toyota Hilux Revo 2018+',c_ktrd,'Toyota','KIT-TRD-PRO-HILUX',268000,408000),
    ('Kit TRD Sport Toyota RAV4 2019+',c_ktrd,'Toyota','KIT-TRD-RAV4',215000,328000),
    ('Kit Nismo Nissan Patrol Y62 Sport Performance',c_knismo,'Nissan','KIT-NISMO-Y62-SP',368000,558000),
    ('Kit Nismo Nissan Navara NP300 2017+',c_knismo,'Nissan','KIT-NISMO-NAV',248000,375000),
    ('Kit ST Ford Ranger Raptor Style 2019+',c_kst,'Ford','KIT-ST-RNGR-RAP',285000,435000),
    ('Kit GT-Line Kia Sportage NQ5 pack complet 2022+',c_kgt,'Kia','KIT-GTL-SPORT-NQ5',245000,372000),
    ('Kit GT-Line Kia Sorento MQ4 2021+',c_kgt,'Kia','KIT-GTL-SOR-MQ4',258000,392000),
    ('Kit N-Line Hyundai Santa Fe TM 2019+',c_knl,'Hyundai','KIT-NL-SANTAFE-TM',245000,372000),
    ('Kit N-Line Hyundai Tucson NX4 2021+',c_knl,'Hyundai','KIT-NL-TUCSON-NX4',228000,348000),
    ('Kit sport universel SUV pare-chocs+jupes+diffuseur noir mat',c_kuniv,NULL,'KIT-UNIV-SUV-NM',195000,295000),
    ('Kit sport universel Pick-up barres latérales+élargisseurs',c_kuniv,NULL,'KIT-UNIV-PIKUP',175000,265000),
    ('Kit sport universel berline lèvre avant+diffuseur+aileron',c_kuniv,NULL,'KIT-UNIV-BERL',145000,218000)
  ) AS t(nm, cat, br, oem, pp, sp);

END $$;
