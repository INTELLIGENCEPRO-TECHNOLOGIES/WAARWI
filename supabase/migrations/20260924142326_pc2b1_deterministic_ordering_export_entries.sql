/*
# PC2B.1 — Deterministic ordering for export_accounting_entries

## Changes
- Appends je.id, jl.id to ORDER BY for fully deterministic pagination
- Removes has_accounting_export plan limit check (standard exports are part of the accounting module)
- No other logic changes — all existing guards remain intact

## Security
- All guards preserved: auth.uid(), current_tenant_id(), view_accounting, period max, journal whitelist, integrity check
- Still STABLE SECURITY DEFINER, read-only
*/

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

  IF p_journal_type IS NOT NULL AND p_journal_type NOT IN ('VE', 'AC', 'CA', 'BQ', 'OD') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Type de journal invalide (VE, AC, CA, BQ, OD ou vide)');
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
$$;

REVOKE ALL ON FUNCTION export_accounting_entries(uuid, date, date, text, int, int) FROM public;
GRANT EXECUTE ON FUNCTION export_accounting_entries(uuid, date, date, text, int, int) TO authenticated;
