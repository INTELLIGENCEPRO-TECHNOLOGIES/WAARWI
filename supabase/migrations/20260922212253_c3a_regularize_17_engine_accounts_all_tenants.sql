/*
# C3A — Régularisation des 17 comptes moteur pour les 12 tenants existants

## Contexte
Le moteur comptable (12 fonctions SECURITY DEFINER) utilise 17 codes de compte en dur.
Seuls 5 tenants (provisionnés par l'ancienne version de provision_tenant) possèdent
ces comptes dans public.accounts. Les 7 tenants récents ont été provisionnés par la
version 9-paramètres qui écrit dans accounting_accounts au lieu de accounts.
Résultat : 134 lignes manquantes.

## Changements
- INSERT INTO public.accounts : les 17 comptes indispensables au moteur comptable
  pour chaque tenant existant, avec ON CONFLICT (tenant_id, code) DO NOTHING.
- account_type = 'general', is_active = true, class = premier chiffre du code.
- Aucune modification de lignes existantes.
- Aucun UPDATE, DELETE, ALTER, DROP.
- accounting_accounts n'est pas touché.

## Comptes insérés (socle minimal moteur, PAS un plan SYSCOHADA complet)
1200000, 1310000, 1390000, 3110000, 4010000, 4110000, 4456000, 4457000,
5210000, 5211000, 5212000, 5213000, 5710000, 6010000, 6580000, 7010000, 7580000

## Lignes attendues
134 nouvelles lignes (5 tenants × 3 manquants + 7 tenants × 17 manquants).

## Sécurité
Aucun changement RLS, policies, privileges ou fonctions.
*/

INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
SELECT t.id, rc.code, rc.name, rc.class, 'general', true
FROM tenants t
CROSS JOIN (VALUES
  ('1200000', 'Report à nouveau',         1),
  ('1310000', 'Résultat net',              1),
  ('1390000', 'Résultat net (perte)',      1),
  ('3110000', 'Marchandises',              3),
  ('4010000', 'Fournisseurs',              4),
  ('4110000', 'Clients',                   4),
  ('4456000', 'TVA déductible',            4),
  ('4457000', 'TVA collectée',             4),
  ('5210000', 'Banque',                    5),
  ('5211000', 'Wave',                      5),
  ('5212000', 'Orange Money',              5),
  ('5213000', 'Free Money',                5),
  ('5710000', 'Caisse',                    5),
  ('6010000', 'Achats de marchandises',    6),
  ('6580000', 'Charges diverses',          6),
  ('7010000', 'Ventes de marchandises',    7),
  ('7580000', 'Produits divers',           7)
) AS rc(code, name, class)
ON CONFLICT (tenant_id, code) DO NOTHING;
