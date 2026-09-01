-- Add pos_view_session_stats permission to control visibility of session statistics
-- and ticket totals at the POS screen.

-- Update the default role permissions trigger function to include the new key
CREATE OR REPLACE FUNCTION create_default_role_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO role_permissions (tenant_id, role, permissions) VALUES
  (NEW.id, 'admin', jsonb_build_object(
    'access_pos', true, 'access_billing', true, 'access_articles', true,
    'access_tiers', true, 'access_dashboard', true, 'access_reports', true,
    'access_master_catalog', true, 'access_stock', true, 'access_sales', true,
    'access_supplier_orders', true, 'access_online_orders', true,
    'access_accounting', true, 'access_cash_history', true,
    'view_purchase_prices', true, 'view_margins', true,
    'view_stock_levels', true, 'view_sales_history', true,
    'view_accounting', true, 'view_dashboard_stats', true, 'view_cash_sessions', true,
    'manage_stock', true, 'manage_articles', true, 'manage_categories', true,
    'create_quotes', true, 'edit_invoices', true, 'delete_invoices', true,
    'edit_quotes', true, 'delete_quotes', true,
    'edit_supplier_orders', true, 'delete_supplier_orders', true,
    'apply_discounts', true, 'sell_below_min_price', true,
    'manage_cash_sessions', true, 'pos_close_session', true, 'pos_open_session', true,
    'pos_returns', true, 'pos_cancel_sale', true, 'pos_reprint', true,
    'pos_cash_movement', true, 'pos_view_x_report', true, 'pos_view_z_report', true,
    'pos_view_session_stats', true,
    'manage_online_orders', true, 'manage_supplier_orders', true, 'manage_customers', true,
    'export_data', true, 'manage_settings', true, 'manage_users', true
  )),
  (NEW.id, 'manager', jsonb_build_object(
    'access_pos', true, 'access_billing', true, 'access_articles', true,
    'access_tiers', true, 'access_dashboard', true, 'access_reports', true,
    'access_master_catalog', true, 'access_stock', true, 'access_sales', true,
    'access_supplier_orders', true, 'access_online_orders', true,
    'access_accounting', false, 'access_cash_history', true,
    'view_purchase_prices', true, 'view_margins', true,
    'view_stock_levels', true, 'view_sales_history', true,
    'view_accounting', false, 'view_dashboard_stats', true, 'view_cash_sessions', true,
    'manage_stock', true, 'manage_articles', true, 'manage_categories', true,
    'create_quotes', true, 'edit_invoices', true, 'delete_invoices', false,
    'edit_quotes', true, 'delete_quotes', true,
    'edit_supplier_orders', true, 'delete_supplier_orders', false,
    'apply_discounts', true, 'sell_below_min_price', false,
    'manage_cash_sessions', true, 'pos_close_session', true, 'pos_open_session', true,
    'pos_returns', true, 'pos_cancel_sale', false, 'pos_reprint', true,
    'pos_cash_movement', true, 'pos_view_x_report', true, 'pos_view_z_report', false,
    'pos_view_session_stats', true,
    'manage_online_orders', true, 'manage_supplier_orders', true, 'manage_customers', true,
    'export_data', true, 'manage_settings', false, 'manage_users', false
  )),
  (NEW.id, 'cashier', jsonb_build_object(
    'access_pos', true, 'access_billing', false, 'access_articles', false,
    'access_tiers', false, 'access_dashboard', false, 'access_reports', false,
    'access_master_catalog', false, 'access_stock', false, 'access_sales', false,
    'access_supplier_orders', false, 'access_online_orders', false,
    'access_accounting', false, 'access_cash_history', false,
    'view_purchase_prices', false, 'view_margins', false,
    'view_stock_levels', true, 'view_sales_history', false,
    'view_accounting', false, 'view_dashboard_stats', false, 'view_cash_sessions', false,
    'manage_stock', false, 'manage_articles', false, 'manage_categories', false,
    'create_quotes', false, 'edit_invoices', false, 'delete_invoices', false,
    'edit_quotes', false, 'delete_quotes', false,
    'edit_supplier_orders', false, 'delete_supplier_orders', false,
    'apply_discounts', false, 'sell_below_min_price', false,
    'manage_cash_sessions', true, 'pos_close_session', false, 'pos_open_session', true,
    'pos_returns', false, 'pos_cancel_sale', false, 'pos_reprint', true,
    'pos_cash_movement', false, 'pos_view_x_report', false, 'pos_view_z_report', false,
    'pos_view_session_stats', false,
    'manage_online_orders', false, 'manage_supplier_orders', false, 'manage_customers', true,
    'export_data', false, 'manage_settings', false, 'manage_users', false
  )),
  (NEW.id, 'viewer', jsonb_build_object(
    'access_pos', false, 'access_billing', false, 'access_articles', true,
    'access_tiers', true, 'access_dashboard', true, 'access_reports', true,
    'access_master_catalog', false, 'access_stock', true, 'access_sales', true,
    'access_supplier_orders', false, 'access_online_orders', false,
    'access_accounting', false, 'access_cash_history', true,
    'view_purchase_prices', false, 'view_margins', false,
    'view_stock_levels', true, 'view_sales_history', true,
    'view_accounting', false, 'view_dashboard_stats', true, 'view_cash_sessions', true,
    'manage_stock', false, 'manage_articles', false, 'manage_categories', false,
    'create_quotes', false, 'edit_invoices', false, 'delete_invoices', false,
    'edit_quotes', false, 'delete_quotes', false,
    'edit_supplier_orders', false, 'delete_supplier_orders', false,
    'apply_discounts', false, 'sell_below_min_price', false,
    'manage_cash_sessions', false, 'pos_close_session', false, 'pos_open_session', false,
    'pos_returns', false, 'pos_cancel_sale', false, 'pos_reprint', false,
    'pos_cash_movement', false, 'pos_view_x_report', false, 'pos_view_z_report', false,
    'pos_view_session_stats', false,
    'manage_online_orders', false, 'manage_supplier_orders', false, 'manage_customers', false,
    'export_data', false, 'manage_settings', false, 'manage_users', false
  ))
  ON CONFLICT (tenant_id, role) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Backfill: grant pos_view_session_stats to admin and manager roles only
UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
    'pos_view_session_stats',
    COALESCE((permissions->>'pos_view_x_report')::boolean, (permissions->>'view_cash_sessions')::boolean, true)
  ),
  updated_at = now()
WHERE role IN ('admin', 'manager');

UPDATE role_permissions
SET permissions = permissions || jsonb_build_object('pos_view_session_stats', false),
  updated_at = now()
WHERE role IN ('cashier', 'viewer');