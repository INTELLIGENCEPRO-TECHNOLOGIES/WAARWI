/*
# PC2C — Consolidate and harden 6 accounting report RPCs

## Changes
All six functions are rewritten forward-only with identical signatures and return columns.

### Security (all 6)
- Guard: auth.uid() IS NOT NULL
- Guard: current_tenant_id() = p_tenant_id  (reject cross-tenant)
- Guard: current_user_can_view_accounting()  (permission check)
- SECURITY DEFINER, search_path = public
- REVOKE ALL FROM public; GRANT EXECUTE TO authenticated, service_role
- All JOINs include tenant_id on both sides
- Deterministic ORDER BY (includes tie-breaking columns)

### balance_tiers & interrogation_tiers
- Remove hardcoded '411%' / '401%' literals
- Use resolve_account(p_tenant_id, 'CUSTOMER_CONTROL'/'SUPPLIER_CONTROL') to derive prefix
- Extract first 3 chars as LIKE prefix (left(v_prefix, 3) || '%')
- Validate p_tiers_type IN ('client','supplier'), RAISE on invalid
- Retrieve tiers_name from customers/suppliers table, not just journal_lines

### recherche_ecritures
- Cap p_limit to LEAST(GREATEST(p_limit, 1), 500)
- Validate p_journal_type against whitelist when provided
- Validate p_date_from <= p_date_to when both provided
- Deterministic ORDER BY entry_date DESC, entry_number DESC, id DESC

### grand_livre
- Deterministic ORDER BY: account_code, entry_date, entry_number, jl.id

### balance_generale
- Deterministic ORDER BY: account_code

### balance_par_journal
- Deterministic ORDER BY: journal_type

## Data safety
- No INSERT, UPDATE, or DELETE on any table
- No schema changes
- All functions are STABLE (read-only)
*/

-- =========================================================================
-- 1. balance_generale
-- =========================================================================
CREATE OR REPLACE FUNCTION public.balance_generale(
  p_tenant_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL
)
RETURNS TABLE(
  account_code    text,
  account_name    text,
  account_class   integer,
  total_debit     numeric,
  total_credit    numeric,
  solde_debiteur  numeric,
  solde_crediteur numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN QUERY
  SELECT
    jl.account_code,
    COALESCE(MAX(jl.account_name), '')::text AS account_name,
    COALESCE(MAX(a.class), 0)::integer       AS account_class,
    COALESCE(SUM(jl.debit), 0)               AS total_debit,
    COALESCE(SUM(jl.credit), 0)              AS total_credit,
    GREATEST(COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0), 0) AS solde_debiteur,
    GREATEST(COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0), 0) AS solde_crediteur
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
  LEFT JOIN accounts a   ON a.tenant_id = p_tenant_id AND a.code = jl.account_code
  WHERE jl.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
  GROUP BY jl.account_code
  ORDER BY jl.account_code;
END;
$$;

REVOKE ALL ON FUNCTION public.balance_generale(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.balance_generale(uuid, date, date) TO authenticated, service_role;


-- =========================================================================
-- 2. balance_par_journal
-- =========================================================================
CREATE OR REPLACE FUNCTION public.balance_par_journal(
  p_tenant_id uuid,
  p_date_from date DEFAULT NULL,
  p_date_to   date DEFAULT NULL
)
RETURNS TABLE(
  journal_type  text,
  nb_ecritures  bigint,
  total_debit   numeric,
  total_credit  numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN QUERY
  SELECT
    je.journal_type,
    COUNT(DISTINCT je.id)     AS nb_ecritures,
    COALESCE(SUM(jl.debit), 0)  AS total_debit,
    COALESCE(SUM(jl.credit), 0) AS total_credit
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
  WHERE jl.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
  GROUP BY je.journal_type
  ORDER BY je.journal_type;
END;
$$;

REVOKE ALL ON FUNCTION public.balance_par_journal(uuid, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.balance_par_journal(uuid, date, date) TO authenticated, service_role;


-- =========================================================================
-- 3. grand_livre
-- =========================================================================
CREATE OR REPLACE FUNCTION public.grand_livre(
  p_tenant_id   uuid,
  p_date_from   date DEFAULT NULL,
  p_date_to     date DEFAULT NULL,
  p_account_code text DEFAULT NULL
)
RETURNS TABLE(
  account_code text,
  account_name text,
  entry_date   date,
  entry_number text,
  journal_type text,
  label        text,
  reference    text,
  debit        numeric,
  credit       numeric,
  entry_id     uuid
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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

  RETURN QUERY
  SELECT
    jl.account_code,
    jl.account_name,
    je.entry_date,
    je.entry_number,
    je.journal_type,
    jl.label,
    je.reference,
    COALESCE(jl.debit, 0)  AS debit,
    COALESCE(jl.credit, 0) AS credit,
    je.id AS entry_id
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
  WHERE jl.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
    AND (p_account_code IS NULL OR jl.account_code = p_account_code)
  ORDER BY jl.account_code, je.entry_date, je.entry_number, jl.id;
END;
$$;

REVOKE ALL ON FUNCTION public.grand_livre(uuid, date, date, text) FROM public;
GRANT EXECUTE ON FUNCTION public.grand_livre(uuid, date, date, text) TO authenticated, service_role;


-- =========================================================================
-- 4. balance_tiers  (no more hardcoded 411/401)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.balance_tiers(
  p_tenant_id  uuid,
  p_tiers_type text DEFAULT 'client',
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL
)
RETURNS TABLE(
  tiers_id     uuid,
  tiers_name   text,
  account_code text,
  total_debit  numeric,
  total_credit numeric,
  solde        numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_control_account text;
  v_like_prefix     text;
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
  IF p_tiers_type NOT IN ('client', 'supplier') THEN
    RAISE EXCEPTION 'Type de tiers invalide: %. Valeurs acceptées: client, supplier', p_tiers_type;
  END IF;

  IF p_tiers_type = 'client' THEN
    v_control_account := resolve_account(p_tenant_id, 'CUSTOMER_CONTROL');
  ELSE
    v_control_account := resolve_account(p_tenant_id, 'SUPPLIER_CONTROL');
  END IF;
  v_like_prefix := left(v_control_account, 3) || '%';

  RETURN QUERY
  SELECT
    jl.third_party_id                           AS tiers_id,
    COALESCE(
      CASE WHEN p_tiers_type = 'client'
        THEN (SELECT c.name FROM customers c WHERE c.id = jl.third_party_id AND c.tenant_id = p_tenant_id)
        ELSE (SELECT s.name FROM suppliers s WHERE s.id = jl.third_party_id AND s.tenant_id = p_tenant_id)
      END,
      MAX(jl.account_name),
      ''
    )::text                                     AS tiers_name,
    jl.account_code,
    COALESCE(SUM(jl.debit), 0)                  AS total_debit,
    COALESCE(SUM(jl.credit), 0)                 AS total_credit,
    COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS solde
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
  WHERE jl.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND jl.third_party_id IS NOT NULL
    AND jl.account_code LIKE v_like_prefix
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
  GROUP BY jl.third_party_id, jl.account_code
  ORDER BY solde DESC, jl.account_code;
END;
$$;

REVOKE ALL ON FUNCTION public.balance_tiers(uuid, text, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.balance_tiers(uuid, text, date, date) TO authenticated, service_role;


-- =========================================================================
-- 5. interrogation_tiers  (no more hardcoded 411/401)
-- =========================================================================
CREATE OR REPLACE FUNCTION public.interrogation_tiers(
  p_tenant_id  uuid,
  p_tiers_id   uuid,
  p_tiers_type text DEFAULT 'client',
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL
)
RETURNS TABLE(
  entry_date   date,
  entry_number text,
  journal_type text,
  reference    text,
  label        text,
  debit        numeric,
  credit       numeric,
  solde_cumule numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_control_account text;
  v_like_prefix     text;
  v_running_balance numeric := 0;
  v_row             RECORD;
  v_tiers_exists    boolean;
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
  IF p_tiers_type NOT IN ('client', 'supplier') THEN
    RAISE EXCEPTION 'Type de tiers invalide: %. Valeurs acceptées: client, supplier', p_tiers_type;
  END IF;

  IF p_tiers_type = 'client' THEN
    SELECT EXISTS(SELECT 1 FROM customers c WHERE c.id = p_tiers_id AND c.tenant_id = p_tenant_id) INTO v_tiers_exists;
    v_control_account := resolve_account(p_tenant_id, 'CUSTOMER_CONTROL');
  ELSE
    SELECT EXISTS(SELECT 1 FROM suppliers s WHERE s.id = p_tiers_id AND s.tenant_id = p_tenant_id) INTO v_tiers_exists;
    v_control_account := resolve_account(p_tenant_id, 'SUPPLIER_CONTROL');
  END IF;

  IF NOT v_tiers_exists THEN
    RAISE EXCEPTION 'Tiers introuvable pour ce tenant';
  END IF;

  v_like_prefix := left(v_control_account, 3) || '%';

  FOR v_row IN
    SELECT
      je.entry_date,
      je.entry_number,
      je.journal_type,
      je.reference,
      jl.label,
      COALESCE(jl.debit, 0)  AS debit,
      COALESCE(jl.credit, 0) AS credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
    WHERE jl.tenant_id = p_tenant_id
      AND je.status = 'posted'
      AND jl.third_party_id = p_tiers_id
      AND jl.account_code LIKE v_like_prefix
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
    ORDER BY je.entry_date, je.entry_number, jl.id
  LOOP
    v_running_balance := v_running_balance + v_row.debit - v_row.credit;
    entry_date   := v_row.entry_date;
    entry_number := v_row.entry_number;
    journal_type := v_row.journal_type;
    reference    := v_row.reference;
    label        := v_row.label;
    debit        := v_row.debit;
    credit       := v_row.credit;
    solde_cumule := v_running_balance;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.interrogation_tiers(uuid, uuid, text, date, date) FROM public;
GRANT EXECUTE ON FUNCTION public.interrogation_tiers(uuid, uuid, text, date, date) TO authenticated, service_role;


-- =========================================================================
-- 6. recherche_ecritures
-- =========================================================================
CREATE OR REPLACE FUNCTION public.recherche_ecritures(
  p_tenant_id    uuid,
  p_search       text    DEFAULT NULL,
  p_journal_type text    DEFAULT NULL,
  p_account_code text    DEFAULT NULL,
  p_date_from    date    DEFAULT NULL,
  p_date_to      date    DEFAULT NULL,
  p_amount_min   numeric DEFAULT NULL,
  p_amount_max   numeric DEFAULT NULL,
  p_limit        integer DEFAULT 200
)
RETURNS TABLE(
  entry_id     uuid,
  entry_number text,
  entry_date   date,
  journal_type text,
  description  text,
  reference    text,
  total_debit  numeric,
  total_credit numeric,
  source_type  text,
  status       text
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
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

  IF p_journal_type IS NOT NULL AND p_journal_type NOT IN ('VE','AC','CA','BQ','OD') THEN
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
$$;

REVOKE ALL ON FUNCTION public.recherche_ecritures(uuid, text, text, text, date, date, numeric, numeric, integer) FROM public;
GRANT EXECUTE ON FUNCTION public.recherche_ecritures(uuid, text, text, text, date, date, numeric, numeric, integer) TO authenticated, service_role;
