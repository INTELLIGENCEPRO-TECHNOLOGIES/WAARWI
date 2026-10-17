/*
# PC2B — Export sécurisé des écritures comptables

## Summary
Creates a read-only SECURITY DEFINER function `export_accounting_entries`
that returns posted journal entries + lines for a given tenant, with full
server-side authorization, integrity checks, and pagination.

Also creates a lightweight `current_user_can_view_accounting()` helper
(mirrors `current_user_can_manage_accounting()`).

## New Functions
- `current_user_can_view_accounting()` RETURNS boolean
  - STABLE, SECURITY DEFINER
  - super_admin / admin → true; others check `view_accounting` in role_permissions

- `export_accounting_entries(...)` RETURNS jsonb
  - STABLE, SECURITY DEFINER (read-only, no writes)
  - Parameters:
    - p_tenant_id uuid
    - p_date_from date
    - p_date_to date
    - p_journal_type text (nullable — NULL = all journals)
    - p_page_size int (default 1000, capped at 1000)
    - p_offset int (default 0)
  - Guards:
    1. auth.uid() non-null
    2. current_tenant_id() = p_tenant_id
    3. current_user_can_view_accounting() = true
    4. Period max 366 days
    5. p_journal_type in (VE, AC, CA, BQ, OD) or NULL
  - Pre-export integrity check:
    - All posted entries in range have is_balanced = true
    - Line sums match header totals (debit/credit)
  - Returns: { success, total_count, page_size, offset, rows[] }
    Each row: entry_date, journal_code, entry_number, reference,
              account_code, account_name, line_label, debit, credit, source_type

## Security
- Both functions are SECURITY DEFINER with search_path = public
- EXECUTE granted only to authenticated role
- No data mutation — STABLE functions
*/

-- ──── current_user_can_view_accounting ────
CREATE OR REPLACE FUNCTION current_user_can_view_accounting()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_role text;
  v_tenant_id uuid;
  v_perm boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT p.role, p.tenant_id INTO v_role, v_tenant_id
  FROM profiles p WHERE p.id = v_uid;

  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('super_admin', 'admin') THEN RETURN true; END IF;

  SELECT (rp.permissions->>'view_accounting')::boolean INTO v_perm
  FROM role_permissions rp
  WHERE rp.tenant_id = v_tenant_id AND rp.role = v_role;

  RETURN COALESCE(v_perm, false);
END;
$$;

REVOKE ALL ON FUNCTION current_user_can_view_accounting() FROM public;
GRANT EXECUTE ON FUNCTION current_user_can_view_accounting() TO authenticated;

-- ──── export_accounting_entries ────
CREATE OR REPLACE FUNCTION export_accounting_entries(
  p_tenant_id uuid,
  p_date_from date,
  p_date_to date,
  p_journal_type text DEFAULT NULL,
  p_page_size int DEFAULT 1000,
  p_offset int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_total bigint;
  v_safe_page_size int;
  v_safe_offset int;
  v_bad_entries jsonb;
  v_rows jsonb;
BEGIN
  -- ──── AUTH GUARDS ────
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

  -- ──── INPUT VALIDATION ────
  IF p_date_from IS NULL OR p_date_to IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Dates de début et fin requises');
  END IF;

  IF p_date_to < p_date_from THEN
    RETURN jsonb_build_object('success', false, 'error', 'La date de fin doit être postérieure ou égale à la date de début');
  END IF;

  IF (p_date_to - p_date_from) > 366 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Période maximale : 366 jours');
  END IF;

  IF p_journal_type IS NOT NULL AND p_journal_type NOT IN ('VE', 'AC', 'CA', 'BQ', 'OD') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Type de journal invalide (VE, AC, CA, BQ, OD ou vide)');
  END IF;

  v_safe_page_size := LEAST(GREATEST(COALESCE(p_page_size, 1000), 1), 1000);
  v_safe_offset    := GREATEST(COALESCE(p_offset, 0), 0);

  -- ──── INTEGRITY PRE-CHECK ────
  SELECT jsonb_agg(jsonb_build_object(
    'entry_number', je.entry_number,
    'issue', CASE
      WHEN je.is_balanced IS DISTINCT FROM true THEN 'is_balanced=false'
      WHEN ABS(COALESCE(je.total_debit, 0) - line_sums.sum_debit) > 0.01
        OR ABS(COALESCE(je.total_credit, 0) - line_sums.sum_credit) > 0.01
        THEN 'header/line total mismatch'
      WHEN ABS(line_sums.sum_debit - line_sums.sum_credit) > 0.01
        THEN 'debit≠credit on lines'
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

  -- ──── TOTAL COUNT ────
  SELECT count(jl.id) INTO v_total
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
  WHERE jl.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND je.entry_date BETWEEN p_date_from AND p_date_to
    AND (p_journal_type IS NULL OR je.journal_type = p_journal_type);

  -- ──── PAGINATED ROWS ────
  SELECT COALESCE(jsonb_agg(row_data ORDER BY entry_date, journal_code, entry_number, account_code), '[]'::jsonb)
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
    je.entry_date, je.journal_type AS journal_code, je.entry_number, jl.account_code
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = p_tenant_id
      AND je.status = 'posted'
      AND je.entry_date BETWEEN p_date_from AND p_date_to
      AND (p_journal_type IS NULL OR je.journal_type = p_journal_type)
    ORDER BY je.entry_date, je.journal_type, je.entry_number, jl.account_code
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
$$;

REVOKE ALL ON FUNCTION export_accounting_entries(uuid, date, date, text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION export_accounting_entries(uuid, date, date, text, int, int) TO authenticated;
