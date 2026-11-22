-- Resolve the authenticated tenant once per statement in these SELECT policies.
-- Public catalog and stock policies continue to apply independently.
SET LOCAL lock_timeout = '3s';

ALTER POLICY "art select" ON public.articles
  USING (tenant_id = (SELECT public.current_tenant_id()));

ALTER POLICY "stk select" ON public.stock_levels
  USING (tenant_id = (SELECT public.current_tenant_id()));
