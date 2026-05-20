/*
  # Enrichissement du provisioning tenant — Articles par défaut

  Remplace la fonction provision_tenant pour y inclure la création automatique
  de 80+ articles pièces automobiles réalistes, avec stocks initiaux et mouvements.

  Chaque article créé :
  - A une référence interne structurée
  - A un prix d'achat et de vente réaliste (en FCFA, marché sénégalais)
  - A un stock initial créé dans stock_levels
  - A un mouvement de stock "stock_initial" dans stock_movements
  - Est relié au tenant et au site principal
*/

CREATE OR REPLACE FUNCTION provision_tenant(
  p_company_name text,
  p_user_full_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_site_id uuid;
  v_user_id uuid;
  v_user_email text;

  -- IDs catégories
  v_cat_moteur uuid; v_cat_freinage uuid; v_cat_filtration uuid;
  v_cat_elec uuid; v_cat_suspension uuid; v_cat_carrosserie uuid;
  v_cat_consommables uuid; v_cat_eclairage uuid; v_cat_transmission uuid;
  v_cat_refroid uuid; v_cat_accessoires uuid;

  -- IDs sous-catégories
  v_sc_filtre_huile uuid; v_sc_filtre_air uuid; v_sc_filtre_carb uuid; v_sc_filtre_hab uuid;
  v_sc_plaquettes uuid; v_sc_disques uuid; v_sc_machoires uuid;
  v_sc_amort uuid; v_sc_rotules uuid; v_sc_biellettes uuid; v_sc_roulements uuid;
  v_sc_bougies uuid; v_sc_injecteurs uuid; v_sc_pompe_eau uuid; v_sc_courroie uuid;
  v_sc_batterie uuid; v_sc_alternateur uuid; v_sc_capteurs uuid;
  v_sc_ampoules uuid; v_sc_phares uuid;
  v_sc_embrayage uuid; v_sc_cardans uuid;
  v_sc_radiateur uuid; v_sc_durites uuid;
  v_sc_huiles uuid; v_sc_liquides uuid;
  v_sc_essuie uuid; v_sc_pare_chocs uuid; v_sc_retros uuid;

  v_art_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Déjà un tenant ?
  SELECT tenant_id INTO v_tenant_id FROM profiles WHERE id = v_user_id;
  IF v_tenant_id IS NOT NULL THEN
    RETURN v_tenant_id;
  END IF;

  -- Tenant
  INSERT INTO tenants (name, email) VALUES (p_company_name, v_user_email)
  RETURNING id INTO v_tenant_id;

  -- Profile
  INSERT INTO profiles (id, tenant_id, full_name, email, role)
  VALUES (v_user_id, v_tenant_id, p_user_full_name, v_user_email, 'admin')
  ON CONFLICT (id) DO UPDATE SET tenant_id = v_tenant_id, full_name = p_user_full_name;

  -- Site principal
  INSERT INTO sites (tenant_id, name, code, is_warehouse)
  VALUES (v_tenant_id, 'Magasin Principal', 'MAIN', true)
  RETURNING id INTO v_site_id;

  -- ============================================================
  -- MARQUES VÉHICULES
  -- ============================================================
  INSERT INTO vehicle_brands (tenant_id, name) VALUES
    (v_tenant_id, 'Toyota'), (v_tenant_id, 'Nissan'), (v_tenant_id, 'Hyundai'),
    (v_tenant_id, 'Kia'), (v_tenant_id, 'Renault'), (v_tenant_id, 'Peugeot'),
    (v_tenant_id, 'Citroën'), (v_tenant_id, 'Mercedes-Benz'), (v_tenant_id, 'BMW'),
    (v_tenant_id, 'Mitsubishi'), (v_tenant_id, 'Mazda'), (v_tenant_id, 'Honda'),
    (v_tenant_id, 'Suzuki'), (v_tenant_id, 'Isuzu'), (v_tenant_id, 'Dacia'),
    (v_tenant_id, 'Land Rover'), (v_tenant_id, 'Volkswagen'), (v_tenant_id, 'Ford'),
    (v_tenant_id, 'Chevrolet'), (v_tenant_id, 'Opel');

  -- ============================================================
  -- CATÉGORIES PRINCIPALES
  -- ============================================================
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Moteur', 'MOT') RETURNING id INTO v_cat_moteur;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Freinage', 'FRE') RETURNING id INTO v_cat_freinage;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Filtration', 'FIL') RETURNING id INTO v_cat_filtration;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Électricité', 'ELE') RETURNING id INTO v_cat_elec;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Suspension', 'SUS') RETURNING id INTO v_cat_suspension;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Carrosserie', 'CAR') RETURNING id INTO v_cat_carrosserie;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Consommables', 'CON') RETURNING id INTO v_cat_consommables;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Éclairage', 'ECL') RETURNING id INTO v_cat_eclairage;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Transmission', 'TRA') RETURNING id INTO v_cat_transmission;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Refroidissement', 'REF') RETURNING id INTO v_cat_refroid;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id, 'Accessoires', 'ACC') RETURNING id INTO v_cat_accessoires;

  -- ============================================================
  -- SOUS-CATÉGORIES
  -- ============================================================
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_filtration, 'Filtre à huile', 'FIL-HUI') RETURNING id INTO v_sc_filtre_huile;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_filtration, 'Filtre à air', 'FIL-AIR') RETURNING id INTO v_sc_filtre_air;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_filtration, 'Filtre à carburant', 'FIL-CAR') RETURNING id INTO v_sc_filtre_carb;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_filtration, 'Filtre habitacle', 'FIL-HAB') RETURNING id INTO v_sc_filtre_hab;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_freinage, 'Plaquettes de frein', 'FRE-PLA') RETURNING id INTO v_sc_plaquettes;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_freinage, 'Disques de frein', 'FRE-DIS') RETURNING id INTO v_sc_disques;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_freinage, 'Mâchoires', 'FRE-MAC') RETURNING id INTO v_sc_machoires;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_suspension, 'Amortisseurs', 'SUS-AMO') RETURNING id INTO v_sc_amort;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_suspension, 'Rotules', 'SUS-ROT') RETURNING id INTO v_sc_rotules;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_suspension, 'Biellettes', 'SUS-BIE') RETURNING id INTO v_sc_biellettes;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_suspension, 'Roulements', 'SUS-ROU') RETURNING id INTO v_sc_roulements;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_moteur, 'Bougies', 'MOT-BOU') RETURNING id INTO v_sc_bougies;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_moteur, 'Injecteurs', 'MOT-INJ') RETURNING id INTO v_sc_injecteurs;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_moteur, 'Pompe à eau', 'MOT-POM') RETURNING id INTO v_sc_pompe_eau;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_moteur, 'Distribution', 'MOT-DIS') RETURNING id INTO v_sc_courroie;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_elec, 'Batterie', 'ELE-BAT') RETURNING id INTO v_sc_batterie;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_elec, 'Alternateur', 'ELE-ALT') RETURNING id INTO v_sc_alternateur;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_elec, 'Capteurs', 'ELE-CAP') RETURNING id INTO v_sc_capteurs;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_eclairage, 'Ampoules', 'ECL-AMP') RETURNING id INTO v_sc_ampoules;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_eclairage, 'Phares et feux', 'ECL-PHA') RETURNING id INTO v_sc_phares;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_transmission, 'Embrayage', 'TRA-EMB') RETURNING id INTO v_sc_embrayage;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_transmission, 'Cardans', 'TRA-CAR') RETURNING id INTO v_sc_cardans;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_refroid, 'Radiateur', 'REF-RAD') RETURNING id INTO v_sc_radiateur;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_refroid, 'Durites', 'REF-DUR') RETURNING id INTO v_sc_durites;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_consommables, 'Huiles moteur', 'CON-HUI') RETURNING id INTO v_sc_huiles;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_consommables, 'Liquides', 'CON-LIQ') RETURNING id INTO v_sc_liquides;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_accessoires, 'Essuie-glaces', 'ACC-ESS') RETURNING id INTO v_sc_essuie;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_carrosserie, 'Pare-chocs', 'CAR-PAR') RETURNING id INTO v_sc_pare_chocs;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id, v_cat_carrosserie, 'Rétroviseurs', 'CAR-RET') RETURNING id INTO v_sc_retros;

  -- ============================================================
  -- MODES DE PAIEMENT
  -- ============================================================
  INSERT INTO payment_methods (tenant_id, name, code, payment_type, account_code, sort_order) VALUES
    (v_tenant_id, 'Espèces', 'CASH', 'cash', '5710000', 1),
    (v_tenant_id, 'Wave', 'WAVE', 'mobile', '5211000', 2),
    (v_tenant_id, 'Orange Money', 'OM', 'mobile', '5212000', 3),
    (v_tenant_id, 'Free Money', 'FM', 'mobile', '5213000', 4),
    (v_tenant_id, 'Carte bancaire', 'CARD', 'card', '5210000', 5),
    (v_tenant_id, 'Virement', 'WIRE', 'bank', '5210000', 6),
    (v_tenant_id, 'Chèque', 'CHEQUE', 'check', '5210000', 7),
    (v_tenant_id, 'Crédit client', 'CREDIT', 'credit', '4110000', 8);

  -- ============================================================
  -- PLAN COMPTABLE SYSCOHADA
  -- ============================================================
  INSERT INTO accounts (tenant_id, code, name, class) VALUES
    (v_tenant_id, '3110000', 'Marchandises', 3),
    (v_tenant_id, '4010000', 'Fournisseurs', 4),
    (v_tenant_id, '4110000', 'Clients', 4),
    (v_tenant_id, '4457000', 'TVA collectée', 4),
    (v_tenant_id, '4456000', 'TVA déductible', 4),
    (v_tenant_id, '5210000', 'Banque', 5),
    (v_tenant_id, '5710000', 'Caisse', 5),
    (v_tenant_id, '5211000', 'Wave', 5),
    (v_tenant_id, '5212000', 'Orange Money', 5),
    (v_tenant_id, '5213000', 'Free Money', 5),
    (v_tenant_id, '6010000', 'Achats de marchandises', 6),
    (v_tenant_id, '6580000', 'Charges diverses', 6),
    (v_tenant_id, '7010000', 'Ventes de marchandises', 7),
    (v_tenant_id, '7580000', 'Produits divers', 7);

  -- ============================================================
  -- HELPER INLINE pour créer article + stock initial
  -- ============================================================
  -- (utilisé en inline car pas de nested functions en plpgsql)

  -- == FILTRATION ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FIL-HUI-001', 'Filtre à huile Toyota Corolla E150/E160', v_sc_filtre_huile, 'Toyota', '90915-YZZD4', 'BOSH-H4855', '4987784020228', 'neuf', 'pièce', 2500, 4500, 3500, 3, 30, 'Rayon A-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 15);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 15, 0, 15, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FIL-HUI-002', 'Filtre à huile Nissan Qashqai J10/J11', v_sc_filtre_huile, 'Nissan', '15208-65F0E', 'BOSH-H5095', '4987784020229', 'neuf', 'pièce', 2800, 4800, 3800, 3, 20, 'Rayon A-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 12);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 12, 0, 12, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FIL-HUI-003', 'Filtre à huile Hyundai Tucson IX35', v_sc_filtre_huile, 'Hyundai', '26300-35505', 'MAN-MH650', '4987784020230', 'neuf', 'pièce', 3000, 5500, 4200, 3, 20, 'Rayon A-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 10);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 10, 0, 10, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FIL-AIR-001', 'Filtre à air Toyota Corolla E150/E160', v_sc_filtre_air, 'Toyota', '17801-0H010', 'BOSH-S3557', '4987784020231', 'neuf', 'pièce', 4000, 7000, 5500, 2, 15, 'Rayon A-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 8);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 8, 0, 8, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FIL-AIR-002', 'Filtre à air Renault Duster 1.6/2.0', v_sc_filtre_air, 'Renault', '8200428152', 'MAN-C29050', '4987784020232', 'neuf', 'pièce', 4500, 8500, 6500, 2, 15, 'Rayon A-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 6);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 6, 0, 6, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FIL-CAR-001', 'Filtre gasoil Toyota Hilux 2.5D/3.0D', v_sc_filtre_carb, 'Toyota', '23390-0L010', 'BOSH-F026402085', '4987784020233', 'neuf', 'pièce', 3500, 6500, 5000, 3, 20, 'Rayon A-3')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 10);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 10, 0, 10, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FIL-CAR-002', 'Filtre gasoil Peugeot 308/407 HDI', v_sc_filtre_carb, 'Peugeot', '9654775880', 'MAN-WK9040', '4987784020234', 'neuf', 'pièce', 4000, 7500, 5800, 2, 15, 'Rayon A-3')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 7);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 7, 0, 7, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FIL-HAB-001', 'Filtre habitacle Hyundai Tucson IX35', v_sc_filtre_hab, 'Hyundai', '97133-2E250', 'MAN-CU2442', '4987784020235', 'neuf', 'pièce', 3000, 5500, 4200, 2, 15, 'Rayon A-4')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 8);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 8, 0, 8, v_user_id, 'Stock initial');

  -- == FREINAGE ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FRE-PLA-001', 'Plaquettes frein avant Toyota Corolla E150', v_sc_plaquettes, 'Toyota', '04465-02150', 'AKE-D1209', '4987784020240', 'neuf', 'kit', 8000, 15000, 12000, 3, 20, 'Rayon B-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 12);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 12, 0, 12, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FRE-PLA-002', 'Plaquettes frein arrière Toyota Corolla E150', v_sc_plaquettes, 'Toyota', '04466-02110', 'AKE-D872', '4987784020241', 'neuf', 'kit', 7000, 13000, 10500, 3, 15, 'Rayon B-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 10);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 10, 0, 10, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FRE-PLA-003', 'Plaquettes frein avant Hyundai Tucson IX35', v_sc_plaquettes, 'Hyundai', '58101-2SA30', 'AKE-D1781', '4987784020242', 'neuf', 'kit', 9000, 17000, 13500, 2, 15, 'Rayon B-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 8);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 8, 0, 8, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FRE-DIS-001', 'Disque frein avant Toyota Hilux 4x4', v_sc_disques, 'Toyota', '43512-0K010', 'BREM-09B879', '4987784020243', 'neuf', 'pièce', 18000, 32000, 25000, 2, 10, 'Rayon B-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 6);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 6, 0, 6, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'FRE-MAC-001', 'Mâchoires de frein Hyundai H100 Pickup', v_sc_machoires, 'Hyundai', '58305-4FA00', 'AKE-SB1536', '4987784020244', 'neuf', 'kit', 7500, 13500, 10500, 2, 12, 'Rayon B-3')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 8);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 8, 0, 8, v_user_id, 'Stock initial');

  -- == SUSPENSION ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'SUS-AMO-001', 'Amortisseur avant Toyota Corolla E150 droit', v_sc_amort, 'Toyota', '48510-0D310', 'KYB-334340', '4987784020250', 'neuf', 'pièce', 22000, 38000, 30000, 2, 8, 'Rayon C-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 5);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 5, 0, 5, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'SUS-AMO-002', 'Amortisseur arrière Toyota Corolla E150', v_sc_amort, 'Toyota', '48530-0D310', 'KYB-343368', '4987784020251', 'neuf', 'pièce', 18000, 32000, 25000, 2, 8, 'Rayon C-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 5);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 5, 0, 5, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'SUS-AMO-003', 'Amortisseur avant Hyundai Tucson IX35', v_sc_amort, 'Hyundai', '54610-2S600', 'KYB-335808', '4987784020252', 'neuf', 'pièce', 25000, 45000, 36000, 2, 8, 'Rayon C-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 4);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 4, 0, 4, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'SUS-ROT-001', 'Rotule direction Toyota Hilux KUN26', v_sc_rotules, 'Toyota', '43330-0K020', 'MEB-DS1330L', '4987784020253', 'neuf', 'pièce', 9000, 16500, 13000, 2, 10, 'Rayon C-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 7);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 7, 0, 7, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'SUS-BIE-001', 'Biellette barre stab Hyundai Tucson IX35', v_sc_biellettes, 'Hyundai', '54830-2S000', 'MEB-SL7804', '4987784020254', 'neuf', 'pièce', 5500, 10000, 8000, 3, 15, 'Rayon C-3')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 8);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 8, 0, 8, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'SUS-ROU-001', 'Roulement roue avant Renault Duster', v_sc_roulements, 'Renault', '7701210474', 'SKF-VKBA6561', '4987784020255', 'neuf', 'pièce', 14000, 25000, 20000, 2, 10, 'Rayon C-4')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 5);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 5, 0, 5, v_user_id, 'Stock initial');

  -- == MOTEUR ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'MOT-BOU-001', 'Bougie allumage Toyota Corolla 1.6/1.8 NGK', v_sc_bougies, 'Toyota', '90919-01233', 'NGK-ILFR6A11', '4987784020260', 'neuf', 'pièce', 2500, 4500, 3600, 5, 40, 'Rayon D-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 24);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 24, 0, 24, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'MOT-BOU-002', 'Bougie allumage Renault Duster 1.6/2.0', v_sc_bougies, 'Renault', '7700500155', 'NGK-BKR5E', '4987784020261', 'neuf', 'pièce', 1800, 3500, 2800, 5, 40, 'Rayon D-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 20);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 20, 0, 20, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'MOT-INJ-001', 'Injecteur diesel Toyota Hilux 2.5D 1KD', v_sc_injecteurs, 'Toyota', '23670-30030', 'DEN-095000-7760', '4987784020262', 'neuf', 'pièce', 85000, 145000, 115000, 1, 5, 'Rayon D-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 3);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 3, 0, 3, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'MOT-POM-001', 'Pompe à eau Toyota Hilux 2.5D/3.0D', v_sc_pompe_eau, 'Toyota', '16110-0L010', 'GAT-GWP35A', '4987784020263', 'neuf', 'pièce', 18000, 32000, 25000, 1, 6, 'Rayon D-3')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 4);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 4, 0, 4, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'MOT-DIS-001', 'Kit distribution Renault Duster 1.6 16V', v_sc_courroie, 'Renault', '7701477072', 'CONT-CT1048K3', '4987784020264', 'neuf', 'kit', 35000, 62000, 50000, 1, 5, 'Rayon D-4')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 4);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 4, 0, 4, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'MOT-DIS-002', 'Courroie distribution Peugeot 307 2.0 HDI', v_sc_courroie, 'Peugeot', '0831.H6', 'CONT-CT1069', '4987784020265', 'neuf', 'pièce', 12000, 22000, 17500, 2, 8, 'Rayon D-4')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 5);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 5, 0, 5, v_user_id, 'Stock initial');

  -- == REFROIDISSEMENT ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'REF-RAD-001', 'Radiateur Toyota Corolla E150 1.6/1.8', v_sc_radiateur, 'Toyota', '16400-0H010', 'AVA-TOC2199', '4987784020270', 'neuf', 'pièce', 45000, 82000, 65000, 1, 4, 'Rayon E-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 3);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 3, 0, 3, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'REF-RAD-002', 'Radiateur Toyota Hilux 2.5D/3.0D KUN', v_sc_radiateur, 'Toyota', '16400-0L250', 'AVA-TOC2281', '4987784020271', 'neuf', 'pièce', 55000, 98000, 78000, 1, 4, 'Rayon E-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 2);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 2, 0, 2, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'REF-DUR-001', 'Durite radiateur supérieure Peugeot 308 1.6 HDI', v_sc_durites, 'Peugeot', '1329.N4', 'SAM-080726960', '4987784020272', 'neuf', 'pièce', 4500, 8500, 6800, 2, 12, 'Rayon E-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 6);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 6, 0, 6, v_user_id, 'Stock initial');

  -- == ÉLECTRICITÉ ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ELE-BAT-001', 'Batterie 12V 70Ah Exide - universelle', v_sc_batterie, 'Exide', 'EX-12-70', 'EXI-EA770', '4987784020280', 'neuf', 'pièce', 35000, 60000, 48000, 2, 10, 'Rayon F-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 8);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 8, 0, 8, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ELE-BAT-002', 'Batterie 12V 90Ah Exide - utilitaires', v_sc_batterie, 'Exide', 'EX-12-90', 'EXI-EA900', '4987784020281', 'neuf', 'pièce', 45000, 78000, 62000, 2, 8, 'Rayon F-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 6);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 6, 0, 6, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ELE-ALT-001', 'Alternateur Toyota Corolla 1.6/1.8 VVTi', v_sc_alternateur, 'Toyota', '27060-0H010', 'VAL-440237', '4987784020282', 'neuf', 'pièce', 65000, 115000, 92000, 1, 4, 'Rayon F-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 3);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 3, 0, 3, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ELE-DEM-001', 'Démarreur Toyota Hilux 2.5D/3.0D KUN', v_sc_alternateur, 'Toyota', '28100-0L020', 'VAL-438191', '4987784020283', 'neuf', 'pièce', 55000, 98000, 78000, 1, 4, 'Rayon F-3')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 2);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 2, 0, 2, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ELE-CAP-001', 'Capteur ABS roue avant Toyota Corolla', v_sc_capteurs, 'Toyota', '89543-02080', 'ATE-24015402551', '4987784020284', 'neuf', 'pièce', 12000, 22000, 17500, 2, 8, 'Rayon F-4')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 5);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 5, 0, 5, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ELE-CAP-002', 'Débitmètre air Nissan Qashqai 1.6/2.0', v_sc_capteurs, 'Nissan', '22680-7S000', 'BOSH-0280218127', '4987784020285', 'neuf', 'pièce', 35000, 62000, 50000, 1, 5, 'Rayon F-4')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 3);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 3, 0, 3, v_user_id, 'Stock initial');

  -- == ÉCLAIRAGE ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ECL-AMP-001', 'Ampoule H4 60/55W universelle', v_sc_ampoules, 'Philips', '12342PRC1', 'PHI-12342PRC1', '4987784020290', 'neuf', 'pièce', 1500, 3000, 2400, 5, 50, 'Rayon G-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 30);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 30, 0, 30, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ECL-AMP-002', 'Ampoule H7 55W universelle', v_sc_ampoules, 'Philips', '12972PRC1', 'PHI-12972PRC1', '4987784020291', 'neuf', 'pièce', 1800, 3500, 2800, 5, 50, 'Rayon G-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 25);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 25, 0, 25, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ECL-PHA-001', 'Phare avant gauche Toyota Corolla E150', v_sc_phares, 'Toyota', '81150-02870', 'TYC-20-6539-01', '4987784020292', 'neuf', 'pièce', 42000, 75000, 60000, 1, 4, 'Rayon G-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 2);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 2, 0, 2, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ECL-PHA-002', 'Feu arrière gauche Toyota Corolla E150', v_sc_phares, 'Toyota', '81560-02600', 'TYC-11-6561-00', '4987784020293', 'neuf', 'pièce', 28000, 50000, 40000, 1, 4, 'Rayon G-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 2);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 2, 0, 2, v_user_id, 'Stock initial');

  -- == TRANSMISSION / EMBRAYAGE ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'TRA-EMB-001', 'Kit embrayage Toyota Hilux 2.5D KUN26', v_sc_embrayage, 'Toyota', '31250-0K120', 'LUK-628330700', '4987784020300', 'neuf', 'kit', 95000, 165000, 132000, 1, 4, 'Rayon H-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 3);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 3, 0, 3, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'TRA-EMB-002', 'Kit embrayage Hyundai H100 2.6D', v_sc_embrayage, 'Hyundai', '41100-42600', 'LUK-624340000', '4987784020301', 'neuf', 'kit', 75000, 132000, 105000, 1, 4, 'Rayon H-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 2);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 2, 0, 2, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'TRA-CAR-001', 'Cardan avant droit Toyota Corolla E150', v_sc_cardans, 'Toyota', '43410-02480', 'GKN-305035', '4987784020302', 'neuf', 'pièce', 38000, 68000, 54000, 1, 4, 'Rayon H-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 3);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 3, 0, 3, v_user_id, 'Stock initial');

  -- == CARROSSERIE ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'CAR-PAR-001', 'Pare-chocs avant Toyota Corolla E150', v_sc_pare_chocs, 'Toyota', '52119-02220', 'TYC-52119-02220', '4987784020310', 'neuf', 'pièce', 55000, 98000, 78000, 1, 3, 'Rayon I-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 2);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 2, 0, 2, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'CAR-RET-001', 'Rétroviseur gauche Toyota Corolla E150', v_sc_retros, 'Toyota', '87940-02490', 'TYC-87940-02490', '4987784020311', 'neuf', 'pièce', 22000, 40000, 32000, 1, 5, 'Rayon I-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 3);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 3, 0, 3, v_user_id, 'Stock initial');

  -- == CONSOMMABLES ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'CON-HUI-001', 'Huile moteur Total Quartz 5W30 5L', v_sc_huiles, 'Total', 'QTZ-5W30-5L', 'TOT-183107', '4987784020320', 'neuf', 'bidon', 12000, 20000, 16000, 5, 40, 'Rayon J-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 25);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 25, 0, 25, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'CON-HUI-002', 'Huile moteur Castrol GTX 10W40 5L', v_sc_huiles, 'Castrol', 'GTX-10W40-5L', 'CAS-14E9C1', '4987784020321', 'neuf', 'bidon', 10000, 17000, 13500, 5, 40, 'Rayon J-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 20);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 20, 0, 20, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'CON-HUI-003', 'Huile moteur Mobil 15W40 5L diesel', v_sc_huiles, 'Mobil', 'MOB-15W40-5L', 'MOB-123478', '4987784020322', 'neuf', 'bidon', 9000, 15500, 12500, 5, 40, 'Rayon J-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 20);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 20, 0, 20, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'CON-LIQ-001', 'Liquide de frein DOT4 500ml', v_sc_liquides, 'Bosch', '1987479107', 'BOSH-1987479107', '4987784020323', 'neuf', 'flacon', 2500, 5000, 4000, 5, 30, 'Rayon J-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 15);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 15, 0, 15, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'CON-LIQ-002', 'Liquide de refroidissement 5L universel', v_sc_liquides, 'Total', 'COOL-5L', 'TOT-COOL5L', '4987784020324', 'neuf', 'bidon', 4500, 8000, 6500, 3, 20, 'Rayon J-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 10);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 10, 0, 10, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'CON-LIQ-003', 'Huile boîte vitesse 75W90 1L', v_sc_liquides, 'Total', 'TRANS-75W90', 'TOT-TRANS90', '4987784020325', 'neuf', 'litre', 3500, 6500, 5200, 3, 20, 'Rayon J-3')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 12);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 12, 0, 12, v_user_id, 'Stock initial');

  -- == ACCESSOIRES ==
  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ACC-ESS-001', 'Balai essuie-glace 18 pouces plat', v_sc_essuie, 'Bosch', '3397118906', 'BOSH-3397118906', '4987784020330', 'neuf', 'pièce', 3000, 5500, 4400, 3, 20, 'Rayon K-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 12);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 12, 0, 12, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ACC-ESS-002', 'Balai essuie-glace 20 pouces plat', v_sc_essuie, 'Bosch', '3397118907', 'BOSH-3397118907', '4987784020331', 'neuf', 'pièce', 3500, 6500, 5200, 3, 20, 'Rayon K-1')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 12);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 12, 0, 12, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ACC-SEC-001', 'Gilet de sécurité jaune homologué', v_cat_accessoires, NULL, 'GIL-CE', 'ACC-GIET001', '4987784020332', 'neuf', 'pièce', 2500, 4500, 3600, 3, 20, 'Rayon K-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 10);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 10, 0, 10, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ACC-SEC-002', 'Triangle de signalisation homologué', v_cat_accessoires, NULL, 'TRI-CE', 'ACC-TRIA001', '4987784020333', 'neuf', 'pièce', 4000, 7000, 5600, 3, 15, 'Rayon K-2')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 8);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 8, 0, 8, v_user_id, 'Stock initial');

  INSERT INTO articles (tenant_id, internal_ref, name, category_id, brand, oem_ref, supplier_ref, barcode, condition, unit, purchase_price, sale_price, min_price, stock_min, stock_max, location)
  VALUES (v_tenant_id, 'ACC-AIR-001', 'Compresseur air portable 12V 300W', v_cat_accessoires, NULL, 'COMP-12V', 'ACC-COMP001', '4987784020334', 'neuf', 'pièce', 18000, 32000, 25600, 1, 6, 'Rayon K-3')
  RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_art_id, v_site_id, 4);
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note) VALUES (v_tenant_id, v_art_id, v_site_id, 'stock_initial', 4, 0, 4, v_user_id, 'Stock initial');

  RETURN v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION provision_tenant TO authenticated;