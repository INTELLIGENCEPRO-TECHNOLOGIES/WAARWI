/*
# PC1E-B — Replace hardcoded codes in comptabiliser_vente, unify to VE journal

## Summary
Rewrites comptabiliser_vente(uuid) to:
1. Always use journal VE and debit the customer account (never cash 5710000).
   Treasury will be handled exclusively by comptabiliser_reglement().
2. Replace all hardcoded account codes with resolve_account() calls:
   - '4110000' → resolve_account(tenant_id, 'CUSTOMER_CONTROL')
   - '7010000' → resolve_account(tenant_id, 'SALES_GOODS')
   - '4457000' → resolve_account(tenant_id, 'VAT_OUTPUT')
   - '5710000' → REMOVED (no longer used)
3. Use sales.created_at::date as the accounting entry date instead of CURRENT_DATE.
4. Remove the fallback that merges VAT into the sales account if VAT account is absent.
   A missing mapping now raises an error via resolve_account().
5. Preserve all existing guards: C2.1 tenant guard, customer tenant join, UPDATE guard.

## Modified function
- comptabiliser_vente(uuid) — signature, owner, SECURITY DEFINER, search_path unchanged.

## Preserved
- get_or_create_customer_account() call when customer_id is present.
- HT/TVA/TTC calculations, labels, statuses, JSON format.
- All C2.1 tenant isolation guards.

## Security
- Privileges unchanged: postgres, authenticated, service_role = EXECUTE.

## No other objects modified
*/

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
v_debit_account text;
v_credit_vente text;
v_credit_tva text;
v_ht numeric;
v_tva numeric;
v_ttc numeric;
v_customer_name text;
v_customer_account text;
v_caller_tenant uuid;
v_entry_date date;
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

-- Accounting entry date: use actual sale date, fallback to today if NULL
v_entry_date := COALESCE(v_sale.created_at::date, CURRENT_DATE);

-- Resolve customer account
IF v_sale.customer_id IS NOT NULL THEN
v_customer_account := get_or_create_customer_account(v_sale.tenant_id, v_sale.customer_id);
ELSE
BEGIN
  v_customer_account := resolve_account(v_sale.tenant_id, 'CUSTOMER_CONTROL');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Résolution CUSTOMER_CONTROL échouée: ' || SQLERRM);
END;
END IF;

-- Always debit customer account, always journal VE
v_debit_account := v_customer_account;

-- Resolve sales goods account
BEGIN
  v_credit_vente := resolve_account(v_sale.tenant_id, 'SALES_GOODS');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Résolution SALES_GOODS échouée: ' || SQLERRM);
END;

-- Resolve VAT account only when VAT amount > 0
IF v_tva > 0 THEN
BEGIN
  v_credit_tva := resolve_account(v_sale.tenant_id, 'VAT_OUTPUT');
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', 'Résolution VAT_OUTPUT échouée: ' || SQLERRM);
END;
END IF;

-- Verify accounts exist
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable.');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_vente || ' introuvable dans le plan comptable.');
END IF;

v_piece_number := next_accounting_piece_number(v_sale.tenant_id, 'VE');

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_sale.tenant_id, v_piece_number, 'VE', v_entry_date,
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
INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES (
v_sale.tenant_id, v_entry_id, v_credit_tva,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva LIMIT 1),
0, v_tva,
'TVA collectée ' || v_sale.sale_number
);
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
'journal', 'VE',
'total', v_ttc
);
END;
$function$;

-- Restore privileges (authenticated has EXECUTE on this function historically)
REVOKE ALL ON FUNCTION public.comptabiliser_vente(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_vente(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_vente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_vente(uuid) TO service_role;
