/*
  # Provision tenant avec 82 articles par défaut

  Cette migration remplace la fonction provision_tenant pour inclure
  automatiquement lors de la création de chaque nouveau tenant:
  - Le tenant, le profil admin, le site principal
  - 20 marques véhicules
  - Les catégories et sous-catégories pièces auto
  - 8 modes de paiement
  - Le plan comptable SYSCOHADA de base (14 comptes)
  - 82 articles réels de pièces automobiles avec emplacement, référence OEM, ref fournisseur
  - Les stock_levels initiaux
  - Les stock_movements de type 'stock_initial'

  Sécurité: SECURITY DEFINER, guard contre double provisioning.
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
  v_moteur_id uuid;
  v_freinage_id uuid;
  v_filtration_id uuid;
  v_elec_id uuid;
  v_suspension_id uuid;
  v_carrosserie_id uuid;
  v_fh_id uuid;   -- filtre huile
  v_fa_id uuid;   -- filtre air
  v_fc_id uuid;   -- filtre carburant
  v_fch_id uuid;  -- filtre habitacle
  v_pla_id uuid;  -- plaquettes
  v_dis_id uuid;  -- disques
  v_etr_id uuid;  -- etriers
  v_cou_id uuid;  -- courroie
  v_pom_id uuid;  -- pompe eau
  v_bou_id uuid;  -- bougies
  v_bat_id uuid;  -- batterie
  v_alt_id uuid;  -- alternateur
  v_dem_id uuid;  -- demarreur
  v_amo_id uuid;  -- amortisseurs
  v_rot_id uuid;  -- rotules
  v_art_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  -- Guard: déjà provisionné ?
  SELECT tenant_id INTO v_tenant_id FROM profiles WHERE id = v_user_id;
  IF v_tenant_id IS NOT NULL THEN
    RETURN v_tenant_id;
  END IF;

  -- Tenant
  INSERT INTO tenants (name, email) VALUES (p_company_name, v_user_email)
  RETURNING id INTO v_tenant_id;

  -- Profil admin
  INSERT INTO profiles (id, tenant_id, full_name, email, role)
  VALUES (v_user_id, v_tenant_id, p_user_full_name, v_user_email, 'admin')
  ON CONFLICT (id) DO UPDATE SET tenant_id = v_tenant_id, full_name = p_user_full_name;

  -- Site principal
  INSERT INTO sites (tenant_id, name, code, is_warehouse)
  VALUES (v_tenant_id, 'Magasin Principal', 'MAIN', true)
  RETURNING id INTO v_site_id;

  -- Marques véhicules
  INSERT INTO vehicle_brands (tenant_id, name) VALUES
    (v_tenant_id,'Toyota'),(v_tenant_id,'Nissan'),(v_tenant_id,'Hyundai'),
    (v_tenant_id,'Kia'),(v_tenant_id,'Renault'),(v_tenant_id,'Peugeot'),
    (v_tenant_id,'Citroën'),(v_tenant_id,'Mercedes-Benz'),(v_tenant_id,'BMW'),
    (v_tenant_id,'Audi'),(v_tenant_id,'Volkswagen'),(v_tenant_id,'Ford'),
    (v_tenant_id,'Mitsubishi'),(v_tenant_id,'Mazda'),(v_tenant_id,'Honda'),
    (v_tenant_id,'Suzuki'),(v_tenant_id,'Isuzu'),(v_tenant_id,'Chevrolet'),
    (v_tenant_id,'Dacia'),(v_tenant_id,'Land Rover');

  -- Catégories principales
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Moteur','MOT') RETURNING id INTO v_moteur_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Freinage','FRE') RETURNING id INTO v_freinage_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Filtration','FIL') RETURNING id INTO v_filtration_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Électricité','ELE') RETURNING id INTO v_elec_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Suspension','SUS') RETURNING id INTO v_suspension_id;
  INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Carrosserie','CAR') RETURNING id INTO v_carrosserie_id;

  -- Sous-catégories
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_filtration_id,'Filtre à huile','FIL-HUI') RETURNING id INTO v_fh_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_filtration_id,'Filtre à air','FIL-AIR') RETURNING id INTO v_fa_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_filtration_id,'Filtre à carburant','FIL-CAR') RETURNING id INTO v_fc_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_filtration_id,'Filtre habitacle','FIL-HAB') RETURNING id INTO v_fch_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_freinage_id,'Plaquettes','FRE-PLA') RETURNING id INTO v_pla_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_freinage_id,'Disques','FRE-DIS') RETURNING id INTO v_dis_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_freinage_id,'Étriers','FRE-ETR') RETURNING id INTO v_etr_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_moteur_id,'Courroie distribution','MOT-DIS') RETURNING id INTO v_cou_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_moteur_id,'Pompe à eau','MOT-POM') RETURNING id INTO v_pom_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_moteur_id,'Bougies','MOT-BOU') RETURNING id INTO v_bou_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_elec_id,'Batterie','ELE-BAT') RETURNING id INTO v_bat_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_elec_id,'Alternateur','ELE-ALT') RETURNING id INTO v_alt_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_elec_id,'Démarreur','ELE-DEM') RETURNING id INTO v_dem_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_suspension_id,'Amortisseurs','SUS-AMO') RETURNING id INTO v_amo_id;
  INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_suspension_id,'Rotules','SUS-ROT') RETURNING id INTO v_rot_id;

  -- Modes de paiement
  INSERT INTO payment_methods (tenant_id, name, code, payment_type, account_code, sort_order) VALUES
    (v_tenant_id,'Espèces','CASH','cash','5710000',1),
    (v_tenant_id,'Wave','WAVE','mobile','5211000',2),
    (v_tenant_id,'Orange Money','OM','mobile','5212000',3),
    (v_tenant_id,'Free Money','FM','mobile','5213000',4),
    (v_tenant_id,'Carte bancaire','CARD','card','5210000',5),
    (v_tenant_id,'Virement','WIRE','bank','5210000',6),
    (v_tenant_id,'Chèque','CHEQUE','check','5210000',7),
    (v_tenant_id,'Crédit client','CREDIT','credit','4110000',8);

  -- Plan comptable SYSCOHADA
  INSERT INTO accounts (tenant_id, code, name, class) VALUES
    (v_tenant_id,'3110000','Marchandises',3),
    (v_tenant_id,'4010000','Fournisseurs',4),
    (v_tenant_id,'4110000','Clients',4),
    (v_tenant_id,'4457000','TVA collectée',4),
    (v_tenant_id,'4456000','TVA déductible',4),
    (v_tenant_id,'5210000','Banque',5),
    (v_tenant_id,'5710000','Caisse',5),
    (v_tenant_id,'5211000','Wave',5),
    (v_tenant_id,'5212000','Orange Money',5),
    (v_tenant_id,'5213000','Free Money',5),
    (v_tenant_id,'6010000','Achats de marchandises',6),
    (v_tenant_id,'6580000','Charges diverses',6),
    (v_tenant_id,'7010000','Ventes de marchandises',7),
    (v_tenant_id,'7580000','Produits divers',7);

  -- ============================================================
  -- ARTICLES PAR DÉFAUT (82 articles)
  -- Helper macro: INSERT article + stock_level + stock_movement
  -- ============================================================

  -- FILTRES A HUILE (6)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FH-001','Filtre à huile Toyota Corolla E12','MANN','W712/73','MAN-W71273',v_fh_id,'new','pce',2500,4500,3500,3800,18,5,50,'Rayon A-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,25);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',25,0,25,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FH-002','Filtre à huile Renault Clio III','BOSCH','0451103316','BOS-0451103316',v_fh_id,'new','pce',2800,5000,3800,4200,18,5,50,'Rayon A-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,20);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',20,0,20,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FH-003','Filtre à huile Peugeot 206/207','FRAM','PH9688','FRA-PH9688',v_fh_id,'new','pce',2200,3800,3000,3200,18,5,50,'Rayon A-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,30);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',30,0,30,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FH-004','Filtre à huile Nissan Almera','NISSAN','15208AA100','NIS-15208AA100',v_fh_id,'new','pce',3000,5500,4200,4800,18,3,30,'Rayon A-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,18);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',18,0,18,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FH-005','Filtre à huile Mercedes Classe C','MANN','W67/1','MAN-W671',v_fh_id,'new','pce',4500,8000,6000,6500,18,3,20,'Rayon A-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,12);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',12,0,12,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FH-006','Filtre à huile Toyota Land Cruiser','TOYOTA','90915YZZE1','TOY-90915YZZE1',v_fh_id,'new','pce',5000,9000,7000,7500,18,3,20,'Rayon A-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,10);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',10,0,10,'Stock initial');

  -- FILTRES A AIR (5)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FA-001','Filtre à air Toyota Corolla E12','MANN','C25004','MAN-C25004',v_fa_id,'new','pce',3500,6000,4800,5200,18,5,30,'Rayon A-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,20);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',20,0,20,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FA-002','Filtre à air Renault Clio III 1.5 dCi','BOSCH','F026400080','BOS-F026400080',v_fa_id,'new','pce',4000,7000,5500,6000,18,5,30,'Rayon A-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,15);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',15,0,15,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FA-003','Filtre à air Peugeot 206 HDi','CHAMPION','U543/606','CHA-U543606',v_fa_id,'new','pce',3200,5500,4300,4800,18,5,30,'Rayon A-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,18);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',18,0,18,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FA-004','Filtre à air Toyota Hilux 2.5 D4D','TOYOTA','1780130060','TOY-1780130060',v_fa_id,'new','pce',5500,9500,7500,8200,18,3,20,'Rayon A-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,10);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',10,0,10,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FA-005','Filtre à air Nissan Pathfinder','MAHLE','LX3018','MAH-LX3018',v_fa_id,'new','pce',6000,10500,8500,9200,18,3,15,'Rayon A-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  -- FILTRES CARBURANT (3)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FC-001','Filtre à carburant Toyota Corolla','BOSCH','0450905930','BOS-0450905930',v_fc_id,'new','pce',4000,7000,5500,6000,18,5,30,'Rayon A-3',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,15);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',15,0,15,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FC-002','Filtre à carburant Renault Clio III','MANN','WK612/6','MAN-WK6126',v_fc_id,'new','pce',4500,8000,6200,6800,18,5,25,'Rayon A-3',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,12);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',12,0,12,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FC-003','Filtre à carburant Peugeot 206 1.9D','PURFLUX','C513','PUR-C513',v_fc_id,'new','pce',3500,6000,4800,5200,18,5,25,'Rayon A-3',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,20);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',20,0,20,'Stock initial');

  -- FILTRES HABITACLE (2)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FCH-001','Filtre habitacle Toyota Corolla','BOSCH','1987432013','BOS-1987432013',v_fch_id,'new','pce',3500,6000,4500,5200,18,5,30,'Rayon A-4',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,15);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',15,0,15,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'FCH-002','Filtre habitacle Renault Megane III','MANN','CU2545','MAN-CU2545',v_fch_id,'new','pce',4000,7000,5500,6200,18,5,25,'Rayon A-4',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,12);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',12,0,12,'Stock initial');

  -- PLAQUETTES DE FREIN (6)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PF-001','Plaquettes avant Toyota Corolla E12','BREMBO','P49035','BRE-P49035',v_pla_id,'new','kit',12000,22000,17000,19000,18,5,30,'Rayon B-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,15);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',15,0,15,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PF-002','Plaquettes arrière Toyota Corolla E12','BREMBO','P49051','BRE-P49051',v_pla_id,'new','kit',10000,18000,14000,16000,18,5,25,'Rayon B-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,12);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',12,0,12,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PF-003','Plaquettes avant Renault Clio III','TRW','GDB1386','TRW-GDB1386',v_pla_id,'new','kit',11000,20000,15500,17500,18,5,25,'Rayon B-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,18);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',18,0,18,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PF-004','Plaquettes avant Peugeot 206/207','FERODO','FDB1422','FER-FDB1422',v_pla_id,'new','kit',9500,17000,13000,15000,18,5,25,'Rayon B-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,20);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',20,0,20,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PF-005','Plaquettes avant Nissan Almera','ATE','13046035412','ATE-13046035412',v_pla_id,'new','kit',13000,24000,19000,21000,18,3,20,'Rayon B-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,10);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',10,0,10,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PF-006','Plaquettes avant Toyota Land Cruiser 100','BREMBO','P83056','BRE-P83056',v_pla_id,'new','kit',18000,33000,26000,29000,18,3,15,'Rayon B-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  -- DISQUES DE FREIN (4)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'DF-001','Disques avant Toyota Corolla E12 (x2)','BREMBO','09870720','BRE-09870720',v_dis_id,'new','kit',22000,40000,32000,35000,18,3,20,'Rayon B-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,10);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',10,0,10,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'DF-002','Disques avant Renault Clio III (x2)','TRW','DF4333','TRW-DF4333',v_dis_id,'new','kit',20000,36000,28000,32000,18,3,20,'Rayon B-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,10);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',10,0,10,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'DF-003','Disques avant Peugeot 206 (x2)','ATE','24012201101','ATE-24012201101',v_dis_id,'new','kit',18000,32000,25000,28000,18,3,20,'Rayon B-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,12);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',12,0,12,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'DF-004','Disques avant Toyota Hilux (x2)','TOYOTA','4351204030','TOY-4351204030',v_dis_id,'new','kit',35000,62000,50000,55000,18,2,10,'Rayon B-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,6);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',6,0,6,'Stock initial');

  -- ETRIERS (2)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'ET-001','Étrier frein avant Toyota Corolla','BREMBO','2297602','BRE-2297602',v_etr_id,'new','pce',28000,52000,42000,46000,18,2,10,'Rayon B-3',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,6);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',6,0,6,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'ET-002','Étrier frein arrière Renault Clio III','TRW','2297603','TRW-2297603',v_etr_id,'new','pce',24000,45000,36000,40000,18,2,10,'Rayon B-3',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,5);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',5,0,5,'Stock initial');

  -- COURROIE DISTRIBUTION (4)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'CD-001','Kit courroie distribution Toyota Corolla 1.4','GATES','K015662XS','GAT-K015662XS',v_cou_id,'new','kit',25000,45000,36000,40000,18,3,15,'Rayon C-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'CD-002','Kit courroie distribution Renault Clio 1.5 dCi','CONTITECH','CT1164K1','CTT-CT1164K1',v_cou_id,'new','kit',30000,55000,43000,48000,18,3,15,'Rayon C-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,6);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',6,0,6,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'CD-003','Kit courroie distribution Peugeot 206 HDi','GATES','K025570XS','GAT-K025570XS',v_cou_id,'new','kit',28000,50000,40000,44000,18,3,15,'Rayon C-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,7);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',7,0,7,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'CD-004','Kit embrayage Renault Clio III 1.5 dCi','VALEO','821313','VAL-821313',v_cou_id,'new','kit',55000,98000,79000,87000,18,2,8,'Rayon C-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,5);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',5,0,5,'Stock initial');

  -- POMPE A EAU (4)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PE-001','Pompe à eau Toyota Corolla 1.4/1.6','AISIN','WPT104','AIS-WPT104',v_pom_id,'new','pce',18000,33000,26000,29000,18,3,15,'Rayon C-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PE-002','Pompe à eau Renault Clio III 1.5 dCi','SKF','VKPC83263','SKF-VKPC83263',v_pom_id,'new','pce',22000,40000,32000,35000,18,2,10,'Rayon C-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,6);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',6,0,6,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PE-003','Pompe à eau Peugeot 206 1.9D','DOLZ','P135','DOL-P135',v_pom_id,'new','pce',20000,36000,29000,32000,18,2,10,'Rayon C-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,7);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',7,0,7,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'PE-004','Pompe à eau Toyota Land Cruiser 1HZ','AISIN','WPT138','AIS-WPT138',v_pom_id,'new','pce',35000,63000,50000,55000,18,2,8,'Rayon C-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,4);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',4,0,4,'Stock initial');

  -- BOUGIES (4)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'BG-001','Bougies NGK Toyota Corolla 1.6 (x4)','NGK','BKR5EYA','NGK-BKR5EYA',v_bou_id,'new','kit',8000,14000,11000,12500,18,5,30,'Rayon D-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,20);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',20,0,20,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'BG-002','Bougies NGK Renault Clio 1.2 (x4)','NGK','BKRE6EKB','NGK-BKRE6EKB',v_bou_id,'new','kit',12000,22000,17000,19000,18,5,25,'Rayon D-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,15);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',15,0,15,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'BG-003','Bougies Denso Peugeot 206 (x4)','DENSO','K16PR-U','DEN-K16PRU',v_bou_id,'new','kit',10000,18000,14000,16000,18,5,25,'Rayon D-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,18);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',18,0,18,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'BG-004','Bougies iridium NGK universel (x4)','NGK','ILZKAR7B10','NGK-ILZKAR7B10',v_bou_id,'new','kit',28000,50000,40000,44000,18,3,15,'Rayon D-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,10);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',10,0,10,'Stock initial');

  -- BATTERIES (4)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'BAT-001','Batterie 60Ah Toyota Corolla/Yaris','VARTA','E38-60Ah','VAR-E3860',v_bat_id,'new','pce',45000,80000,65000,72000,18,3,15,'Rayon E-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'BAT-002','Batterie 70Ah Renault/Peugeot/Citroën','BOSCH','S4E05-70Ah','BOS-S4E0570',v_bat_id,'new','pce',55000,95000,78000,85000,18,3,10,'Rayon E-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,6);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',6,0,6,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'BAT-003','Batterie 100Ah Toyota Land Cruiser','VARTA','H3-100Ah','VAR-H3100',v_bat_id,'new','pce',80000,140000,115000,125000,18,2,8,'Rayon E-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,5);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',5,0,5,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'BAT-004','Batterie 45Ah Nissan Micra/Almera','EXIDE','EC450-45Ah','EXI-EC45045',v_bat_id,'new','pce',35000,62000,50000,55000,18,3,12,'Rayon E-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  -- ALTERNATEURS (3)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'ALT-001','Alternateur Toyota Corolla 1.4/1.6 occasion','VALEO','2541396','VAL-2541396',v_alt_id,'used','pce',35000,65000,52000,58000,18,2,8,'Rayon F-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,4);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',4,0,4,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'ALT-002','Alternateur Renault Clio III 1.5 dCi neuf','VALEO','439505','VAL-439505',v_alt_id,'new','pce',75000,135000,108000,118000,18,1,5,'Rayon F-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,3);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',3,0,3,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'ALT-003','Alternateur Toyota Land Cruiser 1HZ','DENSO','1012101240','DEN-1012101240',v_alt_id,'new','pce',120000,210000,170000,185000,18,1,4,'Rayon F-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,2);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',2,0,2,'Stock initial');

  -- DEMARREURS (3)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'DEM-001','Démarreur Toyota Corolla occasion','VALEO','455993','VAL-455993',v_dem_id,'used','pce',28000,50000,40000,45000,18,2,8,'Rayon F-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,4);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',4,0,4,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'DEM-002','Démarreur Renault Clio/Megane 1.5 dCi neuf','BOSCH','0986022440','BOS-0986022440',v_dem_id,'new','pce',65000,115000,92000,100000,18,1,5,'Rayon F-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,3);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',3,0,3,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'DEM-003','Démarreur Toyota Land Cruiser 1HZ','DENSO','2280003540','DEN-2280003540',v_dem_id,'new','pce',95000,170000,136000,150000,18,1,4,'Rayon F-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,2);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',2,0,2,'Stock initial');

  -- AMORTISSEURS (5)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'AM-001','Amortisseur avant Toyota Corolla (unité)','KAYABA','333274','KYB-333274',v_amo_id,'new','pce',22000,40000,32000,35000,18,4,20,'Rayon G-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'AM-002','Amortisseur arrière Toyota Corolla (unité)','KAYABA','343354','KYB-343354',v_amo_id,'new','pce',18000,33000,26000,29000,18,4,20,'Rayon G-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'AM-003','Amortisseur avant Renault Clio III (unité)','MONROE','B4015','MON-B4015',v_amo_id,'new','pce',20000,36000,29000,32000,18,4,20,'Rayon G-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'AM-004','Amortisseur avant Toyota Land Cruiser 80','KAYABA','344461','KYB-344461',v_amo_id,'new','pce',55000,98000,79000,87000,18,2,10,'Rayon G-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,4);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',4,0,4,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'AM-005','Amortisseur avant Toyota Hilux (unité)','MONROE','G8236','MON-G8236',v_amo_id,'new','pce',40000,72000,58000,64000,18,2,10,'Rayon G-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,5);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',5,0,5,'Stock initial');

  -- ROTULES (4)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'ROT-001','Rotule de direction Toyota Corolla','MOOG','TO-ES-2138','MOO-TOES2138',v_rot_id,'new','pce',8500,15000,12000,13500,18,4,20,'Rayon G-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,12);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',12,0,12,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'ROT-002','Rotule supérieure Toyota Land Cruiser 80','MOOG','TO-BJ-1025','MOO-TOBJ1025',v_rot_id,'new','pce',18000,33000,26000,29000,18,3,15,'Rayon G-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'ROT-003','Rotule de direction Renault Clio III','TRW','JBJ968','TRW-JBJ968',v_rot_id,'new','pce',9500,17000,13500,15000,18,4,20,'Rayon G-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,10);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',10,0,10,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'ROT-004','Kit 2 rotules bas Toyota Hilux','MOOG','TO-BJ-2016','MOO-TOBJ2016',v_rot_id,'new','kit',28000,50000,40000,45000,18,2,10,'Rayon G-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,6);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',6,0,6,'Stock initial');

  -- HUILES MOTEUR (4)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'HU-001','Huile moteur Total Quartz 5W40 1L','TOTAL','TQZ5401','TOT-TQZ5401',v_moteur_id,'new','L',3500,6000,4800,5200,18,20,200,'Rayon H-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,80);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',80,0,80,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'HU-002','Huile moteur Total Quartz 10W40 bidon 5L','TOTAL','TQZ10405','TOT-TQZ10405',v_moteur_id,'new','bidon',16000,28000,22500,25000,18,10,100,'Rayon H-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,40);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',40,0,40,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'HU-003','Huile moteur Castrol GTX 15W40 1L diesel','CASTROL','CGX15401','CAS-CGX15401',v_moteur_id,'new','L',3200,5500,4400,4900,18,20,200,'Rayon H-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,100);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',100,0,100,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'HU-004','Huile transmission Toyota ATF WS 1L','TOYOTA','ATFWS1L','TOY-ATFWS1L',v_moteur_id,'new','L',6000,11000,8800,9800,18,10,50,'Rayon H-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,25);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',25,0,25,'Stock initial');

  -- ELECTRICITE / CAPTEURS (5)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'EL-001','Kit câbles bougies Toyota/Renault universel','NGK','RC-FX29','NGK-RCFX29',v_elec_id,'new','kit',12000,22000,17500,19500,18,3,20,'Rayon I-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,10);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',10,0,10,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'EL-002','Bobine allumage Toyota Corolla 1.6','TOYOTA','9091902220','TOY-9091902220',v_elec_id,'new','pce',18000,32000,26000,29000,18,2,10,'Rayon I-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,6);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',6,0,6,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'EL-003','Capteur ABS roue avant Toyota Corolla','BOSCH','0265007751','BOS-0265007751',v_elec_id,'new','pce',22000,39000,31000,34500,18,2,10,'Rayon I-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,5);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',5,0,5,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'EL-004','Sonde lambda Toyota 1.4/1.6','NTK','OZA660EE1','NTK-OZA660EE1',v_elec_id,'new','pce',25000,45000,36000,40000,18,2,10,'Rayon I-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,5);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',5,0,5,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'EL-005','Vanne EGR Toyota Hilux 2.5 D4D','TOYOTA','2580130040','TOY-2580130040',v_elec_id,'new','pce',35000,63000,50000,55000,18,2,8,'Rayon I-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,4);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',4,0,4,'Stock initial');

  -- SUSPENSION (6)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'SU-001','Silent bloc bras suspension Toyota Corolla','MOOG','TO-SB-1012','MOO-TOSB1012',v_suspension_id,'new','pce',5000,9000,7200,8000,18,5,30,'Rayon J-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,15);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',15,0,15,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'SU-002','Kit silent blocs avant Renault Clio III','MOOG','RE-SB-5682','MOO-RESB5682',v_suspension_id,'new','kit',15000,27000,21500,24000,18,3,15,'Rayon J-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'SU-003','Triangle bras inférieur Peugeot 206','LEMFORDER','2888401','LEM-2888401',v_suspension_id,'new','pce',20000,36000,29000,32000,18,3,15,'Rayon J-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'SU-004','Roulement moyeu avant Toyota Hilux','SKF','VKBA3584','SKF-VKBA3584',v_suspension_id,'new','pce',28000,50000,40000,45000,18,2,10,'Rayon J-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,6);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',6,0,6,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'SU-005','Roulement moyeu avant Toyota Corolla','FAG','713690380','FAG-713690380',v_suspension_id,'new','pce',18000,32000,26000,29000,18,3,15,'Rayon J-2',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'SU-006','Ressort suspension avant Toyota Corolla','KAYABA','48231-02210','KYB-4823102210',v_suspension_id,'new','pce',15000,27000,22000,24000,18,4,20,'Rayon J-3',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,10);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',10,0,10,'Stock initial');

  -- RADIATEURS (2)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'RA-001','Radiateur Toyota Corolla 1.6','DENSO','2211002390','DEN-2211002390',v_moteur_id,'new','pce',45000,82000,66000,73000,18,1,6,'Rayon K-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,4);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',4,0,4,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'RA-002','Radiateur Toyota Land Cruiser 100','DENSO','1640117120','DEN-1640117120',v_moteur_id,'new','pce',95000,170000,136000,150000,18,1,4,'Rayon K-1',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,2);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',2,0,2,'Stock initial');

  -- HUILE DE FREIN + LIQUIDE REFROIDISSEMENT (2)
  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'HU-005','Huile de frein DOT4 500ml','ATE','706070','ATE-706070',v_dis_id,'new','flacon',2500,4500,3600,4000,18,10,100,'Rayon H-3',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,30);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',30,0,30,'Stock initial');

  INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
  VALUES (v_tenant_id,'HU-006','Liquide de refroidissement Toyota 1L','TOYOTA','0888980026','TOY-0888980026',v_moteur_id,'new','L',4000,7000,5600,6200,18,10,50,'Rayon H-3',true) RETURNING id INTO v_art_id;
  INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,20);
  INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',20,0,20,'Stock initial');

  RETURN v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION provision_tenant TO authenticated;
