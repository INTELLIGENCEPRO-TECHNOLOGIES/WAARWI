/*
# PC1D — Create resolve_account() central resolver

## Summary
Creates public.resolve_account(p_tenant_id uuid, p_role_code text) RETURNS text.
This is a read-only, SECURITY DEFINER, STABLE function that resolves an accounting
role code to the corresponding account code for a given tenant, using the
accounting_account_mappings table joined to accounts.

## Function behavior
- Rejects NULL tenant_id with explicit exception.
- Rejects NULL or empty role_code with explicit exception.
- Normalizes role_code with upper(btrim()).
- Joins accounting_account_mappings + accounts on (tenant_id, account_id) with is_active check.
- Returns accounts.code (text).
- Raises exception if mapping is absent, FK is broken, or account is inactive.
- No writes, no dynamic SQL, no hardcoded fallback codes.

## Security
- SECURITY DEFINER with search_path = public.
- STABLE volatility.
- REVOKE ALL from PUBLIC, anon, authenticated.
- GRANT EXECUTE only to service_role.
- Strictly internal — not exposed as a frontend RPC.

## Objects touched
- NEW function: public.resolve_account(uuid, text)
- No other objects modified.
*/

-- Create the function
CREATE OR REPLACE FUNCTION public.resolve_account(
  p_tenant_id uuid,
  p_role_code text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_code text;
BEGIN
  -- Guard: reject NULL tenant
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'resolve_account: p_tenant_id must not be NULL';
  END IF;

  -- Guard: reject NULL or empty role
  IF p_role_code IS NULL OR btrim(p_role_code) = '' THEN
    RAISE EXCEPTION 'resolve_account: p_role_code must not be NULL or empty';
  END IF;

  -- Normalize
  v_role := upper(btrim(p_role_code));

  -- Resolve via mapping + accounts join
  SELECT a.code INTO v_code
  FROM accounting_account_mappings m
  JOIN accounts a
    ON a.id = m.account_id
   AND a.tenant_id = m.tenant_id
  WHERE m.tenant_id = p_tenant_id
    AND m.role_code = v_role
    AND a.is_active IS TRUE;

  IF v_code IS NULL THEN
    RAISE EXCEPTION 'resolve_account: no active account found for tenant=%, role=%', p_tenant_id, v_role;
  END IF;

  RETURN v_code;
END;
$$;

-- Lock down privileges: strictly internal function
REVOKE ALL ON FUNCTION public.resolve_account(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_account(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_account(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_account(uuid, text) TO service_role;
