-- Fix RLS policies on mt_service_point_services to use current_tenant_id()
DROP POLICY IF EXISTS "select_mt_service_point_services" ON mt_service_point_services;
DROP POLICY IF EXISTS "insert_mt_service_point_services" ON mt_service_point_services;
DROP POLICY IF EXISTS "update_mt_service_point_services" ON mt_service_point_services;
DROP POLICY IF EXISTS "delete_mt_service_point_services" ON mt_service_point_services;

CREATE POLICY "select_mt_service_point_services" ON mt_service_point_services
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_service_point_services" ON mt_service_point_services
  FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_service_point_services" ON mt_service_point_services
  FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_service_point_services" ON mt_service_point_services
  FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());
