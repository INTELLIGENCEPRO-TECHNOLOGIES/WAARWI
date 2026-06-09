/*
  # Add page-level access permissions

  Adds access_pos, access_billing, access_articles, access_tiers,
  access_dashboard, access_reports, access_master_catalog to the
  permissions system.

  1. Updates the create_default_role_permissions function
  2. Backfills existing role_permissions rows with the new keys (all true by default)
*/

-- Update the function with new keys
CREATE OR REPLACE FUNCTION create_default_role_permissions(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- Admin: everything enabled
  INSERT INTO role_permissions (tenant_id, role, permissions)
  VALUES (p_tenant_id, 'admin', '{
    "access_pos": true,
    "access_billing": true,
    "access_articles": true,
    "access_tiers": true,
    "access_dashboard": true,
    "access_reports": true,
    "access_master_catalog": true,
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
    "access_pos": true,
    "access_billing": true,
    "access_articles": true,
    "access_tiers": true,
    "access_dashboard": true,
    "access_reports": true,
    "access_master_catalog": true,
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

  -- Cashier: POS-focused
  INSERT INTO role_permissions (tenant_id, role, permissions)
  VALUES (p_tenant_id, 'cashier', '{
    "access_pos": true,
    "access_billing": false,
    "access_articles": false,
    "access_tiers": false,
    "access_dashboard": false,
    "access_reports": false,
    "access_master_catalog": false,
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
    "access_pos": false,
    "access_billing": false,
    "access_articles": true,
    "access_tiers": true,
    "access_dashboard": true,
    "access_reports": false,
    "access_master_catalog": false,
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

-- Backfill: add new access keys to existing rows that don't have them yet
-- Default to true so existing users don't suddenly lose access
UPDATE role_permissions
SET permissions = permissions
  || jsonb_build_object(
    'access_pos', COALESCE(permissions->>'access_pos', 'true')::boolean,
    'access_billing', COALESCE(permissions->>'access_billing', 'true')::boolean,
    'access_articles', COALESCE(permissions->>'access_articles', 'true')::boolean,
    'access_tiers', COALESCE(permissions->>'access_tiers', 'true')::boolean,
    'access_dashboard', COALESCE(permissions->>'access_dashboard', 'true')::boolean,
    'access_reports', COALESCE(permissions->>'access_reports', 'true')::boolean,
    'access_master_catalog', COALESCE(permissions->>'access_master_catalog', 'true')::boolean
  )
WHERE NOT (permissions ? 'access_pos');
