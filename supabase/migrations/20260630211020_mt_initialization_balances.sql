-- Initialisation des soldes pour le module Transfert d'argent

-- Table de suivi du statut d'initialisation par tenant
CREATE TABLE IF NOT EXISTS mt_init_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'non_initialise' CHECK (status IN ('non_initialise','brouillon','valide')),
  initialized_at timestamptz,
  initialized_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  activity_start_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id)
);
ALTER TABLE mt_init_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_init_status" ON mt_init_status FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_init_status" ON mt_init_status FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_init_status" ON mt_init_status FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_init_status" ON mt_init_status FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- Table des lignes d'initialisation des soldes
CREATE TABLE IF NOT EXISTS mt_init_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_point_id uuid REFERENCES mt_service_points(id) ON DELETE SET NULL,
  service_id uuid REFERENCES mt_services(id) ON DELETE SET NULL,
  account_type text NOT NULL CHECK (account_type IN ('cash','uv','bank','attente','commissions','ecarts')),
  label text NOT NULL,
  amount numeric(15,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'XOF',
  bank_name text,
  comment text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_init_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_init_balances" ON mt_init_balances FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_init_balances" ON mt_init_balances FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_init_balances" ON mt_init_balances FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_init_balances" ON mt_init_balances FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

CREATE INDEX idx_mt_init_balances_tenant ON mt_init_balances(tenant_id);
