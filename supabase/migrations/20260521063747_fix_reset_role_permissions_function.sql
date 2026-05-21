/*
  # Fix reset role permissions function

  1. Changes
    - Updated `create_default_role_permissions` to use ON CONFLICT ... DO UPDATE
      so that calling it actually resets permissions to defaults rather than skipping
      existing rows.
*/

CREATE OR REPLACE FUNCTION create_default_role_permissions(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Admin: everything enabled
  INSERT INTO role_permissions (tenant_id, role, permissions)
  VALUES (p_tenant_id, 'admin', '{
    "view_purchase_prices": true,
    "view_margins": true,
    "view_stock_levels": true,
    "manage_stock": true,
    "view_sales_history": true,
    "view_accounting": true,
    "manage_articles": true,
    "manage_categories": true,
    "manage_customers": true,
    "manage_cash_sessions": true,
    "view_cash_sessions": true,
    "apply_discounts": true,
    "sell_below_min_price": true,
    "create_quotes": true,
    "manage_online_orders": true,
    "manage_supplier_orders": true,
    "view_dashboard_stats": true,
    "export_data": true,
    "manage_settings": true,
    "manage_users": true
  }'::jsonb)
  ON CONFLICT (tenant_id, role) DO UPDATE SET
    permissions = EXCLUDED.permissions,
    updated_at = now();

  -- Manager: most things except user/settings management
  INSERT INTO role_permissions (tenant_id, role, permissions)
  VALUES (p_tenant_id, 'manager', '{
    "view_purchase_prices": true,
    "view_margins": true,
    "view_stock_levels": true,
    "manage_stock": true,
    "view_sales_history": true,
    "view_accounting": false,
    "manage_articles": true,
    "manage_categories": true,
    "manage_customers": true,
    "manage_cash_sessions": true,
    "view_cash_sessions": true,
    "apply_discounts": true,
    "sell_below_min_price": false,
    "create_quotes": true,
    "manage_online_orders": true,
    "manage_supplier_orders": true,
    "view_dashboard_stats": true,
    "export_data": true,
    "manage_settings": false,
    "manage_users": false
  }'::jsonb)
  ON CONFLICT (tenant_id, role) DO UPDATE SET
    permissions = EXCLUDED.permissions,
    updated_at = now();

  -- Cashier: POS-focused only
  INSERT INTO role_permissions (tenant_id, role, permissions)
  VALUES (p_tenant_id, 'cashier', '{
    "view_purchase_prices": false,
    "view_margins": false,
    "view_stock_levels": true,
    "manage_stock": false,
    "view_sales_history": false,
    "view_accounting": false,
    "manage_articles": false,
    "manage_categories": false,
    "manage_customers": true,
    "manage_cash_sessions": true,
    "view_cash_sessions": true,
    "apply_discounts": false,
    "sell_below_min_price": false,
    "create_quotes": false,
    "manage_online_orders": false,
    "manage_supplier_orders": false,
    "view_dashboard_stats": false,
    "export_data": false,
    "manage_settings": false,
    "manage_users": false
  }'::jsonb)
  ON CONFLICT (tenant_id, role) DO UPDATE SET
    permissions = EXCLUDED.permissions,
    updated_at = now();

  -- Viewer: read-only, no sensitive data
  INSERT INTO role_permissions (tenant_id, role, permissions)
  VALUES (p_tenant_id, 'viewer', '{
    "view_purchase_prices": false,
    "view_margins": false,
    "view_stock_levels": true,
    "manage_stock": false,
    "view_sales_history": true,
    "view_accounting": false,
    "manage_articles": false,
    "manage_categories": false,
    "manage_customers": false,
    "manage_cash_sessions": false,
    "view_cash_sessions": false,
    "apply_discounts": false,
    "sell_below_min_price": false,
    "create_quotes": false,
    "manage_online_orders": false,
    "manage_supplier_orders": false,
    "view_dashboard_stats": false,
    "export_data": false,
    "manage_settings": false,
    "manage_users": false
  }'::jsonb)
  ON CONFLICT (tenant_id, role) DO UPDATE SET
    permissions = EXCLUDED.permissions,
    updated_at = now();
END;
$$;
