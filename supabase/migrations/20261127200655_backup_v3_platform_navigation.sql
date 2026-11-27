-- Read-only reporting for the V3 backup console.
CREATE OR REPLACE FUNCTION public.br_v3_platform_backup_runs(p_offset integer DEFAULT 0, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Administration de la plateforme requise' USING ERRCODE = '42501';
  END IF;

  WITH runs AS (
    SELECT j.period_key, min(j.created_at) AS created_at, bool_or(j.origin = 'auto') AS automatic,
      count(*)::integer AS total,
      count(*) FILTER (WHERE j.status = 'succeeded')::integer AS succeeded,
      count(*) FILTER (WHERE j.status = 'failed')::integer AS failed,
      count(*) FILTER (WHERE j.status = 'cancelled')::integer AS cancelled,
      count(*) FILTER (WHERE j.status NOT IN ('succeeded', 'failed', 'cancelled'))::integer AS active
    FROM public._br_backup_jobs j
    WHERE j.period_key NOT LIKE 'manual_test:%'
    GROUP BY j.period_key
  ), page AS (
    SELECT * FROM runs ORDER BY created_at DESC, period_key DESC
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 50) OFFSET greatest(coalesce(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY created_at DESC, period_key DESC) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM runs)
  ) INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.br_v3_platform_backup_run(p_period_key text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  items jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Administration de la plateforme requise' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(entry) ORDER BY entry.company_name, entry.job_id), '[]'::jsonb)
  INTO items FROM (
    SELECT j.id AS job_id, t.id AS company_id, t.name AS company_name, j.status,
      j.started_at, j.finished_at, j.error_code, a.total_rows
    FROM public._br_backup_jobs j
    JOIN public.tenants t ON t.id = j.tenant_id
    LEFT JOIN LATERAL (
      SELECT x.total_rows FROM public._br_v3_archives x
      WHERE x.job_id = j.id AND x.tenant_id = j.tenant_id
      ORDER BY x.created_at DESC, x.id DESC LIMIT 1
    ) a ON true
    WHERE j.period_key = p_period_key AND j.period_key NOT LIKE 'manual_test:%'
  ) entry;
  RETURN items;
END;
$$;

CREATE OR REPLACE FUNCTION public.br_v3_platform_backup_transfers(
  p_offset integer DEFAULT 0, p_limit integer DEFAULT 20, p_status text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  result jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Administration de la plateforme requise' USING ERRCODE = '42501';
  END IF;

  WITH transfers AS (
    SELECT tr.id, tr.archive_id, t.id AS company_id, t.name AS company_name,
      coalesce(j.label, CASE WHEN j.backup_kind = 'auto' THEN 'Sauvegarde planifiée' ELSE 'Sauvegarde manuelle' END) AS label,
      tr.status, tr.requested_at, tr.confirmed_at, tr.blocks_confirmed, tr.manifest_confirmed,
      a.block_count, nullif(tr.error_code, 'YIELD') AS error_code
    FROM public._br_v3_offsite_transfers tr
    JOIN public._br_v3_archives a ON a.id = tr.archive_id AND a.tenant_id = tr.tenant_id
    JOIN public._br_backup_jobs j ON j.id = a.job_id
    JOIN public.tenants t ON t.id = tr.tenant_id
    WHERE j.period_key NOT LIKE 'manual_test:%'
      AND (p_status IS NULL OR tr.status = p_status)
  ), page AS (
    SELECT * FROM transfers ORDER BY requested_at DESC, id DESC
    LIMIT least(greatest(coalesce(p_limit, 20), 1), 50) OFFSET greatest(coalesce(p_offset, 0), 0)
  )
  SELECT jsonb_build_object(
    'items', coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY requested_at DESC, id DESC) FROM page), '[]'::jsonb),
    'total', (SELECT count(*) FROM transfers)
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.br_v3_platform_backup_runs(integer,integer), public.br_v3_platform_backup_run(text),
  public.br_v3_platform_backup_transfers(integer,integer,text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.br_v3_platform_backup_runs(integer,integer), public.br_v3_platform_backup_run(text),
  public.br_v3_platform_backup_transfers(integer,integer,text) TO authenticated;

-- Include the last confirmed LWS copy independently of newer archives in flight.
CREATE OR REPLACE FUNCTION public.br_v3_platform_backups()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Administration de la plateforme requise' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'policy', (SELECT jsonb_build_object('enabled', p.enabled, 'cron_expression', p.cron_expression, 'timezone', p.timezone)
      FROM public._br_schedule_policy p WHERE p.id = 1),
    'schedule_active', EXISTS (SELECT 1 FROM cron.job j WHERE j.jobname = 'br_v3_backup_daily' AND j.active),
    'offsite_automatic', EXISTS (SELECT 1 FROM public._br_offsite_config c WHERE c.id = 1 AND c.auto_transfer),
    'retention_enabled', EXISTS (SELECT 1 FROM public._br_v3_export_config c WHERE c.cleanup_delete_enabled),
    'restore_enabled', EXISTS (SELECT 1 FROM public._br_restore_config c WHERE c.enabled),
    'offsite_enabled', (SELECT c.offsite_enabled FROM public._br_v3_export_config c WHERE c.id = 1),
    'companies', (SELECT coalesce(jsonb_agg(to_jsonb(company) ORDER BY company.name), '[]'::jsonb) FROM (
      SELECT t.id, t.name, t.is_active, coalesce(o.suspended, false) AS suspended,
        a.verified_at, c.confirmed_at,
        (SELECT j.status FROM public._br_backup_jobs j WHERE j.tenant_id = t.id
          AND j.period_key NOT LIKE 'manual_test:%' ORDER BY j.created_at DESC, j.id DESC LIMIT 1) AS latest_job_status
      FROM public.tenants t
      LEFT JOIN public._br_tenant_schedule_override o ON o.tenant_id = t.id
      LEFT JOIN LATERAL (
        SELECT a.id, a.verified_at FROM public._br_v3_archives a JOIN public._br_backup_jobs j ON j.id = a.job_id
        WHERE a.tenant_id = t.id AND a.status = 'verified' AND j.period_key NOT LIKE 'manual_test:%'
        ORDER BY a.verified_at DESC, a.id DESC LIMIT 1
      ) a ON true
      LEFT JOIN LATERAL (
        SELECT tr.confirmed_at
        FROM public._br_v3_offsite_transfers tr
        JOIN public._br_v3_archives a ON a.id = tr.archive_id AND a.tenant_id = tr.tenant_id
        JOIN public._br_backup_jobs j ON j.id = a.job_id
        WHERE tr.tenant_id = t.id AND tr.status = 'confirmed'
          AND a.status = 'verified' AND j.period_key NOT LIKE 'manual_test:%'
        ORDER BY tr.confirmed_at DESC, tr.id DESC LIMIT 1
      ) c ON true
    ) company)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.br_v3_platform_backups() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.br_v3_platform_backups() TO authenticated;
