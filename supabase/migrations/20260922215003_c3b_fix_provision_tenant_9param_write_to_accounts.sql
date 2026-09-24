/*
# C3B — Corriger provision_tenant (9 params) : écrire dans accounts, pas accounting_accounts

## Contexte
La surcharge à 9 paramètres de provision_tenant (celle appelée par le formulaire
d'inscription) insère les comptes dans `accounting_accounts` au lieu de `accounts`.
Or, toutes les fonctions comptables et l'interface lisent exclusivement `accounts`.
Les 7 tenants créés via ce formulaire n'avaient donc aucun plan comptable exploitable
(corrigé rétroactivement par C3A pour les tenants existants).

## Changements
1. Recréer la surcharge 9 params identique à l'actuelle SAUF :
   - Le bloc INSERT passe de `accounting_accounts` (10 comptes) à `accounts` (17 comptes moteur).
   - Le moyen de paiement « Virement » passe de code 5120000 à 5210000 (Banque).
   - Ajout de SET search_path = public (sécurité DEFINER).
2. Révoquer EXECUTE de PUBLIC et anon sur les 4 surcharges.
3. Conserver explicitement EXECUTE pour authenticated et service_role.

## Ce qui NE change PAS
- Toute la logique d'inscription (tenant, profil, site, abonnement, catégories).
- Les surcharges 2, 3 et 4 params (corps inchangés, seuls les privilèges changent).
- Les 214 lignes existantes dans `accounts`.
- La table `accounting_accounts` (non touchée).
- Aucune interface, RLS ou autre fonction modifiée.
*/

-- ============================================================
-- 1. Recréer la surcharge 9 params avec le bon INSERT
-- ============================================================
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
SET search_path = public
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

-- ============================================================
-- 2. Révoquer PUBLIC et anon sur TOUTES les surcharges
-- ============================================================

-- 9 params
REVOKE ALL ON FUNCTION public.provision_tenant(text, text, text, uuid, text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_tenant(text, text, text, uuid, text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_tenant(text, text, text, uuid, text, text, text, text, text) TO authenticated, service_role;

-- 4 params
REVOKE ALL ON FUNCTION public.provision_tenant(text, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_tenant(text, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_tenant(text, text, text, uuid) TO authenticated, service_role;

-- 3 params
REVOKE ALL ON FUNCTION public.provision_tenant(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_tenant(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_tenant(text, text, text) TO authenticated, service_role;

-- 2 params (already correct but ensure consistency)
REVOKE ALL ON FUNCTION public.provision_tenant(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provision_tenant(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.provision_tenant(text, text) TO authenticated, service_role;
