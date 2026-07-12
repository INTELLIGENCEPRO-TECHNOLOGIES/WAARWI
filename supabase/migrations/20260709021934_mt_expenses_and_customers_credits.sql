-- ============================================================
-- MT DÉPENSES : catégories + dépenses par point
-- ============================================================
CREATE TABLE IF NOT EXISTS mt_expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE mt_expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_expense_categories" ON mt_expense_categories FOR SELECT TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_expense_categories" ON mt_expense_categories FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_expense_categories" ON mt_expense_categories FOR UPDATE TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_expense_categories" ON mt_expense_categories FOR DELETE TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_mt_expense_categories_tenant ON mt_expense_categories(tenant_id);

CREATE TABLE IF NOT EXISTS mt_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_point_id uuid NOT NULL REFERENCES mt_service_points(id) ON DELETE RESTRICT,
  category_id uuid REFERENCES mt_expense_categories(id) ON DELETE SET NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  source text NOT NULL CHECK (source IN ('cash','bank')),
  description text,
  expense_date timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'validee' CHECK (status IN ('validee','annulee')),
  operated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_expenses" ON mt_expenses FOR SELECT TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_expenses" ON mt_expenses FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_expenses" ON mt_expenses FOR UPDATE TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_expenses" ON mt_expenses FOR DELETE TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_mt_expenses_tenant ON mt_expenses(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mt_expenses_sp ON mt_expenses(service_point_id);
CREATE INDEX IF NOT EXISTS idx_mt_expenses_date ON mt_expenses(tenant_id, expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_mt_expenses_category ON mt_expenses(category_id);

-- ============================================================
-- MT CLIENTS : fichier client + ledger de solde / créances
-- ============================================================
CREATE TABLE IF NOT EXISTS mt_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text,
  name text NOT NULL,
  phone text,
  address text,
  notes text,
  status text NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','inactif')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_customers" ON mt_customers FOR SELECT TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_customers" ON mt_customers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_customers" ON mt_customers FOR UPDATE TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_customers" ON mt_customers FOR DELETE TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_mt_customers_tenant ON mt_customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mt_customers_name ON mt_customers(tenant_id, name);

CREATE TABLE IF NOT EXISTS mt_customer_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES mt_customers(id) ON DELETE CASCADE,
  service_point_id uuid REFERENCES mt_service_points(id) ON DELETE SET NULL,
  operation_id uuid REFERENCES mt_operations(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('depot','retrait','operation_solde','creance','remboursement','ajustement')),
  amount numeric(15,2) NOT NULL,
  balance_delta numeric(15,2) NOT NULL DEFAULT 0,
  creance_delta numeric(15,2) NOT NULL DEFAULT 0,
  comment text,
  operated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  operated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_customer_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_customer_ledger" ON mt_customer_ledger FOR SELECT TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_customer_ledger" ON mt_customer_ledger FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_customer_ledger" ON mt_customer_ledger FOR UPDATE TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_customer_ledger" ON mt_customer_ledger FOR DELETE TO authenticated
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE INDEX IF NOT EXISTS idx_mt_cust_ledger_tenant ON mt_customer_ledger(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mt_cust_ledger_customer ON mt_customer_ledger(customer_id, operated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mt_cust_ledger_op ON mt_customer_ledger(operation_id);

-- ============================================================
-- PERMISSIONS : ajouter aux rôles élevés
-- ============================================================
UPDATE role_permissions
SET permissions = permissions
  || jsonb_build_object(
    'mt_expense_view', true,
    'mt_expense_manage', true,
    'mt_expense_cancel', true,
    'mt_customer_view', true,
    'mt_customer_manage', true,
    'mt_customer_credit', true,
    'mt_customer_repay', true
  ),
  updated_at = now()
WHERE role IN ('proprietaire','admin','manager','superviseur');

-- Superviseur (souvent = supervisor)
UPDATE role_permissions
SET permissions = permissions
  || jsonb_build_object(
    'mt_expense_view', true,
    'mt_expense_manage', true,
    'mt_expense_cancel', true,
    'mt_customer_view', true,
    'mt_customer_manage', true,
    'mt_customer_credit', true,
    'mt_customer_repay', true
  ),
  updated_at = now()
WHERE role = 'supervisor';
