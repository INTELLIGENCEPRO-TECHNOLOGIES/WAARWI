/*
# PC1E-A — Replace hardcoded account codes in comptabiliser_achat and comptabiliser_depense

## Summary
Rewrites two accounting engine functions to use resolve_account() instead of
hardcoded account codes. No logic, structure, or behavior change — only the
source of account codes changes from string literals to the central resolver.

## Modified functions
1. comptabiliser_achat(uuid)
   - '6010000' → resolve_account(tenant_id, 'PURCHASES_GOODS')
   - '4010000' fallback → resolve_account(tenant_id, 'SUPPLIER_CONTROL')
   - get_or_create_supplier_account() call preserved when supplier_id is present

2. comptabiliser_depense(uuid)
   - '6580000' → resolve_account(tenant_id, 'MISC_EXPENSE')
   - '7580000' → resolve_account(tenant_id, 'MISC_INCOME')
   - '5710000' → resolve_account(tenant_id, 'CASH_DEFAULT')
   - Removed fallback '7580000 → 7010000': missing mapping now raises an error
     via resolve_account() instead of silently falling back

## Security
- Both functions remain SECURITY DEFINER with search_path = public.
- Privileges unchanged: postgres + service_role only.
- resolve_account() privileges unchanged.

## No other objects modified
- No tables, data, RLS, mappings, accounts, or other functions touched.
*/

-- 1. Rewrite comptabiliser_achat
CREATE OR REPLACE FUNCTION public.comptabiliser_achat(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
LEFT JOIN suppliers sup ON sup.id = so.supplier_id
WHERE so.id = p_order_id;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Commande fournisseur introuvable');
END IF;

IF v_order.accounting_status = 'accounted' THEN
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

IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_purchase_account) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_purchase_account || ' (Achats) introuvable');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_supplier_account) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte fournisseur ' || v_supplier_account || ' introuvable');
END IF;

v_piece_number := next_accounting_piece_number(v_order.tenant_id, 'AC');

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_order.tenant_id, v_piece_number, 'AC', CURRENT_DATE,
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
WHERE id = p_order_id;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', 'AC',
'total', v_order.total
);
END;
$function$;

-- Restore privileges for comptabiliser_achat
REVOKE ALL ON FUNCTION public.comptabiliser_achat(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_achat(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_achat(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_achat(uuid) TO service_role;


-- 2. Rewrite comptabiliser_depense
CREATE OR REPLACE FUNCTION public.comptabiliser_depense(p_movement_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_mov RECORD;
v_entry_id uuid;
v_piece_number text;
v_journal text;
v_debit_account text;
v_credit_account text;
v_resolved_expense text;
v_resolved_income text;
v_resolved_cash text;
BEGIN
SELECT * INTO v_mov
FROM cash_movements
WHERE id = p_movement_id;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Mouvement introuvable');
END IF;

IF v_mov.accounting_status = 'accounted' THEN
RETURN jsonb_build_object('success', false, 'error', 'Mouvement déjà comptabilisé');
END IF;

-- Resolve the three account codes via mappings
BEGIN
  v_resolved_expense := resolve_account(v_mov.tenant_id, 'MISC_EXPENSE');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Résolution MISC_EXPENSE échouée: ' || SQLERRM);
END;

BEGIN
  v_resolved_income := resolve_account(v_mov.tenant_id, 'MISC_INCOME');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Résolution MISC_INCOME échouée: ' || SQLERRM);
END;

BEGIN
  v_resolved_cash := resolve_account(v_mov.tenant_id, 'CASH_DEFAULT');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Résolution CASH_DEFAULT échouée: ' || SQLERRM);
END;

-- Si le mouvement est une entree (deposit)
IF v_mov.kind = 'deposit' THEN
v_journal := 'CA';
v_debit_account := v_resolved_cash;
v_credit_account := v_resolved_income;
ELSE
-- Sortie de caisse : Debit Charge / Credit Caisse
v_journal := 'CA';
v_debit_account := v_resolved_expense;
v_credit_account := v_resolved_cash;
END IF;

-- 3. Verifier comptes
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_debit_account) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_credit_account) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' introuvable dans le plan comptable');
END IF;

v_piece_number := next_accounting_piece_number(v_mov.tenant_id, v_journal);

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_mov.tenant_id, v_piece_number, v_journal, CURRENT_DATE,
COALESCE(v_mov.reference, ''),
COALESCE(v_mov.reason, 'Mouvement caisse') || CASE WHEN v_mov.note IS NOT NULL AND v_mov.note != '' THEN ' - ' || v_mov.note ELSE '' END,
v_mov.amount, v_mov.amount, true,
'cash_movement', p_movement_id, 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES (
v_mov.tenant_id, v_entry_id, v_debit_account,
(SELECT name FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_debit_account LIMIT 1),
v_mov.amount, 0,
COALESCE(v_mov.reason, 'Mouvement') || CASE WHEN v_mov.note IS NOT NULL AND v_mov.note != '' THEN ' ' || v_mov.note ELSE '' END
);

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES (
v_mov.tenant_id, v_entry_id, v_credit_account,
(SELECT name FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_credit_account LIMIT 1),
0, v_mov.amount,
COALESCE(v_mov.reason, 'Mouvement') || CASE WHEN v_mov.note IS NOT NULL AND v_mov.note != '' THEN ' ' || v_mov.note ELSE '' END
);

UPDATE cash_movements SET
accounting_status = 'accounted',
accounting_entry_id = v_entry_id
WHERE id = p_movement_id;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', v_journal,
'total', v_mov.amount
);
END;
$function$;

-- Restore privileges for comptabiliser_depense
REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_depense(uuid) TO service_role;
