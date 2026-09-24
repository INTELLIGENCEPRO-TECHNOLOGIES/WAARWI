/*
# PC1E-C2-B1 — Secure and repair auxiliary tier accounts

## Plain-English explanation
This migration fixes a critical bug where get_or_create_customer_account and
get_or_create_supplier_account were:
  1. Returning fallback hardcoded collective codes (4110000/4010000) when the
     entity doesn't exist instead of raising an error.
  2. Hardcoding prefix '411'/'401' instead of deriving them from resolve_account().
  3. Not inserting the auxiliary account into the accounts table when one already
     exists on the customer/supplier record.
  4. Granting EXECUTE to anon (security risk).
  5. Not locking rows during code generation (race condition risk).

## Changes

### Modified functions
- `get_or_create_customer_account(uuid, uuid)` — rewritten to use resolve_account(),
  derive prefix dynamically, verify tenant access, lock rows, ensure the account
  exists in accounts table, never return a fallback.
- `get_or_create_supplier_account(uuid, uuid)` — same treatment.

### Indexes
- Strengthen existing unique partial indexes on customers(tenant_id, account_code)
  and suppliers(tenant_id, account_code) to also exclude empty strings.

### Backfill
- Insert into `accounts` all auxiliary codes that exist on customers/suppliers
  records but were never created in the accounts table (991 rows).
- No existing account is modified. No existing code on customers/suppliers is changed.
- No journal_entries or journal_lines are touched.

### Security
- Both functions: owner postgres, SECURITY DEFINER, search_path=public.
- REVOKE EXECUTE from PUBLIC, anon, authenticated.
- GRANT EXECUTE only to postgres, service_role.

## Important notes
1. The backfill uses INSERT ... ON CONFLICT (tenant_id, code) DO NOTHING to be
   idempotent and safe to re-run.
2. The rewritten functions derive the 3-digit prefix from the collective account code
   returned by resolve_account() (e.g. if CUSTOMER_CONTROL maps to 4110000, the
   prefix is '411'). No literal '4110000' or '4010000' appears in the logic.
3. Code generation uses SELECT ... FOR UPDATE on the entity row + advisory lock on
   tenant to prevent race conditions in concurrent calls.
*/

-- ============================================================
-- PART 1: Strengthen unique partial indexes to exclude empty strings
-- ============================================================
DROP INDEX IF EXISTS idx_customers_tenant_account_code_unique;
CREATE UNIQUE INDEX idx_customers_tenant_account_code_unique
  ON customers (tenant_id, account_code)
  WHERE account_code IS NOT NULL AND account_code <> '';

DROP INDEX IF EXISTS idx_suppliers_tenant_account_code_unique;
CREATE UNIQUE INDEX idx_suppliers_tenant_account_code_unique
  ON suppliers (tenant_id, account_code)
  WHERE account_code IS NOT NULL AND account_code <> '';

-- ============================================================
-- PART 2: Backfill missing customer auxiliary accounts
-- ============================================================
INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
SELECT c.tenant_id, c.account_code, c.name, 4, 'auxiliary', true
FROM customers c
WHERE c.account_code IS NOT NULL
  AND c.account_code <> ''
  AND NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.tenant_id = c.tenant_id AND a.code = c.account_code
  )
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================
-- PART 3: Backfill missing supplier auxiliary accounts
-- ============================================================
INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
SELECT s.tenant_id, s.account_code, s.name, 4, 'auxiliary', true
FROM suppliers s
WHERE s.account_code IS NOT NULL
  AND s.account_code <> ''
  AND NOT EXISTS (
    SELECT 1 FROM accounts a
    WHERE a.tenant_id = s.tenant_id AND a.code = s.account_code
  )
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ============================================================
-- PART 4: Rewrite get_or_create_customer_account
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_or_create_customer_account(
  p_tenant_id uuid,
  p_customer_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code        text;
  v_name        text;
  v_collective  text;
  v_prefix      text;
  v_next_num    int;
  v_caller      uuid;
BEGIN
  -- Tenant access check when called by an authenticated user
  v_caller := auth.uid();
  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_tenants ut
      WHERE ut.user_id = v_caller AND ut.tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Access denied: caller does not belong to tenant %', p_tenant_id;
    END IF;
  END IF;

  -- Lock the customer row
  SELECT c.account_code, c.name
    INTO v_code, v_name
    FROM customers c
   WHERE c.id = p_customer_id
     AND c.tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer % not found in tenant %', p_customer_id, p_tenant_id;
  END IF;

  -- Resolve the collective account and derive the 3-char prefix
  v_collective := resolve_account(p_tenant_id, 'CUSTOMER_CONTROL');
  IF v_collective IS NULL THEN
    RAISE EXCEPTION 'No CUSTOMER_CONTROL mapping for tenant %', p_tenant_id;
  END IF;
  v_prefix := left(v_collective, 3);

  -- If the customer already has an account_code, ensure the account row exists
  IF v_code IS NOT NULL AND v_code <> '' THEN
    IF NOT EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.tenant_id = p_tenant_id AND a.code = v_code
    ) THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
      VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true)
      ON CONFLICT (tenant_id, code) DO NOTHING;
    END IF;
    RETURN v_code;
  END IF;

  -- Generate next auxiliary code atomically
  -- Advisory lock on tenant to serialize code generation
  PERFORM pg_advisory_xact_lock(hashtext('aux_cust_' || p_tenant_id::text));

  SELECT COALESCE(MAX(CAST(SUBSTRING(c2.account_code FROM 4) AS int)), 0) + 1
    INTO v_next_num
    FROM customers c2
   WHERE c2.tenant_id = p_tenant_id
     AND c2.account_code IS NOT NULL
     AND c2.account_code <> ''
     AND c2.account_code LIKE v_prefix || '%'
     AND SUBSTRING(c2.account_code FROM 4) ~ '^\d+$';

  v_code := v_prefix || LPAD(v_next_num::text, 4, '0');

  -- Create account in accounts table
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
  VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Set the code on the customer
  UPDATE customers
     SET account_code = v_code
   WHERE id = p_customer_id
     AND tenant_id = p_tenant_id;

  RETURN v_code;
END;
$function$;

ALTER FUNCTION public.get_or_create_customer_account(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_or_create_customer_account(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_customer_account(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_or_create_customer_account(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_account(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_account(uuid, uuid) TO service_role;

-- ============================================================
-- PART 5: Rewrite get_or_create_supplier_account
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_or_create_supplier_account(
  p_tenant_id uuid,
  p_supplier_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code        text;
  v_name        text;
  v_collective  text;
  v_prefix      text;
  v_next_num    int;
  v_caller      uuid;
BEGIN
  -- Tenant access check when called by an authenticated user
  v_caller := auth.uid();
  IF v_caller IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_tenants ut
      WHERE ut.user_id = v_caller AND ut.tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Access denied: caller does not belong to tenant %', p_tenant_id;
    END IF;
  END IF;

  -- Lock the supplier row
  SELECT s.account_code, s.name
    INTO v_code, v_name
    FROM suppliers s
   WHERE s.id = p_supplier_id
     AND s.tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Supplier % not found in tenant %', p_supplier_id, p_tenant_id;
  END IF;

  -- Resolve the collective account and derive the 3-char prefix
  v_collective := resolve_account(p_tenant_id, 'SUPPLIER_CONTROL');
  IF v_collective IS NULL THEN
    RAISE EXCEPTION 'No SUPPLIER_CONTROL mapping for tenant %', p_tenant_id;
  END IF;
  v_prefix := left(v_collective, 3);

  -- If the supplier already has an account_code, ensure the account row exists
  IF v_code IS NOT NULL AND v_code <> '' THEN
    IF NOT EXISTS (
      SELECT 1 FROM accounts a
      WHERE a.tenant_id = p_tenant_id AND a.code = v_code
    ) THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
      VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true)
      ON CONFLICT (tenant_id, code) DO NOTHING;
    END IF;
    RETURN v_code;
  END IF;

  -- Generate next auxiliary code atomically
  PERFORM pg_advisory_xact_lock(hashtext('aux_supp_' || p_tenant_id::text));

  SELECT COALESCE(MAX(CAST(SUBSTRING(s2.account_code FROM 4) AS int)), 0) + 1
    INTO v_next_num
    FROM suppliers s2
   WHERE s2.tenant_id = p_tenant_id
     AND s2.account_code IS NOT NULL
     AND s2.account_code <> ''
     AND s2.account_code LIKE v_prefix || '%'
     AND SUBSTRING(s2.account_code FROM 4) ~ '^\d+$';

  v_code := v_prefix || LPAD(v_next_num::text, 4, '0');

  -- Create account in accounts table
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
  VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true)
  ON CONFLICT (tenant_id, code) DO NOTHING;

  -- Set the code on the supplier
  UPDATE suppliers
     SET account_code = v_code
   WHERE id = p_supplier_id
     AND tenant_id = p_tenant_id;

  RETURN v_code;
END;
$function$;

ALTER FUNCTION public.get_or_create_supplier_account(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) TO service_role;
