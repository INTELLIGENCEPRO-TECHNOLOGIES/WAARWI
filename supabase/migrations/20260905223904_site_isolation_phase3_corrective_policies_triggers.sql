/*
# Site Isolation Phase 3 – Corrective Policies & Triggers

## Summary
This migration enforces site-level isolation across the multi-tenant schema.
It replaces all existing RLS policies on `sites`, `part_categories`, and
`expense_categories` with fine-grained, site-scoped policies, adds mutation
guards, fixes uniqueness constraints, restricts tenant updates, and hardens
the negative-stock trigger.

## Changes

### 1. Helper functions created (idempotent)
- `is_tenant_owner()` – returns TRUE when the authenticated user is the
  tenant owner (profiles.role = 'owner' OR tenants.owner_user_id = auth.uid()).
- `current_user_root_site_ids()` – returns the set of root (non-warehouse)
  site IDs the current user can manage.

### 2. sites – policies
All prior policies on `sites` are dropped dynamically.
New policies enforce:
- **SELECT**: tenant scope + (owner sees all, others see only accessible sites).
- **INSERT**: tenant scope + (only owner can create root stores; staff can
  create depots under their root sites).
- **UPDATE**: tenant scope + owner or accessible site.
- **DELETE**: tenant scope + owner only + root stores only (no warehouse
  deletion via this policy).

### 3. sites – mutation protection trigger
`trg_protect_site_mutation` (BEFORE UPDATE) prevents changing `tenant_id`,
`is_warehouse`, or `parent_site_id` unless the caller is the tenant owner
or a service_role caller (e.g. migrations / edge functions).

### 4. part_categories – policies
All prior policies dropped. New policies enforce:
- **SELECT (authenticated)**: tenant scope + (global categories OR
  site-accessible categories).
- **INSERT (authenticated)**: tenant scope + (global only if owner; otherwise
  site_id required and must be accessible).
- **UPDATE (authenticated)**: same as INSERT for CHECK; USING guards access.
- **DELETE (authenticated)**: tenant + site access.
- **SELECT (anon)**: tenant scope + is_active = true (shop / public catalog).

### 5. expense_categories – policies
Same pattern as part_categories (SELECT/INSERT/UPDATE/DELETE for authenticated
with site scope). No anon policy needed.

### 6. expense_categories – unique constraint fix
Drops the old `expense_categories_tenant_id_name_key` unique constraint.
Creates two partial unique indexes:
- `expense_categories_tenant_global_name_uq` — global (site_id IS NULL).
- `expense_categories_tenant_site_name_uq`  — per-site (site_id IS NOT NULL).

### 7. tenants – UPDATE policy restriction
Drops all existing UPDATE policies on `tenants`.
New policy restricts UPDATE to tenant owner or service_role.

### 8. Negative stock trigger fix
Drops and recreates `check_negative_stock_trigger_fn()` (SECURITY DEFINER).
Fires on INSERT OR UPDATE of `stock_levels`.
For depots (is_warehouse = true), checks the *parent* site's
`allow_negative_stock` flag. Raises exception if negative stock is
forbidden and NEW.quantity < 0.

## Security
- All helper functions are SECURITY DEFINER with `search_path = 'public'`.
- Trigger functions owned by postgres.
- Dynamic policy drops use `pg_policies` catalog — no hard-coded names.

## Important Notes
1. This migration is **idempotent**: dynamic drops + CREATE OR REPLACE.
2. No transaction control statements (BEGIN/COMMIT) — Supabase wraps
   migrations automatically.
3. Existing data is not modified — only DDL and RLS changes.
*/

-- ============================================================
-- 0. HELPER FUNCTIONS (idempotent, CREATE OR REPLACE)
-- ============================================================

-- is_tenant_owner(): TRUE if the calling user owns the tenant
CREATE OR REPLACE FUNCTION public.is_tenant_owner()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN tenants t ON t.id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (p.role = 'owner' OR t.owner_user_id = auth.uid())
  );
$$;

-- current_user_root_site_ids(): returns the root (non-warehouse) site IDs
-- the current user can access. Owner / site_access_mode='all' sees every
-- root site; otherwise only assigned roots.
CREATE OR REPLACE FUNCTION public.current_user_root_site_ids()
RETURNS SETOF uuid
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_prof record;
BEGIN
  SELECT p.id, p.tenant_id, p.site_access_mode, p.assigned_site_ids, p.role
    INTO v_prof
    FROM profiles p
   WHERE p.id = auth.uid();

  IF v_prof IS NULL OR v_prof.tenant_id IS NULL THEN
    RETURN;
  END IF;

  -- Owner or 'all' access → every root site in the tenant
  IF v_prof.role = 'owner'
     OR v_prof.site_access_mode = 'all'
     OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = v_prof.tenant_id AND t.owner_user_id = v_prof.id)
  THEN
    RETURN QUERY
      SELECT s.id FROM sites s
       WHERE s.tenant_id = v_prof.tenant_id
         AND s.is_warehouse = false;
    RETURN;
  END IF;

  -- Assigned sites → filter to root (non-warehouse) only
  IF v_prof.assigned_site_ids IS NOT NULL AND array_length(v_prof.assigned_site_ids, 1) > 0 THEN
    RETURN QUERY
      SELECT s.id FROM sites s
       WHERE s.id = ANY(v_prof.assigned_site_ids)
         AND s.tenant_id = v_prof.tenant_id
         AND s.is_warehouse = false;
    RETURN;
  END IF;

  -- No assignment → no root sites
  RETURN;
END;
$$;

-- ============================================================
-- 1. DROP ALL EXISTING POLICIES on sites, part_categories,
--    expense_categories
-- ============================================================

DO $drop$
DECLARE
  _rec record;
BEGIN
  FOR _rec IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename IN ('sites', 'part_categories', 'expense_categories')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
                   _rec.policyname, _rec.schemaname, _rec.tablename);
  END LOOP;
END
$drop$;

-- ============================================================
-- 2. SITES POLICIES
-- ============================================================

-- SELECT: tenant scope + owner sees all, staff sees accessible sites
CREATE POLICY "sites_select_scoped"
  ON public.sites FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      is_tenant_owner()
      OR (
        -- root stores the user can access
        (is_warehouse = false AND id IN (SELECT current_user_root_site_ids()))
        OR
        -- depots whose parent the user can access
        (is_warehouse = true AND parent_site_id IN (SELECT current_user_root_site_ids()))
      )
    )
  );

-- INSERT: owner can create root stores; staff can create depots under
-- their root sites
CREATE POLICY "sites_insert_scoped"
  ON public.sites FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      -- depot (warehouse) → parent must be a root site accessible to user
      (is_warehouse = true AND parent_site_id IN (SELECT current_user_root_site_ids()))
      OR
      -- root store → only tenant owner may create
      (is_warehouse = false AND is_tenant_owner())
    )
  );

-- UPDATE: tenant scope + owner or accessible site
CREATE POLICY "sites_update_scoped"
  ON public.sites FOR UPDATE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      is_tenant_owner()
      OR id IN (SELECT current_user_root_site_ids())
      OR parent_site_id IN (SELECT current_user_root_site_ids())
    )
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      is_tenant_owner()
      OR id IN (SELECT current_user_root_site_ids())
      OR parent_site_id IN (SELECT current_user_root_site_ids())
    )
  );

-- DELETE: only owner can delete root stores (not warehouses)
CREATE POLICY "sites_delete_scoped"
  ON public.sites FOR DELETE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND is_tenant_owner()
    AND is_warehouse = false
  );

-- ============================================================
-- 3. SITE MUTATION PROTECTION TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION public.protect_site_mutation_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_is_owner boolean;
  v_jwt_role text;
BEGIN
  -- Service-role callers (migrations, edge functions) are always allowed
  v_jwt_role := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
  IF v_jwt_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Tenant owners are allowed to change structural fields
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN tenants t ON t.id = p.tenant_id
    WHERE p.id = auth.uid()
      AND (p.role = 'owner' OR t.owner_user_id = auth.uid())
  ) INTO v_is_owner;

  IF v_is_owner THEN
    RETURN NEW;
  END IF;

  -- Non-owner: block changes to protected columns
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    RAISE EXCEPTION 'Only the tenant owner can change tenant_id on a site'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_warehouse IS DISTINCT FROM OLD.is_warehouse THEN
    RAISE EXCEPTION 'Only the tenant owner can change is_warehouse on a site'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.parent_site_id IS DISTINCT FROM OLD.parent_site_id THEN
    RAISE EXCEPTION 'Only the tenant owner can change parent_site_id on a site'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure the function is owned by postgres
ALTER FUNCTION public.protect_site_mutation_fn() OWNER TO postgres;

-- Drop the trigger if it already exists, then create it
DROP TRIGGER IF EXISTS trg_protect_site_mutation ON public.sites;
CREATE TRIGGER trg_protect_site_mutation
  BEFORE UPDATE ON public.sites
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_site_mutation_fn();

-- ============================================================
-- 4. PART_CATEGORIES POLICIES
-- ============================================================

-- SELECT for authenticated: tenant scope + (global OR site-accessible)
CREATE POLICY "part_categories_select_scoped"
  ON public.part_categories FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      site_id IS NULL
      OR current_user_can_access_site(site_id)
    )
  );

-- INSERT for authenticated: tenant scope + site scoping rules
CREATE POLICY "part_categories_insert_scoped"
  ON public.part_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      -- Global category (site_id IS NULL) → only tenant owner
      (site_id IS NULL AND is_tenant_owner())
      OR
      -- Site-specific category → must have access to that site
      (site_id IS NOT NULL AND current_user_can_access_site(site_id))
    )
  );

-- UPDATE for authenticated: USING checks current access; CHECK validates new row
CREATE POLICY "part_categories_update_scoped"
  ON public.part_categories FOR UPDATE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      site_id IS NULL
      OR current_user_can_access_site(site_id)
    )
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      (site_id IS NULL AND is_tenant_owner())
      OR
      (site_id IS NOT NULL AND current_user_can_access_site(site_id))
    )
  );

-- DELETE for authenticated: tenant + site access
CREATE POLICY "part_categories_delete_scoped"
  ON public.part_categories FOR DELETE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      site_id IS NULL
      OR current_user_can_access_site(site_id)
    )
  );

-- SELECT for anon (shop / public catalog): active categories only
CREATE POLICY "part_categories_anon_select_active"
  ON public.part_categories FOR SELECT
  TO anon
  USING (
    tenant_id = current_tenant_id()
    AND is_active = true
  );

-- ============================================================
-- 5. EXPENSE_CATEGORIES POLICIES
-- ============================================================

-- SELECT for authenticated
CREATE POLICY "expense_categories_select_scoped"
  ON public.expense_categories FOR SELECT
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      site_id IS NULL
      OR current_user_can_access_site(site_id)
    )
  );

-- INSERT for authenticated
CREATE POLICY "expense_categories_insert_scoped"
  ON public.expense_categories FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      (site_id IS NULL AND is_tenant_owner())
      OR
      (site_id IS NOT NULL AND current_user_can_access_site(site_id))
    )
  );

-- UPDATE for authenticated
CREATE POLICY "expense_categories_update_scoped"
  ON public.expense_categories FOR UPDATE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      site_id IS NULL
      OR current_user_can_access_site(site_id)
    )
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      (site_id IS NULL AND is_tenant_owner())
      OR
      (site_id IS NOT NULL AND current_user_can_access_site(site_id))
    )
  );

-- DELETE for authenticated
CREATE POLICY "expense_categories_delete_scoped"
  ON public.expense_categories FOR DELETE
  TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND (
      site_id IS NULL
      OR current_user_can_access_site(site_id)
    )
  );

-- ============================================================
-- 6. FIX expense_categories UNIQUE CONSTRAINT
-- ============================================================

-- Drop the old global unique constraint (tenant_id, name)
ALTER TABLE public.expense_categories
  DROP CONSTRAINT IF EXISTS expense_categories_tenant_id_name_key;

-- Global uniqueness: one name per tenant when site_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_tenant_global_name_uq
  ON public.expense_categories (tenant_id, name)
  WHERE site_id IS NULL;

-- Per-site uniqueness: one name per (tenant, site) when site_id IS NOT NULL
CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_tenant_site_name_uq
  ON public.expense_categories (tenant_id, site_id, name)
  WHERE site_id IS NOT NULL;

-- ============================================================
-- 7. RESTRICT tenants UPDATE POLICY
-- ============================================================

-- Dynamically drop all existing UPDATE policies on tenants
DO $drop_tenants$
DECLARE
  _rec record;
BEGIN
  FOR _rec IN
    SELECT policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'tenants'
       AND cmd        = 'UPDATE'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.tenants', _rec.policyname);
  END LOOP;
END
$drop_tenants$;

-- New restricted UPDATE policy: only owner or service_role
CREATE POLICY "tenants_update_owner_only"
  ON public.tenants FOR UPDATE
  TO authenticated
  USING (
    id = current_tenant_id()
    AND (
      is_tenant_owner()
      OR (coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'service_role')
    )
  )
  WITH CHECK (
    id = current_tenant_id()
    AND (
      is_tenant_owner()
      OR (coalesce(current_setting('request.jwt.claims', true)::json->>'role', '') = 'service_role')
    )
  );

-- ============================================================
-- 8. FIX NEGATIVE STOCK TRIGGER
-- ============================================================

-- Drop the old trigger and function
DROP TRIGGER IF EXISTS trg_guard_negative_stock ON public.stock_levels;
DROP FUNCTION IF EXISTS public._guard_negative_stock();

-- New trigger function: checks allow_negative_stock on the site (or
-- parent site for depots). Fires on INSERT OR UPDATE.
CREATE OR REPLACE FUNCTION public.check_negative_stock_trigger_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_site            record;
  v_allow_negative  boolean;
BEGIN
  -- Only check when quantity is going negative
  IF NEW.quantity >= 0 THEN
    RETURN NEW;
  END IF;

  -- Fetch the site record
  SELECT s.id, s.is_warehouse, s.parent_site_id, s.allow_negative_stock
    INTO v_site
    FROM sites s
   WHERE s.id = NEW.site_id;

  -- If site not found, allow (defensive)
  IF v_site IS NULL THEN
    RETURN NEW;
  END IF;

  -- For depots (is_warehouse = true), check the PARENT site's flag
  IF v_site.is_warehouse = true AND v_site.parent_site_id IS NOT NULL THEN
    SELECT allow_negative_stock
      INTO v_allow_negative
      FROM sites
     WHERE id = v_site.parent_site_id;

    -- If parent not found, fall back to the depot's own flag
    IF v_allow_negative IS NULL THEN
      v_allow_negative := v_site.allow_negative_stock;
    END IF;
  ELSE
    -- Root store: use its own flag
    v_allow_negative := v_site.allow_negative_stock;
  END IF;

  -- Enforce the constraint
  IF v_allow_negative = false THEN
    RAISE EXCEPTION '[NEGATIVE_STOCK_FORBIDDEN] Stock négatif interdit pour ce magasin';
  END IF;

  RETURN NEW;
END;
$$;

-- Ensure ownership
ALTER FUNCTION public.check_negative_stock_trigger_fn() OWNER TO postgres;

-- Create trigger on INSERT OR UPDATE
CREATE TRIGGER trg_guard_negative_stock
  BEFORE INSERT OR UPDATE ON public.stock_levels
  FOR EACH ROW
  EXECUTE FUNCTION public.check_negative_stock_trigger_fn();
