-- Fix page-access permissions for cashier role
-- The trigger function correctly sets these to false for new tenants,
-- but the page_access backfill (20260607015332) set them all to true for existing rows.
-- Cashiers should only access POS.

UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
  'access_billing', false,
  'access_articles', false,
  'access_tiers', false,
  'access_dashboard', false,
  'access_reports', false,
  'access_master_catalog', false,
  'access_stock', false,
  'access_sales', false,
  'access_supplier_orders', false,
  'access_online_orders', false,
  'access_accounting', false,
  'access_cash_history', false
),
updated_at = now()
WHERE role = 'cashier';

-- Viewer should access read-only pages per the trigger function definition
UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
  'access_pos', false,
  'access_billing', false,
  'access_master_catalog', false,
  'access_supplier_orders', false,
  'access_online_orders', false,
  'access_accounting', false
),
updated_at = now()
WHERE role = 'viewer';