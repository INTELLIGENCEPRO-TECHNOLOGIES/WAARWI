/*
# Site-scoped expense category settings

## Summary
Adds per-site activation/deactivation for legacy global expense categories and
provides RPCs for site-scoped creation, toggling, and reading of expense categories.

## 1. New Table: expense_category_site_settings
  - id (uuid, PK)
  - tenant_id (uuid, NOT NULL, FK tenants)
  - expense_category_id (uuid, NOT NULL, FK expense_categories)
  - site_id (uuid, NOT NULL, FK sites)
  - is_enabled (boolean, NOT NULL)
  - created_at (timestamptz)
  - updated_at (timestamptz)
  - UNIQUE(tenant_id, expense_category_id, site_id)
  Only for legacy global categories (expense_categories.site_id IS NULL).

## 2. New RPCs
  - get_effective_expense_categories(p_site_id, p_include_inactive) — returns
    merged list of global + site-local categories with effective_enabled status.
  - create_expense_category_for_site(p_site_id, p_name) — creates a site-local category.
  - set_expense_category_enabled_for_site(p_site_id, p_category_id, p_enabled) — toggles
    a category for a specific site.
  - is_expense_category_available_for_site(p_category_id, p_site_id) — helper boolean
    for RLS INSERT guard on cash_movements.

## 3. Security
  - RLS on expense_category_site_settings (4 policies, tenant + site scoped).
  - Extended cash_movements INSERT policy to validate expense_category availability.
  - All RPCs: REVOKE from PUBLIC/anon, GRANT to authenticated only.

## 4. Backup registry
  - Registers expense_category_site_settings in _br_table_registry.

## Important notes
  - No existing data is modified.
  - record_cash_movement is NOT modified.
  - No backfill — the settings table starts empty.
  - Old sauvegardes remain compatible (is_mandatory = false).
*/

-- ============================================================
-- 1. Table: expense_category_site_settings
-- ============================================================
CREATE TABLE IF NOT EXISTS public.expense_category_site_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  expense_category_id uuid NOT NULL REFERENCES expense_categories(id) ON DELETE CASCADE,
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  is_enabled  boolean NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, expense_category_id, site_id)
);

ALTER TABLE public.expense_category_site_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ecss_select" ON public.expense_category_site_settings;
CREATE POLICY "ecss_select" ON public.expense_category_site_settings
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND current_user_can_access_site(site_id));

DROP POLICY IF EXISTS "ecss_insert" ON public.expense_category_site_settings;
CREATE POLICY "ecss_insert" ON public.expense_category_site_settings
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND current_user_can_access_site(site_id));

DROP POLICY IF EXISTS "ecss_update" ON public.expense_category_site_settings;
CREATE POLICY "ecss_update" ON public.expense_category_site_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND current_user_can_access_site(site_id))
  WITH CHECK (tenant_id = current_tenant_id() AND current_user_can_access_site(site_id));

DROP POLICY IF EXISTS "ecss_delete" ON public.expense_category_site_settings;
CREATE POLICY "ecss_delete" ON public.expense_category_site_settings
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND current_user_can_access_site(site_id));

CREATE INDEX IF NOT EXISTS idx_ecss_tenant_site
  ON public.expense_category_site_settings (tenant_id, site_id);

-- ============================================================
-- 2. RPC: get_effective_expense_categories
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_effective_expense_categories(
  p_site_id uuid,
  p_include_inactive boolean DEFAULT false
)
RETURNS TABLE (
  id uuid,
  name text,
  site_id uuid,
  scope text,
  effective_enabled boolean
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_root_site_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT current_user_can_access_site(p_site_id) THEN
    RAISE EXCEPTION 'Access denied to site %', p_site_id;
  END IF;

  v_root_site_id := resolve_root_site_id(p_site_id);

  RETURN QUERY
  SELECT
    ec.id,
    ec.name,
    ec.site_id,
    CASE WHEN ec.site_id IS NULL THEN 'legacy_global' ELSE 'site' END AS scope,
    CASE
      WHEN ec.site_id IS NULL THEN
        COALESCE(ecss.is_enabled, ec.is_active)
      ELSE
        ec.is_active
    END AS effective_enabled
  FROM expense_categories ec
  LEFT JOIN expense_category_site_settings ecss
    ON ecss.expense_category_id = ec.id
    AND ecss.site_id = v_root_site_id
    AND ecss.tenant_id = v_tenant_id
  WHERE ec.tenant_id = v_tenant_id
    AND (
      ec.site_id IS NULL
      OR ec.site_id = v_root_site_id
    )
    AND (
      p_include_inactive
      OR CASE
           WHEN ec.site_id IS NULL THEN COALESCE(ecss.is_enabled, ec.is_active)
           ELSE ec.is_active
         END = true
    )
  ORDER BY ec.name;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_effective_expense_categories(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_effective_expense_categories(uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_effective_expense_categories(uuid, boolean) TO authenticated;

-- ============================================================
-- 3. RPC: create_expense_category_for_site
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_expense_category_for_site(
  p_site_id uuid,
  p_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_root_site_id uuid;
  v_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT current_user_can_access_site(p_site_id) THEN
    RAISE EXCEPTION 'Access denied to site %', p_site_id;
  END IF;

  IF trim(p_name) = '' OR p_name IS NULL THEN
    RAISE EXCEPTION 'Name cannot be empty';
  END IF;

  v_root_site_id := resolve_root_site_id(p_site_id);

  INSERT INTO expense_categories (tenant_id, name, site_id, is_active)
  VALUES (v_tenant_id, trim(p_name), v_root_site_id, true)
  RETURNING expense_categories.id INTO v_id;

  RETURN v_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_expense_category_for_site(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_expense_category_for_site(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_expense_category_for_site(uuid, text) TO authenticated;

-- ============================================================
-- 4. RPC: set_expense_category_enabled_for_site
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_expense_category_enabled_for_site(
  p_site_id uuid,
  p_category_id uuid,
  p_enabled boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_root_site_id uuid;
  v_cat_site_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT current_user_can_access_site(p_site_id) THEN
    RAISE EXCEPTION 'Access denied to site %', p_site_id;
  END IF;

  v_root_site_id := resolve_root_site_id(p_site_id);

  SELECT ec.site_id INTO v_cat_site_id
  FROM expense_categories ec
  WHERE ec.id = p_category_id AND ec.tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found';
  END IF;

  IF v_cat_site_id IS NULL THEN
    -- Global category: upsert into site settings
    INSERT INTO expense_category_site_settings
      (tenant_id, expense_category_id, site_id, is_enabled, updated_at)
    VALUES
      (v_tenant_id, p_category_id, v_root_site_id, p_enabled, now())
    ON CONFLICT (tenant_id, expense_category_id, site_id)
    DO UPDATE SET is_enabled = p_enabled, updated_at = now();
  ELSIF v_cat_site_id = v_root_site_id THEN
    -- Local category belonging to this site: toggle is_active
    UPDATE expense_categories
    SET is_active = p_enabled
    WHERE id = p_category_id
      AND tenant_id = v_tenant_id
      AND site_id = v_root_site_id;
  ELSE
    RAISE EXCEPTION 'Cannot modify a category belonging to another site';
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.set_expense_category_enabled_for_site(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_expense_category_enabled_for_site(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_expense_category_enabled_for_site(uuid, uuid, boolean) TO authenticated;

-- ============================================================
-- 5. Helper: is_expense_category_available_for_site
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_expense_category_available_for_site(
  p_category_id uuid,
  p_site_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_root_site_id uuid;
  v_cat_site_id uuid;
  v_cat_active boolean;
  v_override boolean;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN false; END IF;

  v_root_site_id := resolve_root_site_id(p_site_id);

  SELECT ec.site_id, ec.is_active
  INTO v_cat_site_id, v_cat_active
  FROM expense_categories ec
  WHERE ec.id = p_category_id AND ec.tenant_id = v_tenant_id;

  IF NOT FOUND THEN RETURN false; END IF;

  IF v_cat_site_id IS NULL THEN
    -- Global: check site override
    SELECT ecss.is_enabled INTO v_override
    FROM expense_category_site_settings ecss
    WHERE ecss.expense_category_id = p_category_id
      AND ecss.site_id = v_root_site_id
      AND ecss.tenant_id = v_tenant_id;
    RETURN COALESCE(v_override, v_cat_active);
  ELSIF v_cat_site_id = v_root_site_id THEN
    RETURN v_cat_active;
  ELSE
    RETURN false;
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.is_expense_category_available_for_site(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_expense_category_available_for_site(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_expense_category_available_for_site(uuid, uuid) TO authenticated;

-- ============================================================
-- 6. Extend cash_movements INSERT policy
-- ============================================================
DROP POLICY IF EXISTS "cash_movements tenant insert" ON public.cash_movements;
CREATE POLICY "cash_movements tenant insert" ON public.cash_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND (
      kind <> 'expense'
      OR expense_category_id IS NULL
      OR is_expense_category_available_for_site(expense_category_id, site_id)
    )
  );

-- ============================================================
-- 7. Backup registry
-- ============================================================
INSERT INTO public._br_table_registry (
  schema_name, table_name, tenant_link, category,
  restore_order, reset_behavior, is_mandatory
)
VALUES (
  'public', 'expense_category_site_settings', 'direct', 'structure',
  20, 'preserve', false
)
ON CONFLICT (schema_name, table_name)
DO UPDATE SET
  tenant_link = EXCLUDED.tenant_link,
  category = EXCLUDED.category,
  restore_order = EXCLUDED.restore_order,
  reset_behavior = EXCLUDED.reset_behavior,
  is_mandatory = EXCLUDED.is_mandatory;
