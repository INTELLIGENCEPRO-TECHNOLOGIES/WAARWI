-- Fix RLS policies on pricing tier tables to use current_tenant_id() function
-- instead of current_setting('app.current_tenant_id') which is not set by the client

DROP POLICY IF EXISTS "select_own_pricing_tiers" ON article_pricing_tiers;
DROP POLICY IF EXISTS "insert_own_pricing_tiers" ON article_pricing_tiers;
DROP POLICY IF EXISTS "update_own_pricing_tiers" ON article_pricing_tiers;
DROP POLICY IF EXISTS "delete_own_pricing_tiers" ON article_pricing_tiers;

CREATE POLICY "select_own_pricing_tiers" ON article_pricing_tiers FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_own_pricing_tiers" ON article_pricing_tiers FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_own_pricing_tiers" ON article_pricing_tiers FOR UPDATE
  TO authenticated USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_own_pricing_tiers" ON article_pricing_tiers FOR DELETE
  TO authenticated USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "select_own_tier_defs" ON pricing_tier_definitions;
DROP POLICY IF EXISTS "insert_own_tier_defs" ON pricing_tier_definitions;
DROP POLICY IF EXISTS "update_own_tier_defs" ON pricing_tier_definitions;
DROP POLICY IF EXISTS "delete_own_tier_defs" ON pricing_tier_definitions;

CREATE POLICY "select_own_tier_defs" ON pricing_tier_definitions FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_own_tier_defs" ON pricing_tier_definitions FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_own_tier_defs" ON pricing_tier_definitions FOR UPDATE
  TO authenticated USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_own_tier_defs" ON pricing_tier_definitions FOR DELETE
  TO authenticated USING (tenant_id = current_tenant_id());
