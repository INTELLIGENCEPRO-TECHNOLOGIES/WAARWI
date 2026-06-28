-- Table to store balance adjustment entries (report de solde)
CREATE TABLE IF NOT EXISTS balance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('customer', 'supplier')),
  entity_id uuid NOT NULL,
  previous_balance numeric NOT NULL DEFAULT 0,
  new_balance numeric NOT NULL DEFAULT 0,
  amount numeric NOT NULL DEFAULT 0,
  note text DEFAULT '',
  user_id uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_balance_adjustments_customer ON balance_adjustments(entity_id, entity_type) WHERE entity_type = 'customer';
CREATE INDEX idx_balance_adjustments_supplier ON balance_adjustments(entity_id, entity_type) WHERE entity_type = 'supplier';
CREATE INDEX idx_balance_adjustments_tenant ON balance_adjustments(tenant_id);

ALTER TABLE balance_adjustments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_balance_adjustments" ON balance_adjustments FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_own_balance_adjustments" ON balance_adjustments FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_own_balance_adjustments" ON balance_adjustments FOR UPDATE
  TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_own_balance_adjustments" ON balance_adjustments FOR DELETE
  TO authenticated USING (tenant_id = current_tenant_id());