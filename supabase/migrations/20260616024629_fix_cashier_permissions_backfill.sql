-- Fix incorrect backfill values from 20260613011239 migration
-- The previous backfill set pos_returns=true (hardcoded) and pos_close_session/pos_cash_movement=true
-- (inherited from manage_cash_sessions) for ALL roles including cashier.
-- This corrective migration resets cashier-role rows to the intended restrictive defaults.

UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
  'pos_close_session', false,
  'pos_returns', false,
  'pos_cancel_sale', false,
  'pos_cash_movement', false,
  'pos_view_x_report', false,
  'pos_view_z_report', false,
  'create_quotes', false,
  'edit_invoices', false,
  'delete_invoices', false,
  'edit_quotes', false,
  'delete_quotes', false,
  'edit_supplier_orders', false,
  'delete_supplier_orders', false,
  'manage_online_orders', false,
  'manage_supplier_orders', false,
  'manage_stock', false,
  'manage_articles', false,
  'apply_discounts', false,
  'sell_below_min_price', false
),
updated_at = now()
WHERE role = 'cashier';

-- Also fix viewer role which should have no write permissions at all
UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
  'pos_close_session', false,
  'pos_open_session', false,
  'pos_returns', false,
  'pos_cancel_sale', false,
  'pos_reprint', false,
  'pos_cash_movement', false,
  'pos_view_x_report', false,
  'pos_view_z_report', false,
  'create_quotes', false,
  'edit_invoices', false,
  'delete_invoices', false,
  'edit_quotes', false,
  'delete_quotes', false,
  'edit_supplier_orders', false,
  'delete_supplier_orders', false,
  'manage_online_orders', false,
  'manage_supplier_orders', false,
  'manage_stock', false,
  'manage_articles', false,
  'manage_customers', false,
  'manage_categories', false,
  'apply_discounts', false,
  'sell_below_min_price', false,
  'manage_cash_sessions', false,
  'manage_settings', false,
  'manage_users', false,
  'export_data', false
),
updated_at = now()
WHERE role = 'viewer';