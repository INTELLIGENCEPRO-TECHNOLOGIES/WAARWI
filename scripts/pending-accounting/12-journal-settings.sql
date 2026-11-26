-- Pending release: no production migration applied.
-- Built-in codes remain reserved and active for automated source posting.
CREATE TABLE public.accounting_journal_settings(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 code text NOT NULL CHECK(code ~ '^[A-Z]{2,3}$'),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 is_active boolean NOT NULL DEFAULT true,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid,
 UNIQUE(tenant_id,code),
 CHECK(code NOT IN ('VE','AC','CA','BQ','OD') OR is_active)
);
ALTER TABLE public.accounting_journal_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_journal_settings FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_journal_settings TO authenticated;
CREATE POLICY accounting_journal_settings_read ON public.accounting_journal_settings FOR SELECT TO authenticated
 USING(tenant_id=public.current_tenant_id() AND public.current_user_can_view_accounting());
CREATE OR REPLACE FUNCTION public._accounting_journal_allowed(p_tenant uuid,p_code text,p_active boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(p_code IN ('VE','AC','CA','BQ','OD') OR EXISTS(SELECT 1 FROM public.accounting_journal_settings j WHERE j.tenant_id=p_tenant AND j.code=p_code AND (NOT p_active OR j.is_active)),false)
$$;
REVOKE ALL ON FUNCTION public._accounting_journal_allowed(uuid,text,boolean) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.list_accounting_journals(p_tenant_id uuid)
RETURNS TABLE(code text,name text,is_active boolean,is_system boolean,revision bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 RETURN QUERY
 WITH defaults(c,n) AS (VALUES ('VE','Journal des ventes'),('AC','Journal des achats'),('CA','Journal de caisse'),('BQ','Journal de banque'),('OD','Opérations diverses'))
 SELECT d.c,coalesce(j.name,d.n),true,true,coalesce(j.revision,0::bigint)
 FROM defaults d LEFT JOIN public.accounting_journal_settings j ON j.tenant_id=p_tenant_id AND j.code=d.c
 UNION ALL
 SELECT j.code,j.name,j.is_active,false,j.revision FROM public.accounting_journal_settings j WHERE j.tenant_id=p_tenant_id AND j.code NOT IN ('VE','AC','CA','BQ','OD')
 ORDER BY 1;
END;$$;
REVOKE ALL ON FUNCTION public.list_accounting_journals(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.list_accounting_journals(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.save_accounting_journal(p_tenant_id uuid,p_code text,p_name text,p_active boolean,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j public.accounting_journal_settings%ROWTYPE; c text:=upper(btrim(p_code)); n text:=btrim(p_name);
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF c IS NULL OR c !~ '^[A-Z]{2,3}$' OR n IS NULL OR length(n) NOT BETWEEN 1 AND 100 OR p_active IS NULL OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'Code de 2 à 3 lettres et intitulé obligatoire.'; END IF;
 IF c IN ('VE','AC','CA','BQ','OD') AND NOT p_active THEN RAISE EXCEPTION 'Journal système : désactivation interdite.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':journal:'||c,0));
 SELECT * INTO j FROM public.accounting_journal_settings WHERE tenant_id=p_tenant_id AND code=c FOR UPDATE;
 IF coalesce(j.revision,0)<>p_revision THEN RAISE EXCEPTION 'Le journal a été modifié. Actualisez.' USING ERRCODE='40001';END IF;
 INSERT INTO public.accounting_journal_settings(tenant_id,code,name,is_active,revision,updated_by)
 VALUES(p_tenant_id,c,n,p_active,p_revision+1,auth.uid())
 ON CONFLICT(tenant_id,code) DO UPDATE SET name=excluded.name,is_active=excluded.is_active,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now()
 RETURNING * INTO j;
 RETURN jsonb_build_object('success',true,'code',j.code,'revision',j.revision);
END;$$;
REVOKE ALL ON FUNCTION public.save_accounting_journal(uuid,text,text,boolean,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_accounting_journal(uuid,text,text,boolean,bigint) TO authenticated;
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','accounting_journal_settings','direct','tenant_id','structure',11,'preserve',false);
-- Keep existing APIs and numbering, extend manual journal choices only.
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
IF p_entry_date IS NULL OR NOT isfinite(p_entry_date) OR p_entry_date>(now() AT TIME ZONE 'Africa/Dakar')::date OR extract(year from p_entry_date)<>extract(year from CURRENT_DATE) THEN RAISE EXCEPTION 'Date obligatoire, dans l’exercice courant et non future.'; END IF;
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
v_piece_number := next_accounting_piece_number(p_tenant_id, p_journal_type);

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
$function$

;
CREATE OR REPLACE FUNCTION public.recherche_ecritures(p_tenant_id uuid, p_search text DEFAULT NULL::text, p_journal_type text DEFAULT NULL::text, p_account_code text DEFAULT NULL::text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_amount_min numeric DEFAULT NULL::numeric, p_amount_max numeric DEFAULT NULL::numeric, p_limit integer DEFAULT 200)
 RETURNS TABLE(entry_id uuid, entry_number text, entry_date date, journal_type text, description text, reference text, total_debit numeric, total_credit numeric, source_type text, status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_safe_limit int;
BEGIN
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
END IF;
IF current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Accès refusé au tenant' USING ERRCODE = '42501';
END IF;
IF NOT current_user_can_view_accounting() THEN
RAISE EXCEPTION 'Permission view_accounting requise' USING ERRCODE = '42501';
END IF;

IF p_journal_type IS NOT NULL AND NOT public._accounting_journal_allowed(p_tenant_id,p_journal_type,false) THEN
RAISE EXCEPTION 'Type de journal invalide';
END IF;

IF p_date_from IS NOT NULL AND p_date_to IS NOT NULL AND p_date_to < p_date_from THEN
RAISE EXCEPTION 'La date de fin doit être postérieure à la date de début';
END IF;

v_safe_limit := LEAST(GREATEST(COALESCE(p_limit, 200), 1), 500);

RETURN QUERY
SELECT
je.id          AS entry_id,
je.entry_number,
je.entry_date,
je.journal_type,
je.description,
je.reference,
je.total_debit,
je.total_credit,
je.source_type,
je.status
FROM journal_entries je
WHERE je.tenant_id = p_tenant_id
AND (p_journal_type IS NULL OR je.journal_type = p_journal_type)
AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
AND (p_amount_min IS NULL OR je.total_debit >= p_amount_min)
AND (p_amount_max IS NULL OR je.total_debit <= p_amount_max)
AND (p_account_code IS NULL OR EXISTS (
SELECT 1 FROM journal_lines jl
WHERE jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
AND jl.account_code = p_account_code
))
AND (p_search IS NULL OR (
je.description  ILIKE '%' || p_search || '%'
OR je.reference    ILIKE '%' || p_search || '%'
OR je.entry_number ILIKE '%' || p_search || '%'
))
ORDER BY je.entry_date DESC, je.entry_number DESC, je.id DESC
LIMIT v_safe_limit;
END;
$function$

;
CREATE OR REPLACE FUNCTION public.export_accounting_entries(p_tenant_id uuid, p_date_from date, p_date_to date, p_journal_type text DEFAULT NULL::text, p_page_size integer DEFAULT 1000, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_uid uuid;
v_total bigint;
v_safe_page_size int;
v_safe_offset int;
v_bad_entries jsonb;
v_rows jsonb;
BEGIN
-- AUTH GUARDS
v_uid := auth.uid();
IF v_uid IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Utilisateur non authentifié');
END IF;

IF current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RETURN jsonb_build_object('success', false, 'error', 'Accès refusé au tenant demandé');
END IF;

IF NOT current_user_can_view_accounting() THEN
RETURN jsonb_build_object('success', false, 'error', 'Permission view_accounting requise');
END IF;

-- INPUT VALIDATION
IF p_date_from IS NULL OR p_date_to IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Dates de début et fin requises');
END IF;

IF p_date_to < p_date_from THEN
RETURN jsonb_build_object('success', false, 'error', 'La date de fin doit être postérieure ou égale à la date de début');
END IF;

IF (p_date_to - p_date_from) > 366 THEN
RETURN jsonb_build_object('success', false, 'error', 'Période maximale : 366 jours');
END IF;

IF p_journal_type IS NOT NULL AND NOT public._accounting_journal_allowed(p_tenant_id,p_journal_type,false) THEN
RETURN jsonb_build_object('success', false, 'error', 'Journal inconnu');
END IF;

v_safe_page_size := LEAST(GREATEST(COALESCE(p_page_size, 1000), 1), 1000);
v_safe_offset    := GREATEST(COALESCE(p_offset, 0), 0);

-- INTEGRITY PRE-CHECK
SELECT jsonb_agg(jsonb_build_object(
'entry_number', je.entry_number,
'issue', CASE
WHEN je.is_balanced IS DISTINCT FROM true THEN 'is_balanced=false'
WHEN ABS(COALESCE(je.total_debit, 0) - line_sums.sum_debit) > 0.01
OR ABS(COALESCE(je.total_credit, 0) - line_sums.sum_credit) > 0.01
THEN 'header/line total mismatch'
WHEN ABS(line_sums.sum_debit - line_sums.sum_credit) > 0.01
THEN 'debit!=credit on lines'
END
))
INTO v_bad_entries
FROM journal_entries je
LEFT JOIN LATERAL (
SELECT COALESCE(SUM(jl.debit), 0)  AS sum_debit,
COALESCE(SUM(jl.credit), 0) AS sum_credit
FROM journal_lines jl
WHERE jl.entry_id = je.id AND jl.tenant_id = p_tenant_id
) line_sums ON true
WHERE je.tenant_id = p_tenant_id
AND je.status = 'posted'
AND je.entry_date BETWEEN p_date_from AND p_date_to
AND (p_journal_type IS NULL OR je.journal_type = p_journal_type)
AND (
je.is_balanced IS DISTINCT FROM true
OR ABS(COALESCE(je.total_debit, 0) - line_sums.sum_debit) > 0.01
OR ABS(COALESCE(je.total_credit, 0) - line_sums.sum_credit) > 0.01
OR ABS(line_sums.sum_debit - line_sums.sum_credit) > 0.01
);

IF v_bad_entries IS NOT NULL AND jsonb_array_length(v_bad_entries) > 0 THEN
RETURN jsonb_build_object(
'success', false,
'error', 'Intégrité : certaines écritures sont déséquilibrées',
'bad_entries', v_bad_entries
);
END IF;

-- TOTAL COUNT
SELECT count(jl.id) INTO v_total
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
WHERE jl.tenant_id = p_tenant_id
AND je.status = 'posted'
AND je.entry_date BETWEEN p_date_from AND p_date_to
AND (p_journal_type IS NULL OR je.journal_type = p_journal_type);

-- PAGINATED ROWS (deterministic: date, journal, entry_number, account_code, entry_id, line_id)
SELECT COALESCE(jsonb_agg(row_data ORDER BY entry_date, journal_code, entry_number, account_code, entry_id, line_id), '[]'::jsonb)
INTO v_rows
FROM (
SELECT jsonb_build_object(
'entry_date',    je.entry_date,
'journal_code',  je.journal_type,
'entry_number',  je.entry_number,
'reference',     COALESCE(je.reference, ''),
'account_code',  jl.account_code,
'account_name',  COALESCE(jl.account_name, ''),
'line_label',    COALESCE(jl.label, ''),
'debit',         COALESCE(jl.debit, 0),
'credit',        COALESCE(jl.credit, 0),
'source_type',   COALESCE(je.source_type, '')
) AS row_data,
je.entry_date, je.journal_type AS journal_code, je.entry_number, jl.account_code,
je.id AS entry_id, jl.id AS line_id
FROM journal_lines jl
JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
WHERE jl.tenant_id = p_tenant_id
AND je.status = 'posted'
AND je.entry_date BETWEEN p_date_from AND p_date_to
AND (p_journal_type IS NULL OR je.journal_type = p_journal_type)
ORDER BY je.entry_date, je.journal_type, je.entry_number, jl.account_code, je.id, jl.id
LIMIT v_safe_page_size OFFSET v_safe_offset
) sub;

RETURN jsonb_build_object(
'success',     true,
'total_count', v_total,
'page_size',   v_safe_page_size,
'offset',      v_safe_offset,
'rows',        v_rows
);
END;
$function$

;
