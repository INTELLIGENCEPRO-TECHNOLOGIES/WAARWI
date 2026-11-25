-- PROPOSITION À TESTER EN ENVIRONNEMENT ISOLÉ. Ne pas exécuter en production.
-- Corrige la date des futurs achats sans modifier les écritures historiques.
-- Ne couvre pas encore la TVA récupérable. Ne pas déployer avant recette et revue des privilèges.
BEGIN;
CREATE OR REPLACE FUNCTION public.comptabiliser_achat(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_order RECORD;
v_entry_id uuid;
v_piece_number text;
v_supplier_name text;
v_supplier_account text;
v_purchase_account text;
v_fallback_supplier text;
BEGIN
SELECT so.*, sup.name as supplier_name
INTO v_order
FROM supplier_orders so
LEFT JOIN suppliers sup ON sup.id = so.supplier_id AND sup.tenant_id = so.tenant_id
WHERE so.id = p_order_id AND so.tenant_id = public.current_tenant_id()
FOR UPDATE OF so;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Commande fournisseur introuvable');
END IF;

IF auth.uid() IS NULL OR NOT public.current_user_can_manage_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE = '42501';
END IF;
IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_order.tenant_id AND t.enabled_modules ? 'accounting') THEN
  RETURN jsonb_build_object('success', false, 'error', 'Module comptable non activé');
END IF;
IF v_order.status IS DISTINCT FROM 'received' OR v_order.received_date IS NULL OR NOT isfinite(v_order.received_date) OR v_order.received_date > (now() AT TIME ZONE 'Africa/Dakar')::date THEN
  RETURN jsonb_build_object('success', false, 'error', 'Réception complète et date de réception valide obligatoires');
END IF;
-- Le numéroteur historique utilise l’année courante.
IF extract(year FROM v_order.received_date) <> extract(year FROM CURRENT_DATE) THEN
  RETURN jsonb_build_object('success', false, 'error', 'Achat d’un exercice antérieur : numérotation à régulariser');
END IF;
IF v_order.total IS NULL OR v_order.total <= 0 OR v_order.total IN ('NaN'::numeric, 'Infinity'::numeric) OR v_order.total <> round(v_order.total, 2) THEN
  RETURN jsonb_build_object('success', false, 'error', 'Montant d’achat invalide');
END IF;
IF v_order.supplier_id IS NOT NULL AND v_order.supplier_name IS NULL THEN
  RETURN jsonb_build_object('success', false, 'error', 'Fournisseur introuvable dans cette entreprise');
END IF;
IF v_order.accounting_status = 'accounted' OR v_order.accounting_entry_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.tenant_id = v_order.tenant_id AND j.source_type = 'purchase' AND j.source_id = p_order_id) THEN
RETURN jsonb_build_object('success', false, 'error', 'Achat déjà comptabilisé');
END IF;

v_supplier_name := COALESCE(v_order.supplier_name, 'Fournisseur');

-- Resolve purchase account via mapping
BEGIN
v_purchase_account := resolve_account(v_order.tenant_id, 'PURCHASES_GOODS');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution PURCHASES_GOODS échouée: ' || SQLERRM);
END;

-- Get or create supplier auxiliary account
IF v_order.supplier_id IS NOT NULL THEN
v_supplier_account := get_or_create_supplier_account(v_order.tenant_id, v_order.supplier_id);
ELSE
-- Resolve collective supplier control account via mapping
BEGIN
v_fallback_supplier := resolve_account(v_order.tenant_id, 'SUPPLIER_CONTROL');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution SUPPLIER_CONTROL échouée: ' || SQLERRM);
END;
v_supplier_account := v_fallback_supplier;
END IF;

IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_purchase_account AND is_active) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_purchase_account || ' (Achats) introuvable');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_supplier_account AND is_active) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte fournisseur ' || v_supplier_account || ' introuvable');
END IF;

IF v_purchase_account = v_supplier_account THEN
  RETURN jsonb_build_object('success', false, 'error', 'Comptes d’achat et fournisseur identiques');
END IF;
BEGIN
  PERFORM public._assert_accounting_month_open(v_order.tenant_id, date_trunc('month', v_order.received_date)::date);
EXCEPTION WHEN SQLSTATE '55000' THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
v_piece_number := next_accounting_piece_number(v_order.tenant_id, 'AC');

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_order.tenant_id, v_piece_number, 'AC', v_order.received_date,
v_order.order_number,
'Achat ' || v_order.order_number || ' - ' || v_supplier_name,
v_order.total, v_order.total, true,
'purchase', p_order_id, 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
VALUES (
v_order.tenant_id, v_entry_id, v_purchase_account,
(SELECT name FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_purchase_account LIMIT 1),
v_order.total, 0,
'Achat marchandises ' || v_order.order_number,
v_order.supplier_id
);

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
VALUES (
v_order.tenant_id, v_entry_id, v_supplier_account,
(SELECT name FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_supplier_account LIMIT 1),
0, v_order.total,
'Fournisseur ' || v_supplier_name,
v_order.supplier_id
);

UPDATE supplier_orders SET
accounting_status = 'accounted',
accounting_entry_id = v_entry_id
WHERE id = p_order_id AND tenant_id = v_order.tenant_id;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', 'AC',
'total', v_order.total
);
END;
$function$

REVOKE ALL ON FUNCTION public.comptabiliser_achat(uuid) FROM PUBLIC, anon, authenticated;
COMMIT;
