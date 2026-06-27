
-- Add registration-related columns to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city text DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS whatsapp_phone text DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS responsible_name text DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS responsible_title text DEFAULT '';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS selected_plan_code text DEFAULT 'trial';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_start_date timestamptz DEFAULT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_end_date timestamptz DEFAULT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'pending_review';

-- Add trial_days to plans table so admin can configure trial duration per plan
ALTER TABLE plans ADD COLUMN IF NOT EXISTS trial_days int DEFAULT 14;

-- Allow anon users to read public plans (for signup page)
CREATE POLICY "Anon view public plans" ON plans FOR SELECT TO anon USING (is_public = true);

-- Update provision_tenant to accept new registration fields
CREATE OR REPLACE FUNCTION provision_tenant(
  p_company_name text,
  p_user_full_name text,
  p_business_type text DEFAULT 'auto_parts',
  p_activity_type_id uuid DEFAULT NULL,
  p_city text DEFAULT '',
  p_whatsapp_phone text DEFAULT '',
  p_responsible_title text DEFAULT '',
  p_selected_plan text DEFAULT 'trial'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
v_tenant_id uuid;
v_site_id uuid;
v_user_id uuid;
v_user_email text;
v_resolved_activity_id uuid;
v_trial_days int;
v_moteur_id uuid;
v_freinage_id uuid;
v_filtration_id uuid;
v_elec_id uuid;
v_suspension_id uuid;
v_carrosserie_id uuid;
v_fh_id uuid;
v_fa_id uuid;
v_fc_id uuid;
v_fch_id uuid;
v_pla_id uuid;
v_dis_id uuid;
v_etr_id uuid;
v_cou_id uuid;
v_pom_id uuid;
v_bou_id uuid;
v_bat_id uuid;
v_alt_id uuid;
v_dem_id uuid;
v_amo_id uuid;
v_rot_id uuid;
v_art_id uuid;
BEGIN
v_user_id := auth.uid();
IF v_user_id IS NULL THEN
RAISE EXCEPTION 'Non authentifie';
END IF;

SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

SELECT tenant_id INTO v_tenant_id FROM profiles WHERE id = v_user_id;
IF v_tenant_id IS NOT NULL THEN
RETURN v_tenant_id;
END IF;

-- Resolve activity type ID
v_resolved_activity_id := p_activity_type_id;
IF v_resolved_activity_id IS NULL AND p_business_type IS NOT NULL THEN
SELECT id INTO v_resolved_activity_id
FROM business_activity_types
WHERE (slug = p_business_type OR legacy_business_type = p_business_type)
AND is_active = true
LIMIT 1;
END IF;

-- Get trial days from selected plan
SELECT trial_days INTO v_trial_days FROM plans WHERE code = p_selected_plan;
IF v_trial_days IS NULL THEN v_trial_days := 14; END IF;

-- Tenant (pending approval, inactive)
INSERT INTO tenants (name, email, business_type, business_activity_type_id, approval_status, is_active, status, plan, city, whatsapp_phone, responsible_name, responsible_title, selected_plan_code, subscription_status)
VALUES (p_company_name, v_user_email, coalesce(p_business_type,'auto_parts'), v_resolved_activity_id, 'pending', false, 'pending', p_selected_plan, p_city, p_whatsapp_phone, p_user_full_name, p_responsible_title, p_selected_plan, 'pending_review')
RETURNING id INTO v_tenant_id;

INSERT INTO profiles (id, tenant_id, full_name, email, role)
VALUES (v_user_id, v_tenant_id, p_user_full_name, v_user_email, 'admin')
ON CONFLICT (id) DO UPDATE SET tenant_id = v_tenant_id, full_name = p_user_full_name;

INSERT INTO sites (tenant_id, name, code, is_warehouse)
VALUES (v_tenant_id, 'Magasin Principal', 'MAIN', true)
RETURNING id INTO v_site_id;

-- Common: payment methods + accounting
INSERT INTO payment_methods (tenant_id, name, code, payment_type, account_code, sort_order) VALUES
(v_tenant_id,'Especes','CASH','cash','5710000',1),
(v_tenant_id,'Wave','WAVE','mobile','5211000',2),
(v_tenant_id,'Orange Money','OM','mobile','5212000',3),
(v_tenant_id,'Free Money','FM','mobile','5213000',4),
(v_tenant_id,'Carte bancaire','CARD','card','5210000',5),
(v_tenant_id,'Virement','WIRE','bank','5210000',6),
(v_tenant_id,'Cheque','CHEQUE','check','5210000',7),
(v_tenant_id,'Credit client','CREDIT','credit','4110000',8);

INSERT INTO accounts (tenant_id, code, name, class) VALUES
(v_tenant_id,'3110000','Marchandises',3),
(v_tenant_id,'4010000','Fournisseurs',4),
(v_tenant_id,'4110000','Clients',4),
(v_tenant_id,'4457000','TVA collectee',4),
(v_tenant_id,'4456000','TVA deductible',4),
(v_tenant_id,'5210000','Banque',5),
(v_tenant_id,'5710000','Caisse',5),
(v_tenant_id,'5211000','Wave',5),
(v_tenant_id,'5212000','Orange Money',5),
(v_tenant_id,'5213000','Free Money',5),
(v_tenant_id,'6010000','Achats de marchandises',6),
(v_tenant_id,'6580000','Charges diverses',6),
(v_tenant_id,'7010000','Ventes de marchandises',7),
(v_tenant_id,'7580000','Produits divers',7);

-- Auto-parts specific catalog
IF coalesce(p_business_type,'auto_parts') = 'auto_parts' THEN
INSERT INTO vehicle_brands (tenant_id, name) VALUES
(v_tenant_id,'Toyota'),(v_tenant_id,'Nissan'),(v_tenant_id,'Hyundai'),
(v_tenant_id,'Kia'),(v_tenant_id,'Renault'),(v_tenant_id,'Peugeot'),
(v_tenant_id,'Citroen'),(v_tenant_id,'Mercedes-Benz'),(v_tenant_id,'BMW'),
(v_tenant_id,'Audi'),(v_tenant_id,'Volkswagen'),(v_tenant_id,'Ford'),
(v_tenant_id,'Mitsubishi'),(v_tenant_id,'Mazda'),(v_tenant_id,'Honda'),
(v_tenant_id,'Suzuki'),(v_tenant_id,'Isuzu'),(v_tenant_id,'Chevrolet'),
(v_tenant_id,'Dacia'),(v_tenant_id,'Land Rover');

INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Moteur','MOT') RETURNING id INTO v_moteur_id;
INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Freinage','FRE') RETURNING id INTO v_freinage_id;
INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Filtration','FIL') RETURNING id INTO v_filtration_id;
INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Electricite','ELE') RETURNING id INTO v_elec_id;
INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Suspension','SUS') RETURNING id INTO v_suspension_id;
INSERT INTO part_categories (tenant_id, name, code) VALUES (v_tenant_id,'Carrosserie','CAR') RETURNING id INTO v_carrosserie_id;

INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_filtration_id,'Filtre a huile','FIL-HUI') RETURNING id INTO v_fh_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_filtration_id,'Filtre a air','FIL-AIR') RETURNING id INTO v_fa_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_filtration_id,'Filtre a carburant','FIL-CAR') RETURNING id INTO v_fc_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_filtration_id,'Filtre habitacle','FIL-HAB') RETURNING id INTO v_fch_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_freinage_id,'Plaquettes','FRE-PLA') RETURNING id INTO v_pla_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_freinage_id,'Disques','FRE-DIS') RETURNING id INTO v_dis_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_freinage_id,'Etriers','FRE-ETR') RETURNING id INTO v_etr_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_moteur_id,'Courroie distribution','MOT-DIS') RETURNING id INTO v_cou_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_moteur_id,'Pompe a eau','MOT-POM') RETURNING id INTO v_pom_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_moteur_id,'Bougies','MOT-BOU') RETURNING id INTO v_bou_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_elec_id,'Batterie','ELE-BAT') RETURNING id INTO v_bat_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_elec_id,'Alternateur','ELE-ALT') RETURNING id INTO v_alt_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_elec_id,'Demarreur','ELE-DEM') RETURNING id INTO v_dem_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_suspension_id,'Amortisseurs','SUS-AMO') RETURNING id INTO v_amo_id;
INSERT INTO part_categories (tenant_id, parent_id, name, code) VALUES (v_tenant_id,v_suspension_id,'Rotules','SUS-ROT') RETURNING id INTO v_rot_id;

INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
VALUES (v_tenant_id,'FH-001','Filtre a huile Toyota Corolla','MANN','W712/73','MAN-W71273',v_fh_id,'new','pce',2500,4500,3500,3800,18,5,50,'Rayon A-1',true) RETURNING id INTO v_art_id;
INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,25);
INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',25,0,25,'Stock initial');

INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
VALUES (v_tenant_id,'BAT-001','Batterie 60Ah universelle','VARTA','E38-60Ah','VAR-E3860',v_bat_id,'new','pce',45000,80000,65000,72000,18,3,15,'Rayon E-1',true) RETURNING id INTO v_art_id;
INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,8);
INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',8,0,8,'Stock initial');

INSERT INTO articles (tenant_id,internal_ref,name,brand,oem_ref,supplier_ref,category_id,condition,unit,purchase_price,sale_price,min_price,wholesale_price,vat_rate,stock_min,stock_max,location,is_active)
VALUES (v_tenant_id,'BG-001','Bougies NGK universelles (x4)','NGK','BKR5EYA','NGK-BKR5EYA',v_bou_id,'new','kit',8000,14000,11000,12500,18,5,30,'Rayon D-1',true) RETURNING id INTO v_art_id;
INSERT INTO stock_levels (tenant_id,article_id,site_id,quantity) VALUES (v_tenant_id,v_art_id,v_site_id,20);
INSERT INTO stock_movements (tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES (v_tenant_id,v_art_id,v_site_id,'stock_initial',20,0,20,'Stock initial');
END IF;

RETURN v_tenant_id;
END;
$$;
