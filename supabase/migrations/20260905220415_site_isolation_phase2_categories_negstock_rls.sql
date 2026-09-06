/*
  # Site Isolation Phase 2 — Categories site_id, Negative Stock, RLS

  ## 1. New Columns
  - `part_categories.site_id` (uuid NULL) — NULL = global, set = per-site
  - `expense_categories.site_id` (uuid NULL) — same semantics
  - `sites.allow_negative_stock` (boolean NOT NULL DEFAULT false)

  ## 2. Backfill
  - Existing categories stay global (site_id NULL)
  - sites.allow_negative_stock from tenant settings or false

  ## 3. Uniqueness constraints
  - part_categories: unique(tenant_id, name, site_id) with COALESCE for null
  - expense_categories: same

  ## 4. RLS on sites table: add site-scope check
  ## 5. Negative stock trigger on stock_levels
  ## 6. Column privileges: restrict sensitive profile columns
*/

-- 1. NEW COLUMNS

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='part_categories' AND column_name='site_id') THEN
    ALTER TABLE part_categories ADD COLUMN site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='expense_categories' AND column_name='site_id') THEN
    ALTER TABLE expense_categories ADD COLUMN site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sites' AND column_name='allow_negative_stock') THEN
    ALTER TABLE sites ADD COLUMN allow_negative_stock boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- 2. BACKFILL sites.allow_negative_stock from tenant settings
UPDATE sites s
SET allow_negative_stock = COALESCE(
  (SELECT (t.settings->>'allow_negative_stock')::boolean
   FROM tenants t WHERE t.id = s.tenant_id),
  false
)
WHERE NOT s.is_warehouse;

-- Depots inherit from parent
UPDATE sites s
SET allow_negative_stock = COALESCE(
  (SELECT p.allow_negative_stock FROM sites p WHERE p.id = s.parent_site_id),
  false
)
WHERE s.is_warehouse AND s.parent_site_id IS NOT NULL;

-- 3. UNIQUENESS (use partial indexes for null-safe uniqueness)
DROP INDEX IF EXISTS idx_part_categories_unique_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_part_categories_unique_name_global
  ON part_categories (tenant_id, lower(name))
  WHERE site_id IS NULL AND parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_part_categories_unique_name_site
  ON part_categories (tenant_id, site_id, lower(name))
  WHERE site_id IS NOT NULL AND parent_id IS NULL;

DROP INDEX IF EXISTS idx_expense_categories_unique_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_unique_name_global
  ON expense_categories (tenant_id, lower(name))
  WHERE site_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_unique_name_site
  ON expense_categories (tenant_id, site_id, lower(name))
  WHERE site_id IS NOT NULL;

-- 4. SITE-SCOPED RLS ON sites TABLE
-- Users should only see sites they can access
DROP POLICY IF EXISTS "select_own_tenant_sites" ON sites;
CREATE POLICY "select_own_tenant_sites" ON sites FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "insert_own_tenant_sites" ON sites;
CREATE POLICY "insert_own_tenant_sites" ON sites FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "update_own_tenant_sites" ON sites;
CREATE POLICY "update_own_tenant_sites" ON sites FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "delete_own_tenant_sites" ON sites;
CREATE POLICY "delete_own_tenant_sites" ON sites FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id());

-- Category RLS: user sees global + own site categories
DROP POLICY IF EXISTS "select_part_categories" ON part_categories;
CREATE POLICY "select_part_categories" ON part_categories FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)));

DROP POLICY IF EXISTS "insert_part_categories" ON part_categories;
CREATE POLICY "insert_part_categories" ON part_categories FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)));

DROP POLICY IF EXISTS "update_part_categories" ON part_categories;
CREATE POLICY "update_part_categories" ON part_categories FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)))
  WITH CHECK (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)));

DROP POLICY IF EXISTS "delete_part_categories" ON part_categories;
CREATE POLICY "delete_part_categories" ON part_categories FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)));

-- Expense categories RLS
DROP POLICY IF EXISTS "select_expense_categories" ON expense_categories;
CREATE POLICY "select_expense_categories" ON expense_categories FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)));

DROP POLICY IF EXISTS "insert_expense_categories" ON expense_categories;
CREATE POLICY "insert_expense_categories" ON expense_categories FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)));

DROP POLICY IF EXISTS "update_expense_categories" ON expense_categories;
CREATE POLICY "update_expense_categories" ON expense_categories FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)))
  WITH CHECK (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)));

DROP POLICY IF EXISTS "delete_expense_categories" ON expense_categories;
CREATE POLICY "delete_expense_categories" ON expense_categories FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id() AND (site_id IS NULL OR current_user_can_access_site(site_id)));

-- 5. NEGATIVE STOCK GUARD ON stock_levels
CREATE OR REPLACE FUNCTION _guard_negative_stock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_article record;
  v_site record;
  v_root_site record;
BEGIN
  IF NEW.quantity < 0 AND (OLD.quantity IS NULL OR OLD.quantity >= 0 OR NEW.quantity < OLD.quantity) THEN
    SELECT track_stock INTO v_article FROM articles WHERE id = NEW.article_id;
    IF v_article IS NULL OR v_article.track_stock = false THEN RETURN NEW; END IF;

    SELECT s.*, COALESCE(s.parent_site_id, s.id) AS root_id INTO v_site
    FROM sites s WHERE s.id = NEW.site_id;

    IF v_site IS NULL THEN RETURN NEW; END IF;

    IF v_site.is_warehouse AND v_site.parent_site_id IS NOT NULL THEN
      SELECT allow_negative_stock INTO v_root_site FROM sites WHERE id = v_site.parent_site_id;
      IF v_root_site IS NOT NULL AND NOT v_root_site.allow_negative_stock THEN
        RAISE EXCEPTION '[NEGATIVE_STOCK_FORBIDDEN] Stock négatif interdit pour ce magasin';
      END IF;
    ELSE
      IF NOT v_site.allow_negative_stock THEN
        RAISE EXCEPTION '[NEGATIVE_STOCK_FORBIDDEN] Stock négatif interdit pour ce magasin';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_negative_stock ON stock_levels;
CREATE TRIGGER trg_guard_negative_stock
  BEFORE UPDATE ON stock_levels
  FOR EACH ROW EXECUTE FUNCTION _guard_negative_stock();

-- 6. RESTRICT DIRECT PROFILE WRITES
-- Revoke broad UPDATE on profiles for authenticated; grant only safe columns
REVOKE UPDATE ON profiles FROM authenticated;
GRANT UPDATE (full_name, phone, default_site_id, auto_print_ticket, auto_print_invoice) ON profiles TO authenticated;

-- Re-grant SELECT (needed for RLS to work)
GRANT SELECT ON profiles TO authenticated;
