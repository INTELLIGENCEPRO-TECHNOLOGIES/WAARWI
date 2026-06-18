-- Pricing tiers system for articles
-- Allows multiple named price levels per article (détail, grossiste, revendeur, spécial, custom)

CREATE TABLE IF NOT EXISTS article_pricing_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tier_name text NOT NULL,
  price numeric NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, article_id, tier_name)
);

CREATE INDEX idx_article_pricing_tiers_article ON article_pricing_tiers(article_id);
CREATE INDEX idx_article_pricing_tiers_tenant ON article_pricing_tiers(tenant_id);

ALTER TABLE article_pricing_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_pricing_tiers" ON article_pricing_tiers FOR SELECT
  TO authenticated USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid);
CREATE POLICY "insert_own_pricing_tiers" ON article_pricing_tiers FOR INSERT
  TO authenticated WITH CHECK (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid);
CREATE POLICY "update_own_pricing_tiers" ON article_pricing_tiers FOR UPDATE
  TO authenticated USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid);
CREATE POLICY "delete_own_pricing_tiers" ON article_pricing_tiers FOR DELETE
  TO authenticated USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid);

-- Also create a tenant-level table for defining available tier names
CREATE TABLE IF NOT EXISTS pricing_tier_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tier_name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, tier_name)
);

ALTER TABLE pricing_tier_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_tier_defs" ON pricing_tier_definitions FOR SELECT
  TO authenticated USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid);
CREATE POLICY "insert_own_tier_defs" ON pricing_tier_definitions FOR INSERT
  TO authenticated WITH CHECK (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid);
CREATE POLICY "update_own_tier_defs" ON pricing_tier_definitions FOR UPDATE
  TO authenticated USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid);
CREATE POLICY "delete_own_tier_defs" ON pricing_tier_definitions FOR DELETE
  TO authenticated USING (tenant_id = (SELECT current_setting('app.current_tenant_id', true))::uuid);
