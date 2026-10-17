/*
# PC2C.1 — Harden accounting SELECT RLS + balance_tiers tiers JOIN

## Overview
Strengthens the SELECT RLS policies on the four core accounting tables so
that authenticated users need **both** `tenant_id = current_tenant_id()`
**and** `current_user_can_view_accounting() = true` to read rows.

Recreates `balance_tiers` with a mandatory JOIN to `customers` (for client)
or `suppliers` (for supplier), eliminating orphan lines and cross-type leaks.

## Tables Modified
- `accounts`           — SELECT policy hardened
- `journal_entries`    — SELECT policy hardened
- `journal_lines`      — SELECT policy hardened
- `accounting_account_mappings` — SELECT policy hardened

## Functions Modified
- `balance_tiers(uuid, text, date, date)` — adds JOIN to tiers table

## Security Changes
- All four SELECT policies now require `current_user_can_view_accounting()`
  in addition to tenant isolation
- INSERT / UPDATE / DELETE policies unchanged
- Grants unchanged (authenticated, service_role, postgres keep SELECT)
- service_role bypasses RLS as before

## Important Notes
1. `current_user_can_view_accounting()` is SECURITY DEFINER and returns
   true for super_admin/admin roles, or when role_permissions has
   view_accounting = true. It returns false for unauthenticated callers.
2. Write policies are NOT touched — business functions that insert/update
   accounting data continue to work via SECURITY DEFINER RPCs.
3. balance_tiers now JOINs customers/suppliers so orphan third_party_id
   lines or wrong-type lines are excluded from results.
*/

-- ============================================================
-- 1. Harden SELECT policies on 4 accounting tables
-- ============================================================

-- accounts
DROP POLICY IF EXISTS "acc select" ON accounts;
CREATE POLICY "acc select" ON accounts FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND current_user_can_view_accounting() = true
  );

-- journal_entries
DROP POLICY IF EXISTS "je select" ON journal_entries;
CREATE POLICY "je select" ON journal_entries FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND current_user_can_view_accounting() = true
  );

-- journal_lines
DROP POLICY IF EXISTS "jl select" ON journal_lines;
CREATE POLICY "jl select" ON journal_lines FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND current_user_can_view_accounting() = true
  );

-- accounting_account_mappings
DROP POLICY IF EXISTS "mapping_select_own_tenant" ON accounting_account_mappings;
CREATE POLICY "mapping_select_own_tenant" ON accounting_account_mappings FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND current_user_can_view_accounting() = true
  );

-- ============================================================
-- 2. Recreate balance_tiers with mandatory tiers JOIN
-- ============================================================
CREATE OR REPLACE FUNCTION public.balance_tiers(
  p_tenant_id uuid,
  p_tiers_type text DEFAULT 'client',
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE(
  tiers_id uuid,
  tiers_name text,
  account_code text,
  total_debit numeric,
  total_credit numeric,
  solde numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF p_tiers_type = 'client' THEN
    RETURN QUERY
    SELECT
      c.id                                              AS tiers_id,
      c.name::text                                      AS tiers_name,
      jl.account_code,
      COALESCE(SUM(jl.debit), 0)                       AS total_debit,
      COALESCE(SUM(jl.credit), 0)                      AS total_credit,
      COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS solde
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
    JOIN customers c ON c.id = jl.third_party_id AND c.tenant_id = p_tenant_id
    WHERE jl.tenant_id = p_tenant_id
      AND je.status = 'posted'
      AND jl.account_code LIKE v_like_prefix
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
    GROUP BY c.id, c.name, jl.account_code
    ORDER BY solde DESC, jl.account_code;
  ELSE
    RETURN QUERY
    SELECT
      s.id                                              AS tiers_id,
      s.name::text                                      AS tiers_name,
      jl.account_code,
      COALESCE(SUM(jl.debit), 0)                       AS total_debit,
      COALESCE(SUM(jl.credit), 0)                      AS total_credit,
      COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) AS solde
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = jl.tenant_id
    JOIN suppliers s ON s.id = jl.third_party_id AND s.tenant_id = p_tenant_id
    WHERE jl.tenant_id = p_tenant_id
      AND je.status = 'posted'
      AND jl.account_code LIKE v_like_prefix
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to   IS NULL OR je.entry_date <= p_date_to)
    GROUP BY s.id, s.name, jl.account_code
    ORDER BY solde DESC, jl.account_code;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.balance_tiers(uuid, text, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.balance_tiers(uuid, text, date, date) TO authenticated, service_role;
