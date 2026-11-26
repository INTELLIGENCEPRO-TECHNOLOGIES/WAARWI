-- Correctif testé en recette isolée uniquement.
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

-- Ordre commun aux écritures manuelles et aux documents commerciaux :
-- période d'abord, puis verrou du journal, puis comptes et compteur.
PERFORM public._bank_reconciliation_access(p_tenant_id,true);
IF p_entry_date IS NULL OR NOT isfinite(p_entry_date) OR p_entry_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Date obligatoire et non future.'; END IF;
PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',p_entry_date)::date);
PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':journal:'||coalesce(p_journal_type,''),0));
IF NOT public._accounting_journal_allowed(p_tenant_id,p_journal_type,true) THEN
RAISE EXCEPTION 'Type de journal invalide: %', coalesce(p_journal_type, 'NULL');
END IF;
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
REVOKE ALL ON FUNCTION public.create_manual_journal_entry(uuid,text,date,text,text,jsonb) FROM PUBLIC,anon,authenticated;

