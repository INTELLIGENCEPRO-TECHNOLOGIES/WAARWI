-- Junction table linking service points to the services they handle
CREATE TABLE IF NOT EXISTS mt_service_point_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_point_id uuid NOT NULL REFERENCES mt_service_points(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES mt_services(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_point_id, service_id)
);

ALTER TABLE mt_service_point_services ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_mt_service_point_services" ON mt_service_point_services
  FOR SELECT TO authenticated
  USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "insert_mt_service_point_services" ON mt_service_point_services
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "update_mt_service_point_services" ON mt_service_point_services
  FOR UPDATE TO authenticated
  USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid)
  WITH CHECK (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

CREATE POLICY "delete_mt_service_point_services" ON mt_service_point_services
  FOR DELETE TO authenticated
  USING (tenant_id = (current_setting('app.current_tenant_id', true))::uuid);

-- Add an index for fast lookups
CREATE INDEX idx_mt_sps_service_point ON mt_service_point_services(service_point_id);
CREATE INDEX idx_mt_sps_service ON mt_service_point_services(service_id);
CREATE INDEX idx_mt_sps_tenant ON mt_service_point_services(tenant_id);
