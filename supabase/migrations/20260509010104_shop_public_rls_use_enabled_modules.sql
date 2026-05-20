/*
  # Public shop gating uses tenant.enabled_modules

  1. Rationale
    - Previously, all public (anon) shop reads required `shop_settings.is_active = true`.
      That legacy in-app toggle now duplicates the platform-level "online_orders"
      module switch, which confuses users.
    - We move the single source of truth to `tenants.enabled_modules` (jsonb array):
      the shop is publicly accessible as long as:
        * the tenant is approved + active,
        * the tenant has a `public_slug`,
        * `online_orders` is in `enabled_modules` (or modules list is empty, meaning
          "all modules enabled" by default).

  2. Policy changes (anon SELECT only — authenticated policies are untouched)
    - `tenants`: drop `tenants public read shop slug`, recreate with module check.
    - `shop_settings`: drop `shop_settings public read active`, recreate with
      module check via a subquery on tenants.
    - `articles`: drop `articles public read active shop`, recreate with module check.
    - `part_categories`: drop `part_categories public read shop`, recreate.
    - `vehicle_brands`: drop `vehicle_brands public read shop`, recreate.
    - `vehicle_models`: drop `vehicle_models public read shop`, recreate.
    - `stock_levels`: drop `stock_levels public read shop`, recreate.
    - `article_compatibilities`: drop `article_compatibilities public read shop`, recreate.

  3. Security
    - Still restricts public access to tenants that have explicitly published
      their shop via a `public_slug`, are approved, active, and have `online_orders`
      enabled. Anon cannot read inactive or suspended tenants.
*/

-- Helper predicate reused via inline subquery
-- A tenant is "publicly shoppable" iff:
--   public_slug IS NOT NULL
--   AND COALESCE(is_active, true)
--   AND COALESCE(approval_status, 'approved') = 'approved'
--   AND (enabled_modules IS NULL
--        OR jsonb_typeof(enabled_modules) <> 'array'
--        OR enabled_modules ? 'online_orders')

-- tenants
DROP POLICY IF EXISTS "tenants public read shop slug" ON tenants;
CREATE POLICY "tenants public read shop slug"
  ON tenants FOR SELECT TO anon
  USING (
    public_slug IS NOT NULL
    AND COALESCE(is_active, true)
    AND COALESCE(approval_status, 'approved') = 'approved'
    AND (
      enabled_modules IS NULL
      OR jsonb_typeof(enabled_modules) <> 'array'
      OR enabled_modules ? 'online_orders'
    )
  );

-- shop_settings
DROP POLICY IF EXISTS "shop_settings public read active" ON shop_settings;
CREATE POLICY "shop_settings public read active"
  ON shop_settings FOR SELECT TO anon
  USING (
    tenant_id IN (
      SELECT id FROM tenants
      WHERE public_slug IS NOT NULL
        AND COALESCE(is_active, true)
        AND COALESCE(approval_status, 'approved') = 'approved'
        AND (
          enabled_modules IS NULL
          OR jsonb_typeof(enabled_modules) <> 'array'
          OR enabled_modules ? 'online_orders'
        )
    )
  );

-- articles
DROP POLICY IF EXISTS "articles public read active shop" ON articles;
CREATE POLICY "articles public read active shop"
  ON articles FOR SELECT TO anon
  USING (
    is_active = true
    AND tenant_id IN (
      SELECT id FROM tenants
      WHERE public_slug IS NOT NULL
        AND COALESCE(is_active, true)
        AND COALESCE(approval_status, 'approved') = 'approved'
        AND (
          enabled_modules IS NULL
          OR jsonb_typeof(enabled_modules) <> 'array'
          OR enabled_modules ? 'online_orders'
        )
    )
  );

-- part_categories
DROP POLICY IF EXISTS "part_categories public read shop" ON part_categories;
CREATE POLICY "part_categories public read shop"
  ON part_categories FOR SELECT TO anon
  USING (
    is_active = true
    AND tenant_id IN (
      SELECT id FROM tenants
      WHERE public_slug IS NOT NULL
        AND COALESCE(is_active, true)
        AND COALESCE(approval_status, 'approved') = 'approved'
        AND (
          enabled_modules IS NULL
          OR jsonb_typeof(enabled_modules) <> 'array'
          OR enabled_modules ? 'online_orders'
        )
    )
  );

-- vehicle_brands
DROP POLICY IF EXISTS "vehicle_brands public read shop" ON vehicle_brands;
CREATE POLICY "vehicle_brands public read shop"
  ON vehicle_brands FOR SELECT TO anon
  USING (
    is_active = true
    AND tenant_id IN (
      SELECT id FROM tenants
      WHERE public_slug IS NOT NULL
        AND COALESCE(is_active, true)
        AND COALESCE(approval_status, 'approved') = 'approved'
        AND (
          enabled_modules IS NULL
          OR jsonb_typeof(enabled_modules) <> 'array'
          OR enabled_modules ? 'online_orders'
        )
    )
  );

-- vehicle_models
DROP POLICY IF EXISTS "vehicle_models public read shop" ON vehicle_models;
CREATE POLICY "vehicle_models public read shop"
  ON vehicle_models FOR SELECT TO anon
  USING (
    tenant_id IN (
      SELECT id FROM tenants
      WHERE public_slug IS NOT NULL
        AND COALESCE(is_active, true)
        AND COALESCE(approval_status, 'approved') = 'approved'
        AND (
          enabled_modules IS NULL
          OR jsonb_typeof(enabled_modules) <> 'array'
          OR enabled_modules ? 'online_orders'
        )
    )
  );

-- stock_levels
DROP POLICY IF EXISTS "stock_levels public read shop" ON stock_levels;
CREATE POLICY "stock_levels public read shop"
  ON stock_levels FOR SELECT TO anon
  USING (
    tenant_id IN (
      SELECT id FROM tenants
      WHERE public_slug IS NOT NULL
        AND COALESCE(is_active, true)
        AND COALESCE(approval_status, 'approved') = 'approved'
        AND (
          enabled_modules IS NULL
          OR jsonb_typeof(enabled_modules) <> 'array'
          OR enabled_modules ? 'online_orders'
        )
    )
  );

-- article_compatibilities
DROP POLICY IF EXISTS "article_compatibilities public read shop" ON article_compatibilities;
CREATE POLICY "article_compatibilities public read shop"
  ON article_compatibilities FOR SELECT TO anon
  USING (
    tenant_id IN (
      SELECT id FROM tenants
      WHERE public_slug IS NOT NULL
        AND COALESCE(is_active, true)
        AND COALESCE(approval_status, 'approved') = 'approved'
        AND (
          enabled_modules IS NULL
          OR jsonb_typeof(enabled_modules) <> 'array'
          OR enabled_modules ? 'online_orders'
        )
    )
  );