-- Table des grossistes
CREATE TABLE mt_wholesalers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  address text,
  zone text,
  notes text,
  status text DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Table de liaison grossiste-services
CREATE TABLE mt_wholesaler_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wholesaler_id uuid NOT NULL REFERENCES mt_wholesalers(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES mt_services(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(wholesaler_id, service_id)
);

-- Ajout des colonnes grossiste et audit sur mt_operations
ALTER TABLE mt_operations ADD COLUMN IF NOT EXISTS wholesaler_id uuid REFERENCES mt_wholesalers(id);
ALTER TABLE mt_operations ADD COLUMN IF NOT EXISTS balance_before_cash numeric(15,2);
ALTER TABLE mt_operations ADD COLUMN IF NOT EXISTS balance_after_cash numeric(15,2);
ALTER TABLE mt_operations ADD COLUMN IF NOT EXISTS balance_before_uv numeric(15,2);
ALTER TABLE mt_operations ADD COLUMN IF NOT EXISTS balance_after_uv numeric(15,2);

-- Ajout des nouveaux types d'opérations : recharge_grossiste et dechargement_grossiste
ALTER TABLE mt_operations DROP CONSTRAINT IF EXISTS mt_operations_type_check;
ALTER TABLE mt_operations ADD CONSTRAINT mt_operations_type_check
  CHECK (type IN ('depot', 'retrait', 'achat_uv', 'versement_banque', 'retrait_banque', 'transfert_interne', 'transfert_service', 'ajustement', 'annulation', 'recharge_grossiste', 'dechargement_grossiste'));

-- Index
CREATE INDEX IF NOT EXISTS idx_mt_wholesalers_tenant ON mt_wholesalers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_mt_operations_wholesaler ON mt_operations(wholesaler_id) WHERE wholesaler_id IS NOT NULL;

-- RLS pour mt_wholesalers
ALTER TABLE mt_wholesalers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mt_wholesalers_select" ON mt_wholesalers FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "mt_wholesalers_insert" ON mt_wholesalers FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "mt_wholesalers_update" ON mt_wholesalers FOR UPDATE
  TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "mt_wholesalers_delete" ON mt_wholesalers FOR DELETE
  TO authenticated USING (tenant_id = current_tenant_id());

-- RLS pour mt_wholesaler_services
ALTER TABLE mt_wholesaler_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mt_ws_select" ON mt_wholesaler_services FOR SELECT
  TO authenticated USING (
    wholesaler_id IN (SELECT id FROM mt_wholesalers WHERE tenant_id = current_tenant_id())
  );
CREATE POLICY "mt_ws_insert" ON mt_wholesaler_services FOR INSERT
  TO authenticated WITH CHECK (
    wholesaler_id IN (SELECT id FROM mt_wholesalers WHERE tenant_id = current_tenant_id())
  );
CREATE POLICY "mt_ws_delete" ON mt_wholesaler_services FOR DELETE
  TO authenticated USING (
    wholesaler_id IN (SELECT id FROM mt_wholesalers WHERE tenant_id = current_tenant_id())
  );