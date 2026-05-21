/*
  # Role Permissions System

  1. New Tables
    - `role_permissions`
      - `id` (uuid, primary key)
      - `tenant_id` (uuid, references tenants)
      - `role` (text) - the role this permission set applies to
      - `permissions` (jsonb) - the complete permission map for this role
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    - Unique constraint on (tenant_id, role) so each tenant has one permission record per role

  2. Permission Keys (stored in jsonb `permissions` column):
    - view_purchase_prices: See purchase/cost prices on articles
    - view_margins: See profit margins on sales and articles
    - view_stock_levels: See stock quantities
    - manage_stock: Perform stock movements (adjust, transfer)
    - view_sales_history: Access sales history
    - view_accounting: Access accounting module
    - manage_articles: Create/edit/delete articles
    - manage_categories: Create/edit categories
    - manage_customers: Create/edit customers and suppliers
    - manage_cash_sessions: Open/close cash sessions
    - view_cash_sessions: See cash session details and history
    - apply_discounts: Apply discounts on POS
    - sell_below_min_price: Sell below minimum price
    - create_quotes: Create and manage quotes
    - manage_online_orders: Manage online orders
    - manage_supplier_orders: Create/manage supplier orders
    - view_dashboard_stats: See dashboard revenue/profit stats
    - export_data: Export data (Excel, PDF)
    - manage_settings: Access settings (except user management)
    - manage_users: Manage users and permissions

  3. Security
    - Enable RLS on `role_permissions` table
    - Admins of the tenant can read/write
    - All authenticated users of the tenant can read (to check their own permissions)

  4. Default Permissions
    - admin: all permissions enabled
    - manager: most permissions except manage_users and manage_settings
    - cashier: POS-focused permissions only
    - viewer: read-only, no sensitive financial data

  5. Notes
    - The `permissions` jsonb is a flat key→boolean map
    - Admins always have full access (enforced in app logic, not just DB)
    - A trigger inserts default permission rows when a tenant is created
*/

-- Create the role_permissions table
CREATE TABLE IF NOT EXISTS role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, role)
);

-- Enable RLS
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Policy: all authenticated users in the tenant can read permissions
CREATE POLICY "Tenant members can read role permissions"
  ON role_permissions
  FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Policy: only admins can insert
CREATE POLICY "Admins can insert role permissions"
  ON role_permissions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'super_admin')
  );

-- Policy: only admins can update
CREATE POLICY "Admins can update role permissions"
  ON role_permissions
  FOR UPDATE
  TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'super_admin')
  )
  WITH CHECK (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'super_admin')
  );

-- Policy: only admins can delete
CREATE POLICY "Admins can delete role permissions"
  ON role_permissions
  FOR DELETE
  TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid())
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('admin', 'super_admin')
  );

-- Default permission sets for each role
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
  ON CONFLICT (tenant_id, role) DO NOTHING;

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
  ON CONFLICT (tenant_id, role) DO NOTHING;

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
  ON CONFLICT (tenant_id, role) DO NOTHING;

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
    "view_dashboard_stats": true,
    "export_data": false,
    "manage_settings": false,
    "manage_users": false
  }'::jsonb)
  ON CONFLICT (tenant_id, role) DO NOTHING;
END;
$$;

-- Provision default permissions for all existing tenants
DO $$
DECLARE
  t_id uuid;
BEGIN
  FOR t_id IN SELECT id FROM tenants LOOP
    PERFORM create_default_role_permissions(t_id);
  END LOOP;
END $$;

-- Trigger: auto-create default permissions for new tenants
CREATE OR REPLACE FUNCTION trigger_create_role_permissions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  PERFORM create_default_role_permissions(NEW.id);
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_create_role_permissions'
  ) THEN
    CREATE TRIGGER trg_create_role_permissions
      AFTER INSERT ON tenants
      FOR EACH ROW
      EXECUTE FUNCTION trigger_create_role_permissions();
  END IF;
END $$;

-- Add role_permissions to realtime
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'role_permissions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE role_permissions;
  END IF;
END $$;
