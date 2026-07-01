-- Fix all mt_* RLS policies to use current_tenant_id() instead of current_setting(...)

-- mt_service_points
DROP POLICY IF EXISTS "select_mt_service_points" ON mt_service_points;
DROP POLICY IF EXISTS "insert_mt_service_points" ON mt_service_points;
DROP POLICY IF EXISTS "update_mt_service_points" ON mt_service_points;
DROP POLICY IF EXISTS "delete_mt_service_points" ON mt_service_points;
CREATE POLICY "select_mt_service_points" ON mt_service_points FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_service_points" ON mt_service_points FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_service_points" ON mt_service_points FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_service_points" ON mt_service_points FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- mt_services
DROP POLICY IF EXISTS "select_mt_services" ON mt_services;
DROP POLICY IF EXISTS "insert_mt_services" ON mt_services;
DROP POLICY IF EXISTS "update_mt_services" ON mt_services;
DROP POLICY IF EXISTS "delete_mt_services" ON mt_services;
CREATE POLICY "select_mt_services" ON mt_services FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_services" ON mt_services FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_services" ON mt_services FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_services" ON mt_services FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- mt_accounts
DROP POLICY IF EXISTS "select_mt_accounts" ON mt_accounts;
DROP POLICY IF EXISTS "insert_mt_accounts" ON mt_accounts;
DROP POLICY IF EXISTS "update_mt_accounts" ON mt_accounts;
DROP POLICY IF EXISTS "delete_mt_accounts" ON mt_accounts;
CREATE POLICY "select_mt_accounts" ON mt_accounts FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_accounts" ON mt_accounts FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_accounts" ON mt_accounts FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_accounts" ON mt_accounts FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- mt_operations
DROP POLICY IF EXISTS "select_mt_operations" ON mt_operations;
DROP POLICY IF EXISTS "insert_mt_operations" ON mt_operations;
DROP POLICY IF EXISTS "update_mt_operations" ON mt_operations;
DROP POLICY IF EXISTS "delete_mt_operations" ON mt_operations;
CREATE POLICY "select_mt_operations" ON mt_operations FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_operations" ON mt_operations FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_operations" ON mt_operations FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_operations" ON mt_operations FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- mt_reconciliations
DROP POLICY IF EXISTS "select_mt_reconciliations" ON mt_reconciliations;
DROP POLICY IF EXISTS "insert_mt_reconciliations" ON mt_reconciliations;
DROP POLICY IF EXISTS "update_mt_reconciliations" ON mt_reconciliations;
DROP POLICY IF EXISTS "delete_mt_reconciliations" ON mt_reconciliations;
CREATE POLICY "select_mt_reconciliations" ON mt_reconciliations FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_reconciliations" ON mt_reconciliations FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_reconciliations" ON mt_reconciliations FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_reconciliations" ON mt_reconciliations FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- mt_closures
DROP POLICY IF EXISTS "select_mt_closures" ON mt_closures;
DROP POLICY IF EXISTS "insert_mt_closures" ON mt_closures;
DROP POLICY IF EXISTS "update_mt_closures" ON mt_closures;
DROP POLICY IF EXISTS "delete_mt_closures" ON mt_closures;
CREATE POLICY "select_mt_closures" ON mt_closures FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_closures" ON mt_closures FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_closures" ON mt_closures FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_closures" ON mt_closures FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- mt_audit_log
DROP POLICY IF EXISTS "select_mt_audit_log" ON mt_audit_log;
DROP POLICY IF EXISTS "insert_mt_audit_log" ON mt_audit_log;
DROP POLICY IF EXISTS "update_mt_audit_log" ON mt_audit_log;
DROP POLICY IF EXISTS "delete_mt_audit_log" ON mt_audit_log;
CREATE POLICY "select_mt_audit_log" ON mt_audit_log FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_audit_log" ON mt_audit_log FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_audit_log" ON mt_audit_log FOR UPDATE TO authenticated USING (false);
CREATE POLICY "delete_mt_audit_log" ON mt_audit_log FOR DELETE TO authenticated USING (false);

-- mt_commission_tiers
DROP POLICY IF EXISTS "select_mt_commission_tiers" ON mt_commission_tiers;
DROP POLICY IF EXISTS "insert_mt_commission_tiers" ON mt_commission_tiers;
DROP POLICY IF EXISTS "update_mt_commission_tiers" ON mt_commission_tiers;
DROP POLICY IF EXISTS "delete_mt_commission_tiers" ON mt_commission_tiers;
CREATE POLICY "select_mt_commission_tiers" ON mt_commission_tiers FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_mt_commission_tiers" ON mt_commission_tiers FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_mt_commission_tiers" ON mt_commission_tiers FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_mt_commission_tiers" ON mt_commission_tiers FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());
