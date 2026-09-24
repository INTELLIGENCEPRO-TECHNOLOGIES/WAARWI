/*
# C2.1 — Renforcement des gardes tenant et jointures cross-tenant

## Description
Correctif chirurgical sur les 7 RPC comptables publiques, portant uniquement sur :

1. **IS DISTINCT FROM** : Dans les 6 fonctions recevant `p_tenant_id`, remplace
   `p_tenant_id != current_tenant_id()` par `p_tenant_id IS DISTINCT FROM current_tenant_id()`
   afin de bloquer aussi les appels ou `p_tenant_id` serait NULL.
   Les verifications `auth.uid() IS NULL` et `current_tenant_id() IS NULL` sont conservees.

2. **Jointures tenant renforcees** :
   - `comptabiliser_vente` : ajoute `AND c.tenant_id = s.tenant_id` sur le LEFT JOIN customers
   - `comptabiliser_reglements_clients_en_masse` : ajoute `AND s.tenant_id = sp.tenant_id` sur le JOIN sales
   - `comptabiliser_reglements_fournisseurs_en_masse` : ajoute `AND so.tenant_id = sp.tenant_id` sur le LEFT JOIN supplier_orders
   - `cloturer_exercice` : ajoute `AND jl.tenant_id = je.tenant_id` sur les deux JOIN journal_entries

3. **UPDATE guard** : Dans `comptabiliser_vente`, ajoute `AND tenant_id = v_caller_tenant`
   au UPDATE sales final.

## Fonctions modifiees (7)
- comptabiliser_vente(p_sale_id uuid)
- comptabiliser_ventes_en_masse(p_tenant_id uuid)
- comptabiliser_reglements_clients_en_masse(p_tenant_id uuid)
- comptabiliser_achats_en_masse(p_tenant_id uuid)
- comptabiliser_reglements_fournisseurs_en_masse(p_tenant_id uuid)
- cloturer_journal(p_tenant_id uuid, p_journal_type text, p_date_to date)
- cloturer_exercice(p_tenant_id uuid, p_fiscal_year integer)

## Interdictions respectees
- Aucun changement de logique comptable
- Aucune donnee modifiee
- Aucune modification d'interface, table, RLS, privilege, signature, SECURITY DEFINER, search_path
- Migration basee sur pg_get_functiondef des fonctions actuellement deployees
*/

-- =================================================================
-- 1. comptabiliser_vente(p_sale_id uuid)
--    Changements : LEFT JOIN +tenant, UPDATE +tenant
-- =================================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_vente(p_sale_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_sale RECORD;
v_entry_id uuid;
v_piece_number text;
v_journal text;
v_debit_account text;
v_credit_vente text;
v_credit_tva text;
v_ht numeric;
v_tva numeric;
v_ttc numeric;
v_customer_name text;
v_customer_account text;
v_caller_tenant uuid;
BEGIN
-- C2 tenant guard
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;
v_caller_tenant := current_tenant_id();
IF v_caller_tenant IS NULL THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

SELECT s.*, c.name as customer_name
INTO v_sale
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
WHERE s.id = p_sale_id
AND s.tenant_id = v_caller_tenant;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
END IF;

IF v_sale.accounting_status = 'accounted' THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée');
END IF;

IF v_sale.status = 'cancelled' THEN
RETURN jsonb_build_object('success', false, 'error', 'Impossible de comptabiliser une vente annulée');
END IF;

v_ht := v_sale.subtotal - COALESCE(v_sale.discount, 0);
v_tva := COALESCE(v_sale.vat_amount, 0);
v_ttc := v_sale.total;
v_customer_name := COALESCE(v_sale.customer_name, 'Client comptant');

IF v_sale.customer_id IS NOT NULL THEN
v_customer_account := get_or_create_customer_account(v_sale.tenant_id, v_sale.customer_id);
ELSE
v_customer_account := '4110000';
END IF;

IF v_sale.status = 'paid' THEN
v_journal := 'CA';
v_debit_account := '5710000';
ELSE
v_journal := 'VE';
v_debit_account := v_customer_account;
END IF;

v_credit_vente := '7010000';
v_credit_tva := '4457000';

IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable.');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_vente || ' introuvable dans le plan comptable.');
END IF;

v_piece_number := next_accounting_piece_number(v_sale.tenant_id, v_journal);

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_sale.tenant_id, v_piece_number, v_journal, CURRENT_DATE,
v_sale.sale_number,
'Vente ' || v_sale.sale_number || ' - ' || v_customer_name,
v_ttc, v_ttc, true,
'sale', p_sale_id, 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
VALUES (
v_sale.tenant_id, v_entry_id, v_debit_account,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account LIMIT 1),
v_ttc, 0,
'Vente ' || v_sale.sale_number || ' ' || v_customer_name,
v_sale.customer_id
);

IF v_ht > 0 THEN
INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES (
v_sale.tenant_id, v_entry_id, v_credit_vente,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente LIMIT 1),
0, v_ht,
'Vente marchandises ' || v_sale.sale_number
);
END IF;

IF v_tva > 0 THEN
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva) THEN
UPDATE journal_lines SET credit = v_ttc WHERE entry_id = v_entry_id AND account_code = v_credit_vente;
ELSE
INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES (
v_sale.tenant_id, v_entry_id, v_credit_tva,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva LIMIT 1),
0, v_tva,
'TVA collectée ' || v_sale.sale_number
);
END IF;
END IF;

UPDATE sales SET
accounting_status = 'accounted',
accounting_entry_id = v_entry_id,
accounted_at = now()
WHERE id = p_sale_id
AND tenant_id = v_caller_tenant;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', v_journal,
'total', v_ttc
);
END;
$function$;


-- =================================================================
-- 2. comptabiliser_ventes_en_masse(p_tenant_id uuid)
--    Changement : != -> IS DISTINCT FROM
-- =================================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_ventes_en_masse(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_sale RECORD;
v_result jsonb;
v_success int := 0;
v_errors int := 0;
v_error_messages jsonb[] := '{}';
BEGIN
-- C2 tenant guard
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

FOR v_sale IN
SELECT id, sale_number FROM sales
WHERE tenant_id = p_tenant_id
AND accounting_status = 'not_accounted'
AND status != 'cancelled'
ORDER BY created_at
LOOP
v_result := comptabiliser_vente(v_sale.id);
IF (v_result->>'success')::boolean THEN
v_success := v_success + 1;
ELSE
v_errors := v_errors + 1;
v_error_messages := array_append(v_error_messages, jsonb_build_object('sale', v_sale.sale_number, 'error', v_result->>'error'));
END IF;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'accounted', v_success,
'errors', v_errors,
'error_details', to_jsonb(v_error_messages)
);
END;
$function$;


-- =================================================================
-- 3. comptabiliser_reglements_clients_en_masse(p_tenant_id uuid)
--    Changements : != -> IS DISTINCT FROM, JOIN +tenant
-- =================================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglements_clients_en_masse(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_pay RECORD;
v_result jsonb;
v_success int := 0;
v_errors int := 0;
v_error_messages jsonb[] := '{}';
BEGIN
-- C2 tenant guard
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

FOR v_pay IN
SELECT sp.id, s.sale_number
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND s.accounting_status = 'accounted'
ORDER BY sp.created_at
LOOP
v_result := comptabiliser_reglement(v_pay.id);
IF (v_result->>'success')::boolean THEN
v_success := v_success + 1;
ELSE
v_errors := v_errors + 1;
v_error_messages := array_append(v_error_messages, jsonb_build_object('sale', v_pay.sale_number, 'error', v_result->>'error'));
END IF;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'accounted', v_success,
'errors', v_errors,
'error_details', to_jsonb(v_error_messages)
);
END;
$function$;


-- =================================================================
-- 4. comptabiliser_achats_en_masse(p_tenant_id uuid)
--    Changement : != -> IS DISTINCT FROM
-- =================================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_achats_en_masse(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_order RECORD;
v_result jsonb;
v_success int := 0;
v_errors int := 0;
v_error_messages jsonb[] := '{}';
BEGIN
-- C2 tenant guard
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

FOR v_order IN
SELECT id, order_number FROM supplier_orders
WHERE tenant_id = p_tenant_id
AND (accounting_status = 'not_accounted' OR accounting_status IS NULL)
AND status = 'received'
ORDER BY created_at
LOOP
v_result := comptabiliser_achat(v_order.id);
IF (v_result->>'success')::boolean THEN
v_success := v_success + 1;
ELSE
v_errors := v_errors + 1;
v_error_messages := array_append(v_error_messages, jsonb_build_object('order', v_order.order_number, 'error', v_result->>'error'));
END IF;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'accounted', v_success,
'errors', v_errors,
'error_details', to_jsonb(v_error_messages)
);
END;
$function$;


-- =================================================================
-- 5. comptabiliser_reglements_fournisseurs_en_masse(p_tenant_id uuid)
--    Changements : != -> IS DISTINCT FROM, LEFT JOIN +tenant
-- =================================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_pay RECORD;
v_result jsonb;
v_success int := 0;
v_errors int := 0;
v_error_messages jsonb[] := '{}';
BEGIN
-- C2 tenant guard
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

FOR v_pay IN
SELECT sp.id, so.order_number
FROM supplier_payments sp
LEFT JOIN supplier_orders so ON so.id = sp.order_id AND so.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
ORDER BY sp.created_at
LOOP
v_result := comptabiliser_reglement_fournisseur(v_pay.id);
IF (v_result->>'success')::boolean THEN
v_success := v_success + 1;
ELSE
v_errors := v_errors + 1;
v_error_messages := array_append(v_error_messages, jsonb_build_object('order', COALESCE(v_pay.order_number, '?'), 'error', v_result->>'error'));
END IF;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'accounted', v_success,
'errors', v_errors,
'error_details', to_jsonb(v_error_messages)
);
END;
$function$;


-- =================================================================
-- 6. cloturer_journal(p_tenant_id uuid, p_journal_type text, p_date_to date)
--    Changement : != -> IS DISTINCT FROM
-- =================================================================
CREATE OR REPLACE FUNCTION public.cloturer_journal(p_tenant_id uuid, p_journal_type text, p_date_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_count int;
BEGIN
-- C2 tenant guard
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

IF EXISTS (
SELECT 1 FROM journal_entries
WHERE tenant_id = p_tenant_id
AND journal_type = p_journal_type
AND entry_date <= p_date_to
AND status = 'posted'
AND is_balanced = false
) THEN
RETURN jsonb_build_object('success', false, 'error', 'Il existe des écritures non équilibrées. Corrigez-les avant de clôturer.');
END IF;

IF EXISTS (
SELECT 1 FROM journal_entries
WHERE tenant_id = p_tenant_id
AND journal_type = p_journal_type
AND entry_date <= p_date_to
AND status = 'draft'
) THEN
RETURN jsonb_build_object('success', false, 'error', 'Il existe des écritures en brouillon. Validez ou supprimez-les avant de clôturer.');
END IF;

UPDATE journal_entries
SET status = 'posted'
WHERE tenant_id = p_tenant_id
AND journal_type = p_journal_type
AND entry_date <= p_date_to
AND status = 'posted';

GET DIAGNOSTICS v_count = ROW_COUNT;

RETURN jsonb_build_object(
'success', true,
'journal', p_journal_type,
'closed_until', p_date_to,
'entries_closed', v_count
);
END;
$function$;


-- =================================================================
-- 7. cloturer_exercice(p_tenant_id uuid, p_fiscal_year integer)
--    Changements : != -> IS DISTINCT FROM, 2x JOIN +tenant
-- =================================================================
CREATE OR REPLACE FUNCTION public.cloturer_exercice(p_tenant_id uuid, p_fiscal_year integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_date_from date;
v_date_to date;
v_total_charges numeric;
v_total_produits numeric;
v_resultat numeric;
v_entry_id uuid;
v_piece_number text;
BEGIN
-- C2 tenant guard
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

v_date_from := make_date(p_fiscal_year, 1, 1);
v_date_to := make_date(p_fiscal_year, 12, 31);

IF EXISTS (
SELECT 1 FROM journal_entries
WHERE tenant_id = p_tenant_id
AND entry_date BETWEEN v_date_from AND v_date_to
AND (status = 'draft' OR is_balanced = false)
) THEN
RETURN jsonb_build_object('success', false, 'error', 'Des écritures en brouillon ou déséquilibrées existent pour cet exercice.');
END IF;

SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0)
INTO v_total_charges
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND jl.tenant_id = je.tenant_id
WHERE je.tenant_id = p_tenant_id AND je.status = 'posted'
AND je.entry_date BETWEEN v_date_from AND v_date_to
AND jl.account_code LIKE '6%';

SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0)
INTO v_total_produits
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND jl.tenant_id = je.tenant_id
WHERE je.tenant_id = p_tenant_id AND je.status = 'posted'
AND je.entry_date BETWEEN v_date_from AND v_date_to
AND jl.account_code LIKE '7%';

v_resultat := v_total_produits - v_total_charges;

v_piece_number := next_accounting_piece_number(p_tenant_id, 'OD');

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, status, posted_at, posted_by
) VALUES (
p_tenant_id, v_piece_number, 'OD', v_date_to,
'CLOTURE-' || p_fiscal_year,
'Clôture exercice ' || p_fiscal_year || ' - Résultat : ' || v_resultat::text || ' FCFA',
ABS(v_resultat), ABS(v_resultat), true,
'closing', 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

IF v_resultat >= 0 THEN
INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES
(p_tenant_id, v_entry_id, '1310000', 'Résultat net', v_resultat, 0, 'Résultat exercice ' || p_fiscal_year),
(p_tenant_id, v_entry_id, '1200000', 'Report à nouveau', 0, v_resultat, 'Affectation résultat ' || p_fiscal_year);
ELSE
INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES
(p_tenant_id, v_entry_id, '1200000', 'Report à nouveau', ABS(v_resultat), 0, 'Perte exercice ' || p_fiscal_year),
(p_tenant_id, v_entry_id, '1390000', 'Résultat net (perte)', 0, ABS(v_resultat), 'Résultat exercice ' || p_fiscal_year);
END IF;

RETURN jsonb_build_object(
'success', true,
'fiscal_year', p_fiscal_year,
'total_charges', v_total_charges,
'total_produits', v_total_produits,
'resultat', v_resultat,
'entry_id', v_entry_id,
'piece_number', v_piece_number
);
END;
$function$;
