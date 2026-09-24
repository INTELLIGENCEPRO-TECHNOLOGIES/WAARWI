/*
# PC1E-C2-B1.1 — Harden auxiliary account generation across all four functions

## Plain-English explanation
This migration fixes three critical defects in the four auxiliary-account functions:

1. `get_or_create_customer_account` and `get_or_create_supplier_account` referenced a
   non-existent `user_tenants` table for tenant access checks. Replaced with a
   `current_tenant_id() IS DISTINCT FROM p_tenant_id` guard that works for authenticated
   callers while still allowing postgres/service_role internal calls.

2. `assign_customer_account_code` and `assign_supplier_account_code` (BEFORE INSERT
   triggers) used hardcoded prefixes '411'/'401' and only scanned their own tier table
   for the MAX sequence, with no advisory lock and no `accounts` row creation.

3. All four functions used `ON CONFLICT DO NOTHING` for operational account creation,
   which could silently fail and assign a tier to a code whose account row was never
   validated.

## Changes to functions

### `get_or_create_customer_account(uuid, uuid)` — rewritten
- Tenant guard: uses `current_tenant_id() IS DISTINCT FROM p_tenant_id` when
  `auth.uid() IS NOT NULL`. No reference to `user_tenants`.
- Prefix derived from `resolve_account(p_tenant_id, 'CUSTOMER_CONTROL')`.
- Advisory lock key unified: `hashtext(p_tenant_id::text || ':' || v_prefix)`.
- Next suffix computed from MAX across `customers`, `suppliers`, AND `accounts`.
- Overflow guard: raises error if suffix >= 10000 (code would exceed 7 digits).
- No `ON CONFLICT DO NOTHING` for new account: plain INSERT that will fail on
  true conflict (impossible under advisory lock, but safe).
- Existing code path: validates format, prefix, and account attributes
  (class=4, account_type='auxiliary', is_active=true). Creates missing accounts
  row only after validation. Never modifies existing accounts.
- Security: SECURITY DEFINER, owner postgres, search_path=public.
- Privileges: REVOKE from PUBLIC/anon/authenticated; GRANT to postgres + service_role.

### `get_or_create_supplier_account(uuid, uuid)` — same treatment
- Identical logic with SUPPLIER_CONTROL role code and `suppliers` table.

### `assign_customer_account_code()` — trigger function rewritten
- SECURITY DEFINER, owner postgres, search_path=public.
- Derives prefix from `resolve_account(NEW.tenant_id, 'CUSTOMER_CONTROL')`.
- Same advisory lock key as the helper.
- Scans customers + suppliers + accounts for MAX suffix.
- Overflow guard (suffix >= 10000).
- Creates accounts row in the same transaction (plain INSERT, no ON CONFLICT).
- Validates existing code if non-NULL: format, prefix, account attributes.
- REVOKE EXECUTE from PUBLIC/anon/authenticated.

### `assign_supplier_account_code()` — trigger function rewritten
- Same treatment with SUPPLIER_CONTROL role code.

## Important notes
1. Trigger names and events are NOT changed (`trg_assign_customer_account_code`
   BEFORE INSERT ON customers, `trg_assign_supplier_account_code` BEFORE INSERT
   ON suppliers).
2. No existing data is modified: no account_code changes, no accounts modifications,
   no journal changes.
3. The 991 accounts backfilled by PC1E-C2-B1 remain untouched.
4. The unified lock key `hashtext(tenant_id::text || ':' || prefix)` ensures that
   both triggers and helpers serialize against each other for the same prefix.
*/

-- ============================================================
-- PART 1: get_or_create_customer_account
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
  v_acct        record;
BEGIN
  -- Tenant access guard for authenticated callers
  IF auth.uid() IS NOT NULL THEN
    IF current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'Access denied: caller tenant does not match p_tenant_id %', p_tenant_id;
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

  -- Resolve collective account and derive prefix
  v_collective := resolve_account(p_tenant_id, 'CUSTOMER_CONTROL');
  IF v_collective IS NULL THEN
    RAISE EXCEPTION 'No CUSTOMER_CONTROL mapping for tenant %', p_tenant_id;
  END IF;
  v_prefix := left(v_collective, 3);

  -- If code already assigned, validate and ensure accounts row
  IF v_code IS NOT NULL AND v_code <> '' THEN
    IF v_code !~ '^\d{7}$' THEN
      RAISE EXCEPTION 'Customer % has malformed account_code %: expected 7 digits', p_customer_id, v_code;
    END IF;
    IF left(v_code, 3) <> v_prefix THEN
      RAISE EXCEPTION 'Customer % account_code % does not match expected prefix %', p_customer_id, v_code, v_prefix;
    END IF;

    SELECT a.class, a.account_type, a.is_active
      INTO v_acct
      FROM accounts a
     WHERE a.tenant_id = p_tenant_id AND a.code = v_code;

    IF NOT FOUND THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
      VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true);
    ELSE
      IF v_acct.class <> 4 OR v_acct.account_type <> 'auxiliary' OR v_acct.is_active <> true THEN
        RAISE EXCEPTION 'Account % in tenant % exists but has incompatible attributes (class=%, type=%, active=%)',
          v_code, p_tenant_id, v_acct.class, v_acct.account_type, v_acct.is_active;
      END IF;
    END IF;

    RETURN v_code;
  END IF;

  -- Serialize code generation for this tenant + prefix
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || v_prefix));

  -- Compute max suffix across all three sources
  SELECT COALESCE(MAX(suffix), 0) + 1 INTO v_next_num
  FROM (
    SELECT CAST(SUBSTRING(c2.account_code FROM 4) AS int) AS suffix
      FROM customers c2
     WHERE c2.tenant_id = p_tenant_id
       AND c2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL
    SELECT CAST(SUBSTRING(s2.account_code FROM 4) AS int)
      FROM suppliers s2
     WHERE s2.tenant_id = p_tenant_id
       AND s2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL
    SELECT CAST(SUBSTRING(a2.code FROM 4) AS int)
      FROM accounts a2
     WHERE a2.tenant_id = p_tenant_id
       AND a2.code ~ ('^' || v_prefix || '\d{4}$')
  ) combined;

  IF v_next_num > 9999 THEN
    RAISE EXCEPTION 'Auxiliary code overflow for tenant % prefix %: suffix % exceeds 9999',
      p_tenant_id, v_prefix, v_next_num;
  END IF;

  v_code := v_prefix || LPAD(v_next_num::text, 4, '0');

  -- Create account (strict INSERT, no ON CONFLICT)
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
  VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true);

  -- Assign to customer
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
-- PART 2: get_or_create_supplier_account
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
  v_acct        record;
BEGIN
  -- Tenant access guard for authenticated callers
  IF auth.uid() IS NOT NULL THEN
    IF current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'Access denied: caller tenant does not match p_tenant_id %', p_tenant_id;
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

  -- Resolve collective account and derive prefix
  v_collective := resolve_account(p_tenant_id, 'SUPPLIER_CONTROL');
  IF v_collective IS NULL THEN
    RAISE EXCEPTION 'No SUPPLIER_CONTROL mapping for tenant %', p_tenant_id;
  END IF;
  v_prefix := left(v_collective, 3);

  -- If code already assigned, validate and ensure accounts row
  IF v_code IS NOT NULL AND v_code <> '' THEN
    IF v_code !~ '^\d{7}$' THEN
      RAISE EXCEPTION 'Supplier % has malformed account_code %: expected 7 digits', p_supplier_id, v_code;
    END IF;
    IF left(v_code, 3) <> v_prefix THEN
      RAISE EXCEPTION 'Supplier % account_code % does not match expected prefix %', p_supplier_id, v_code, v_prefix;
    END IF;

    SELECT a.class, a.account_type, a.is_active
      INTO v_acct
      FROM accounts a
     WHERE a.tenant_id = p_tenant_id AND a.code = v_code;

    IF NOT FOUND THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
      VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true);
    ELSE
      IF v_acct.class <> 4 OR v_acct.account_type <> 'auxiliary' OR v_acct.is_active <> true THEN
        RAISE EXCEPTION 'Account % in tenant % exists but has incompatible attributes (class=%, type=%, active=%)',
          v_code, p_tenant_id, v_acct.class, v_acct.account_type, v_acct.is_active;
      END IF;
    END IF;

    RETURN v_code;
  END IF;

  -- Serialize code generation for this tenant + prefix
  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || v_prefix));

  -- Compute max suffix across all three sources
  SELECT COALESCE(MAX(suffix), 0) + 1 INTO v_next_num
  FROM (
    SELECT CAST(SUBSTRING(c2.account_code FROM 4) AS int) AS suffix
      FROM customers c2
     WHERE c2.tenant_id = p_tenant_id
       AND c2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL
    SELECT CAST(SUBSTRING(s2.account_code FROM 4) AS int)
      FROM suppliers s2
     WHERE s2.tenant_id = p_tenant_id
       AND s2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL
    SELECT CAST(SUBSTRING(a2.code FROM 4) AS int)
      FROM accounts a2
     WHERE a2.tenant_id = p_tenant_id
       AND a2.code ~ ('^' || v_prefix || '\d{4}$')
  ) combined;

  IF v_next_num > 9999 THEN
    RAISE EXCEPTION 'Auxiliary code overflow for tenant % prefix %: suffix % exceeds 9999',
      p_tenant_id, v_prefix, v_next_num;
  END IF;

  v_code := v_prefix || LPAD(v_next_num::text, 4, '0');

  -- Create account (strict INSERT, no ON CONFLICT)
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
  VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true);

  -- Assign to supplier
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

-- ============================================================
-- PART 3: assign_customer_account_code trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_customer_account_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_collective  text;
  v_prefix      text;
  v_next_num    int;
  v_acct        record;
BEGIN
  -- If account_code already provided on INSERT, validate it
  IF NEW.account_code IS NOT NULL AND NEW.account_code <> '' THEN
    v_collective := resolve_account(NEW.tenant_id, 'CUSTOMER_CONTROL');
    IF v_collective IS NULL THEN
      RAISE EXCEPTION 'No CUSTOMER_CONTROL mapping for tenant %', NEW.tenant_id;
    END IF;
    v_prefix := left(v_collective, 3);

    IF NEW.account_code !~ '^\d{7}$' THEN
      RAISE EXCEPTION 'Customer account_code % is malformed: expected 7 digits', NEW.account_code;
    END IF;
    IF left(NEW.account_code, 3) <> v_prefix THEN
      RAISE EXCEPTION 'Customer account_code % does not match expected prefix %', NEW.account_code, v_prefix;
    END IF;

    -- Ensure account row exists in accounts
    SELECT a.class, a.account_type, a.is_active
      INTO v_acct
      FROM accounts a
     WHERE a.tenant_id = NEW.tenant_id AND a.code = NEW.account_code;

    IF NOT FOUND THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
      VALUES (NEW.tenant_id, NEW.account_code, NEW.name, 4, 'auxiliary', true);
    ELSE
      IF v_acct.class <> 4 OR v_acct.account_type <> 'auxiliary' OR v_acct.is_active <> true THEN
        RAISE EXCEPTION 'Account % in tenant % has incompatible attributes (class=%, type=%, active=%)',
          NEW.account_code, NEW.tenant_id, v_acct.class, v_acct.account_type, v_acct.is_active;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- Auto-generate: resolve prefix from collective account
  v_collective := resolve_account(NEW.tenant_id, 'CUSTOMER_CONTROL');
  IF v_collective IS NULL THEN
    RAISE EXCEPTION 'No CUSTOMER_CONTROL mapping for tenant %', NEW.tenant_id;
  END IF;
  v_prefix := left(v_collective, 3);

  -- Serialize with same key as the helper function
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || ':' || v_prefix));

  -- Max suffix across all three sources
  SELECT COALESCE(MAX(suffix), 0) + 1 INTO v_next_num
  FROM (
    SELECT CAST(SUBSTRING(c2.account_code FROM 4) AS int) AS suffix
      FROM customers c2
     WHERE c2.tenant_id = NEW.tenant_id
       AND c2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL
    SELECT CAST(SUBSTRING(s2.account_code FROM 4) AS int)
      FROM suppliers s2
     WHERE s2.tenant_id = NEW.tenant_id
       AND s2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL
    SELECT CAST(SUBSTRING(a2.code FROM 4) AS int)
      FROM accounts a2
     WHERE a2.tenant_id = NEW.tenant_id
       AND a2.code ~ ('^' || v_prefix || '\d{4}$')
  ) combined;

  IF v_next_num > 9999 THEN
    RAISE EXCEPTION 'Auxiliary code overflow for tenant % prefix %: suffix % exceeds 9999',
      NEW.tenant_id, v_prefix, v_next_num;
  END IF;

  NEW.account_code := v_prefix || LPAD(v_next_num::text, 4, '0');

  -- Create account row in the same transaction
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
  VALUES (NEW.tenant_id, NEW.account_code, NEW.name, 4, 'auxiliary', true);

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.assign_customer_account_code() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_customer_account_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_customer_account_code() FROM anon;
REVOKE ALL ON FUNCTION public.assign_customer_account_code() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_customer_account_code() TO postgres;
GRANT EXECUTE ON FUNCTION public.assign_customer_account_code() TO service_role;

-- ============================================================
-- PART 4: assign_supplier_account_code trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION public.assign_supplier_account_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_collective  text;
  v_prefix      text;
  v_next_num    int;
  v_acct        record;
BEGIN
  -- If account_code already provided on INSERT, validate it
  IF NEW.account_code IS NOT NULL AND NEW.account_code <> '' THEN
    v_collective := resolve_account(NEW.tenant_id, 'SUPPLIER_CONTROL');
    IF v_collective IS NULL THEN
      RAISE EXCEPTION 'No SUPPLIER_CONTROL mapping for tenant %', NEW.tenant_id;
    END IF;
    v_prefix := left(v_collective, 3);

    IF NEW.account_code !~ '^\d{7}$' THEN
      RAISE EXCEPTION 'Supplier account_code % is malformed: expected 7 digits', NEW.account_code;
    END IF;
    IF left(NEW.account_code, 3) <> v_prefix THEN
      RAISE EXCEPTION 'Supplier account_code % does not match expected prefix %', NEW.account_code, v_prefix;
    END IF;

    -- Ensure account row exists in accounts
    SELECT a.class, a.account_type, a.is_active
      INTO v_acct
      FROM accounts a
     WHERE a.tenant_id = NEW.tenant_id AND a.code = NEW.account_code;

    IF NOT FOUND THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
      VALUES (NEW.tenant_id, NEW.account_code, NEW.name, 4, 'auxiliary', true);
    ELSE
      IF v_acct.class <> 4 OR v_acct.account_type <> 'auxiliary' OR v_acct.is_active <> true THEN
        RAISE EXCEPTION 'Account % in tenant % has incompatible attributes (class=%, type=%, active=%)',
          NEW.account_code, NEW.tenant_id, v_acct.class, v_acct.account_type, v_acct.is_active;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  -- Auto-generate: resolve prefix from collective account
  v_collective := resolve_account(NEW.tenant_id, 'SUPPLIER_CONTROL');
  IF v_collective IS NULL THEN
    RAISE EXCEPTION 'No SUPPLIER_CONTROL mapping for tenant %', NEW.tenant_id;
  END IF;
  v_prefix := left(v_collective, 3);

  -- Serialize with same key as the helper function
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || ':' || v_prefix));

  -- Max suffix across all three sources
  SELECT COALESCE(MAX(suffix), 0) + 1 INTO v_next_num
  FROM (
    SELECT CAST(SUBSTRING(c2.account_code FROM 4) AS int) AS suffix
      FROM customers c2
     WHERE c2.tenant_id = NEW.tenant_id
       AND c2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL
    SELECT CAST(SUBSTRING(s2.account_code FROM 4) AS int)
      FROM suppliers s2
     WHERE s2.tenant_id = NEW.tenant_id
       AND s2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL
    SELECT CAST(SUBSTRING(a2.code FROM 4) AS int)
      FROM accounts a2
     WHERE a2.tenant_id = NEW.tenant_id
       AND a2.code ~ ('^' || v_prefix || '\d{4}$')
  ) combined;

  IF v_next_num > 9999 THEN
    RAISE EXCEPTION 'Auxiliary code overflow for tenant % prefix %: suffix % exceeds 9999',
      NEW.tenant_id, v_prefix, v_next_num;
  END IF;

  NEW.account_code := v_prefix || LPAD(v_next_num::text, 4, '0');

  -- Create account row in the same transaction
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
  VALUES (NEW.tenant_id, NEW.account_code, NEW.name, 4, 'auxiliary', true);

  RETURN NEW;
END;
$function$;

ALTER FUNCTION public.assign_supplier_account_code() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_supplier_account_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_supplier_account_code() FROM anon;
REVOKE ALL ON FUNCTION public.assign_supplier_account_code() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_supplier_account_code() TO postgres;
GRANT EXECUTE ON FUNCTION public.assign_supplier_account_code() TO service_role;
