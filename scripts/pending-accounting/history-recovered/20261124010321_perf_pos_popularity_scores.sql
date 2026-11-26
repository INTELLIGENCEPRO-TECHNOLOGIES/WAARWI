-- Candidate for staging only; apply after security and performance validation.
-- Rollback: DROP FUNCTION public.rpc_pos_popularity_scores(uuid, uuid);

CREATE FUNCTION public.rpc_pos_popularity_scores(p_tenant_id uuid, p_site_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_object_agg(r.article_id::text, r.score), '{}'::jsonb)
  FROM (
    SELECT si.article_id, sum(coalesce(si.quantity, 0)) AS score
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id AND si.tenant_id = s.tenant_id
    WHERE s.tenant_id = p_tenant_id
      AND p_tenant_id = (SELECT public.current_tenant_id())
      AND s.created_at >= now() - interval '2160 hours'
      AND s.status <> 'cancelled'
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
      AND si.article_id IS NOT NULL
    GROUP BY si.article_id
  ) r;
$$;
REVOKE ALL ON FUNCTION public.rpc_pos_popularity_scores(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_pos_popularity_scores(uuid, uuid) TO authenticated;

