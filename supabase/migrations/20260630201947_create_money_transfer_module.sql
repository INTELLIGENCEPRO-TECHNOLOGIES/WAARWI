-- =====================================================
-- Module: Transfert d'argent
-- Tables, RLS, fonctions pour la gestion des transferts
-- =====================================================

-- 1. Points de service
CREATE TABLE IF NOT EXISTS mt_service_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  address text,
  manager_name text,
  phone text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_service_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_service_points" ON mt_service_points FOR SELECT TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_service_points" ON mt_service_points FOR INSERT TO authenticated WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_service_points" ON mt_service_points FOR UPDATE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_service_points" ON mt_service_points FOR DELETE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 2. Services de transfert
CREATE TABLE IF NOT EXISTS mt_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL DEFAULT 'national' CHECK (type IN ('national','international','mixte')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  bank_account text,
  alert_min_balance numeric(15,2) DEFAULT 0,
  max_balance numeric(15,2),
  commission_mode text DEFAULT 'fixed' CHECK (commission_mode IN ('fixed','percentage','tiered','none')),
  currency text NOT NULL DEFAULT 'XOF',
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_services" ON mt_services FOR SELECT TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_services" ON mt_services FOR INSERT TO authenticated WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_services" ON mt_services FOR UPDATE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_services" ON mt_services FOR DELETE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 3. Comptes internes
CREATE TABLE IF NOT EXISTS mt_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_point_id uuid REFERENCES mt_service_points(id) ON DELETE SET NULL,
  service_id uuid REFERENCES mt_services(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('cash','uv','bank','commissions','ecarts','attente')),
  label text NOT NULL,
  currency text NOT NULL DEFAULT 'XOF',
  balance numeric(15,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_accounts" ON mt_accounts FOR SELECT TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_accounts" ON mt_accounts FOR INSERT TO authenticated WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_accounts" ON mt_accounts FOR UPDATE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_accounts" ON mt_accounts FOR DELETE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE INDEX idx_mt_accounts_tenant ON mt_accounts(tenant_id);
CREATE INDEX idx_mt_accounts_sp ON mt_accounts(service_point_id);
CREATE INDEX idx_mt_accounts_svc ON mt_accounts(service_id);

-- 4. Opérations (table principale)
CREATE TABLE IF NOT EXISTS mt_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_point_id uuid NOT NULL REFERENCES mt_service_points(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES mt_services(id) ON DELETE SET NULL,
  type text NOT NULL CHECK (type IN ('depot','retrait','achat_uv','versement_banque','retrait_banque','transfert_interne','transfert_service','ajustement','annulation')),
  amount numeric(15,2) NOT NULL DEFAULT 0,
  commission numeric(15,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'XOF',
  source_account_id uuid REFERENCES mt_accounts(id) ON DELETE SET NULL,
  dest_account_id uuid REFERENCES mt_accounts(id) ON DELETE SET NULL,
  dest_service_point_id uuid REFERENCES mt_service_points(id) ON DELETE SET NULL,
  reference text,
  client_name text,
  client_phone text,
  status text NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','validee','en_attente','annulee','rapprochee','rejetee','ecart_detecte')),
  comment text,
  attachment_url text,
  operated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancelled_at timestamptz,
  cancel_reason text,
  related_operation_id uuid REFERENCES mt_operations(id) ON DELETE SET NULL,
  operated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_operations" ON mt_operations FOR SELECT TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_operations" ON mt_operations FOR INSERT TO authenticated WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_operations" ON mt_operations FOR UPDATE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_operations" ON mt_operations FOR DELETE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE INDEX idx_mt_operations_tenant ON mt_operations(tenant_id);
CREATE INDEX idx_mt_operations_sp ON mt_operations(service_point_id);
CREATE INDEX idx_mt_operations_svc ON mt_operations(service_id);
CREATE INDEX idx_mt_operations_status ON mt_operations(tenant_id, status);
CREATE INDEX idx_mt_operations_date ON mt_operations(tenant_id, operated_at DESC);
CREATE INDEX idx_mt_operations_type ON mt_operations(tenant_id, type);

-- 5. Rapprochements
CREATE TABLE IF NOT EXISTS mt_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_point_id uuid REFERENCES mt_service_points(id) ON DELETE SET NULL,
  service_id uuid REFERENCES mt_services(id) ON DELETE SET NULL,
  account_id uuid REFERENCES mt_accounts(id) ON DELETE SET NULL,
  reconciliation_date date NOT NULL DEFAULT CURRENT_DATE,
  theoretical_balance numeric(15,2) NOT NULL DEFAULT 0,
  actual_balance numeric(15,2) NOT NULL DEFAULT 0,
  difference numeric(15,2) NOT NULL DEFAULT 0,
  justification text,
  status text NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','valide','rejete')),
  validated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  validated_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_reconciliations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_reconciliations" ON mt_reconciliations FOR SELECT TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_reconciliations" ON mt_reconciliations FOR INSERT TO authenticated WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_reconciliations" ON mt_reconciliations FOR UPDATE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_reconciliations" ON mt_reconciliations FOR DELETE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- 6. Clôtures journalières
CREATE TABLE IF NOT EXISTS mt_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_point_id uuid NOT NULL REFERENCES mt_service_points(id) ON DELETE RESTRICT,
  closure_date date NOT NULL,
  cash_opening numeric(15,2) NOT NULL DEFAULT 0,
  cash_in numeric(15,2) NOT NULL DEFAULT 0,
  cash_out numeric(15,2) NOT NULL DEFAULT 0,
  cash_theoretical numeric(15,2) NOT NULL DEFAULT 0,
  cash_actual numeric(15,2),
  cash_difference numeric(15,2) DEFAULT 0,
  uv_opening numeric(15,2) NOT NULL DEFAULT 0,
  uv_movements numeric(15,2) NOT NULL DEFAULT 0,
  uv_theoretical numeric(15,2) NOT NULL DEFAULT 0,
  uv_actual numeric(15,2),
  uv_difference numeric(15,2) DEFAULT 0,
  bank_theoretical numeric(15,2) NOT NULL DEFAULT 0,
  commissions_generated numeric(15,2) NOT NULL DEFAULT 0,
  bank_deposits numeric(15,2) NOT NULL DEFAULT 0,
  bank_withdrawals numeric(15,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ouverte' CHECK (status IN ('ouverte','cloturee','validee')),
  closed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  closed_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_closures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_closures" ON mt_closures FOR SELECT TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_closures" ON mt_closures FOR INSERT TO authenticated WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_closures" ON mt_closures FOR UPDATE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_closures" ON mt_closures FOR DELETE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE INDEX idx_mt_closures_tenant_date ON mt_closures(tenant_id, closure_date DESC);
CREATE UNIQUE INDEX idx_mt_closures_unique ON mt_closures(tenant_id, service_point_id, closure_date);

-- 7. Journal d'audit
CREATE TABLE IF NOT EXISTS mt_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid,
  action text NOT NULL,
  old_value jsonb,
  new_value jsonb,
  reason text,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_audit_log" ON mt_audit_log FOR SELECT TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_audit_log" ON mt_audit_log FOR INSERT TO authenticated WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_audit_log" ON mt_audit_log FOR UPDATE TO authenticated USING (false);
CREATE POLICY "delete_mt_audit_log" ON mt_audit_log FOR DELETE TO authenticated USING (false);

CREATE INDEX idx_mt_audit_tenant ON mt_audit_log(tenant_id, created_at DESC);
CREATE INDEX idx_mt_audit_entity ON mt_audit_log(tenant_id, entity_type, entity_id);

-- 8. Barèmes de commission
CREATE TABLE IF NOT EXISTS mt_commission_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES mt_services(id) ON DELETE CASCADE,
  operation_type text NOT NULL CHECK (operation_type IN ('depot','retrait')),
  min_amount numeric(15,2) NOT NULL DEFAULT 0,
  max_amount numeric(15,2),
  commission_amount numeric(15,2) DEFAULT 0,
  commission_percent numeric(5,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mt_commission_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "select_mt_commission_tiers" ON mt_commission_tiers FOR SELECT TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "insert_mt_commission_tiers" ON mt_commission_tiers FOR INSERT TO authenticated WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "update_mt_commission_tiers" ON mt_commission_tiers FOR UPDATE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid) WITH CHECK (tenant_id = current_setting('app.current_tenant_id')::uuid);
CREATE POLICY "delete_mt_commission_tiers" ON mt_commission_tiers FOR DELETE TO authenticated USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
