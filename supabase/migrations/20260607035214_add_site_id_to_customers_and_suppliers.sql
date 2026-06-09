-- Add site_id to customers for multi-site isolation
ALTER TABLE customers ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_customers_site_id ON customers(site_id) WHERE site_id IS NOT NULL;

-- Add site_id to suppliers for multi-site isolation
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_site_id ON suppliers(site_id) WHERE site_id IS NOT NULL;
