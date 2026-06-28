-- Create the accounting_accounts table referenced by provision_tenant
CREATE TABLE IF NOT EXISTS accounting_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  type text NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one code per tenant
ALTER TABLE accounting_accounts ADD CONSTRAINT accounting_accounts_tenant_code_unique UNIQUE (tenant_id, code);

-- Index for lookups
CREATE INDEX idx_accounting_accounts_tenant ON accounting_accounts (tenant_id);

-- Enable RLS
ALTER TABLE accounting_accounts ENABLE ROW LEVEL SECURITY;

-- RLS Policies (authenticated users, scoped to their tenant)
CREATE POLICY "select_own_accounting_accounts" ON accounting_accounts FOR SELECT
  TO authenticated USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "insert_own_accounting_accounts" ON accounting_accounts FOR INSERT
  TO authenticated WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "update_own_accounting_accounts" ON accounting_accounts FOR UPDATE
  TO authenticated USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "delete_own_accounting_accounts" ON accounting_accounts FOR DELETE
  TO authenticated USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Grant service_role bypass for provision_tenant function
GRANT ALL ON accounting_accounts TO service_role;