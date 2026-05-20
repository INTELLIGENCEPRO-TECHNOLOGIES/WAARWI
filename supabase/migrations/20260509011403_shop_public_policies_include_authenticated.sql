/*
  # Public shop policies include authenticated role

  1. Problem
    - The public shop RLS policies were scoped to `TO anon` only. When a Supabase
      user is logged-in into their own tenant and browses another tenant's public
      shop (e.g. SAD PIECES AUTO) in the same browser, the Supabase client attaches
      the JWT, so the query runs under the `authenticated` role. The authenticated
      policy restricts reads to `tenant_id = current_tenant_id()`, so the visitor's
      shop appears empty.

  2. Fix
    - Recreate the public-shop policies with `TO anon, authenticated` so any visitor
      — logged-in or not — can read the published shop of any tenant that has
      `online_orders` in `enabled_modules`, is approved/active, and has a slug.

  3. Security
    - Same gating as before (tenant approved + active + slug + online_orders module).
    - Authenticated users already have their own tenant-scoped SELECT policy, which
      remains untouched. The new permissive policies simply grant additional read
      access to publicly-published shops.
*/

-- tenants
DROP POLICY IF EXISTS "tenants public read shop slug" ON tenants;
CREATE POLICY "tenants public read shop slug"
  ON tenants FOR SELECT TO anon, authenticated
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
  ON shop_settings FOR SELECT TO anon, authenticated
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
  ON articles FOR SELECT TO anon, authenticated
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
  ON part_categories FOR SELECT TO anon, authenticated
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
  ON vehicle_brands FOR SELECT TO anon, authenticated
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
  ON vehicle_models FOR SELECT TO anon, authenticated
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
  ON stock_levels FOR SELECT TO anon, authenticated
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
  ON article_compatibilities FOR SELECT TO anon, authenticated
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