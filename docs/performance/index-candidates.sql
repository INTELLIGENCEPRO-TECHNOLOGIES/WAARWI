-- Candidate only. Benchmark individually before retaining any index.
-- Run each statement outside a transaction, in staging first.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_perf_sale_items_tenant_sale ON public.sale_items (tenant_id, sale_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_perf_cash_control_lines_tenant_session ON public.cash_control_lines (tenant_id, cash_session_id);
-- Rollback if no measurable benefit:
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_perf_sale_items_tenant_sale;
-- DROP INDEX CONCURRENTLY IF EXISTS public.idx_perf_cash_control_lines_tenant_session;
