/*
  # Peuplement des compatibilités articles / véhicules

  Pour chaque article du catalogue, insère les entrées article_compatibilities
  correspondant aux marques et modèles réellement compatibles.

  Logique appliquée par type de pièce:
  - Filtres à huile / air / carburant: compatibilités étendues par moteur partagé
  - Plaquettes / disques: compatibilités par plateforme constructeur
  - Huiles / consommables universels: toutes les marques
  - Pièces spécifiques (courroie distrib, pompe à eau, embrayage): modèles précis
  - Batteries: gamme de puissance couvre plusieurs modèles

  Toutes les insertions utilisent ON CONFLICT DO NOTHING pour idempotence.
*/

DO $$
DECLARE
  v_tenant_id uuid;
  b_toyota uuid; b_nissan uuid; b_hyundai uuid; b_kia uuid;
  b_renault uuid; b_peugeot uuid; b_citroen uuid; b_vw uuid;
  b_mercedes uuid; b_bmw uuid; b_ford uuid; b_opel uuid;
  b_mitsubishi uuid; b_honda uuid; b_suzuki uuid; b_isuzu uuid;
  b_landrover uuid; b_fiat uuid; b_dacia uuid; b_mazda uuid;
  b_audi uuid; b_chevrolet uuid;
  m_corolla uuid; m_yaris uuid; m_auris uuid; m_camry uuid; m_prius uuid;
  m_rav4 uuid; m_hilux uuid; m_hiace uuid; m_lc uuid; m_lc70 uuid; m_lc200 uuid;
  m_prado uuid; m_fortuner uuid; m_vitz uuid; m_probox uuid; m_avanza uuid;
  m_clio uuid; m_megane uuid; m_laguna uuid; m_scenic uuid; m_kangoo uuid;
  m_trafic uuid; m_master uuid; m_duster_r uuid; m_logan_r uuid; m_sandero_r uuid;
  m_fluence uuid; m_symbol uuid;
  m_206 uuid; m_207 uuid; m_208 uuid; m_306 uuid; m_307 uuid; m_308 uuid;
  m_405 uuid; m_406 uuid; m_407 uuid; m_partner uuid;
  m_c3 uuid; m_c4 uuid; m_c5 uuid; m_berlingo uuid; m_jumpy uuid; m_xsara uuid;
  m_almera uuid; m_micra uuid; m_note uuid; m_primera uuid; m_xtrail uuid;
  m_qashqai uuid; m_patrol uuid; m_navara uuid; m_pathfinder uuid;
  m_i10 uuid; m_i20 uuid; m_i30 uuid; m_accent uuid; m_elantra uuid;
  m_tucson uuid; m_santafe uuid; m_h1 uuid;
  m_picanto uuid; m_rio uuid; m_sportage uuid; m_sorento uuid; m_carnival uuid;
  m_classe_a uuid; m_classe_c uuid; m_classe_e uuid; m_sprinter uuid; m_vito uuid; m_glc uuid;
  m_s1 uuid; m_s3 uuid; m_s5 uuid; m_x3 uuid; m_x5 uuid;
  m_golf uuid; m_polo uuid; m_passat uuid; m_tiguan uuid; m_caddy uuid;
  m_fiesta uuid; m_focus uuid; m_mondeo uuid; m_ranger uuid; m_transit uuid; m_kuga uuid;
  m_corsa uuid; m_astra uuid; m_vectra uuid; m_zafira uuid; m_vivaro uuid;
  m_lancer uuid; m_pajero uuid; m_pajero_sport uuid; m_l200 uuid; m_l300 uuid; m_outlander uuid;
  m_civic uuid; m_accord uuid; m_crv uuid; m_jazz uuid;
  m_swift uuid; m_vitara uuid; m_grand_vitara uuid; m_jimny uuid;
  m_dmax uuid; m_nkr uuid;
  m_defender uuid; m_discovery uuid; m_range_rover uuid; m_freelander uuid;
  m_logan_d uuid; m_sandero_d uuid; m_duster_d uuid;
  m_punto uuid; m_doblo uuid; m_ducato uuid;
  m_mazda3 uuid; m_mazda6 uuid; m_cx5 uuid; m_bt50 uuid;
  m_a3 uuid; m_a4 uuid; m_a6 uuid;
  m_aveo uuid; m_captiva uuid; m_colorado uuid;
  a_fh001 uuid; a_fh002 uuid; a_fh003 uuid; a_fh004 uuid; a_fh005 uuid; a_fh006 uuid;
  a_fa001 uuid; a_fa002 uuid; a_fa003 uuid; a_fa004 uuid; a_fa005 uuid;
  a_fc001 uuid; a_fc002 uuid; a_fc003 uuid;
  a_fch001 uuid; a_fch002 uuid;
  a_pf001 uuid; a_pf002 uuid; a_pf003 uuid; a_pf004 uuid; a_pf005 uuid; a_pf006 uuid;
  a_df001 uuid; a_df002 uuid; a_df003 uuid; a_df004 uuid;
  a_cd001 uuid; a_cd002 uuid; a_cd003 uuid; a_cd004 uuid;
  a_pe001 uuid; a_pe002 uuid; a_pe003 uuid; a_pe004 uuid;
  a_am001 uuid; a_am002 uuid; a_am003 uuid; a_am004 uuid; a_am005 uuid;
  a_rot001 uuid; a_rot002 uuid; a_rot003 uuid; a_rot004 uuid;
  a_su001 uuid; a_su002 uuid; a_su003 uuid; a_su004 uuid; a_su005 uuid; a_su006 uuid; a_su007 uuid;
  a_alt001 uuid; a_alt002 uuid; a_alt003 uuid;
  a_dem001 uuid; a_dem002 uuid; a_dem003 uuid;
  a_bat001 uuid; a_bat002 uuid; a_bat003 uuid; a_bat004 uuid;
  a_bg001 uuid; a_bg002 uuid; a_bg003 uuid; a_bg004 uuid;
  a_el001 uuid; a_el002 uuid; a_el003 uuid; a_el004 uuid; a_el005 uuid;
  a_et001 uuid; a_et002 uuid;
  a_kt001 uuid; a_kt002 uuid;
  a_ve001 uuid; a_ve002 uuid;
  a_ra001 uuid; a_ra002 uuid;
  a_hu001 uuid; a_hu002 uuid; a_hu003 uuid; a_hu004 uuid; a_hu005 uuid;
BEGIN
  SELECT id INTO v_tenant_id FROM tenants LIMIT 1;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  SELECT id INTO b_toyota     FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Toyota';
  SELECT id INTO b_nissan     FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Nissan';
  SELECT id INTO b_hyundai    FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Hyundai';
  SELECT id INTO b_kia        FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Kia';
  SELECT id INTO b_renault    FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Renault';
  SELECT id INTO b_peugeot    FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Peugeot';
  SELECT id INTO b_citroen    FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Citroën';
  SELECT id INTO b_vw         FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Volkswagen';
  SELECT id INTO b_mercedes   FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Mercedes-Benz';
  SELECT id INTO b_bmw        FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='BMW';
  SELECT id INTO b_ford       FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Ford';
  SELECT id INTO b_opel       FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Opel';
  SELECT id INTO b_mitsubishi FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Mitsubishi';
  SELECT id INTO b_honda      FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Honda';
  SELECT id INTO b_suzuki     FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Suzuki';
  SELECT id INTO b_isuzu      FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Isuzu';
  SELECT id INTO b_landrover  FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Land Rover';
  SELECT id INTO b_fiat       FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Fiat';
  SELECT id INTO b_dacia      FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Dacia';
  SELECT id INTO b_mazda      FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Mazda';
  SELECT id INTO b_audi       FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Audi';
  SELECT id INTO b_chevrolet  FROM vehicle_brands WHERE tenant_id=v_tenant_id AND name='Chevrolet';

  SELECT id INTO m_corolla  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Corolla';
  SELECT id INTO m_yaris    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Yaris';
  SELECT id INTO m_auris    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Auris';
  SELECT id INTO m_camry    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Camry';
  SELECT id INTO m_prius    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Prius';
  SELECT id INTO m_rav4     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='RAV4';
  SELECT id INTO m_hilux    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Hilux';
  SELECT id INTO m_hiace    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='HiAce';
  SELECT id INTO m_lc       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Land Cruiser';
  SELECT id INTO m_lc70     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Land Cruiser 70';
  SELECT id INTO m_lc200    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Land Cruiser 200';
  SELECT id INTO m_prado    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Prado';
  SELECT id INTO m_fortuner FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Fortuner';
  SELECT id INTO m_vitz     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Vitz';
  SELECT id INTO m_probox   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Probox';
  SELECT id INTO m_avanza   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_toyota AND name='Avanza';
  SELECT id INTO m_clio     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Clio';
  SELECT id INTO m_megane   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Megane';
  SELECT id INTO m_laguna   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Laguna';
  SELECT id INTO m_scenic   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Scenic';
  SELECT id INTO m_kangoo   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Kangoo';
  SELECT id INTO m_duster_r FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Duster';
  SELECT id INTO m_logan_r  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Logan';
  SELECT id INTO m_sandero_r FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Sandero';
  SELECT id INTO m_fluence  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Fluence';
  SELECT id INTO m_symbol   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_renault AND name='Symbol';
  SELECT id INTO m_206      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_peugeot AND name='206';
  SELECT id INTO m_207      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_peugeot AND name='207';
  SELECT id INTO m_208      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_peugeot AND name='208';
  SELECT id INTO m_306      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_peugeot AND name='306';
  SELECT id INTO m_307      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_peugeot AND name='307';
  SELECT id INTO m_308      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_peugeot AND name='308';
  SELECT id INTO m_partner  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_peugeot AND name='Partner';
  SELECT id INTO m_c3       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_citroen AND name='C3';
  SELECT id INTO m_c4       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_citroen AND name='C4';
  SELECT id INTO m_c5       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_citroen AND name='C5';
  SELECT id INTO m_berlingo FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_citroen AND name='Berlingo';
  SELECT id INTO m_xsara    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_citroen AND name='Xsara';
  SELECT id INTO m_almera   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_nissan AND name='Almera';
  SELECT id INTO m_micra    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_nissan AND name='Micra';
  SELECT id INTO m_note     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_nissan AND name='Note';
  SELECT id INTO m_primera  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_nissan AND name='Primera';
  SELECT id INTO m_xtrail   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_nissan AND name='X-Trail';
  SELECT id INTO m_qashqai  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_nissan AND name='Qashqai';
  SELECT id INTO m_patrol   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_nissan AND name='Patrol';
  SELECT id INTO m_navara   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_nissan AND name='Navara';
  SELECT id INTO m_pathfinder FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_nissan AND name='Pathfinder';
  SELECT id INTO m_i10      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_hyundai AND name='i10';
  SELECT id INTO m_i20      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_hyundai AND name='i20';
  SELECT id INTO m_i30      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_hyundai AND name='i30';
  SELECT id INTO m_accent   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_hyundai AND name='Accent';
  SELECT id INTO m_elantra  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_hyundai AND name='Elantra';
  SELECT id INTO m_tucson   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_hyundai AND name='Tucson';
  SELECT id INTO m_santafe  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_hyundai AND name='Santa Fe';
  SELECT id INTO m_h1       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_hyundai AND name='H-1';
  SELECT id INTO m_picanto  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_kia AND name='Picanto';
  SELECT id INTO m_rio      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_kia AND name='Rio';
  SELECT id INTO m_sportage FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_kia AND name='Sportage';
  SELECT id INTO m_sorento  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_kia AND name='Sorento';
  SELECT id INTO m_carnival FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_kia AND name='Carnival';
  SELECT id INTO m_classe_a  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mercedes AND name='Classe A';
  SELECT id INTO m_classe_c  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mercedes AND name='Classe C';
  SELECT id INTO m_classe_e  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mercedes AND name='Classe E';
  SELECT id INTO m_sprinter  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mercedes AND name='Sprinter';
  SELECT id INTO m_vito      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mercedes AND name='Vito';
  SELECT id INTO m_glc       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mercedes AND name='GLC';
  SELECT id INTO m_s1       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_bmw AND name='Série 1';
  SELECT id INTO m_s3       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_bmw AND name='Série 3';
  SELECT id INTO m_s5       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_bmw AND name='Série 5';
  SELECT id INTO m_x3       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_bmw AND name='X3';
  SELECT id INTO m_x5       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_bmw AND name='X5';
  SELECT id INTO m_golf     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_vw AND name='Golf';
  SELECT id INTO m_polo     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_vw AND name='Polo';
  SELECT id INTO m_passat   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_vw AND name='Passat';
  SELECT id INTO m_tiguan   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_vw AND name='Tiguan';
  SELECT id INTO m_caddy    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_vw AND name='Caddy';
  SELECT id INTO m_fiesta   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_ford AND name='Fiesta';
  SELECT id INTO m_focus    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_ford AND name='Focus';
  SELECT id INTO m_mondeo   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_ford AND name='Mondeo';
  SELECT id INTO m_ranger   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_ford AND name='Ranger';
  SELECT id INTO m_transit  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_ford AND name='Transit';
  SELECT id INTO m_kuga     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_ford AND name='Kuga';
  SELECT id INTO m_corsa    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_opel AND name='Corsa';
  SELECT id INTO m_astra    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_opel AND name='Astra';
  SELECT id INTO m_vectra   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_opel AND name='Vectra';
  SELECT id INTO m_zafira   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_opel AND name='Zafira';
  SELECT id INTO m_vivaro   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_opel AND name='Vivaro';
  SELECT id INTO m_lancer      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mitsubishi AND name='Lancer';
  SELECT id INTO m_pajero      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mitsubishi AND name='Pajero';
  SELECT id INTO m_pajero_sport FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mitsubishi AND name='Pajero Sport';
  SELECT id INTO m_l200        FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mitsubishi AND name='L200';
  SELECT id INTO m_l300        FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mitsubishi AND name='L300';
  SELECT id INTO m_outlander   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mitsubishi AND name='Outlander';
  SELECT id INTO m_civic    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_honda AND name='Civic';
  SELECT id INTO m_accord   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_honda AND name='Accord';
  SELECT id INTO m_crv      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_honda AND name='CR-V';
  SELECT id INTO m_jazz     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_honda AND name='Jazz';
  SELECT id INTO m_swift       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_suzuki AND name='Swift';
  SELECT id INTO m_vitara      FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_suzuki AND name='Vitara';
  SELECT id INTO m_grand_vitara FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_suzuki AND name='Grand Vitara';
  SELECT id INTO m_jimny       FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_suzuki AND name='Jimny';
  SELECT id INTO m_dmax  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_isuzu AND name='D-Max';
  SELECT id INTO m_nkr   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_isuzu AND name='NKR';
  SELECT id INTO m_defender   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_landrover AND name='Defender';
  SELECT id INTO m_discovery  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_landrover AND name='Discovery';
  SELECT id INTO m_range_rover FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_landrover AND name='Range Rover';
  SELECT id INTO m_freelander FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_landrover AND name='Freelander';
  SELECT id INTO m_logan_d   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_dacia AND name='Logan';
  SELECT id INTO m_sandero_d FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_dacia AND name='Sandero';
  SELECT id INTO m_duster_d  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_dacia AND name='Duster';
  SELECT id INTO m_punto  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_fiat AND name='Punto';
  SELECT id INTO m_doblo  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_fiat AND name='Doblo';
  SELECT id INTO m_ducato FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_fiat AND name='Ducato';
  SELECT id INTO m_mazda3 FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mazda AND name='Mazda3';
  SELECT id INTO m_mazda6 FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mazda AND name='Mazda6';
  SELECT id INTO m_cx5    FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mazda AND name='CX-5';
  SELECT id INTO m_bt50   FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_mazda AND name='BT-50';
  SELECT id INTO m_a3 FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_audi AND name='A3';
  SELECT id INTO m_a4 FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_audi AND name='A4';
  SELECT id INTO m_a6 FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_audi AND name='A6';
  SELECT id INTO m_aveo     FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_chevrolet AND name='Aveo';
  SELECT id INTO m_captiva  FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_chevrolet AND name='Captiva';
  SELECT id INTO m_colorado FROM vehicle_models WHERE tenant_id=v_tenant_id AND brand_id=b_chevrolet AND name='Colorado';

  SELECT id INTO a_fh001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FH-001';
  SELECT id INTO a_fh002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FH-002';
  SELECT id INTO a_fh003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FH-003';
  SELECT id INTO a_fh004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FH-004';
  SELECT id INTO a_fh005 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FH-005';
  SELECT id INTO a_fh006 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FH-006';
  SELECT id INTO a_fa001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FA-001';
  SELECT id INTO a_fa002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FA-002';
  SELECT id INTO a_fa003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FA-003';
  SELECT id INTO a_fa004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FA-004';
  SELECT id INTO a_fa005 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FA-005';
  SELECT id INTO a_fc001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FC-001';
  SELECT id INTO a_fc002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FC-002';
  SELECT id INTO a_fc003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FC-003';
  SELECT id INTO a_fch001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FCH-001';
  SELECT id INTO a_fch002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='FCH-002';
  SELECT id INTO a_pf001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PF-001';
  SELECT id INTO a_pf002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PF-002';
  SELECT id INTO a_pf003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PF-003';
  SELECT id INTO a_pf004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PF-004';
  SELECT id INTO a_pf005 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PF-005';
  SELECT id INTO a_pf006 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PF-006';
  SELECT id INTO a_df001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='DF-001';
  SELECT id INTO a_df002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='DF-002';
  SELECT id INTO a_df003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='DF-003';
  SELECT id INTO a_df004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='DF-004';
  SELECT id INTO a_cd001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='CD-001';
  SELECT id INTO a_cd002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='CD-002';
  SELECT id INTO a_cd003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='CD-003';
  SELECT id INTO a_cd004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='CD-004';
  SELECT id INTO a_pe001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PE-001';
  SELECT id INTO a_pe002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PE-002';
  SELECT id INTO a_pe003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PE-003';
  SELECT id INTO a_pe004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='PE-004';
  SELECT id INTO a_am001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='AM-001';
  SELECT id INTO a_am002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='AM-002';
  SELECT id INTO a_am003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='AM-003';
  SELECT id INTO a_am004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='AM-004';
  SELECT id INTO a_am005 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='AM-005';
  SELECT id INTO a_rot001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='ROT-001';
  SELECT id INTO a_rot002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='ROT-002';
  SELECT id INTO a_rot003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='ROT-003';
  SELECT id INTO a_rot004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='ROT-004';
  SELECT id INTO a_su001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='SU-001';
  SELECT id INTO a_su002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='SU-002';
  SELECT id INTO a_su003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='SU-003';
  SELECT id INTO a_su004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='SU-004';
  SELECT id INTO a_su005 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='SU-005';
  SELECT id INTO a_su006 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='SU-006';
  SELECT id INTO a_su007 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='SU-007';
  SELECT id INTO a_alt001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='ALT-001';
  SELECT id INTO a_alt002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='ALT-002';
  SELECT id INTO a_alt003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='ALT-003';
  SELECT id INTO a_dem001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='DEM-001';
  SELECT id INTO a_dem002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='DEM-002';
  SELECT id INTO a_dem003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='DEM-003';
  SELECT id INTO a_bat001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='BAT-001';
  SELECT id INTO a_bat002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='BAT-002';
  SELECT id INTO a_bat003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='BAT-003';
  SELECT id INTO a_bat004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='BAT-004';
  SELECT id INTO a_bg001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='BG-001';
  SELECT id INTO a_bg002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='BG-002';
  SELECT id INTO a_bg003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='BG-003';
  SELECT id INTO a_bg004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='BG-004';
  SELECT id INTO a_el001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='EL-001';
  SELECT id INTO a_el002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='EL-002';
  SELECT id INTO a_el003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='EL-003';
  SELECT id INTO a_el004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='EL-004';
  SELECT id INTO a_el005 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='EL-005';
  SELECT id INTO a_et001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='ET-001';
  SELECT id INTO a_et002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='ET-002';
  SELECT id INTO a_kt001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='KT-001';
  SELECT id INTO a_kt002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='KT-002';
  SELECT id INTO a_ve001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='VE-001';
  SELECT id INTO a_ve002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='VE-002';
  SELECT id INTO a_ra001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='RA-001';
  SELECT id INTO a_ra002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='RA-002';
  SELECT id INTO a_hu001 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='HU-001';
  SELECT id INTO a_hu002 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='HU-002';
  SELECT id INTO a_hu003 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='HU-003';
  SELECT id INTO a_hu004 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='HU-004';
  SELECT id INTO a_hu005 FROM articles WHERE tenant_id=v_tenant_id AND internal_ref='HU-005';

  -- FH-001 Toyota Corolla E12 (1ZZ/3ZZ)
  IF a_fh001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fh001,b_toyota,m_corolla,2002,2007,'1ZZ/3ZZ'),(v_tenant_id,a_fh001,b_toyota,m_auris,2006,2012,'1ZZ'),
    (v_tenant_id,a_fh001,b_toyota,m_yaris,2005,2012,'1SZ'),(v_tenant_id,a_fh001,b_toyota,m_camry,2002,2006,'2AZ'),
    (v_tenant_id,a_fh001,b_toyota,m_prius,2003,2009,'1NZ') ON CONFLICT DO NOTHING; END IF;

  -- FH-002 Renault Clio III K9K — partagé Renault/Nissan/Dacia
  IF a_fh002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fh002,b_renault,m_clio,2001,2014,'K9K'),(v_tenant_id,a_fh002,b_renault,m_megane,2003,2015,'K9K'),
    (v_tenant_id,a_fh002,b_renault,m_scenic,2003,2009,'K9K'),(v_tenant_id,a_fh002,b_renault,m_kangoo,2001,2013,'K9K'),
    (v_tenant_id,a_fh002,b_renault,m_logan_r,2004,2013,'K9K'),(v_tenant_id,a_fh002,b_renault,m_sandero_r,2007,2013,'K9K'),
    (v_tenant_id,a_fh002,b_renault,m_fluence,2009,2015,'K9K'),(v_tenant_id,a_fh002,b_renault,m_duster_r,2010,2018,'K9K'),
    (v_tenant_id,a_fh002,b_renault,m_symbol,2002,2012,'K9K'),(v_tenant_id,a_fh002,b_nissan,m_micra,2003,2010,'K9K'),
    (v_tenant_id,a_fh002,b_nissan,m_note,2006,2013,'K9K'),(v_tenant_id,a_fh002,b_dacia,m_logan_d,2004,2013,'K9K'),
    (v_tenant_id,a_fh002,b_dacia,m_sandero_d,2008,2013,'K9K'),(v_tenant_id,a_fh002,b_dacia,m_duster_d,2010,2018,'K9K') ON CONFLICT DO NOTHING; END IF;

  -- FH-003 Peugeot 206/207 PSA (TU/DW8/HDi) — partagé PSA + Fiat
  IF a_fh003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fh003,b_peugeot,m_206,1998,2010,'TU/DW8'),(v_tenant_id,a_fh003,b_peugeot,m_207,2006,2014,'TU5/HDi'),
    (v_tenant_id,a_fh003,b_peugeot,m_208,2012,2019,'EB/DV'),(v_tenant_id,a_fh003,b_peugeot,m_306,1993,2002,'TU/XUD'),
    (v_tenant_id,a_fh003,b_peugeot,m_307,2001,2008,'TU/HDi'),(v_tenant_id,a_fh003,b_peugeot,m_partner,2002,2012,'TU/HDi'),
    (v_tenant_id,a_fh003,b_citroen,m_c3,2002,2010,'TU/HDi'),(v_tenant_id,a_fh003,b_citroen,m_xsara,1997,2005,'TU/XUD/HDi'),
    (v_tenant_id,a_fh003,b_citroen,m_berlingo,2002,2012,'TU/HDi'),(v_tenant_id,a_fh003,b_fiat,m_punto,2005,2012,'Multijet') ON CONFLICT DO NOTHING; END IF;

  -- FH-004 Nissan Almera (SR/QG/YD)
  IF a_fh004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fh004,b_nissan,m_almera,1995,2006,'SR/QG'),(v_tenant_id,a_fh004,b_nissan,m_micra,1992,2010,'CG/CR'),
    (v_tenant_id,a_fh004,b_nissan,m_primera,1990,2007,'SR/QG'),(v_tenant_id,a_fh004,b_nissan,m_note,2004,2012,'CR'),
    (v_tenant_id,a_fh004,b_nissan,m_xtrail,2001,2007,'QR/YD22'),(v_tenant_id,a_fh004,b_nissan,m_qashqai,2006,2013,'HR/MR') ON CONFLICT DO NOTHING; END IF;

  -- FH-005 Mercedes Classe C (M271/OM611/OM651)
  IF a_fh005 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fh005,b_mercedes,m_classe_c,2000,2014,'M271/OM611'),(v_tenant_id,a_fh005,b_mercedes,m_classe_e,2002,2009,'M271/OM648'),
    (v_tenant_id,a_fh005,b_mercedes,m_classe_a,2004,2012,'M266'),(v_tenant_id,a_fh005,b_mercedes,m_vito,2003,2010,'OM646'),
    (v_tenant_id,a_fh005,b_mercedes,m_sprinter,2000,2006,'OM611'),(v_tenant_id,a_fh005,b_mercedes,m_glc,2015,2020,'OM651') ON CONFLICT DO NOTHING; END IF;

  -- FH-006 Toyota Land Cruiser (1HZ/1HD/1VD)
  IF a_fh006 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fh006,b_toyota,m_lc,1990,2007,'1HZ/1HD-T'),(v_tenant_id,a_fh006,b_toyota,m_lc70,1984,2007,'1HZ'),
    (v_tenant_id,a_fh006,b_toyota,m_lc200,2007,NULL,'1VD-FTV'),(v_tenant_id,a_fh006,b_toyota,m_prado,1990,2009,'1KZ/1GR'),
    (v_tenant_id,a_fh006,b_toyota,m_hiace,1995,2006,'1KZ/2KD'),(v_tenant_id,a_fh006,b_toyota,m_hilux,2000,2010,'1KZ/2KD') ON CONFLICT DO NOTHING; END IF;

  -- FA-001 Filtre air Toyota Corolla
  IF a_fa001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fa001,b_toyota,m_corolla,2002,2007,'1ZZ/3ZZ'),(v_tenant_id,a_fa001,b_toyota,m_auris,2006,2012,'1ZZ'),
    (v_tenant_id,a_fa001,b_toyota,m_yaris,2005,2011,'1SZ'),(v_tenant_id,a_fa001,b_toyota,m_vitz,2005,2011,'1SZ'),
    (v_tenant_id,a_fa001,b_toyota,m_probox,2002,2014,'1NZ') ON CONFLICT DO NOTHING; END IF;

  -- FA-002 Filtre air Renault Clio K9K
  IF a_fa002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fa002,b_renault,m_clio,2001,2014,'K9K'),(v_tenant_id,a_fa002,b_renault,m_megane,2002,2009,'K9K'),
    (v_tenant_id,a_fa002,b_renault,m_scenic,2003,2009,'K9K'),(v_tenant_id,a_fa002,b_renault,m_kangoo,2001,2013,'K9K'),
    (v_tenant_id,a_fa002,b_renault,m_logan_r,2004,2013,'K9K'),(v_tenant_id,a_fa002,b_dacia,m_logan_d,2004,2013,'K9K'),
    (v_tenant_id,a_fa002,b_dacia,m_sandero_d,2008,2013,'K9K'),(v_tenant_id,a_fa002,b_nissan,m_micra,2003,2010,'K9K'),
    (v_tenant_id,a_fa002,b_nissan,m_note,2006,2012,'K9K') ON CONFLICT DO NOTHING; END IF;

  -- FA-003 Filtre air Peugeot 206 HDi
  IF a_fa003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fa003,b_peugeot,m_206,1998,2010,'DW8/DW10'),(v_tenant_id,a_fa003,b_peugeot,m_207,2006,2013,'DW10'),
    (v_tenant_id,a_fa003,b_peugeot,m_307,2001,2008,'DW10'),(v_tenant_id,a_fa003,b_peugeot,m_partner,2002,2010,'DW8/DW10'),
    (v_tenant_id,a_fa003,b_citroen,m_c3,2002,2010,'DW10'),(v_tenant_id,a_fa003,b_citroen,m_berlingo,2002,2012,'DW8/DW10'),
    (v_tenant_id,a_fa003,b_citroen,m_xsara,2000,2005,'DW10'),(v_tenant_id,a_fa003,b_fiat,m_doblo,2001,2010,'JTD 1.9') ON CONFLICT DO NOTHING; END IF;

  -- FA-004 Filtre air Hilux 2KD
  IF a_fa004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fa004,b_toyota,m_hilux,2005,2015,'2KD'),(v_tenant_id,a_fa004,b_toyota,m_fortuner,2005,2015,'2KD'),
    (v_tenant_id,a_fa004,b_toyota,m_hiace,2005,2013,'2KD'),(v_tenant_id,a_fa004,b_toyota,m_prado,2003,2009,'1KD/2KD'),
    (v_tenant_id,a_fa004,b_toyota,m_avanza,2003,2011,'2KD') ON CONFLICT DO NOTHING; END IF;

  -- FA-005 Filtre air Nissan Pathfinder
  IF a_fa005 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fa005,b_nissan,m_pathfinder,2005,2012,'VQ35/YD25'),(v_tenant_id,a_fa005,b_nissan,m_xtrail,2007,2013,'YD25'),
    (v_tenant_id,a_fa005,b_nissan,m_navara,2005,2014,'YD25'),(v_tenant_id,a_fa005,b_nissan,m_patrol,2004,2012,'ZD30'),
    (v_tenant_id,a_fa005,b_mitsubishi,m_pajero,2000,2012,'4M41'),(v_tenant_id,a_fa005,b_mitsubishi,m_l200,2006,2015,'4D56') ON CONFLICT DO NOTHING; END IF;

  -- FC-001 Filtre carburant Toyota Corolla
  IF a_fc001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fc001,b_toyota,m_corolla,1995,2007,'1ZZ/3ZZ'),(v_tenant_id,a_fc001,b_toyota,m_auris,2006,2012,'1ZZ'),
    (v_tenant_id,a_fc001,b_toyota,m_camry,2002,2006,'2AZ'),(v_tenant_id,a_fc001,b_toyota,m_rav4,2001,2006,'1AZ'),
    (v_tenant_id,a_fc001,b_toyota,m_vitz,2002,2010,'1SZ') ON CONFLICT DO NOTHING; END IF;

  -- FC-002 Filtre carburant Renault K9K
  IF a_fc002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fc002,b_renault,m_clio,2001,2012,'K9K'),(v_tenant_id,a_fc002,b_renault,m_megane,2002,2009,'K9K/F9Q'),
    (v_tenant_id,a_fc002,b_renault,m_scenic,2003,2009,'K9K'),(v_tenant_id,a_fc002,b_renault,m_kangoo,2001,2013,'K9K'),
    (v_tenant_id,a_fc002,b_renault,m_logan_r,2004,2013,'K9K'),(v_tenant_id,a_fc002,b_dacia,m_logan_d,2004,2013,'K9K'),
    (v_tenant_id,a_fc002,b_dacia,m_duster_d,2010,2015,'K9K'),(v_tenant_id,a_fc002,b_nissan,m_micra,2003,2010,'K9K'),
    (v_tenant_id,a_fc002,b_nissan,m_note,2006,2012,'K9K') ON CONFLICT DO NOTHING; END IF;

  -- FC-003 Filtre carburant Peugeot 206 1.9D
  IF a_fc003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fc003,b_peugeot,m_206,1998,2010,'XUD/DW8'),(v_tenant_id,a_fc003,b_peugeot,m_307,2001,2007,'DW10'),
    (v_tenant_id,a_fc003,b_peugeot,m_306,1993,2002,'XUD'),(v_tenant_id,a_fc003,b_peugeot,m_partner,1996,2010,'DW8'),
    (v_tenant_id,a_fc003,b_citroen,m_c3,2002,2009,'DW8'),(v_tenant_id,a_fc003,b_citroen,m_berlingo,1996,2010,'DW8'),
    (v_tenant_id,a_fc003,b_citroen,m_xsara,1997,2004,'XUD/DW10'),(v_tenant_id,a_fc003,b_fiat,m_doblo,2001,2010,'JTD 1.9') ON CONFLICT DO NOTHING; END IF;

  -- FCH-001 Filtre habitacle Toyota Corolla
  IF a_fch001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fch001,b_toyota,m_corolla,2002,2007,NULL),(v_tenant_id,a_fch001,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_fch001,b_toyota,m_camry,2006,2011,NULL),(v_tenant_id,a_fch001,b_toyota,m_rav4,2006,2012,NULL),
    (v_tenant_id,a_fch001,b_toyota,m_yaris,2005,2011,NULL) ON CONFLICT DO NOTHING; END IF;

  -- FCH-002 Filtre habitacle Renault Megane III
  IF a_fch002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_fch002,b_renault,m_megane,2008,2016,NULL),(v_tenant_id,a_fch002,b_renault,m_scenic,2009,2016,NULL),
    (v_tenant_id,a_fch002,b_renault,m_fluence,2009,2015,NULL),(v_tenant_id,a_fch002,b_renault,m_laguna,2007,2015,NULL),
    (v_tenant_id,a_fch002,b_dacia,m_duster_d,2010,2018,NULL),(v_tenant_id,a_fch002,b_dacia,m_logan_d,2004,2012,NULL),
    (v_tenant_id,a_fch002,b_nissan,m_qashqai,2006,2013,NULL) ON CONFLICT DO NOTHING; END IF;

  -- PF-001 Plaquettes avant Toyota Corolla
  IF a_pf001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pf001,b_toyota,m_corolla,2002,2007,'Av'),(v_tenant_id,a_pf001,b_toyota,m_auris,2006,2012,'Av'),
    (v_tenant_id,a_pf001,b_toyota,m_yaris,2005,2011,'Av'),(v_tenant_id,a_pf001,b_toyota,m_prius,2003,2009,'Av'),
    (v_tenant_id,a_pf001,b_toyota,m_rav4,2001,2006,'Av') ON CONFLICT DO NOTHING; END IF;

  -- PF-002 Plaquettes arrière Toyota Corolla
  IF a_pf002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pf002,b_toyota,m_corolla,2002,2007,'Ar'),(v_tenant_id,a_pf002,b_toyota,m_auris,2006,2012,'Ar'),
    (v_tenant_id,a_pf002,b_toyota,m_camry,2002,2006,'Ar'),(v_tenant_id,a_pf002,b_toyota,m_rav4,2001,2006,'Ar') ON CONFLICT DO NOTHING; END IF;

  -- PF-003 Plaquettes avant Renault Clio III
  IF a_pf003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pf003,b_renault,m_clio,2005,2014,'Av'),(v_tenant_id,a_pf003,b_renault,m_megane,2002,2009,'Av'),
    (v_tenant_id,a_pf003,b_renault,m_scenic,2003,2009,'Av'),(v_tenant_id,a_pf003,b_renault,m_kangoo,2001,2013,'Av'),
    (v_tenant_id,a_pf003,b_renault,m_logan_r,2004,2012,'Av'),(v_tenant_id,a_pf003,b_dacia,m_logan_d,2004,2012,'Av'),
    (v_tenant_id,a_pf003,b_dacia,m_sandero_d,2008,2013,'Av'),(v_tenant_id,a_pf003,b_nissan,m_micra,2003,2010,'Av'),
    (v_tenant_id,a_pf003,b_nissan,m_note,2006,2012,'Av') ON CONFLICT DO NOTHING; END IF;

  -- PF-004 Plaquettes avant Peugeot 206/207 (PSA)
  IF a_pf004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pf004,b_peugeot,m_206,1998,2010,'Av'),(v_tenant_id,a_pf004,b_peugeot,m_207,2006,2014,'Av'),
    (v_tenant_id,a_pf004,b_peugeot,m_208,2012,2019,'Av'),(v_tenant_id,a_pf004,b_peugeot,m_306,1993,2002,'Av'),
    (v_tenant_id,a_pf004,b_peugeot,m_partner,1996,2010,'Av'),(v_tenant_id,a_pf004,b_citroen,m_c3,2002,2010,'Av'),
    (v_tenant_id,a_pf004,b_citroen,m_xsara,1997,2004,'Av'),(v_tenant_id,a_pf004,b_citroen,m_berlingo,1996,2010,'Av') ON CONFLICT DO NOTHING; END IF;

  -- PF-005 Plaquettes avant Nissan Almera
  IF a_pf005 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pf005,b_nissan,m_almera,1995,2006,'Av'),(v_tenant_id,a_pf005,b_nissan,m_micra,1992,2010,'Av'),
    (v_tenant_id,a_pf005,b_nissan,m_primera,1990,2007,'Av'),(v_tenant_id,a_pf005,b_nissan,m_note,2006,2012,'Av'),
    (v_tenant_id,a_pf005,b_nissan,m_xtrail,2001,2007,'Av') ON CONFLICT DO NOTHING; END IF;

  -- PF-006 Plaquettes avant Toyota Land Cruiser 100
  IF a_pf006 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pf006,b_toyota,m_lc,1998,2007,'Av LC100'),(v_tenant_id,a_pf006,b_toyota,m_lc200,2007,NULL,'Av'),
    (v_tenant_id,a_pf006,b_toyota,m_prado,2003,2009,'Av'),(v_tenant_id,a_pf006,b_toyota,m_fortuner,2005,2015,'Av') ON CONFLICT DO NOTHING; END IF;

  -- DF-001 Disques avant Toyota Corolla
  IF a_df001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_df001,b_toyota,m_corolla,2002,2007,'Ø255mm'),(v_tenant_id,a_df001,b_toyota,m_auris,2006,2012,'Ø255mm'),
    (v_tenant_id,a_df001,b_toyota,m_yaris,2005,2011,'Ø255mm'),(v_tenant_id,a_df001,b_toyota,m_rav4,2001,2006,'Ø255mm') ON CONFLICT DO NOTHING; END IF;

  -- DF-002 Disques avant Renault Clio III
  IF a_df002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_df002,b_renault,m_clio,2005,2014,'Ø280mm'),(v_tenant_id,a_df002,b_renault,m_megane,2002,2009,'Ø300mm'),
    (v_tenant_id,a_df002,b_renault,m_scenic,2003,2009,'Ø280mm'),(v_tenant_id,a_df002,b_renault,m_kangoo,2001,2013,'Ø259mm'),
    (v_tenant_id,a_df002,b_renault,m_logan_r,2004,2012,'Ø238mm'),(v_tenant_id,a_df002,b_dacia,m_logan_d,2004,2012,'Ø238mm'),
    (v_tenant_id,a_df002,b_dacia,m_sandero_d,2008,2013,'Ø238mm'),(v_tenant_id,a_df002,b_nissan,m_micra,2003,2010,'Ø238mm') ON CONFLICT DO NOTHING; END IF;

  -- DF-003 Disques avant Peugeot 206
  IF a_df003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_df003,b_peugeot,m_206,1998,2010,'Ø247-266mm'),(v_tenant_id,a_df003,b_peugeot,m_207,2006,2013,'Ø266mm'),
    (v_tenant_id,a_df003,b_peugeot,m_306,1993,2002,'Ø247mm'),(v_tenant_id,a_df003,b_peugeot,m_partner,1996,2010,'Ø247mm'),
    (v_tenant_id,a_df003,b_citroen,m_c3,2002,2009,'Ø247mm'),(v_tenant_id,a_df003,b_citroen,m_xsara,1997,2004,'Ø247mm'),
    (v_tenant_id,a_df003,b_citroen,m_berlingo,1996,2010,'Ø247mm') ON CONFLICT DO NOTHING; END IF;

  -- DF-004 Disques avant Toyota Hilux
  IF a_df004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_df004,b_toyota,m_hilux,2005,2015,'Ø296mm'),(v_tenant_id,a_df004,b_toyota,m_fortuner,2005,2015,'Ø296mm'),
    (v_tenant_id,a_df004,b_toyota,m_hiace,2005,2013,'Ø290mm'),(v_tenant_id,a_df004,b_toyota,m_prado,2003,2009,'Ø296mm'),
    (v_tenant_id,a_df004,b_mitsubishi,m_l200,2006,2015,'similaire'),(v_tenant_id,a_df004,b_isuzu,m_dmax,2007,2012,'similaire') ON CONFLICT DO NOTHING; END IF;

  -- CD-001 Kit courroie Toyota Corolla 1.4
  IF a_cd001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_cd001,b_toyota,m_corolla,2002,2007,'3ZZ/4ZZ'),(v_tenant_id,a_cd001,b_toyota,m_auris,2006,2012,'3ZZ'),
    (v_tenant_id,a_cd001,b_toyota,m_yaris,2005,2011,'1SZ'),(v_tenant_id,a_cd001,b_toyota,m_vitz,2002,2010,'1SZ') ON CONFLICT DO NOTHING; END IF;

  -- CD-002 Kit courroie Renault K9K
  IF a_cd002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_cd002,b_renault,m_clio,2001,2014,'K9K'),(v_tenant_id,a_cd002,b_renault,m_megane,2002,2009,'K9K'),
    (v_tenant_id,a_cd002,b_renault,m_scenic,2003,2009,'K9K'),(v_tenant_id,a_cd002,b_renault,m_kangoo,2001,2013,'K9K'),
    (v_tenant_id,a_cd002,b_renault,m_logan_r,2004,2013,'K9K'),(v_tenant_id,a_cd002,b_dacia,m_logan_d,2004,2013,'K9K'),
    (v_tenant_id,a_cd002,b_dacia,m_sandero_d,2008,2013,'K9K'),(v_tenant_id,a_cd002,b_dacia,m_duster_d,2010,2018,'K9K'),
    (v_tenant_id,a_cd002,b_nissan,m_micra,2003,2010,'K9K'),(v_tenant_id,a_cd002,b_nissan,m_note,2006,2012,'K9K') ON CONFLICT DO NOTHING; END IF;

  -- CD-003 Kit courroie Peugeot 206 HDi
  IF a_cd003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_cd003,b_peugeot,m_206,1998,2010,'DW8/DW10'),(v_tenant_id,a_cd003,b_peugeot,m_307,2001,2008,'DW10'),
    (v_tenant_id,a_cd003,b_peugeot,m_207,2006,2012,'DW10'),(v_tenant_id,a_cd003,b_peugeot,m_308,2007,2013,'DW10'),
    (v_tenant_id,a_cd003,b_peugeot,m_partner,2002,2012,'DW8/DW10'),(v_tenant_id,a_cd003,b_citroen,m_c3,2002,2010,'DW8/DW10'),
    (v_tenant_id,a_cd003,b_citroen,m_c4,2004,2011,'DW10'),(v_tenant_id,a_cd003,b_citroen,m_berlingo,2002,2012,'DW8/DW10'),
    (v_tenant_id,a_cd003,b_citroen,m_xsara,1997,2004,'DW8/DW10'),(v_tenant_id,a_cd003,b_fiat,m_doblo,2001,2010,'JTD 2.0') ON CONFLICT DO NOTHING; END IF;

  -- CD-004 Courroie Hilux 2KD
  IF a_cd004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_cd004,b_toyota,m_hilux,2005,2015,'2KD-FTV'),(v_tenant_id,a_cd004,b_toyota,m_fortuner,2005,2015,'2KD'),
    (v_tenant_id,a_cd004,b_toyota,m_hiace,2005,2013,'2KD'),(v_tenant_id,a_cd004,b_toyota,m_prado,2003,2009,'1KD') ON CONFLICT DO NOTHING; END IF;

  -- KT-001 Kit embrayage Renault Clio 1.5 dCi
  IF a_kt001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_kt001,b_renault,m_clio,2001,2014,'K9K'),(v_tenant_id,a_kt001,b_renault,m_megane,2002,2009,'K9K/F9Q'),
    (v_tenant_id,a_kt001,b_renault,m_scenic,2003,2009,'K9K'),(v_tenant_id,a_kt001,b_renault,m_kangoo,2001,2013,'K9K'),
    (v_tenant_id,a_kt001,b_renault,m_logan_r,2004,2012,'K9K'),(v_tenant_id,a_kt001,b_dacia,m_logan_d,2004,2012,'K9K'),
    (v_tenant_id,a_kt001,b_dacia,m_sandero_d,2008,2013,'K9K'),(v_tenant_id,a_kt001,b_nissan,m_micra,2003,2010,'K9K') ON CONFLICT DO NOTHING; END IF;

  -- KT-002 Kit embrayage Peugeot 206 1.4/1.6
  IF a_kt002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_kt002,b_peugeot,m_206,1998,2010,'TU3/TU5'),(v_tenant_id,a_kt002,b_peugeot,m_207,2006,2013,'TU5'),
    (v_tenant_id,a_kt002,b_peugeot,m_208,2012,2019,'EB'),(v_tenant_id,a_kt002,b_peugeot,m_306,1993,2002,'TU3/TU5'),
    (v_tenant_id,a_kt002,b_peugeot,m_partner,1996,2010,'TU5'),(v_tenant_id,a_kt002,b_citroen,m_c3,2002,2009,'TU5'),
    (v_tenant_id,a_kt002,b_citroen,m_xsara,1997,2004,'TU5/XU') ON CONFLICT DO NOTHING; END IF;

  -- PE-001 Pompe à eau Toyota Corolla
  IF a_pe001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pe001,b_toyota,m_corolla,2002,2007,'1ZZ/3ZZ'),(v_tenant_id,a_pe001,b_toyota,m_auris,2006,2012,'1ZZ'),
    (v_tenant_id,a_pe001,b_toyota,m_yaris,2005,2011,'1SZ'),(v_tenant_id,a_pe001,b_toyota,m_camry,2002,2006,'2AZ'),
    (v_tenant_id,a_pe001,b_toyota,m_rav4,2001,2006,'1AZ') ON CONFLICT DO NOTHING; END IF;

  -- PE-002 Pompe à eau Renault K9K
  IF a_pe002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pe002,b_renault,m_clio,2001,2014,'K9K'),(v_tenant_id,a_pe002,b_renault,m_megane,2002,2009,'K9K/F9Q'),
    (v_tenant_id,a_pe002,b_renault,m_scenic,2003,2009,'K9K'),(v_tenant_id,a_pe002,b_renault,m_kangoo,2001,2013,'K9K'),
    (v_tenant_id,a_pe002,b_renault,m_logan_r,2004,2013,'K9K'),(v_tenant_id,a_pe002,b_dacia,m_logan_d,2004,2013,'K9K'),
    (v_tenant_id,a_pe002,b_dacia,m_sandero_d,2008,2013,'K9K'),(v_tenant_id,a_pe002,b_nissan,m_micra,2003,2010,'K9K') ON CONFLICT DO NOTHING; END IF;

  -- PE-003 Pompe à eau Peugeot 206
  IF a_pe003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pe003,b_peugeot,m_206,1998,2010,'XUD/DW8/DW10'),(v_tenant_id,a_pe003,b_peugeot,m_307,2001,2007,'DW10'),
    (v_tenant_id,a_pe003,b_peugeot,m_306,1993,2002,'XUD'),(v_tenant_id,a_pe003,b_peugeot,m_partner,1996,2010,'DW8'),
    (v_tenant_id,a_pe003,b_citroen,m_c3,2002,2009,'DW8'),(v_tenant_id,a_pe003,b_citroen,m_xsara,1997,2004,'XUD/DW10'),
    (v_tenant_id,a_pe003,b_citroen,m_berlingo,1996,2010,'DW8'),(v_tenant_id,a_pe003,b_fiat,m_doblo,2001,2010,'JTD 1.9') ON CONFLICT DO NOTHING; END IF;

  -- PE-004 Pompe à eau Land Cruiser 1HZ
  IF a_pe004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_pe004,b_toyota,m_lc,1990,2007,'1HZ/1HD-T'),(v_tenant_id,a_pe004,b_toyota,m_lc70,1984,2007,'1HZ'),
    (v_tenant_id,a_pe004,b_toyota,m_hiace,1989,2004,'1HZ'),(v_tenant_id,a_pe004,b_toyota,m_prado,1990,2002,'1HZ') ON CONFLICT DO NOTHING; END IF;

  -- AM-001..005 Amortisseurs
  IF a_am001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_am001,b_toyota,m_corolla,2002,2007,'Av'),(v_tenant_id,a_am001,b_toyota,m_auris,2006,2012,'Av'),
    (v_tenant_id,a_am001,b_toyota,m_yaris,2005,2011,'Av') ON CONFLICT DO NOTHING; END IF;

  IF a_am002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_am002,b_toyota,m_corolla,2002,2007,'Ar'),(v_tenant_id,a_am002,b_toyota,m_auris,2006,2012,'Ar'),
    (v_tenant_id,a_am002,b_toyota,m_prius,2003,2009,'Ar') ON CONFLICT DO NOTHING; END IF;

  IF a_am003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_am003,b_renault,m_clio,2005,2014,'Av'),(v_tenant_id,a_am003,b_renault,m_megane,2002,2009,'Av'),
    (v_tenant_id,a_am003,b_renault,m_logan_r,2004,2012,'Av'),(v_tenant_id,a_am003,b_dacia,m_logan_d,2004,2012,'Av'),
    (v_tenant_id,a_am003,b_dacia,m_sandero_d,2008,2013,'Av') ON CONFLICT DO NOTHING; END IF;

  IF a_am004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_am004,b_toyota,m_lc,1990,1998,'LC80 Av'),(v_tenant_id,a_am004,b_toyota,m_lc70,1984,2007,'Av'),
    (v_tenant_id,a_am004,b_toyota,m_prado,1990,2002,'Av') ON CONFLICT DO NOTHING; END IF;

  IF a_am005 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_am005,b_toyota,m_hilux,2005,2015,'Av'),(v_tenant_id,a_am005,b_toyota,m_fortuner,2005,2015,'Av'),
    (v_tenant_id,a_am005,b_toyota,m_hiace,2005,2013,'Av'),(v_tenant_id,a_am005,b_mitsubishi,m_l200,2006,2015,'similaire'),
    (v_tenant_id,a_am005,b_isuzu,m_dmax,2007,2012,'similaire'),(v_tenant_id,a_am005,b_nissan,m_navara,2006,2015,'similaire') ON CONFLICT DO NOTHING; END IF;

  -- ROT-001..004 Rotules
  IF a_rot001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_rot001,b_toyota,m_corolla,2002,2007,NULL),(v_tenant_id,a_rot001,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_rot001,b_toyota,m_yaris,2005,2011,NULL),(v_tenant_id,a_rot001,b_toyota,m_rav4,2001,2006,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_rot002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_rot002,b_toyota,m_lc,1990,1998,'LC80 rot sup'),(v_tenant_id,a_rot002,b_toyota,m_lc70,1984,2007,'rot sup'),
    (v_tenant_id,a_rot002,b_toyota,m_prado,1990,2002,'rot sup') ON CONFLICT DO NOTHING; END IF;

  IF a_rot003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_rot003,b_renault,m_clio,2005,2014,NULL),(v_tenant_id,a_rot003,b_renault,m_megane,2002,2009,NULL),
    (v_tenant_id,a_rot003,b_renault,m_logan_r,2004,2012,NULL),(v_tenant_id,a_rot003,b_dacia,m_logan_d,2004,2012,NULL),
    (v_tenant_id,a_rot003,b_nissan,m_micra,2003,2010,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_rot004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_rot004,b_toyota,m_hilux,2005,2015,'rot bas'),(v_tenant_id,a_rot004,b_toyota,m_fortuner,2005,2015,'rot bas'),
    (v_tenant_id,a_rot004,b_toyota,m_hiace,2005,2013,'rot bas'),(v_tenant_id,a_rot004,b_mitsubishi,m_l200,2006,2015,'similaire'),
    (v_tenant_id,a_rot004,b_isuzu,m_dmax,2007,2012,'similaire') ON CONFLICT DO NOTHING; END IF;

  -- SU-001..007 Suspension
  IF a_su001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_su001,b_toyota,m_corolla,2002,2007,NULL),(v_tenant_id,a_su001,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_su001,b_toyota,m_yaris,2005,2011,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_su002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_su002,b_renault,m_clio,2005,2014,NULL),(v_tenant_id,a_su002,b_renault,m_megane,2002,2009,NULL),
    (v_tenant_id,a_su002,b_renault,m_logan_r,2004,2012,NULL),(v_tenant_id,a_su002,b_dacia,m_logan_d,2004,2012,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_su003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_su003,b_toyota,m_lc,1990,1998,'LC80'),(v_tenant_id,a_su003,b_toyota,m_lc70,1984,2007,NULL),
    (v_tenant_id,a_su003,b_toyota,m_prado,1990,2002,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_su004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_su004,b_peugeot,m_206,1998,2010,'triangle inf'),(v_tenant_id,a_su004,b_peugeot,m_207,2006,2013,NULL),
    (v_tenant_id,a_su004,b_peugeot,m_307,2001,2008,NULL),(v_tenant_id,a_su004,b_citroen,m_c3,2002,2009,NULL),
    (v_tenant_id,a_su004,b_citroen,m_xsara,1997,2004,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_su005 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_su005,b_toyota,m_hilux,2005,2015,'moyeu av'),(v_tenant_id,a_su005,b_toyota,m_fortuner,2005,2015,NULL),
    (v_tenant_id,a_su005,b_toyota,m_hiace,2005,2013,NULL),(v_tenant_id,a_su005,b_mitsubishi,m_l200,2006,2015,'similaire'),
    (v_tenant_id,a_su005,b_isuzu,m_dmax,2007,2012,'similaire') ON CONFLICT DO NOTHING; END IF;

  IF a_su006 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_su006,b_toyota,m_corolla,2002,2007,'roulement av'),(v_tenant_id,a_su006,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_su006,b_toyota,m_yaris,2005,2011,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_su007 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_su007,b_toyota,m_corolla,2002,2007,'ressort av'),(v_tenant_id,a_su007,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_su007,b_toyota,m_yaris,2005,2011,NULL) ON CONFLICT DO NOTHING; END IF;

  -- ALT-001..003 Alternateurs
  IF a_alt001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_alt001,b_toyota,m_corolla,2002,2007,'1ZZ/3ZZ'),(v_tenant_id,a_alt001,b_toyota,m_auris,2006,2012,'1ZZ'),
    (v_tenant_id,a_alt001,b_toyota,m_yaris,2005,2011,'1SZ'),(v_tenant_id,a_alt001,b_toyota,m_camry,2002,2006,'2AZ'),
    (v_tenant_id,a_alt001,b_toyota,m_rav4,2001,2006,'1AZ') ON CONFLICT DO NOTHING; END IF;

  IF a_alt002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_alt002,b_renault,m_clio,2001,2014,'K9K'),(v_tenant_id,a_alt002,b_renault,m_megane,2002,2009,'K9K'),
    (v_tenant_id,a_alt002,b_renault,m_scenic,2003,2009,'K9K'),(v_tenant_id,a_alt002,b_renault,m_kangoo,2001,2013,'K9K'),
    (v_tenant_id,a_alt002,b_renault,m_logan_r,2004,2012,'K9K'),(v_tenant_id,a_alt002,b_dacia,m_logan_d,2004,2012,'K9K'),
    (v_tenant_id,a_alt002,b_dacia,m_sandero_d,2008,2013,'K9K'),(v_tenant_id,a_alt002,b_nissan,m_micra,2003,2010,'K9K') ON CONFLICT DO NOTHING; END IF;

  IF a_alt003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_alt003,b_toyota,m_lc,1990,2007,'1HZ/1HD-T'),(v_tenant_id,a_alt003,b_toyota,m_lc70,1984,2007,'1HZ'),
    (v_tenant_id,a_alt003,b_toyota,m_hiace,1989,2004,'1HZ'),(v_tenant_id,a_alt003,b_toyota,m_prado,1990,2002,'1HZ') ON CONFLICT DO NOTHING; END IF;

  -- DEM-001..003 Démarreurs
  IF a_dem001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_dem001,b_toyota,m_corolla,2002,2007,'1ZZ/3ZZ'),(v_tenant_id,a_dem001,b_toyota,m_auris,2006,2012,'1ZZ'),
    (v_tenant_id,a_dem001,b_toyota,m_yaris,2005,2011,'1SZ'),(v_tenant_id,a_dem001,b_toyota,m_camry,2002,2006,'2AZ') ON CONFLICT DO NOTHING; END IF;

  IF a_dem002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_dem002,b_renault,m_clio,2001,2014,'K9K'),(v_tenant_id,a_dem002,b_renault,m_megane,2002,2009,'K9K/F9Q'),
    (v_tenant_id,a_dem002,b_renault,m_scenic,2003,2009,'K9K'),(v_tenant_id,a_dem002,b_renault,m_kangoo,2001,2013,'K9K'),
    (v_tenant_id,a_dem002,b_renault,m_logan_r,2004,2012,'K9K'),(v_tenant_id,a_dem002,b_dacia,m_logan_d,2004,2012,'K9K'),
    (v_tenant_id,a_dem002,b_nissan,m_micra,2003,2010,'K9K') ON CONFLICT DO NOTHING; END IF;

  IF a_dem003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_dem003,b_toyota,m_lc,1990,2007,'1HZ/1HD-T'),(v_tenant_id,a_dem003,b_toyota,m_lc70,1984,2007,'1HZ'),
    (v_tenant_id,a_dem003,b_toyota,m_hiace,1989,2004,'1HZ'),(v_tenant_id,a_dem003,b_toyota,m_prado,1990,2002,'1HZ') ON CONFLICT DO NOTHING; END IF;

  -- BAT-001 Batterie 60Ah Toyota Corolla/Yaris
  IF a_bat001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_bat001,b_toyota,m_corolla,2002,2013,'60Ah'),(v_tenant_id,a_bat001,b_toyota,m_yaris,2005,2013,'60Ah'),
    (v_tenant_id,a_bat001,b_toyota,m_auris,2006,2013,'60Ah'),(v_tenant_id,a_bat001,b_toyota,m_prius,2003,2009,'60Ah'),
    (v_tenant_id,a_bat001,b_toyota,m_avanza,2003,2011,'60Ah'),(v_tenant_id,a_bat001,b_honda,m_jazz,2001,2010,'60Ah'),
    (v_tenant_id,a_bat001,b_honda,m_civic,2001,2012,'60Ah'),(v_tenant_id,a_bat001,b_hyundai,m_i20,2008,2014,'60Ah'),
    (v_tenant_id,a_bat001,b_kia,m_rio,2000,2012,'60Ah'),(v_tenant_id,a_bat001,b_suzuki,m_swift,2005,2013,'60Ah') ON CONFLICT DO NOTHING; END IF;

  -- BAT-002 Batterie 70Ah Renault/Peugeot/Citroën — très large compat
  IF a_bat002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_bat002,b_renault,m_clio,2001,2014,'70Ah'),(v_tenant_id,a_bat002,b_renault,m_megane,2002,2014,'70Ah'),
    (v_tenant_id,a_bat002,b_renault,m_scenic,2003,2009,'70Ah'),(v_tenant_id,a_bat002,b_renault,m_logan_r,2004,2013,'70Ah'),
    (v_tenant_id,a_bat002,b_peugeot,m_206,1998,2010,'70Ah'),(v_tenant_id,a_bat002,b_peugeot,m_207,2006,2014,'70Ah'),
    (v_tenant_id,a_bat002,b_peugeot,m_307,2001,2008,'70Ah'),(v_tenant_id,a_bat002,b_citroen,m_c3,2002,2010,'70Ah'),
    (v_tenant_id,a_bat002,b_citroen,m_c4,2004,2011,'70Ah'),(v_tenant_id,a_bat002,b_vw,m_polo,2002,2009,'70Ah'),
    (v_tenant_id,a_bat002,b_vw,m_golf,2004,2013,'70Ah'),(v_tenant_id,a_bat002,b_ford,m_fiesta,2002,2012,'70Ah'),
    (v_tenant_id,a_bat002,b_ford,m_focus,2004,2012,'70Ah'),(v_tenant_id,a_bat002,b_opel,m_corsa,2006,2014,'70Ah'),
    (v_tenant_id,a_bat002,b_opel,m_astra,2004,2010,'70Ah'),(v_tenant_id,a_bat002,b_dacia,m_logan_d,2004,2013,'70Ah'),
    (v_tenant_id,a_bat002,b_dacia,m_sandero_d,2008,2013,'70Ah'),(v_tenant_id,a_bat002,b_fiat,m_punto,2005,2012,'70Ah'),
    (v_tenant_id,a_bat002,b_hyundai,m_i30,2007,2012,'70Ah'),(v_tenant_id,a_bat002,b_kia,m_sportage,2004,2010,'70Ah') ON CONFLICT DO NOTHING; END IF;

  -- BAT-003 Batterie 100Ah 4x4/utilitaires
  IF a_bat003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_bat003,b_toyota,m_lc,1990,NULL,'100Ah'),(v_tenant_id,a_bat003,b_toyota,m_lc70,1984,NULL,'100Ah'),
    (v_tenant_id,a_bat003,b_toyota,m_lc200,2007,NULL,'100Ah'),(v_tenant_id,a_bat003,b_toyota,m_hilux,2005,NULL,'100Ah'),
    (v_tenant_id,a_bat003,b_toyota,m_hiace,2005,NULL,'100Ah'),(v_tenant_id,a_bat003,b_nissan,m_patrol,2004,NULL,'100Ah'),
    (v_tenant_id,a_bat003,b_mitsubishi,m_pajero,2000,NULL,'100Ah'),(v_tenant_id,a_bat003,b_landrover,m_defender,1990,NULL,'100Ah'),
    (v_tenant_id,a_bat003,b_landrover,m_discovery,1989,NULL,'100Ah'),(v_tenant_id,a_bat003,b_isuzu,m_dmax,2007,NULL,'100Ah'),
    (v_tenant_id,a_bat003,b_ford,m_ranger,2006,NULL,'100Ah') ON CONFLICT DO NOTHING; END IF;

  -- BAT-004 Batterie 45Ah petites citadines
  IF a_bat004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_bat004,b_nissan,m_micra,1992,2010,'45Ah'),(v_tenant_id,a_bat004,b_nissan,m_almera,1995,2006,'45Ah'),
    (v_tenant_id,a_bat004,b_nissan,m_note,2004,2012,'45Ah'),(v_tenant_id,a_bat004,b_renault,m_clio,1990,2005,'45Ah'),
    (v_tenant_id,a_bat004,b_hyundai,m_i10,2007,2013,'45Ah'),(v_tenant_id,a_bat004,b_kia,m_picanto,2004,2011,'45Ah'),
    (v_tenant_id,a_bat004,b_suzuki,m_swift,1983,2004,'45Ah'),(v_tenant_id,a_bat004,b_fiat,m_punto,1993,2005,'45Ah') ON CONFLICT DO NOTHING; END IF;

  -- BG-001 Bougies NGK Toyota Corolla 1.6
  IF a_bg001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_bg001,b_toyota,m_corolla,2002,2007,'1ZZ NGK BKR5E'),(v_tenant_id,a_bg001,b_toyota,m_auris,2006,2012,'1ZZ'),
    (v_tenant_id,a_bg001,b_toyota,m_yaris,2005,2011,'1SZ'),(v_tenant_id,a_bg001,b_toyota,m_camry,2002,2006,'2AZ'),
    (v_tenant_id,a_bg001,b_toyota,m_prius,2003,2009,'1NZ-FXE'),(v_tenant_id,a_bg001,b_toyota,m_rav4,2001,2006,'1AZ'),
    (v_tenant_id,a_bg001,b_honda,m_civic,2001,2010,'NGK') ON CONFLICT DO NOTHING; END IF;

  -- BG-002 Bougies NGK Renault Clio 1.2
  IF a_bg002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_bg002,b_renault,m_clio,1998,2012,'D4F/D7F'),(v_tenant_id,a_bg002,b_renault,m_megane,1995,2008,'F4R/K4M'),
    (v_tenant_id,a_bg002,b_renault,m_scenic,1999,2009,'F4R/K4M'),(v_tenant_id,a_bg002,b_renault,m_logan_r,2004,2012,'K7M'),
    (v_tenant_id,a_bg002,b_dacia,m_logan_d,2004,2012,'K7M'),(v_tenant_id,a_bg002,b_dacia,m_sandero_d,2008,2012,'K7M'),
    (v_tenant_id,a_bg002,b_nissan,m_micra,2003,2010,'CGA3') ON CONFLICT DO NOTHING; END IF;

  -- BG-003 Bougies Denso Peugeot 206
  IF a_bg003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_bg003,b_peugeot,m_206,1998,2010,'TU3/TU5'),(v_tenant_id,a_bg003,b_peugeot,m_207,2006,2013,'TU5'),
    (v_tenant_id,a_bg003,b_peugeot,m_306,1993,2002,'TU3/TU5'),(v_tenant_id,a_bg003,b_citroen,m_c3,2002,2009,'TU5'),
    (v_tenant_id,a_bg003,b_citroen,m_xsara,1997,2004,'TU5/XU'),(v_tenant_id,a_bg003,b_citroen,m_berlingo,1996,2010,'TU5'),
    (v_tenant_id,a_bg003,b_fiat,m_punto,2005,2012,'Fire 1.2/1.4') ON CONFLICT DO NOTHING; END IF;

  -- BG-004 Bougies iridium NGK universelles
  IF a_bg004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_bg004,b_toyota,m_corolla,2000,NULL,'Univ.'),(v_tenant_id,a_bg004,b_toyota,m_hilux,2005,NULL,'Univ.'),
    (v_tenant_id,a_bg004,b_renault,m_clio,2000,NULL,'Univ.'),(v_tenant_id,a_bg004,b_peugeot,m_206,2000,NULL,'Univ.'),
    (v_tenant_id,a_bg004,b_vw,m_golf,2000,NULL,'Univ.'),(v_tenant_id,a_bg004,b_ford,m_focus,2000,NULL,'Univ.'),
    (v_tenant_id,a_bg004,b_opel,m_astra,2000,NULL,'Univ.'),(v_tenant_id,a_bg004,b_hyundai,m_i30,2007,NULL,'Univ.'),
    (v_tenant_id,a_bg004,b_kia,m_rio,2005,NULL,'Univ.'),(v_tenant_id,a_bg004,b_honda,m_civic,2000,NULL,'Univ.'),
    (v_tenant_id,a_bg004,b_mazda,m_mazda3,2003,NULL,'Univ.'),(v_tenant_id,a_bg004,b_mitsubishi,m_lancer,2003,NULL,'Univ.'),
    (v_tenant_id,a_bg004,b_suzuki,m_swift,2005,NULL,'Univ.'),(v_tenant_id,a_bg004,b_chevrolet,m_aveo,2005,NULL,'Univ.'),
    (v_tenant_id,a_bg004,b_audi,m_a3,2003,NULL,'Univ.') ON CONFLICT DO NOTHING; END IF;

  -- EL-001..005 Électricité
  IF a_el001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_el001,b_toyota,m_corolla,2002,2007,NULL),(v_tenant_id,a_el001,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_el001,b_toyota,m_yaris,2005,2011,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_el002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_el002,b_toyota,m_corolla,2002,2007,NULL),(v_tenant_id,a_el002,b_renault,m_clio,1998,2012,NULL),
    (v_tenant_id,a_el002,b_peugeot,m_206,1998,2010,NULL),(v_tenant_id,a_el002,b_renault,m_megane,1995,2008,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_el003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_el003,b_toyota,m_corolla,2002,2007,'bobine 1ZZ'),(v_tenant_id,a_el003,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_el003,b_toyota,m_yaris,2005,2011,NULL),(v_tenant_id,a_el003,b_toyota,m_camry,2002,2006,NULL),
    (v_tenant_id,a_el003,b_toyota,m_rav4,2001,2006,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_el004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_el004,b_toyota,m_corolla,2002,2007,'ABS av'),(v_tenant_id,a_el004,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_el004,b_toyota,m_yaris,2005,2011,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_el005 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_el005,b_toyota,m_corolla,2002,2007,'sonde lambda'),(v_tenant_id,a_el005,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_el005,b_toyota,m_yaris,2005,2011,NULL),(v_tenant_id,a_el005,b_toyota,m_camry,2002,2006,NULL) ON CONFLICT DO NOTHING; END IF;

  -- ET-001..002 Étriers
  IF a_et001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_et001,b_toyota,m_corolla,2002,2007,'étrier av'),(v_tenant_id,a_et001,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_et001,b_toyota,m_yaris,2005,2011,NULL),(v_tenant_id,a_et001,b_toyota,m_rav4,2001,2006,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_et002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_et002,b_renault,m_clio,2005,2014,'étrier ar'),(v_tenant_id,a_et002,b_renault,m_megane,2002,2009,'étrier ar'),
    (v_tenant_id,a_et002,b_renault,m_scenic,2003,2009,'étrier ar'),(v_tenant_id,a_et002,b_renault,m_laguna,2001,2007,'étrier ar') ON CONFLICT DO NOTHING; END IF;

  -- VE-001..002 Vannes EGR
  IF a_ve001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_ve001,b_toyota,m_hilux,2005,2015,'2KD EGR'),(v_tenant_id,a_ve001,b_toyota,m_fortuner,2005,2015,'2KD'),
    (v_tenant_id,a_ve001,b_toyota,m_hiace,2005,2013,'2KD'),(v_tenant_id,a_ve001,b_toyota,m_prado,2003,2009,'1KD') ON CONFLICT DO NOTHING; END IF;

  IF a_ve002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_ve002,b_renault,m_megane,2003,2010,'K9K EGR'),(v_tenant_id,a_ve002,b_renault,m_scenic,2003,2009,'K9K'),
    (v_tenant_id,a_ve002,b_renault,m_kangoo,2001,2013,'K9K'),(v_tenant_id,a_ve002,b_renault,m_laguna,2001,2008,'dCi'),
    (v_tenant_id,a_ve002,b_renault,m_duster_r,2010,2018,'K9K'),(v_tenant_id,a_ve002,b_dacia,m_duster_d,2010,2018,'K9K'),
    (v_tenant_id,a_ve002,b_nissan,m_micra,2003,2010,'K9K'),(v_tenant_id,a_ve002,b_nissan,m_note,2006,2012,'K9K') ON CONFLICT DO NOTHING; END IF;

  -- RA-001..002 Radiateurs
  IF a_ra001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_ra001,b_toyota,m_corolla,2002,2007,NULL),(v_tenant_id,a_ra001,b_toyota,m_auris,2006,2012,NULL),
    (v_tenant_id,a_ra001,b_toyota,m_yaris,2005,2011,NULL) ON CONFLICT DO NOTHING; END IF;

  IF a_ra002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,year_start,year_end,notes) VALUES
    (v_tenant_id,a_ra002,b_toyota,m_lc,1998,2007,'LC100'),(v_tenant_id,a_ra002,b_toyota,m_lc200,2007,NULL,NULL),
    (v_tenant_id,a_ra002,b_toyota,m_prado,2003,2009,NULL) ON CONFLICT DO NOTHING; END IF;

  -- HU-001 Huile 5W40 — universal essence/diesel
  IF a_hu001 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,notes) VALUES
    (v_tenant_id,a_hu001,b_toyota,m_corolla,'5W40'),(v_tenant_id,a_hu001,b_toyota,m_hilux,'5W40'),
    (v_tenant_id,a_hu001,b_renault,m_clio,'5W40'),(v_tenant_id,a_hu001,b_renault,m_megane,'5W40'),
    (v_tenant_id,a_hu001,b_peugeot,m_206,'5W40'),(v_tenant_id,a_hu001,b_peugeot,m_307,'5W40'),
    (v_tenant_id,a_hu001,b_vw,m_golf,'5W40'),(v_tenant_id,a_hu001,b_vw,m_polo,'5W40'),
    (v_tenant_id,a_hu001,b_ford,m_focus,'5W40'),(v_tenant_id,a_hu001,b_ford,m_fiesta,'5W40'),
    (v_tenant_id,a_hu001,b_hyundai,m_i30,'5W40'),(v_tenant_id,a_hu001,b_hyundai,m_accent,'5W40'),
    (v_tenant_id,a_hu001,b_kia,m_rio,'5W40'),(v_tenant_id,a_hu001,b_kia,m_sportage,'5W40'),
    (v_tenant_id,a_hu001,b_honda,m_civic,'5W40'),(v_tenant_id,a_hu001,b_nissan,m_almera,'5W40'),
    (v_tenant_id,a_hu001,b_mitsubishi,m_lancer,'5W40'),(v_tenant_id,a_hu001,b_suzuki,m_swift,'5W40'),
    (v_tenant_id,a_hu001,b_opel,m_corsa,'5W40'),(v_tenant_id,a_hu001,b_mercedes,m_classe_c,'5W40'),
    (v_tenant_id,a_hu001,b_bmw,m_s3,'5W40'),(v_tenant_id,a_hu001,b_audi,m_a3,'5W40'),
    (v_tenant_id,a_hu001,b_mazda,m_mazda3,'5W40'),(v_tenant_id,a_hu001,b_dacia,m_logan_d,'5W40'),
    (v_tenant_id,a_hu001,b_chevrolet,m_aveo,'5W40') ON CONFLICT DO NOTHING; END IF;

  -- HU-002 Huile 10W40 bidon 5L
  IF a_hu002 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,notes) VALUES
    (v_tenant_id,a_hu002,b_toyota,m_corolla,'10W40'),(v_tenant_id,a_hu002,b_toyota,m_hilux,'10W40'),
    (v_tenant_id,a_hu002,b_renault,m_clio,'10W40'),(v_tenant_id,a_hu002,b_peugeot,m_206,'10W40'),
    (v_tenant_id,a_hu002,b_vw,m_golf,'10W40'),(v_tenant_id,a_hu002,b_ford,m_focus,'10W40'),
    (v_tenant_id,a_hu002,b_hyundai,m_elantra,'10W40'),(v_tenant_id,a_hu002,b_kia,m_sportage,'10W40'),
    (v_tenant_id,a_hu002,b_honda,m_accord,'10W40'),(v_tenant_id,a_hu002,b_nissan,m_xtrail,'10W40'),
    (v_tenant_id,a_hu002,b_mitsubishi,m_pajero,'10W40'),(v_tenant_id,a_hu002,b_opel,m_astra,'10W40'),
    (v_tenant_id,a_hu002,b_mercedes,m_classe_e,'10W40'),(v_tenant_id,a_hu002,b_bmw,m_s5,'10W40'),
    (v_tenant_id,a_hu002,b_mazda,m_mazda6,'10W40') ON CONFLICT DO NOTHING; END IF;

  -- HU-003 Huile 15W40 diesel lourds
  IF a_hu003 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,notes) VALUES
    (v_tenant_id,a_hu003,b_toyota,m_lc,'15W40 diesel'),(v_tenant_id,a_hu003,b_toyota,m_hilux,'15W40 diesel'),
    (v_tenant_id,a_hu003,b_toyota,m_hiace,'15W40 diesel'),(v_tenant_id,a_hu003,b_nissan,m_patrol,'15W40 diesel'),
    (v_tenant_id,a_hu003,b_nissan,m_navara,'15W40 diesel'),(v_tenant_id,a_hu003,b_mitsubishi,m_pajero,'15W40 diesel'),
    (v_tenant_id,a_hu003,b_mitsubishi,m_l200,'15W40 diesel'),(v_tenant_id,a_hu003,b_isuzu,m_dmax,'15W40 diesel'),
    (v_tenant_id,a_hu003,b_landrover,m_defender,'15W40 diesel'),(v_tenant_id,a_hu003,b_ford,m_ranger,'15W40 diesel'),
    (v_tenant_id,a_hu003,b_mazda,m_bt50,'15W40 diesel') ON CONFLICT DO NOTHING; END IF;

  -- HU-004 ATF WS Toyota boites auto
  IF a_hu004 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,notes) VALUES
    (v_tenant_id,a_hu004,b_toyota,m_corolla,'ATF WS'),(v_tenant_id,a_hu004,b_toyota,m_camry,'ATF WS'),
    (v_tenant_id,a_hu004,b_toyota,m_prius,'ATF WS'),(v_tenant_id,a_hu004,b_toyota,m_rav4,'ATF WS'),
    (v_tenant_id,a_hu004,b_toyota,m_hilux,'ATF WS'),(v_tenant_id,a_hu004,b_toyota,m_lc,'ATF WS/T-IV'),
    (v_tenant_id,a_hu004,b_toyota,m_prado,'ATF WS'),(v_tenant_id,a_hu004,b_toyota,m_fortuner,'ATF WS') ON CONFLICT DO NOTHING; END IF;

  -- HU-005 Huile de frein DOT4 universelle
  IF a_hu005 IS NOT NULL THEN INSERT INTO article_compatibilities (tenant_id,article_id,brand_id,model_id,notes) VALUES
    (v_tenant_id,a_hu005,b_toyota,m_corolla,'DOT4'),(v_tenant_id,a_hu005,b_toyota,m_hilux,'DOT4'),
    (v_tenant_id,a_hu005,b_renault,m_clio,'DOT4'),(v_tenant_id,a_hu005,b_peugeot,m_206,'DOT4'),
    (v_tenant_id,a_hu005,b_vw,m_golf,'DOT4'),(v_tenant_id,a_hu005,b_ford,m_focus,'DOT4'),
    (v_tenant_id,a_hu005,b_hyundai,m_i30,'DOT4'),(v_tenant_id,a_hu005,b_nissan,m_almera,'DOT4'),
    (v_tenant_id,a_hu005,b_mercedes,m_classe_c,'DOT4'),(v_tenant_id,a_hu005,b_bmw,m_s3,'DOT4'),
    (v_tenant_id,a_hu005,b_honda,m_civic,'DOT4'),(v_tenant_id,a_hu005,b_mitsubishi,m_pajero,'DOT4'),
    (v_tenant_id,a_hu005,b_opel,m_astra,'DOT4'),(v_tenant_id,a_hu005,b_audi,m_a4,'DOT4'),
    (v_tenant_id,a_hu005,b_dacia,m_duster_d,'DOT4') ON CONFLICT DO NOTHING; END IF;

END $$;
