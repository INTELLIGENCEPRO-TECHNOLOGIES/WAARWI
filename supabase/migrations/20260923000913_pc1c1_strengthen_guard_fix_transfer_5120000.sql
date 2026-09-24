/*
# PC1C.1 — Finalize prerequisites before resolve_account()

## Two targeted fixes in one forward-only migration

### 1. Strengthen provision_tenant mapping guard (9-param overload only)
The PC1C guard counted ALL rows for the tenant in accounting_account_mappings.
This new guard counts only the 14 exact (role_code, account_code) pairs expected,
joined through accounts to verify the mapping actually points to the right account.
Uses IS DISTINCT FROM 14 so a future extra role won't block tenant creation,
while a wrong or missing mapping will.

### 2. Fix 7 historical payment_methods TRANSFER/bank 5120000 → 5210000
Exactly 7 tenants still have their default "Virement" payment method pointing to
the non-existent account code 5120000. This corrects them to 5210000 (Banque),
which is the code already used by new tenants and by BANK_DEFAULT mapping.
A row-count guard ensures exactly 7 rows are updated; otherwise rollback.

## Tables modified
- payment_methods: 7 rows updated (account_code only)
- pg_proc: provision_tenant 9-param body replaced

## Tables NOT modified
- accounts (214), accounting_account_mappings (168), journal_entries (9),
  journal_lines (18), accounting_accounts, all other functions
*/

----------------------------------------------------------------------
-- PART 1: Recreate provision_tenant 9-param with strengthened guard
----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provision_tenant(
  p_company_name text,
  p_user_full_name text,
  p_business_type text DEFAULT 'auto_parts'::text,
  p_activity_type_id uuid DEFAULT NULL::uuid,
  p_city text DEFAULT ''::text,
  p_whatsapp_phone text DEFAULT ''::text,
  p_responsible_title text DEFAULT ''::text,
  p_selected_plan text DEFAULT 'trial'::text,
  p_billing_cycle text DEFAULT 'monthly'::text
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
v_mapping_count integer;
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
INSERT INTO tenants (name, email, business_type, business_activity_type_id, approval_status, is_active, status, plan, city, whatsapp_phone, responsible_name, responsible_title, selected_plan_code, subscription_status, billing_cycle)
VALUES (p_company_name, v_user_email, coalesce(p_business_type,'auto_parts'), v_resolved_activity_id, 'pending', false, 'pending', p_selected_plan, p_city, p_whatsapp_phone, p_user_full_name, p_responsible_title, p_selected_plan, 'pending_review', p_billing_cycle)
RETURNING id INTO v_tenant_id;

INSERT INTO profiles (id, tenant_id, full_name, email, role)
VALUES (v_user_id, v_tenant_id, p_user_full_name, v_user_email, 'admin')
ON CONFLICT (id) DO UPDATE SET tenant_id = v_tenant_id, full_name = p_user_full_name;

INSERT INTO sites (tenant_id, name, code, is_warehouse)
VALUES (v_tenant_id, 'Magasin Principal', 'MAIN', true)
RETURNING id INTO v_site_id;

-- Common: payment methods (Virement now uses 5210000 instead of 5120000)
INSERT INTO payment_methods (tenant_id, name, code, payment_type, account_code, sort_order) VALUES
(v_tenant_id,'Especes','CASH','cash','5710000',1),
(v_tenant_id,'Wave','WAVE','mobile','5211000',2),
(v_tenant_id,'Orange Money','OM','mobile','5212000',3),
(v_tenant_id,'Free Money','FM','mobile','5213000',4),
(v_tenant_id,'Carte bancaire','CARD','card','5210000',5),
(v_tenant_id,'Virement','TRANSFER','bank','5210000',6);

-- 17 comptes moteur comptable dans accounts (socle minimal, pas un plan SYSCOHADA complet)
INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active) VALUES
(v_tenant_id, '1200000', 'Report à nouveau',         1, 'general', true),
(v_tenant_id, '1310000', 'Résultat net',              1, 'general', true),
(v_tenant_id, '1390000', 'Résultat net (perte)',      1, 'general', true),
(v_tenant_id, '3110000', 'Marchandises',              3, 'general', true),
(v_tenant_id, '4010000', 'Fournisseurs',              4, 'general', true),
(v_tenant_id, '4110000', 'Clients',                   4, 'general', true),
(v_tenant_id, '4456000', 'TVA déductible',            4, 'general', true),
(v_tenant_id, '4457000', 'TVA collectée',             4, 'general', true),
(v_tenant_id, '5210000', 'Banque',                    5, 'general', true),
(v_tenant_id, '5211000', 'Wave',                      5, 'general', true),
(v_tenant_id, '5212000', 'Orange Money',              5, 'general', true),
(v_tenant_id, '5213000', 'Free Money',                5, 'general', true),
(v_tenant_id, '5710000', 'Caisse',                    5, 'general', true),
(v_tenant_id, '6010000', 'Achats de marchandises',    6, 'general', true),
(v_tenant_id, '6580000', 'Charges diverses',          6, 'general', true),
(v_tenant_id, '7010000', 'Ventes de marchandises',    7, 'general', true),
(v_tenant_id, '7580000', 'Produits divers',           7, 'general', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- PC1C: Initialize 14 global accounting role mappings
INSERT INTO accounting_account_mappings (tenant_id, role_code, account_id)
SELECT v_tenant_id, m.role_code, a.id
FROM (VALUES
('CARRY_FORWARD',    '1200000'),
('RESULT_PROFIT',    '1310000'),
('RESULT_LOSS',      '1390000'),
('INVENTORY_GOODS',  '3110000'),
('SUPPLIER_CONTROL', '4010000'),
('CUSTOMER_CONTROL', '4110000'),
('VAT_INPUT',        '4456000'),
('VAT_OUTPUT',       '4457000'),
('BANK_DEFAULT',     '5210000'),
('CASH_DEFAULT',     '5710000'),
('PURCHASES_GOODS',  '6010000'),
('MISC_EXPENSE',     '6580000'),
('SALES_GOODS',      '7010000'),
('MISC_INCOME',      '7580000')
) AS m(role_code, account_code)
JOIN accounts a ON a.tenant_id = v_tenant_id AND a.code = m.account_code
ON CONFLICT (tenant_id, role_code) DO NOTHING;

-- PC1C.1: Strengthened guard — count exact (role_code, account_code) matches
SELECT count(*) INTO v_mapping_count
FROM (VALUES
  ('CARRY_FORWARD',    '1200000'),
  ('RESULT_PROFIT',    '1310000'),
  ('RESULT_LOSS',      '1390000'),
  ('INVENTORY_GOODS',  '3110000'),
  ('SUPPLIER_CONTROL', '4010000'),
  ('CUSTOMER_CONTROL', '4110000'),
  ('VAT_INPUT',        '4456000'),
  ('VAT_OUTPUT',       '4457000'),
  ('BANK_DEFAULT',     '5210000'),
  ('CASH_DEFAULT',     '5710000'),
  ('PURCHASES_GOODS',  '6010000'),
  ('MISC_EXPENSE',     '6580000'),
  ('SALES_GOODS',      '7010000'),
  ('MISC_INCOME',      '7580000')
) AS expected(role_code, account_code)
JOIN accounting_account_mappings m
  ON m.tenant_id = v_tenant_id AND m.role_code = expected.role_code
JOIN accounts a
  ON a.id = m.account_id AND a.tenant_id = m.tenant_id AND a.code = expected.account_code;

IF v_mapping_count IS DISTINCT FROM 14 THEN
  RAISE EXCEPTION 'PC1C.1: verified mapping count is %, expected 14 for tenant %',
    v_mapping_count, v_tenant_id;
END IF;

-- Auto-parts specific categories (only for auto_parts type)
IF p_business_type = 'auto_parts' OR (v_resolved_activity_id IS NOT NULL AND EXISTS(
SELECT 1 FROM business_activity_types WHERE id = v_resolved_activity_id AND (slug = 'auto_parts' OR legacy_business_type = 'auto_parts')
)) THEN
INSERT INTO categories (tenant_id, name, code, sort_order) VALUES
(v_tenant_id, 'Moteur', 'MOT', 1) RETURNING id INTO v_moteur_id;
INSERT INTO categories (tenant_id, name, code, sort_order) VALUES
(v_tenant_id, 'Freinage', 'FRE', 2) RETURNING id INTO v_freinage_id;
INSERT INTO categories (tenant_id, name, code, sort_order) VALUES
(v_tenant_id, 'Filtration', 'FIL', 3) RETURNING id INTO v_filtration_id;
INSERT INTO categories (tenant_id, name, code, sort_order) VALUES
(v_tenant_id, 'Electricite', 'ELE', 4) RETURNING id INTO v_elec_id;
INSERT INTO categories (tenant_id, name, code, sort_order) VALUES
(v_tenant_id, 'Suspension', 'SUS', 5) RETURNING id INTO v_suspension_id;
INSERT INTO categories (tenant_id, name, code, sort_order) VALUES
(v_tenant_id, 'Carrosserie', 'CAR', 6) RETURNING id INTO v_carrosserie_id;

-- Sub-categories
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Filtre huile', 'FH', v_filtration_id, 1) RETURNING id INTO v_fh_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Filtre air', 'FA', v_filtration_id, 2) RETURNING id INTO v_fa_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Filtre carburant', 'FC', v_filtration_id, 3) RETURNING id INTO v_fc_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Filtre climatisation', 'FCH', v_filtration_id, 4) RETURNING id INTO v_fch_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Plaquettes', 'PLA', v_freinage_id, 1) RETURNING id INTO v_pla_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Disques', 'DIS', v_freinage_id, 2) RETURNING id INTO v_dis_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Etriers', 'ETR', v_freinage_id, 3) RETURNING id INTO v_etr_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Courroies', 'COU', v_moteur_id, 1) RETURNING id INTO v_cou_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Pompes', 'POM', v_moteur_id, 2) RETURNING id INTO v_pom_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Bougies', 'BOU', v_elec_id, 1) RETURNING id INTO v_bou_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Batteries', 'BAT', v_elec_id, 2) RETURNING id INTO v_bat_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Alternateurs', 'ALT', v_elec_id, 3) RETURNING id INTO v_alt_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Demarreurs', 'DEM', v_elec_id, 4) RETURNING id INTO v_dem_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Amortisseurs', 'AMO', v_suspension_id, 1) RETURNING id INTO v_amo_id;
INSERT INTO categories (tenant_id, name, code, parent_id, sort_order) VALUES
(v_tenant_id, 'Rotules', 'ROT', v_suspension_id, 2) RETURNING id INTO v_rot_id;
ELSE
-- Generic categories for non-auto businesses
INSERT INTO categories (tenant_id, name, code, sort_order) VALUES
(v_tenant_id, 'Produits', 'PROD', 1) RETURNING id INTO v_art_id;
INSERT INTO categories (tenant_id, name, code, sort_order) VALUES
(v_tenant_id, 'Services', 'SVC', 2);
END IF;

RETURN v_tenant_id;
END;
$function$;

----------------------------------------------------------------------
-- PART 2: Fix 7 historical TRANSFER/bank payment_methods 5120000→5210000
----------------------------------------------------------------------

DO $$
DECLARE
  v_updated integer;
BEGIN
  UPDATE payment_methods
  SET account_code = '5210000'
  WHERE code = 'TRANSFER'
    AND payment_type = 'bank'
    AND account_code = '5120000';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'PC1C.1: expected 7 payment_methods updated, got %', v_updated;
  END IF;
END $$;
