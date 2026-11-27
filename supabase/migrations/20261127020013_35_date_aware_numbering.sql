-- Pending: date-aware numbering; preserve all issued numbers and existing YY format.
CREATE OR REPLACE FUNCTION public.next_accounting_piece_number(p_tenant_id uuid,p_journal_type text,p_entry_date date)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE yr int; prefix text; observed int; nxt int;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_journal_type IS NULL OR p_journal_type !~ '^[A-Z]{2,3}$' OR p_entry_date IS NULL OR NOT isfinite(p_entry_date) OR p_entry_date<date '2000-01-01' OR p_entry_date>date '2099-12-31' OR p_entry_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Journal ou date de numérotation invalide.' USING ERRCODE='22023';END IF;
 PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',p_entry_date)::date);
 yr:=extract(year FROM p_entry_date)::int % 100;
 prefix:=p_journal_type||lpad(yr::text,2,'0');
 SELECT right(j.entry_number,5)::int INTO observed
 FROM public.journal_entries j WHERE j.tenant_id=p_tenant_id AND j.entry_number BETWEEN prefix||'00000' AND prefix||'99999' AND j.entry_number ~ ('^'||prefix||'[0-9]{5}$')
 ORDER BY j.entry_number DESC LIMIT 1;
 observed:=coalesce(observed,0);
 INSERT INTO public.accounting_sequences(tenant_id,journal_type,fiscal_year,last_number)
 VALUES(p_tenant_id,p_journal_type,yr,observed+1)
 ON CONFLICT(tenant_id,journal_type,fiscal_year) DO UPDATE SET last_number=greatest(accounting_sequences.last_number,excluded.last_number-1)+1
 RETURNING last_number INTO nxt;
 IF nxt<1 OR nxt>99999 THEN RAISE EXCEPTION 'Capacité annuelle de numérotation atteinte pour le journal %. Contactez l’administrateur.',p_journal_type USING ERRCODE='22003';END IF;
 RETURN prefix||lpad(nxt::text,5,'0');
END;$$;
REVOKE ALL ON FUNCTION public.next_accounting_piece_number(uuid,text,date) FROM PUBLIC,anon,authenticated;
-- Fail closed if an overlooked caller omits the accounting date.
CREATE OR REPLACE FUNCTION public.next_accounting_piece_number(p_tenant_id uuid,p_journal_type text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Date de pièce obligatoire pour la numérotation.' USING ERRCODE='22023'; END;$$;
REVOKE ALL ON FUNCTION public.next_accounting_piece_number(uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_manual_journal_entry(p_tenant_id uuid, p_journal_type text, p_entry_date date, p_description text, p_reference text DEFAULT ''::text, p_lines jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_entry_id uuid;
v_piece_number text;
v_line jsonb;
v_total_debit numeric := 0;
v_total_credit numeric := 0;
v_line_count int;
v_account_name text;

v_debit_raw text;
v_credit_raw text;
v_debit numeric;
v_credit numeric;
v_idx int := 0;
BEGIN
-- Tenant guard
IF auth.uid() IS NULL OR current_tenant_id() IS NULL
OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

-- Permission guard
IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

-- Validate journal type
PERFORM public._bank_reconciliation_access(p_tenant_id,true);
PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':journal:'||coalesce(p_journal_type,''),0));
IF NOT public._accounting_journal_allowed(p_tenant_id,p_journal_type,true) THEN
RAISE EXCEPTION 'Type de journal invalide: %', coalesce(p_journal_type, 'NULL');
END IF;

-- Validate date and description
IF p_entry_date IS NULL OR NOT isfinite(p_entry_date) OR p_entry_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Date obligatoire et non future.'; END IF;
PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',p_entry_date)::date);
IF p_description IS NULL OR trim(p_description) = '' THEN
RAISE EXCEPTION 'Description obligatoire';
END IF;

-- ====== NEW: p_lines NULL / type / count validation ======
IF p_lines IS NULL THEN
RAISE EXCEPTION 'p_lines ne peut pas etre NULL';
END IF;
IF jsonb_typeof(p_lines) != 'array' THEN
RAISE EXCEPTION 'p_lines doit etre un tableau JSON';
END IF;

v_line_count := jsonb_array_length(p_lines);
IF v_line_count < 2 THEN RAISE EXCEPTION 'Au moins 2 lignes requises'; END IF;
IF v_line_count > 500 THEN RAISE EXCEPTION 'Maximum 500 lignes'; END IF;

-- Lock selected accounts in stable order before validation.
PERFORM 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code IN (SELECT l->>'account_code' FROM jsonb_array_elements(p_lines) l) ORDER BY a.code FOR SHARE;
-- Validate lines and compute totals
FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
v_idx := v_idx + 1;

-- Validate account exists and is active in this tenant
SELECT a.name INTO v_account_name
FROM accounts a
WHERE a.tenant_id = p_tenant_id
AND a.code = v_line->>'account_code'
AND a.is_active = true;

IF NOT FOUND THEN
RAISE EXCEPTION 'Compte % introuvable ou inactif', v_line->>'account_code';
END IF;

-- ====== NEW: strict numeric validation ======
v_debit_raw  := v_line->>'debit';
v_credit_raw := v_line->>'credit';

-- Reject NaN / Infinity / non-numeric strings
BEGIN
v_debit  := coalesce(v_debit_raw::numeric, 0);
EXCEPTION WHEN OTHERS THEN
RAISE EXCEPTION 'Ligne %: debit non numerique: %', v_idx, v_debit_raw;
END;
BEGIN
v_credit := coalesce(v_credit_raw::numeric, 0);
EXCEPTION WHEN OTHERS THEN
RAISE EXCEPTION 'Ligne %: credit non numerique: %', v_idx, v_credit_raw;
END;

-- Reject NaN/Infinity that Postgres accepts as numeric literals
IF v_debit = 'NaN'::numeric OR v_credit = 'NaN'::numeric THEN
RAISE EXCEPTION 'Ligne %: NaN interdit', v_idx;
END IF;
IF v_debit = 'Infinity'::numeric OR v_debit = '-Infinity'::numeric
OR v_credit = 'Infinity'::numeric OR v_credit = '-Infinity'::numeric THEN
RAISE EXCEPTION 'Ligne %: Infinity interdit', v_idx;
END IF;

-- Reject more than 2 decimal places
IF v_debit != round(v_debit, 2) THEN
RAISE EXCEPTION 'Ligne %: debit avec plus de 2 decimales: %', v_idx, v_debit;
END IF;
IF v_credit != round(v_credit, 2) THEN
RAISE EXCEPTION 'Ligne %: credit avec plus de 2 decimales: %', v_idx, v_credit;
END IF;

-- Reject negative
IF v_debit < 0 THEN
RAISE EXCEPTION 'Debit negatif interdit pour compte %', v_line->>'account_code';
END IF;
IF v_credit < 0 THEN
RAISE EXCEPTION 'Credit negatif interdit pour compte %', v_line->>'account_code';
END IF;

-- Require exactly one positive side
IF v_debit = 0 AND v_credit = 0 THEN
RAISE EXCEPTION 'Ligne sans montant pour compte %', v_line->>'account_code';
END IF;
IF v_debit > 0 AND v_credit > 0 THEN
RAISE EXCEPTION 'Debit et credit simultanes interdits pour compte %', v_line->>'account_code';
END IF;

v_total_debit  := v_total_debit + v_debit;
v_total_credit := v_total_credit + v_credit;
END LOOP;

-- Round totals to 2 decimals for comparison
v_total_debit  := round(v_total_debit, 2);
v_total_credit := round(v_total_credit, 2);

-- ====== NEW: total must be strictly positive ======
IF v_total_debit <= 0 THEN
RAISE EXCEPTION 'Le total doit etre strictement positif';
END IF;

-- Balance check (exact comparison after rounding)
IF v_total_debit IS DISTINCT FROM v_total_credit THEN
RAISE EXCEPTION 'Ecriture desequilibree: debit=%, credit=%', v_total_debit, v_total_credit;
END IF;

-- Generate piece number
v_piece_number := next_accounting_piece_number(p_tenant_id, p_journal_type, p_entry_date);

-- Create entry
INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, status, posted_at, posted_by
) VALUES (
p_tenant_id, v_piece_number, p_journal_type, p_entry_date, coalesce(p_reference, ''),
trim(p_description), v_total_debit, v_total_credit, true,
'manual', 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

-- Create lines (account_name read from accounts, never from client)
FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
SELECT a.name INTO v_account_name
FROM accounts a
WHERE a.tenant_id = p_tenant_id AND a.code = v_line->>'account_code';

INSERT INTO journal_lines (
tenant_id, entry_id, account_code, account_name, debit, credit, label
) VALUES (
p_tenant_id, v_entry_id, v_line->>'account_code', v_account_name,
round(coalesce((v_line->>'debit')::numeric, 0), 2),
round(coalesce((v_line->>'credit')::numeric, 0), 2),
coalesce(v_line->>'label', '')
);
END LOOP;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', p_journal_type,
'total', v_total_debit
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reverse_manual_accounting_entry(p_tenant_id uuid, p_entry_id uuid, p_date date, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 o public.journal_entries%ROWTYPE;
 prev public.journal_entries%ROWTYPE;
 v_id uuid; v_piece text; v_d numeric; v_c numeric; v_count int;
 v_reason text:=nullif(btrim(p_reason),'');
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id() OR NOT public.current_user_can_manage_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.enabled_modules ? 'accounting') THEN RAISE EXCEPTION 'Module comptable non activé.' USING ERRCODE='42501'; END IF;
 IF v_reason IS NULL OR length(v_reason)>500 THEN RAISE EXCEPTION 'Motif d’extourne obligatoire (500 caractères maximum).'; END IF;
 SELECT * INTO o FROM public.journal_entries e WHERE e.tenant_id=p_tenant_id AND e.id=p_entry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Écriture introuvable.'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_fixed_assets a LEFT JOIN public.journal_lines l ON l.tenant_id=a.tenant_id AND l.id IN(a.acquisition_line_id,a.sale_line_id) WHERE a.tenant_id=p_tenant_id AND (l.entry_id=o.id OR a.disposal_entry_id=o.id))
 OR EXISTS(SELECT 1 FROM public.accounting_asset_depreciations d WHERE d.tenant_id=p_tenant_id AND d.entry_id=o.id) THEN RAISE EXCEPTION 'Cette pièce est liée au registre des immobilisations. Correction spécialisée requise.';END IF;
 IF o.source_type IS DISTINCT FROM 'manual' OR o.status IS DISTINCT FROM 'posted' THEN
  RAISE EXCEPTION 'Extourne réservée aux écritures manuelles validées. Corrigez les pièces commerciales depuis leur module d’origine.';
 END IF;
 IF p_date IS NULL OR NOT isfinite(p_date) OR p_date<o.entry_date OR p_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Date d’extourne invalide : elle doit être comprise entre la date d’origine et aujourd’hui.'; END IF;
 SELECT * INTO prev FROM public.journal_entries WHERE tenant_id=p_tenant_id AND source_type='reversal' AND source_id=o.id;
 IF FOUND THEN
  IF prev.status='posted' AND prev.entry_date=p_date AND prev.reversal_reason=v_reason THEN
   RETURN jsonb_build_object('success',true,'entry_id',prev.id,'piece_number',prev.entry_number,'already_reversed',true);
  END IF;
  RAISE EXCEPTION 'Cette écriture possède déjà une extourne : %.',prev.entry_number;
 END IF;
 -- Les opérations de lettrage verrouillent également l'écriture parente avant ses lignes.
 PERFORM 1 FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.entry_id=o.id ORDER BY l.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.journal_lines l JOIN public.accounting_match_lines m ON m.tenant_id=l.tenant_id AND m.line_id=l.id AND m.released_at IS NULL WHERE l.tenant_id=p_tenant_id AND l.entry_id=o.id) THEN
  RAISE EXCEPTION 'Délettrez les lignes de cette écriture avant de l’extourner.';
 END IF;
 SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0) INTO v_count,v_d,v_c FROM public.journal_lines WHERE tenant_id=p_tenant_id AND entry_id=o.id;
 IF v_count<2 OR v_d<=0 OR v_d IS DISTINCT FROM v_c OR v_d IS DISTINCT FROM o.total_debit OR v_c IS DISTINCT FROM o.total_credit OR v_d IN ('NaN'::numeric,'Infinity'::numeric) THEN
  RAISE EXCEPTION 'L’écriture d’origine doit être équilibrée et ses totaux cohérents.';
 END IF;
 PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',p_date)::date);
 v_piece:=public.next_accounting_piece_number(p_tenant_id,o.journal_type, p_date);
 INSERT INTO public.journal_entries(tenant_id,entry_number,journal_type,entry_date,reference,description,total_debit,total_credit,is_balanced,source_type,source_id,status,posted_at,posted_by,reversal_reason)
 VALUES(p_tenant_id,v_piece,o.journal_type,p_date,o.entry_number,'Extourne de '||o.entry_number||' : '||v_reason,v_c,v_d,true,'reversal',o.id,'posted',now(),auth.uid(),v_reason)
 RETURNING id INTO v_id;
 INSERT INTO public.journal_lines(tenant_id,entry_id,account_code,account_name,debit,credit,label,third_party_id)
 SELECT p_tenant_id,v_id,l.account_code,l.account_name,l.credit,l.debit,'Extourne : '||coalesce(nullif(l.label,''),o.entry_number),l.third_party_id
 FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.entry_id=o.id ORDER BY l.id;
 RETURN jsonb_build_object('success',true,'entry_id',v_id,'piece_number',v_piece,'original_piece',o.entry_number,'total',v_d);
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
IF v_entry_date IS NULL OR NOT isfinite(v_entry_date) OR v_entry_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN
 RETURN jsonb_build_object('success',false,'error','Date comptable invalide ou future.');
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
v_piece_number := next_accounting_piece_number(v_sale.tenant_id, 'VE', v_entry_date);

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

IF (v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date IS NULL OR NOT isfinite((v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date) OR (v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN
 RETURN jsonb_build_object('success',false,'error','Date comptable invalide ou future.');
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
v_piece_number := next_accounting_piece_number(v_pay.tenant_id, v_journal, (v_pay.created_at AT TIME ZONE 'Africa/Dakar')::date);

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

IF (v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date IS NULL OR NOT isfinite((v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date) OR (v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN
 RETURN jsonb_build_object('success',false,'error','Date comptable invalide ou future.');
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
v_piece_number := next_accounting_piece_number(v_cp.tenant_id, v_journal, (v_cp.created_at AT TIME ZONE 'Africa/Dakar')::date);

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
IF COALESCE((v_sp.paid_at AT TIME ZONE 'Africa/Dakar')::date,(v_sp.created_at AT TIME ZONE 'Africa/Dakar')::date) IS NULL OR NOT isfinite(COALESCE((v_sp.paid_at AT TIME ZONE 'Africa/Dakar')::date,(v_sp.created_at AT TIME ZONE 'Africa/Dakar')::date)) OR COALESCE((v_sp.paid_at AT TIME ZONE 'Africa/Dakar')::date,(v_sp.created_at AT TIME ZONE 'Africa/Dakar')::date)>(now() AT TIME ZONE 'Africa/Dakar')::date THEN
 RETURN jsonb_build_object('success',false,'error','Date comptable invalide ou future.');
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
v_piece_number := next_accounting_piece_number(v_sp.tenant_id, v_journal, v_entry_date);

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

CREATE OR REPLACE FUNCTION public._cash_accounting_decision(p_movement cash_movements)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
DECLARE
  m public.cash_movements := p_movement;
  v_decision jsonb;
  v_source_type text := 'cash_movement';
  v_source_id uuid := m.id;
  v_candidates uuid[];
  v_entries uuid[];
  v_entry public.journal_entries;
  v_vault_code text;
  v_treasury_code text;
  v_payment_type text;
  v_debit text;
  v_credit text;
  v_journal text;
  v_operation_date date := (m.created_at AT TIME ZONE 'UTC')::date;
BEGIN
  v_decision := jsonb_build_object('amount', m.amount, 'date', v_operation_date);

  IF m.accounting_status = 'excluded' OR m.supplier_id IS NOT NULL THEN
    RETURN v_decision || jsonb_build_object('action', 'excluded', 'reason', 'Règlement à traiter via les règlements fournisseurs ou mouvement déjà exclu.');
  END IF;

  IF m.amount IS NULL OR m.amount <= 0 OR m.amount IN ('NaN'::numeric, 'Infinity'::numeric)
     OR round(m.amount,2)<>m.amount OR m.created_at IS NULL OR NOT isfinite(m.created_at) THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Montant ou date de mouvement invalide.');
  END IF;

  IF m.kind = 'income' THEN
    SELECT ARRAY(SELECT cp.id FROM public.customer_payments cp
      WHERE cp.tenant_id = m.tenant_id AND cp.cash_movement_id = m.id
      LIMIT 2) INTO v_candidates;

    IF cardinality(v_candidates) > 0 THEN
      IF cardinality(v_candidates) <> 1 OR NOT EXISTS (
        SELECT 1 FROM public.customer_payments cp
        WHERE cp.id = v_candidates[1] AND cp.tenant_id = m.tenant_id
          AND cp.customer_id = m.customer_id AND cp.amount = m.amount AND cp.status = 'confirmed'
      ) THEN
        RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Lien avec le règlement client ambigu ou incohérent.');
      END IF;
      v_source_type := 'customer_payment';
      v_source_id := v_candidates[1];

    ELSIF m.reason LIKE 'Règlement %' AND m.reason NOT LIKE 'Règlement solde%'
        AND m.reason NOT LIKE 'Règlement report de solde%' THEN
      -- The legacy POS wrote both rows in the same transaction. The same day
      -- alone is ambiguous when a customer made two identical instalments.
      SELECT ARRAY(
        SELECT sp.id
        FROM public.sales s
        JOIN public.sale_payments sp ON sp.sale_id = s.id AND sp.tenant_id = s.tenant_id
        WHERE s.tenant_id = m.tenant_id AND s.sale_number = m.reference
          AND m.reason = 'Règlement ' || s.sale_number
          AND s.customer_id IS NOT DISTINCT FROM m.customer_id
          AND sp.cash_session_id = m.cash_session_id AND sp.payment_method_id = m.payment_method_id
          AND sp.amount = m.amount AND sp.created_at = m.created_at
        LIMIT 2
      ) INTO v_candidates;

      IF cardinality(v_candidates) <> 1 THEN
        RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Règlement de facture à rapprocher manuellement.');
      END IF;
      v_source_type := 'payment';
      v_source_id := v_candidates[1];
    END IF;
  END IF;

  IF m.kind IN ('vault_deposit', 'vault_withdrawal') THEN
    SELECT NULLIF(btrim(v.account_code), '') INTO v_vault_code
    FROM public.vault_movements vm
    JOIN public.vaults v ON v.id = vm.vault_id AND v.tenant_id = vm.tenant_id AND v.site_id = vm.site_id
    WHERE vm.id = m.vault_movement_id AND vm.tenant_id = m.tenant_id AND vm.site_id = m.site_id
      AND vm.cash_session_id = m.cash_session_id AND vm.amount = m.amount
      AND vm.kind = CASE WHEN m.kind = 'vault_deposit' THEN 'cash_deposit' ELSE 'cash_withdrawal' END
      AND vm.direction = CASE WHEN m.kind = 'vault_deposit' THEN 'in' ELSE 'out' END;
    IF NOT FOUND OR EXISTS (
      SELECT 1 FROM public.cash_movements other
      WHERE other.tenant_id = m.tenant_id AND other.vault_movement_id = m.vault_movement_id AND other.id <> m.id
    ) THEN
      RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Contrepartie du coffre manquante, incohérente ou déjà associée à un autre mouvement.');
    END IF;
    v_source_type := 'vault_movement';
    v_source_id := m.vault_movement_id;
  END IF;

  -- A journal source may exist even when the movement or payment status is stale.
  SELECT ARRAY(
    SELECT j.id FROM public.journal_entries j
    WHERE j.tenant_id = m.tenant_id AND (
      (j.source_type = v_source_type AND j.source_id = v_source_id)
      OR (j.source_type = 'cash_movement' AND j.source_id = m.id)
    )
    LIMIT 2
  ) INTO v_entries;

  IF cardinality(v_entries) > 1 THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Plusieurs écritures existent pour cette opération.');
  ELSIF cardinality(v_entries) = 1 THEN
    SELECT * INTO v_entry FROM public.journal_entries WHERE tenant_id = m.tenant_id AND id = v_entries[1];
    IF v_entry.status IS DISTINCT FROM 'posted'
       OR v_entry.is_balanced IS DISTINCT FROM true
       OR v_entry.total_debit IS DISTINCT FROM m.amount OR v_entry.total_credit IS DISTINCT FROM m.amount
       OR (m.accounting_entry_id IS NOT NULL AND m.accounting_entry_id <> v_entry.id)
       OR (v_source_type IN ('payment', 'customer_payment') AND v_entry.source_type <> v_source_type)
       OR EXISTS (
         SELECT 1 FROM public.cash_movements other
         WHERE other.tenant_id = m.tenant_id AND other.accounting_entry_id = v_entry.id AND other.id <> m.id
       )
       OR NOT EXISTS (
         SELECT FROM public.journal_lines jl WHERE jl.tenant_id = m.tenant_id AND jl.entry_id = v_entry.id
         HAVING sum(jl.debit) = m.amount AND sum(jl.credit) = m.amount
       ) THEN
      RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'L’écriture existante doit être vérifiée.');
    END IF;
    RETURN v_decision || jsonb_build_object('action', 'link', 'entry_id', v_entry.id, 'entry_number', v_entry.entry_number);
  ELSIF m.accounting_entry_id IS NOT NULL OR m.accounting_status = 'accounted' THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Le lien comptable actuel est incohérent.');
  END IF;

  IF v_source_type IN ('payment', 'customer_payment') THEN
    -- Keep the existing client payment RPCs responsible for the accounts and
    -- eligibility of their source. The cash operation only links that entry.
    RETURN v_decision || jsonb_build_object('action', 'post_payment',
      'source_type', v_source_type, 'source_id', v_source_id);
  END IF;

  IF m.kind NOT IN ('income', 'expense', 'vault_deposit', 'vault_withdrawal')
     OR m.customer_id IS NOT NULL OR m.sale_return_id IS NOT NULL
     OR (m.kind = 'income' AND m.reason LIKE 'Règlement%')
     OR (m.kind IN ('income', 'expense') AND m.vault_movement_id IS NOT NULL) THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Contrepartie à vérifier à partir de la pièce d’origine.');
  END IF;

  SELECT NULLIF(btrim(pm.account_code), ''), pm.payment_type INTO v_treasury_code, v_payment_type
  FROM public.payment_methods pm
  JOIN public.accounts a ON a.tenant_id = pm.tenant_id AND a.code = btrim(pm.account_code)
    AND a.is_active AND a.class = 5
  WHERE pm.id = m.payment_method_id AND pm.tenant_id = m.tenant_id;

  IF v_treasury_code IS NULL OR v_payment_type IS NULL
     OR v_payment_type NOT IN ('cash', 'bank', 'mobile', 'card', 'check')
     OR (v_source_type = 'vault_movement' AND v_payment_type <> 'cash') THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Compte de trésorerie actif à renseigner sur le mode de paiement.');
  END IF;

  v_journal := CASE WHEN v_payment_type = 'cash' THEN 'CA' ELSE 'BQ' END;
  IF v_source_type = 'vault_movement' THEN
    IF v_vault_code IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.accounts a WHERE a.tenant_id = m.tenant_id AND a.code = v_vault_code AND a.is_active AND a.class = 5
    ) THEN
      RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Compte comptable du coffre à renseigner.');
    END IF;
    IF m.kind = 'vault_deposit' THEN
      v_debit := v_vault_code;
      v_credit := v_treasury_code;
    ELSE
      v_debit := v_treasury_code;
      v_credit := v_vault_code;
    END IF;
  ELSE
    BEGIN
      IF m.kind = 'income' THEN
        v_debit := v_treasury_code;
        v_credit := public.resolve_account(m.tenant_id, 'MISC_INCOME');
      ELSE
        v_debit := public.resolve_account(m.tenant_id, 'MISC_EXPENSE');
        v_credit := v_treasury_code;
      END IF;
    EXCEPTION WHEN raise_exception THEN
      RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Compte de contrepartie à renseigner dans le plan comptable.');
    END;
  END IF;

  IF v_operation_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN
    RETURN v_decision||jsonb_build_object('action','review','reason','Date comptable future.');
  END IF;
  IF v_source_type='cash_movement' AND (
    (m.kind='income' AND NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.tenant_id=m.tenant_id AND a.code=v_credit AND a.is_active AND a.class=7))
    OR (m.kind='expense' AND NOT EXISTS(SELECT 1 FROM public.accounts a WHERE a.tenant_id=m.tenant_id AND a.code=v_debit AND a.is_active AND a.class=6))
  ) THEN RETURN v_decision||jsonb_build_object('action','review','reason','Contrepartie de charge ou de produit active requise.');END IF;
  IF v_debit = v_credit THEN
    RETURN v_decision || jsonb_build_object('action', 'review', 'reason', 'Les comptes de débit et de crédit doivent être distincts.');
  END IF;
  RETURN v_decision || jsonb_build_object('action', 'post', 'source_type', v_source_type, 'source_id', v_source_id,
    'journal', v_journal, 'debit_account', v_debit, 'credit_account', v_credit);
END;
$function$;

CREATE OR REPLACE FUNCTION public._apply_cash_accounting(p_tenant_id uuid, p_movement_id uuid, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  m public.cash_movements;
  v_decision jsonb;
  v_entry_id uuid;
  v_piece text;
  v_label text;
  v_payment_result jsonb;
  v_payment_link jsonb;
BEGIN
  SELECT * INTO m FROM public.cash_movements cm
  WHERE cm.id = p_movement_id AND (p_tenant_id IS NULL OR cm.tenant_id = p_tenant_id)
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mouvement de caisse introuvable.');
  END IF;

  -- Competing transfers for the same vault movement must serialize.
  IF m.vault_movement_id IS NOT NULL THEN
    PERFORM 1 FROM public.vault_movements vm
    WHERE vm.id = m.vault_movement_id AND vm.tenant_id = m.tenant_id FOR UPDATE;
  END IF;
  v_decision := public._cash_accounting_decision(m);

  IF m.accounting_status = 'accounted' AND v_decision->>'action' = 'link'
     AND m.accounting_entry_id = (v_decision->>'entry_id')::uuid THEN
    RETURN jsonb_build_object('success', true, 'outcome', 'already_accounted', 'entry_id', m.accounting_entry_id);
  END IF;
  IF p_expected IS NOT NULL AND p_expected IS DISTINCT FROM v_decision THEN
    RETURN jsonb_build_object('success', false, 'error', 'Le mouvement ou sa contrepartie a changé. Actualisez le contrôle.');
  END IF;

  CASE v_decision->>'action'
    WHEN 'excluded' THEN
      RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', v_decision->>'reason');
    WHEN 'link' THEN
      v_entry_id := (v_decision->>'entry_id')::uuid;
      -- An existing entry can cover only one cash movement. Use its row lock
      -- before a second check across cash movements, including legacy matches.
      PERFORM 1 FROM public.journal_entries j
      WHERE j.id = v_entry_id AND j.tenant_id = m.tenant_id FOR UPDATE;
      IF public._cash_accounting_decision(m) IS DISTINCT FROM v_decision THEN
        RETURN jsonb_build_object('success', false, 'error', 'L’écriture a changé. Actualisez le contrôle.');
      END IF;
    WHEN 'post_payment' THEN
      BEGIN
        IF v_decision->>'source_type' = 'payment' THEN
          v_payment_result := public.comptabiliser_reglement((v_decision->>'source_id')::uuid);
        ELSE
          v_payment_result := public.comptabiliser_reglement_solde_client((v_decision->>'source_id')::uuid);
        END IF;
        v_payment_link := public._cash_accounting_decision(m);
        IF v_payment_link->>'action' IS DISTINCT FROM 'link' THEN
          RAISE EXCEPTION '%', COALESCE(v_payment_result->>'error', 'Le règlement ne peut pas être comptabilisé.');
        END IF;
        v_entry_id := (v_payment_link->>'entry_id')::uuid;
        v_piece := v_payment_link->>'entry_number';
        PERFORM 1 FROM public.journal_entries j WHERE j.id = v_entry_id AND j.tenant_id = m.tenant_id FOR UPDATE;
        IF public._cash_accounting_decision(m) IS DISTINCT FROM v_payment_link THEN
          RAISE EXCEPTION 'L’écriture a changé. Actualisez le contrôle.';
        END IF;
      EXCEPTION WHEN raise_exception THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
      END;
    WHEN 'post' THEN
      v_piece := public.next_accounting_piece_number(m.tenant_id, v_decision->>'journal', (v_decision->>'date')::date);
      v_label := COALESCE(NULLIF(m.reason, ''), 'Mouvement de caisse');
      INSERT INTO public.journal_entries (tenant_id, entry_number, journal_type, entry_date, reference,
        description, total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by)
      VALUES (m.tenant_id, v_piece, v_decision->>'journal', (v_decision->>'date')::date,
        COALESCE(m.reference, ''), v_label, m.amount, m.amount, true,
        v_decision->>'source_type', (v_decision->>'source_id')::uuid, 'posted', now(), auth.uid())
      RETURNING id INTO v_entry_id;

      INSERT INTO public.journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
      SELECT m.tenant_id, v_entry_id, a.code, a.name, line.debit, line.credit, v_label
      FROM (VALUES (v_decision->>'debit_account', m.amount, 0::numeric),
                   (v_decision->>'credit_account', 0::numeric, m.amount)) AS line(code, debit, credit)
      JOIN public.accounts a ON a.tenant_id = m.tenant_id AND a.code = line.code AND a.is_active;
      IF NOT FOUND OR (SELECT count(*) FROM public.journal_lines jl WHERE jl.entry_id = v_entry_id AND jl.tenant_id = m.tenant_id) <> 2 THEN
        RAISE EXCEPTION 'Un compte a changé pendant la comptabilisation. Actualisez le contrôle.';
      END IF;
    ELSE
      RETURN jsonb_build_object('success', false, 'error', v_decision->>'reason');
  END CASE;

  UPDATE public.cash_movements SET accounting_status = 'accounted', accounting_entry_id = v_entry_id
  WHERE id = m.id AND tenant_id = m.tenant_id;
  RETURN jsonb_build_object('success', true, 'outcome', v_decision->>'action', 'entry_id', v_entry_id,
    'piece_number', COALESCE(v_piece, v_decision->>'entry_number'),
    'journal', v_decision->>'journal', 'total', m.amount);
END;
$function$;

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
IF v_order.total IS NULL OR v_order.total <= 0 OR v_order.total IN ('NaN'::numeric, 'Infinity'::numeric) OR v_order.total <> round(v_order.total, 2) THEN
  RETURN jsonb_build_object('success', false, 'error', 'Montant d’achat invalide');
END IF;
IF v_order.supplier_id IS NOT NULL AND v_order.supplier_name IS NULL THEN
  RETURN jsonb_build_object('success', false, 'error', 'Fournisseur introuvable dans cette entreprise');
END IF;
IF v_order.accounting_status = 'accounted' OR v_order.accounting_entry_id IS NOT NULL OR EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.tenant_id = v_order.tenant_id AND j.source_type = 'purchase' AND j.source_id = p_order_id) THEN
RETURN jsonb_build_object('success', false, 'error', 'Achat déjà comptabilisé');
END IF;

-- Verrouiller la période avant de créer des comptes auxiliaires.
BEGIN
  PERFORM public._assert_accounting_month_open(v_order.tenant_id, date_trunc('month', v_order.received_date)::date);
EXCEPTION WHEN SQLSTATE '55000' THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
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

IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_purchase_account AND is_active AND class = 6) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_purchase_account || ' (Achats) introuvable');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_supplier_account AND is_active AND class = 4) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte fournisseur ' || v_supplier_account || ' introuvable');
END IF;

IF v_purchase_account = v_supplier_account THEN
  RETURN jsonb_build_object('success', false, 'error', 'Comptes d’achat et fournisseur identiques');
END IF;
v_piece_number := next_accounting_piece_number(v_order.tenant_id, 'AC', v_order.received_date);

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
$function$;

-- Preserve month row locking and annual closure semantics; validate the boundary itself.
CREATE OR REPLACE FUNCTION public._assert_accounting_month_open(p_tenant_id uuid, p_month_start date)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE v_closed_at timestamptz;
BEGIN
 IF p_tenant_id IS NULL OR p_month_start IS NULL OR NOT isfinite(p_month_start) OR extract(day FROM p_month_start)<>1 OR p_month_start<date '2000-01-01' OR p_month_start>date '2099-12-01' THEN
  RAISE EXCEPTION 'Période comptable invalide.' USING ERRCODE='22023';
 END IF;
 SELECT c.closed_at INTO v_closed_at FROM public.accounting_month_closures c
 WHERE c.tenant_id=p_tenant_id AND c.month_start=p_month_start FOR SHARE;
 IF NOT FOUND THEN
  INSERT INTO public.accounting_month_closures(tenant_id,month_start) VALUES(p_tenant_id,p_month_start) ON CONFLICT(tenant_id,month_start) DO NOTHING;
  SELECT c.closed_at INTO v_closed_at FROM public.accounting_month_closures c WHERE c.tenant_id=p_tenant_id AND c.month_start=p_month_start FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La période a changé pendant la transaction. Réessayez.' USING ERRCODE='40001'; END IF;
 END IF;
 IF v_closed_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year>=extract(year FROM p_month_start)) THEN
  RAISE EXCEPTION 'La période comptable de % est clôturée.',to_char(p_month_start,'MM/YYYY') USING ERRCODE='55000';
 END IF;
END;$function$;
REVOKE ALL ON FUNCTION public._assert_accounting_month_open(uuid,date) FROM PUBLIC,anon,authenticated;
