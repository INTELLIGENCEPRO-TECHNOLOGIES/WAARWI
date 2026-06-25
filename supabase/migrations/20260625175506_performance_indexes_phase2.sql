-- Performance indexes - Phase 2
-- All indexes are additive (no data modification), safe to apply
-- Rollback for each: DROP INDEX IF EXISTS <index_name>;

-- 1. Sales by tenant + site + date (Dashboard, Sales, CashHistory)
CREATE INDEX IF NOT EXISTS idx_sales_tenant_site_created
  ON sales(tenant_id, site_id, created_at DESC);

-- 2. Stock levels by tenant + site (Stock, Dashboard, POS)
CREATE INDEX IF NOT EXISTS idx_stock_levels_tenant_site
  ON stock_levels(tenant_id, site_id);

-- 3. Articles active by tenant (Articles, Stock, POS, SupplierOrders)
CREATE INDEX IF NOT EXISTS idx_articles_tenant_active
  ON articles(tenant_id) WHERE is_active = true;

-- 4. Sale payments by tenant + date (Dashboard encaissements)
CREATE INDEX IF NOT EXISTS idx_sale_payments_tenant_created
  ON sale_payments(tenant_id, created_at);

-- 5. Supplier orders by tenant + status (Dashboard, Tiers)
CREATE INDEX IF NOT EXISTS idx_supplier_orders_tenant_status
  ON supplier_orders(tenant_id, status);

-- 6. Online orders by tenant + status (Dashboard, OnlineOrders)
CREATE INDEX IF NOT EXISTS idx_online_orders_tenant_status
  ON online_orders(tenant_id, status);
