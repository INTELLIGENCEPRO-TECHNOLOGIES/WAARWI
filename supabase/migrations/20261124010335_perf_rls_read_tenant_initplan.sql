SET LOCAL lock_timeout = '2s';
ALTER POLICY "sales select" ON public.sales USING (tenant_id = (SELECT public.current_tenant_id()));
ALTER POLICY "si select" ON public.sale_items USING (tenant_id = (SELECT public.current_tenant_id()));
ALTER POLICY "Tenant members can select cash_control_lines" ON public.cash_control_lines USING (tenant_id = (SELECT public.current_tenant_id()));