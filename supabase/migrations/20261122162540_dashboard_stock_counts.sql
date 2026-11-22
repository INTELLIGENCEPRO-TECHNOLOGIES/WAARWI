CREATE OR REPLACE FUNCTION public.dashboard_stock_counts(
  p_tenant_id uuid,
  p_site_id uuid,
  p_shared_articles boolean
)
RETURNS TABLE (low_stock_count bigint, out_of_stock_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  WITH scope AS (
    SELECT s.tenant_id, s.id AS site_id
    FROM public.sites s
    WHERE s.id = p_site_id
      AND s.tenant_id = p_tenant_id
      AND s.tenant_id = (SELECT public.current_tenant_id())
  ),
  tracked AS (
    SELECT count(*) AS article_count
    FROM scope s
    JOIN public.articles a ON a.tenant_id = s.tenant_id
    WHERE a.is_active = true AND a.track_stock = true
      AND (p_shared_articles OR a.site_id = s.site_id)
  ),
  levels AS (
    SELECT count(*) AS level_count,
           count(*) FILTER (WHERE coalesce(l.quantity, 0) <= 0) AS empty_count,
           count(*) FILTER (WHERE l.quantity > 0 AND a.stock_min > 0 AND l.quantity <= a.stock_min) AS low_count
    FROM scope s
    JOIN public.stock_levels l ON l.tenant_id = s.tenant_id AND l.site_id = s.site_id
    JOIN public.articles a ON a.id = l.article_id AND a.tenant_id = s.tenant_id
    WHERE a.track_stock = true
  )
  SELECT levels.low_count, levels.empty_count + greatest(0, tracked.article_count - levels.level_count)
  FROM tracked CROSS JOIN levels;
$$;

REVOKE ALL ON FUNCTION public.dashboard_stock_counts(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dashboard_stock_counts(uuid, uuid, boolean) TO authenticated;
