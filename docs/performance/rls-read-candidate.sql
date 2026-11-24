-- Staging candidate; do not apply blindly in production.
BEGIN;
SET LOCAL lock_timeout = '2s';
-- Preserve existing permissive and restrictive policies, commands and roles.
ALTER POLICY "sales select" ON public.sales USING (tenant_id = (SELECT public.current_tenant_id()));
ALTER POLICY "si select" ON public.sale_items USING (tenant_id = (SELECT public.current_tenant_id()));
ALTER POLICY "Tenant members can select cash_control_lines" ON public.cash_control_lines USING (tenant_id = (SELECT public.current_tenant_id()));
COMMIT;
-- Rollback (transactional):
-- ALTER POLICY "sales select" ON public.sales USING (tenant_id = public.current_tenant_id());
-- ALTER POLICY "si select" ON public.sale_items USING (tenant_id = public.current_tenant_id());
-- ALTER POLICY "Tenant members can select cash_control_lines" ON public.cash_control_lines USING (tenant_id = public.current_tenant_id());
