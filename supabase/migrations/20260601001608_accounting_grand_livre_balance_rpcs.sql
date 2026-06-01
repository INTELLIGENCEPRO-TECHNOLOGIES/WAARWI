/*
  # Grand Livre et Balance dynamiques SYSCOHADA

  1. Fonctions
    - `grand_livre(p_tenant_id, p_date_from, p_date_to, p_account_code)` : detail des ecritures par compte
    - `balance_generale(p_tenant_id, p_date_from, p_date_to)` : balance par compte
    - `balance_par_journal(p_tenant_id, p_date_from, p_date_to)` : totaux par journal

  2. Notes
    - Calculs dynamiques depuis journal_entries + journal_lines
    - Pas de table physique de balance
    - Filtreable par periode et par compte
*/

-- ==============================================
-- GRAND LIVRE : detail des ecritures par compte
-- ==============================================
CREATE OR REPLACE FUNCTION grand_livre(
  p_tenant_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_account_code text DEFAULT NULL
)
RETURNS TABLE (
  account_code text,
  account_name text,
  entry_date date,
  entry_number text,
  journal_type text,
  label text,
  reference text,
  debit numeric,
  credit numeric,
  entry_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jl.account_code,
    jl.account_name,
    je.entry_date,
    je.entry_number,
    je.journal_type,
    jl.label,
    je.reference,
    COALESCE(jl.debit, 0) as debit,
    COALESCE(jl.credit, 0) as credit,
    je.id as entry_id
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = p_tenant_id
  WHERE jl.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
    AND (p_account_code IS NULL OR jl.account_code = p_account_code)
  ORDER BY jl.account_code, je.entry_date, je.entry_number;
$$;

-- ==============================================
-- BALANCE GENERALE : solde par compte
-- ==============================================
CREATE OR REPLACE FUNCTION balance_generale(
  p_tenant_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (
  account_code text,
  account_name text,
  account_class int,
  total_debit numeric,
  total_credit numeric,
  solde_debiteur numeric,
  solde_crediteur numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jl.account_code,
    COALESCE(MAX(jl.account_name), '') as account_name,
    COALESCE(MAX(a.class), 0) as account_class,
    COALESCE(SUM(jl.debit), 0) as total_debit,
    COALESCE(SUM(jl.credit), 0) as total_credit,
    GREATEST(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0), 0) as solde_debiteur,
    GREATEST(COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0), 0) as solde_crediteur
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = p_tenant_id
  LEFT JOIN accounts a ON a.tenant_id = p_tenant_id AND a.code = jl.account_code
  WHERE jl.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
  GROUP BY jl.account_code
  ORDER BY jl.account_code;
$$;

-- ==============================================
-- TOTAUX PAR JOURNAL
-- ==============================================
CREATE OR REPLACE FUNCTION balance_par_journal(
  p_tenant_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (
  journal_type text,
  nb_ecritures bigint,
  total_debit numeric,
  total_credit numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    je.journal_type,
    COUNT(*) as nb_ecritures,
    COALESCE(SUM(je.total_debit), 0) as total_debit,
    COALESCE(SUM(je.total_credit), 0) as total_credit
  FROM journal_entries je
  WHERE je.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
  GROUP BY je.journal_type
  ORDER BY je.journal_type;
$$;

GRANT EXECUTE ON FUNCTION grand_livre(uuid, date, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION balance_generale(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION balance_par_journal(uuid, date, date) TO authenticated;
