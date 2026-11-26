-- Audit commercial. Pending, not applied. Existing historical discrepancies are not rewritten.
-- A commercial operation may produce one original entry; reversals and purchase_invoice documents are separate types.
CREATE UNIQUE INDEX uq_accounting_commercial_source ON public.journal_entries(tenant_id,source_type,source_id)
 WHERE source_id IS NOT NULL AND source_type IN ('sale','payment','purchase','customer_payment','supplier_payment','sale_return','cash_movement');
CREATE OR REPLACE FUNCTION public.comptabiliser_reglement(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_pay               record;
v_sale              record;
v_pm                record;
v_entry_id          uuid;
v_piece_number      text;
v_journal           text;
v_debit_account     text;
v_customer_account  text;
v_customer_name     text;
v_acct_check        record;
v_cust_acct_check   record;
BEGIN
-- Lock and fetch the payment
SELECT sp.*
INTO v_pay
FROM sale_payments sp
WHERE sp.id = p_payment_id
FOR UPDATE;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Règlement introuvable');
END IF;

-- Skip non-balance-affecting payments (prepayments, avoirs, credit allocations)
IF v_pay.affects_balance IS NOT TRUE THEN
RETURN jsonb_build_object('success', true, 'skipped', true,
'reason', 'affects_balance=false');
END IF;

-- Require confirmed status
IF v_pay.status IS NULL OR v_pay.status <> 'confirmed' THEN
RETURN jsonb_build_object('success', false,
'error', 'Règlement non confirmé (status=' || COALESCE(v_pay.status, 'NULL') || ')');
END IF;

-- Already accounted guard
PERFORM public._bank_reconciliation_access(v_pay.tenant_id,true);
IF v_pay.accounting_entry_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=v_pay.tenant_id AND j.source_type='payment' AND j.source_id=p_payment_id) THEN
 RETURN jsonb_build_object('success',false,'error','Opération déjà liée à une pièce comptable.');
END IF;
IF v_pay.amount IS NULL OR v_pay.amount<=0 OR v_pay.amount IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR round(v_pay.amount,2)<>v_pay.amount THEN RETURN jsonb_build_object('success',false,'error','Montant invalide.');END IF;
IF v_pay.accounting_status = 'accounted' THEN
RETURN jsonb_build_object('success', false, 'error', 'Règlement déjà comptabilisé');
END IF;

IF (v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date IS NULL OR NOT isfinite((v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date) OR (v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date>(now() AT TIME ZONE 'Africa/Dakar')::date OR extract(year FROM (v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date)<>extract(year FROM CURRENT_DATE) THEN
 RETURN jsonb_build_object('success',false,'error','Date hors exercice courant : numérotation à régulariser.');
END IF;
PERFORM public._assert_accounting_month_open(v_pay.tenant_id,date_trunc('month',(v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date)::date);
-- Amount guard
IF COALESCE(v_pay.amount, 0) <= 0 THEN
RETURN jsonb_build_object('success', false, 'error', 'Montant du règlement invalide');
END IF;

-- Fetch and validate the sale (same tenant)
SELECT s.*
INTO v_sale
FROM sales s
WHERE s.id = v_pay.sale_id AND s.tenant_id = v_pay.tenant_id;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false,
'error', 'Vente introuvable ou tenant incohérent');
END IF;

-- Reject cancelled or deleted sales
IF v_sale.status IN ('cancelled','deleted') OR v_sale.accounting_status IS DISTINCT FROM 'accounted' THEN
RETURN jsonb_build_object('success', false,
'error', 'Vente annulée, comptabilisation refusée');
END IF;
IF v_sale.deleted_at IS NOT NULL THEN
RETURN jsonb_build_object('success', false,
'error', 'Vente supprimée, comptabilisation refusée');
END IF;

-- Overpaid sale guard
IF round(v_sale.paid, 2) > round(v_sale.total, 2) THEN
RETURN jsonb_build_object('success', false,
'error', 'Vente en trop-perçu (paid > total), correction requise',
'sale_number', v_sale.sale_number);
END IF;

-- Fetch payment method (same tenant) with account_code
SELECT pm.*
INTO v_pm
FROM payment_methods pm
WHERE pm.id = v_pay.payment_method_id AND pm.tenant_id = v_pay.tenant_id;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error',
'Mode de paiement introuvable pour ce tenant');
END IF;

-- Whitelist payment_type: cash→CA, bank/mobile/card/check→BQ
IF v_pm.payment_type = 'cash' THEN
v_journal := 'CA';
ELSIF v_pm.payment_type IN ('bank', 'mobile', 'card', 'check') THEN
v_journal := 'BQ';
ELSE
RETURN jsonb_build_object('success', false, 'error',
'Type de paiement non autorisé pour comptabilisation: '
|| COALESCE(v_pm.payment_type, 'NULL'));
END IF;

IF v_pm.account_code IS NULL OR v_pm.account_code = '' THEN
RETURN jsonb_build_object('success', false, 'error',
'Mode de paiement sans code comptable configuré: ' || COALESCE(v_pm.name, ''));
END IF;

-- Verify the treasury account exists and is active in the same tenant
SELECT a.code, a.name, a.is_active
INTO v_acct_check
FROM accounts a
WHERE a.tenant_id = v_pay.tenant_id AND a.code = v_pm.account_code;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error',
'Compte de trésorerie ' || v_pm.account_code || ' introuvable pour ce tenant');
END IF;
IF v_acct_check.is_active IS NOT TRUE THEN
RETURN jsonb_build_object('success', false, 'error',
'Compte de trésorerie ' || v_pm.account_code || ' inactif');
END IF;

v_debit_account := v_pm.account_code;

-- Customer account: auxiliary if customer exists, otherwise CUSTOMER_CONTROL via resolve_account
IF v_sale.customer_id IS NOT NULL THEN
BEGIN
v_customer_account := get_or_create_customer_account(v_pay.tenant_id, v_sale.customer_id);
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error',
'Erreur création compte auxiliaire client: ' || SQLERRM);
END;
ELSE
BEGIN
v_customer_account := resolve_account(v_pay.tenant_id, 'CUSTOMER_CONTROL');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error',
'Erreur résolution CUSTOMER_CONTROL: ' || SQLERRM);
END;
END IF;

-- Verify customer account exists AND is active
SELECT a.code, a.is_active
INTO v_cust_acct_check
FROM accounts a
WHERE a.tenant_id = v_pay.tenant_id AND a.code = v_customer_account;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error',
'Compte client ' || v_customer_account || ' introuvable');
END IF;
IF v_cust_acct_check.is_active IS NOT TRUE THEN
RETURN jsonb_build_object('success', false, 'error',
'Compte client ' || v_customer_account || ' inactif');
END IF;

-- Customer name for description
SELECT COALESCE(c.name, 'Client comptant')
INTO v_customer_name
FROM customers c
WHERE c.id = v_sale.customer_id AND c.tenant_id = v_pay.tenant_id;
IF v_customer_name IS NULL THEN
v_customer_name := 'Client comptant';
END IF;

-- Piece number
IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=v_pay.tenant_id AND code=v_debit_account AND is_active AND class=5) OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=v_pay.tenant_id AND code=v_customer_account AND is_active AND class=4) THEN RETURN jsonb_build_object('success',false,'error','Comptes client et trésorerie actifs de classes 4 et 5 requis.');END IF;
v_piece_number := next_accounting_piece_number(v_pay.tenant_id, v_journal);

-- Create journal entry (date = payment created_at, not CURRENT_DATE)
INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_pay.tenant_id, v_piece_number, v_journal,
(v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date,
v_sale.sale_number,
'Règlement ' || v_customer_name || ' - ' || v_sale.sale_number,
v_pay.amount, v_pay.amount, true,
'payment', p_payment_id, 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

-- Debit: Treasury
INSERT INTO journal_lines (
tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
) VALUES (
v_pay.tenant_id, v_entry_id, v_debit_account,
v_acct_check.name,
v_pay.amount, 0,
'Encaissement ' || v_sale.sale_number || ' ' || v_customer_name,
v_sale.customer_id
);

-- Credit: Customer auxiliary
INSERT INTO journal_lines (
tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
) VALUES (
v_pay.tenant_id, v_entry_id, v_customer_account,
(SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_customer_account LIMIT 1),
0, v_pay.amount,
'Règlement ' || v_customer_name,
v_sale.customer_id
);

-- Mark payment as accounted (with tenant filter)
UPDATE sale_payments SET
accounting_status   = 'accounted',
accounting_entry_id = v_entry_id
WHERE id = p_payment_id AND tenant_id = v_pay.tenant_id;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', v_journal,
'total', v_pay.amount
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.comptabiliser_reglement_fournisseur(p_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_sp record; v_supplier_name text; v_supplier_account text; v_pm record;
v_journal text; v_credit_account text; v_vault_account text;
v_order_status text; v_order_acct_status text; v_order_supplier_id uuid;
v_credit_active boolean;
v_entry_id uuid; v_piece_number text; v_entry_date date;
BEGIN
SELECT sp.* INTO v_sp FROM supplier_payments sp WHERE sp.id = p_payment_id FOR UPDATE;
IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Règlement fournisseur introuvable'); END IF;
PERFORM public._bank_reconciliation_access(v_sp.tenant_id,true);
IF v_sp.accounting_entry_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=v_sp.tenant_id AND j.source_type='supplier_payment' AND j.source_id=p_payment_id) THEN
 RETURN jsonb_build_object('success',false,'error','Opération déjà liée à une pièce comptable.');
END IF;
IF v_sp.amount IS NULL OR v_sp.amount<=0 OR v_sp.amount IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR round(v_sp.amount,2)<>v_sp.amount THEN RETURN jsonb_build_object('success',false,'error','Montant invalide.');END IF;
IF v_sp.accounting_status = 'accounted' THEN RETURN jsonb_build_object('success', false, 'error', 'Règlement déjà comptabilisé'); END IF;
IF v_sp.amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Montant invalide (<=0)'); END IF;
IF COALESCE((v_sp.paid_at AT TIME ZONE 'Africa/Dakar')::date,(v_sp.created_at AT TIME ZONE 'Africa/Dakar')::date) IS NULL OR NOT isfinite(COALESCE((v_sp.paid_at AT TIME ZONE 'Africa/Dakar')::date,(v_sp.created_at AT TIME ZONE 'Africa/Dakar')::date)) OR COALESCE((v_sp.paid_at AT TIME ZONE 'Africa/Dakar')::date,(v_sp.created_at AT TIME ZONE 'Africa/Dakar')::date)>(now() AT TIME ZONE 'Africa/Dakar')::date OR extract(year FROM COALESCE((v_sp.paid_at AT TIME ZONE 'Africa/Dakar')::date,(v_sp.created_at AT TIME ZONE 'Africa/Dakar')::date))<>extract(year FROM CURRENT_DATE) THEN
 RETURN jsonb_build_object('success',false,'error','Date hors exercice courant : numérotation à régulariser.');
END IF;
PERFORM public._assert_accounting_month_open(v_sp.tenant_id,date_trunc('month',COALESCE((v_sp.paid_at AT TIME ZONE 'Africa/Dakar')::date,(v_sp.created_at AT TIME ZONE 'Africa/Dakar')::date))::date);
IF v_sp.supplier_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'supplier_id manquant'); END IF;

SELECT s.name INTO v_supplier_name FROM suppliers s WHERE s.id = v_sp.supplier_id AND s.tenant_id = v_sp.tenant_id;
IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Fournisseur introuvable dans le tenant'); END IF;

v_supplier_account := get_or_create_supplier_account(v_sp.tenant_id, v_sp.supplier_id);

IF v_sp.order_id IS NOT NULL THEN
SELECT so.status, so.accounting_status, so.supplier_id
INTO v_order_status, v_order_acct_status, v_order_supplier_id
FROM supplier_orders so WHERE so.id = v_sp.order_id AND so.tenant_id = v_sp.tenant_id;
IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Commande fournisseur liée introuvable'); END IF;
IF v_order_supplier_id IS DISTINCT FROM v_sp.supplier_id THEN
RETURN jsonb_build_object('success', false, 'error', 'Incohérence fournisseur entre règlement et commande');
END IF;
IF v_order_status IN ('cancelled','draft') THEN RETURN jsonb_build_object('success', false, 'error', 'Commande annulée ou brouillon'); END IF;
IF v_order_acct_status IS DISTINCT FROM 'accounted' THEN RETURN jsonb_build_object('success', false, 'error', 'Achat lié non encore comptabilisé'); END IF;
END IF;

IF v_sp.payment_method_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'payment_method_id manquant'); END IF;
SELECT pm.payment_type, pm.account_code, pm.name INTO v_pm
FROM payment_methods pm WHERE pm.id = v_sp.payment_method_id AND pm.tenant_id = v_sp.tenant_id;
IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Mode de paiement introuvable dans le tenant'); END IF;

IF v_sp.funding_source = 'vault' THEN
SELECT NULLIF(TRIM(v.account_code),'') INTO v_vault_account
FROM vaults v WHERE v.id = v_sp.vault_id AND v.tenant_id = v_sp.tenant_id;
IF v_vault_account IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Compte coffre non configuré'); END IF;
IF v_sp.vault_movement_id IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'vault_movement_id manquant');
END IF;
IF NOT EXISTS (
SELECT 1 FROM vault_movements vm
WHERE vm.id = v_sp.vault_movement_id AND vm.tenant_id = v_sp.tenant_id
AND vm.vault_id IS NOT DISTINCT FROM v_sp.vault_id
AND vm.supplier_id IS NOT DISTINCT FROM v_sp.supplier_id
AND vm.site_id IS NOT DISTINCT FROM v_sp.site_id
AND vm.direction = 'out'
AND vm.kind = 'supplier_payment'
AND vm.amount = v_sp.amount
) THEN
RETURN jsonb_build_object('success', false, 'error', 'Mouvement coffre incohérent (vault/supplier/site/direction/kind)');
END IF;
v_journal := 'CA';
v_credit_account := v_vault_account;
ELSE
CASE v_pm.payment_type
WHEN 'cash' THEN v_journal := 'CA';
WHEN 'bank' THEN v_journal := 'BQ';
WHEN 'mobile' THEN v_journal := 'BQ';
WHEN 'card' THEN v_journal := 'BQ';
WHEN 'check' THEN v_journal := 'BQ';
ELSE RETURN jsonb_build_object('success', false, 'error', 'Type paiement non pris en charge: ' || COALESCE(v_pm.payment_type,'NULL'));
END CASE;
v_credit_account := v_pm.account_code;
IF v_credit_account IS NULL OR TRIM(v_credit_account) = '' THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte trésorerie non configuré sur le mode de paiement');
END IF;
END IF;

SELECT a.is_active INTO v_credit_active FROM accounts a WHERE a.tenant_id = v_sp.tenant_id AND a.code = v_credit_account;
IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' introuvable dans le plan comptable'); END IF;
IF v_credit_active IS DISTINCT FROM true THEN RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' inactif'); END IF;

v_entry_date := COALESCE((v_sp.paid_at AT TIME ZONE 'Africa/Dakar')::date,(v_sp.created_at AT TIME ZONE 'Africa/Dakar')::date);
IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=v_sp.tenant_id AND code=v_credit_account AND is_active AND class=5) OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=v_sp.tenant_id AND code=v_supplier_account AND is_active AND class=4) THEN RETURN jsonb_build_object('success',false,'error','Comptes fournisseur et trésorerie actifs de classes 4 et 5 requis.');END IF;
v_piece_number := next_accounting_piece_number(v_sp.tenant_id, v_journal);

INSERT INTO journal_entries (tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by)
VALUES (v_sp.tenant_id, v_piece_number, v_journal, v_entry_date,
COALESCE((SELECT order_number FROM supplier_orders WHERE id = v_sp.order_id AND tenant_id = v_sp.tenant_id),''),
'Règlement fournisseur ' || COALESCE(v_supplier_name,'Fournisseur'),
v_sp.amount, v_sp.amount, true, 'supplier_payment', p_payment_id, 'posted', now(), auth.uid())
RETURNING id INTO v_entry_id;

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
VALUES (v_sp.tenant_id, v_entry_id, v_supplier_account,
(SELECT name FROM accounts WHERE tenant_id = v_sp.tenant_id AND code = v_supplier_account LIMIT 1),
v_sp.amount, 0, 'Règlement ' || COALESCE(v_supplier_name,'Fournisseur'), v_sp.supplier_id);

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
VALUES (v_sp.tenant_id, v_entry_id, v_credit_account,
(SELECT name FROM accounts WHERE tenant_id = v_sp.tenant_id AND code = v_credit_account LIMIT 1),
0, v_sp.amount, 'Décaissement ' || COALESCE(v_supplier_name,'Fournisseur'), v_sp.supplier_id);

UPDATE supplier_payments SET accounting_status = 'accounted', accounting_entry_id = v_entry_id
WHERE id = p_payment_id AND tenant_id = v_sp.tenant_id;

RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id, 'piece_number', v_piece_number, 'journal', v_journal, 'total', v_sp.amount);
END;
$function$;

CREATE OR REPLACE FUNCTION public.comptabiliser_reglement_solde_client(p_customer_payment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_cp               record;
v_pm               record;
v_entry_id          uuid;
v_piece_number      text;
v_journal           text;
v_debit_account     text;
v_customer_account  text;
v_customer_name     text;
v_acct_check        record;
v_cust_acct_check   record;
v_caller_tenant     uuid;
BEGIN
-- Tenant guard: only callable internally (from en_masse which already validated tenant)
-- But add explicit check anyway
v_caller_tenant := current_tenant_id();

SELECT cp.* INTO v_cp FROM customer_payments cp
WHERE cp.id = p_customer_payment_id FOR UPDATE;
IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Règlement solde introuvable');
END IF;

-- Verify tenant ownership
IF v_caller_tenant IS NOT NULL AND v_cp.tenant_id IS DISTINCT FROM v_caller_tenant THEN
RETURN jsonb_build_object('success', false, 'error', 'Règlement hors tenant courant');
END IF;

IF v_cp.status IS DISTINCT FROM 'confirmed' THEN
RETURN jsonb_build_object('success', false,
'error', 'Règlement solde non confirmé (status=' || COALESCE(v_cp.status, 'NULL') || ')');
END IF;
PERFORM public._bank_reconciliation_access(v_cp.tenant_id,true);
IF v_cp.accounting_entry_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=v_cp.tenant_id AND j.source_type='customer_payment' AND j.source_id=p_customer_payment_id) THEN
 RETURN jsonb_build_object('success',false,'error','Opération déjà liée à une pièce comptable.');
END IF;
IF v_cp.amount IS NULL OR v_cp.amount<=0 OR v_cp.amount IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR round(v_cp.amount,2)<>v_cp.amount THEN RETURN jsonb_build_object('success',false,'error','Montant invalide.');END IF;
IF v_cp.accounting_status = 'accounted' THEN
RETURN jsonb_build_object('success', false, 'error', 'Déjà comptabilisé');
END IF;
IF COALESCE(v_cp.amount, 0) <= 0 THEN
RETURN jsonb_build_object('success', false, 'error', 'Montant invalide');
END IF;

IF (v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date IS NULL OR NOT isfinite((v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date) OR (v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date>(now() AT TIME ZONE 'Africa/Dakar')::date OR extract(year FROM (v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date)<>extract(year FROM CURRENT_DATE) THEN
 RETURN jsonb_build_object('success',false,'error','Date hors exercice courant : numérotation à régulariser.');
END IF;
PERFORM public._assert_accounting_month_open(v_cp.tenant_id,date_trunc('month',(v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date)::date);
SELECT pm.* INTO v_pm FROM payment_methods pm
WHERE pm.id = v_cp.payment_method_id AND pm.tenant_id = v_cp.tenant_id;
IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Mode de paiement introuvable');
END IF;

IF v_pm.payment_type = 'cash' THEN v_journal := 'CA';
ELSIF v_pm.payment_type IN ('bank', 'mobile', 'card', 'check') THEN v_journal := 'BQ';
ELSE
RETURN jsonb_build_object('success', false, 'error',
'Type de paiement non autorisé: ' || COALESCE(v_pm.payment_type, 'NULL'));
END IF;

IF COALESCE(v_pm.account_code, '') = '' THEN
RETURN jsonb_build_object('success', false, 'error',
'Mode de paiement sans code comptable: ' || COALESCE(v_pm.name, ''));
END IF;

SELECT a.code, a.name, a.is_active INTO v_acct_check
FROM accounts a WHERE a.tenant_id = v_cp.tenant_id AND a.code = v_pm.account_code;
IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error',
'Compte trésorerie ' || v_pm.account_code || ' introuvable');
END IF;
IF v_acct_check.is_active IS NOT TRUE THEN
RETURN jsonb_build_object('success', false, 'error',
'Compte trésorerie ' || v_pm.account_code || ' inactif');
END IF;

v_debit_account := v_pm.account_code;

BEGIN
v_customer_account := get_or_create_customer_account(v_cp.tenant_id, v_cp.customer_id);
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error',
'Erreur compte auxiliaire client: ' || SQLERRM);
END;

SELECT a.code, a.is_active INTO v_cust_acct_check
FROM accounts a WHERE a.tenant_id = v_cp.tenant_id AND a.code = v_customer_account;
IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error',
'Compte client ' || v_customer_account || ' introuvable');
END IF;
IF v_cust_acct_check.is_active IS NOT TRUE THEN
RETURN jsonb_build_object('success', false, 'error',
'Compte client ' || v_customer_account || ' inactif');
END IF;

SELECT COALESCE(c.name, 'Client') INTO v_customer_name
FROM customers c WHERE c.id = v_cp.customer_id AND c.tenant_id = v_cp.tenant_id;

IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=v_cp.tenant_id AND code=v_debit_account AND is_active AND class=5) OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=v_cp.tenant_id AND code=v_customer_account AND is_active AND class=4) THEN RETURN jsonb_build_object('success',false,'error','Comptes client et trésorerie actifs de classes 4 et 5 requis.');END IF;
v_piece_number := next_accounting_piece_number(v_cp.tenant_id, v_journal);

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_cp.tenant_id, v_piece_number, v_journal,
(v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date,
COALESCE(v_cp.reference, ''),
'Règlement solde ' || v_customer_name,
v_cp.amount, v_cp.amount, true,
'customer_payment', p_customer_payment_id, 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

INSERT INTO journal_lines (
tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
) VALUES (
v_cp.tenant_id, v_entry_id, v_debit_account, v_acct_check.name,
v_cp.amount, 0, 'Encaissement solde ' || v_customer_name, v_cp.customer_id
);

INSERT INTO journal_lines (
tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
) VALUES (
v_cp.tenant_id, v_entry_id, v_customer_account,
(SELECT name FROM accounts WHERE tenant_id = v_cp.tenant_id AND code = v_customer_account LIMIT 1),
0, v_cp.amount, 'Règlement solde ' || v_customer_name, v_cp.customer_id
);

UPDATE customer_payments SET
accounting_status = 'accounted',
accounting_entry_id = v_entry_id,
accounted_at = now()
WHERE id = p_customer_payment_id AND tenant_id = v_cp.tenant_id;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', v_journal,
'total', v_cp.amount
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.comptabiliser_reglements_clients_en_masse(p_tenant_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_pay                 record;
v_result              jsonb;
v_success             int := 0;
v_errors              int := 0;
v_skipped_no_bal      int := 0;
v_skipped_overpaid    int := 0;
v_skipped_unconfirmed int := 0;
v_bal_success         int := 0;
v_bal_errors          int := 0;
v_error_messages      jsonb[] := '{}';
BEGIN
IF auth.uid() IS NULL OR current_tenant_id() IS NULL
OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

-- ---- Sale payments (existing logic) ----

SELECT count(*) INTO v_skipped_no_bal
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND s.accounting_status = 'accounted'
AND sp.affects_balance IS NOT TRUE;

SELECT count(*) INTO v_skipped_overpaid
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND s.accounting_status = 'accounted'
AND sp.affects_balance IS TRUE
AND sp.status = 'confirmed'
AND s.status <> 'cancelled'
AND s.deleted_at IS NULL
AND round(s.paid, 2) > round(s.total, 2);

SELECT count(*) INTO v_skipped_unconfirmed
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND s.accounting_status = 'accounted'
AND sp.affects_balance IS TRUE
AND (sp.status IS NULL OR sp.status <> 'confirmed');

FOR v_pay IN
SELECT sp.id, sp.sale_id
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND s.accounting_status = 'accounted'
AND sp.affects_balance IS TRUE
AND sp.status = 'confirmed'
AND s.status <> 'cancelled'
AND s.deleted_at IS NULL
AND round(s.paid, 2) <= round(s.total, 2)
ORDER BY sp.created_at
LOOP
BEGIN
v_result := comptabiliser_reglement(v_pay.id);
IF (v_result->>'success')::boolean THEN
IF (v_result->>'skipped')::boolean IS TRUE THEN
v_skipped_no_bal := v_skipped_no_bal + 1;
ELSE
v_success := v_success + 1;
END IF;
ELSE
v_errors := v_errors + 1;
v_error_messages := array_append(v_error_messages,
jsonb_build_object('payment_id', v_pay.id, 'error', v_result->>'error'));
END IF;
EXCEPTION WHEN OTHERS THEN
v_errors:=v_errors+1;
v_error_messages:=array_append(v_error_messages,jsonb_build_object('payment_id',v_pay.id,'error',SQLERRM));
END;
END LOOP;

-- ---- Customer balance payments (NEW) ----

FOR v_pay IN
SELECT cp.id
FROM customer_payments cp
WHERE cp.tenant_id = p_tenant_id
AND cp.status = 'confirmed'
AND (cp.accounting_status = 'not_accounted' OR cp.accounting_status IS NULL)
ORDER BY cp.created_at
LOOP
BEGIN
v_result := comptabiliser_reglement_solde_client(v_pay.id);
IF (v_result->>'success')::boolean THEN
v_bal_success := v_bal_success + 1;
ELSE
v_bal_errors := v_bal_errors + 1;
v_error_messages := array_append(v_error_messages,
jsonb_build_object('customer_payment_id', v_pay.id, 'error', v_result->>'error'));
END IF;
EXCEPTION WHEN OTHERS THEN
v_bal_errors:=v_bal_errors+1;
v_error_messages:=array_append(v_error_messages,jsonb_build_object('customer_payment_id',v_pay.id,'error',SQLERRM));
END;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'accounted', v_success,
'errors', v_errors,
'skipped_no_balance', v_skipped_no_bal,
'skipped_overpaid', v_skipped_overpaid,
'skipped_unconfirmed', v_skipped_unconfirmed,
'balance_payments_accounted', v_bal_success,
'balance_payments_errors', v_bal_errors,
'error_details', to_jsonb(v_error_messages)
);
END;
$function$;

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

-- PC1F: permission guard
IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

SELECT s.*, c.name as customer_name
INTO v_sale
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
WHERE s.id = p_sale_id
AND s.tenant_id = v_caller_tenant
FOR UPDATE OF s;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
END IF;

PERFORM public._bank_reconciliation_access(v_sale.tenant_id,true);
IF v_sale.accounting_entry_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=v_sale.tenant_id AND j.source_type='sale' AND j.source_id=p_sale_id) THEN
 RETURN jsonb_build_object('success',false,'error','Opération déjà liée à une pièce comptable.');
END IF;
IF v_sale.accounting_status = 'accounted' THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée');
END IF;

IF v_sale.status IN ('cancelled', 'deleted') OR v_sale.deleted_at IS NOT NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Impossible de comptabiliser une vente annulée');
END IF;

v_tva := round(COALESCE(v_sale.vat_amount, 0), 2);
v_ttc := round(v_sale.total, 2);
v_ht := COALESCE(v_sale.vat_net_amount, round(v_sale.subtotal - COALESCE(v_sale.discount, 0), 2));
IF v_ht IS NULL OR v_ttc IS NULL OR v_ht < 0 OR v_tva < 0 OR v_ttc <= 0
   OR v_ttc IN ('NaN'::numeric, 'Infinity'::numeric)
   OR v_ht + v_tva IS DISTINCT FROM v_ttc
   OR (v_sale.vat_enabled_at_issue AND v_sale.vat_net_amount IS NULL) THEN
  RETURN jsonb_build_object('success', false, 'error', 'Les montants HT, TVA et TTC de la vente ne concordent pas.');
END IF;
v_customer_name := COALESCE(v_sale.customer_name, 'Client comptant');

v_entry_date := (v_sale.created_at AT TIME ZONE 'Africa/Dakar')::date;
IF v_entry_date IS NULL OR NOT isfinite(v_entry_date) OR v_entry_date>(now() AT TIME ZONE 'Africa/Dakar')::date OR extract(year FROM v_entry_date)<>extract(year FROM CURRENT_DATE) THEN
 RETURN jsonb_build_object('success',false,'error','Date hors exercice courant : numérotation à régulariser.');
END IF;
PERFORM public._assert_accounting_month_open(v_sale.tenant_id,date_trunc('month',v_entry_date)::date);


IF v_sale.customer_id IS NOT NULL THEN
v_customer_account := get_or_create_customer_account(v_sale.tenant_id, v_sale.customer_id);
ELSE
BEGIN
v_customer_account := resolve_account(v_sale.tenant_id, 'CUSTOMER_CONTROL');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution CUSTOMER_CONTROL échouée: ' || SQLERRM);
END;
END IF;

v_debit_account := v_customer_account;

BEGIN
v_credit_vente := resolve_account(v_sale.tenant_id, 'SALES_GOODS');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution SALES_GOODS échouée: ' || SQLERRM);
END;

IF v_tva > 0 THEN
BEGIN
v_credit_tva := resolve_account(v_sale.tenant_id, 'VAT_OUTPUT');
IF v_sale.vat_enabled_at_issue AND v_credit_tva NOT LIKE '443%' THEN
  RETURN jsonb_build_object('success', false, 'error', 'Associez la TVA facturée à un compte actif de la famille 443.');
END IF;
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution VAT_OUTPUT échouée: ' || SQLERRM);
END;
END IF;

IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account AND is_active AND class=4) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable.');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente AND is_active AND class=7) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_vente || ' introuvable dans le plan comptable.');
END IF;

IF v_tva>0 AND NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=v_sale.tenant_id AND code=v_credit_tva AND is_active AND class=4 AND code LIKE '443%') THEN RETURN jsonb_build_object('success',false,'error','Compte de TVA collectée actif (443) requis.');END IF;
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
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

FOR v_sale IN
SELECT id, sale_number FROM sales
WHERE tenant_id = p_tenant_id
AND accounting_status = 'not_accounted'
AND status != 'cancelled'
ORDER BY created_at
LOOP
BEGIN
v_result := comptabiliser_vente(v_sale.id);
IF (v_result->>'success')::boolean THEN
v_success := v_success + 1;
ELSE
v_errors := v_errors + 1;
v_error_messages := array_append(v_error_messages, jsonb_build_object('sale', v_sale.sale_number, 'error', v_result->>'error'));
END IF;
EXCEPTION WHEN OTHERS THEN
v_errors:=v_errors+1;
v_error_messages:=array_append(v_error_messages,jsonb_build_object('sale',v_sale.sale_number,'error',SQLERRM));
END;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'accounted', v_success,
'errors', v_errors,
'error_details', to_jsonb(v_error_messages)
);
END;
$function$;
-- Preserve original RPC exposure. Internal payment helpers are not client endpoints.
REVOKE ALL ON FUNCTION public.comptabiliser_reglement(uuid),public.comptabiliser_reglement_solde_client(uuid),public.comptabiliser_reglement_fournisseur(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.comptabiliser_vente(uuid),public.comptabiliser_ventes_en_masse(uuid),public.comptabiliser_reglements_clients_en_masse(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_vente(uuid),public.comptabiliser_ventes_en_masse(uuid),public.comptabiliser_reglements_clients_en_masse(uuid) TO authenticated;
