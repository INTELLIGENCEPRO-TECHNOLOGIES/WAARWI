ALTER TABLE public._br_backup_jobs ADD COLUMN IF NOT EXISTS label text;

-- An explicit tenant is only available to platform administrators.
CREATE OR REPLACE FUNCTION public._br_v3_manage_tenant(p_tenant_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  tenant uuid := coalesce(p_tenant_id, public.current_tenant_id());
BEGIN
  IF auth.uid() IS NULL OR tenant IS NULL OR NOT (
    coalesce(public._br_can_manage_backups(tenant), false) OR coalesce(public.is_super_admin(), false)
  ) THEN
    RAISE EXCEPTION 'Accès aux sauvegardes réservé au propriétaire ou à un administrateur' USING ERRCODE = '42501';
  END IF;
  RETURN tenant;
END;
$$;

CREATE OR REPLACE FUNCTION public.br_v3_backup_request(p_request_id uuid, p_label text DEFAULT NULL, p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  tenant uuid := public._br_v3_manage_tenant(p_tenant_id);
  request jsonb;
BEGIN
  IF p_request_id IS NULL OR char_length(btrim(coalesce(p_label, ''))) > 120 THEN
    RAISE EXCEPTION 'Demande de sauvegarde invalide' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._br_capture_executor_config c WHERE c.enabled) THEN
    RAISE EXCEPTION 'Le moteur de sauvegarde est indisponible' USING ERRCODE = '55000';
  END IF;
  request := public._br_v3_request_capture(tenant, 'v3:manual:' || p_request_id::text);
  IF (request->>'created')::boolean THEN
    UPDATE public._br_backup_jobs j
    SET label = nullif(btrim(p_label), '')
    WHERE j.id = (request->>'job_id')::uuid;
  END IF;
  RETURN request;
END;
$$;

CREATE OR REPLACE FUNCTION public.br_v3_backup_list(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  tenant uuid := public._br_v3_manage_tenant(p_tenant_id);
  items jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(result) ORDER BY result.created_at DESC, result.job_id DESC), '[]'::jsonb)
  INTO items FROM (
    SELECT j.id AS job_id, a.id AS archive_id, j.created_at, a.verified_at, j.backup_kind AS kind,
      coalesce(j.label, CASE WHEN j.backup_kind = 'auto' THEN 'Sauvegarde planifiée' ELSE 'Sauvegarde manuelle' END) AS label,
      coalesce(a.status, j.status) AS status, a.total_rows, a.stored_bytes AS size_bytes,
      tr.status AS copy_status, tr.confirmed_at, coalesce(a.error_code, j.error_code, tr.error_code) AS error_code
    FROM public._br_backup_jobs j
    LEFT JOIN LATERAL (
      SELECT a.* FROM public._br_v3_archives a WHERE a.job_id = j.id AND a.tenant_id = j.tenant_id
      ORDER BY a.created_at DESC, a.id DESC LIMIT 1
    ) a ON true
    LEFT JOIN public._br_v3_offsite_transfers tr ON tr.archive_id = a.id
    WHERE j.tenant_id = tenant AND j.period_key NOT LIKE 'manual_test:%'
    ORDER BY j.created_at DESC, j.id DESC LIMIT 50
  ) result;
  RETURN jsonb_build_object(
    'backups', items,
    'automatic', EXISTS (
      SELECT 1 FROM public.tenants t CROSS JOIN public._br_schedule_policy p
      WHERE t.id = tenant AND t.is_active AND p.enabled
        AND NOT EXISTS (SELECT 1 FROM public._br_tenant_schedule_override o WHERE o.tenant_id = tenant AND o.suspended)
    ),
    'capture_enabled', EXISTS (SELECT 1 FROM public._br_capture_executor_config c WHERE c.enabled)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.br_v3_backup_copy(p_archive_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  archive_tenant uuid;
BEGIN
  SELECT a.tenant_id INTO archive_tenant FROM public._br_v3_archives a WHERE a.id = p_archive_id AND a.status = 'verified';
  IF NOT FOUND OR NOT (coalesce(public._br_can_manage_backups(archive_tenant), false) OR coalesce(public.is_super_admin(), false)) THEN
    RAISE EXCEPTION 'Sauvegarde introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._br_v3_export_config c WHERE c.offsite_enabled) THEN
    RAISE EXCEPTION 'La copie LWS est désactivée' USING ERRCODE = '55000';
  END IF;
  UPDATE public._br_v3_offsite_transfers t
  SET status = 'pending', attempts = 0, error_code = NULL, error_message = NULL, updated_at = now()
  WHERE t.archive_id = p_archive_id AND t.status = 'failed';
  RETURN public._br_v3_offsite_request(p_archive_id);
END;
$$;

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
      LEFT JOIN public._br_v3_offsite_transfers c ON c.archive_id = a.id AND c.status = 'confirmed'
    ) company)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.br_v3_schedule_suspend(p_tenant_id uuid, p_suspended boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Administration de la plateforme requise' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public._br_tenant_schedule_override (tenant_id, suspended, updated_by)
  VALUES (p_tenant_id, p_suspended, auth.uid())
  ON CONFLICT (tenant_id) DO UPDATE SET suspended = excluded.suspended, updated_by = excluded.updated_by, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.br_v3_schedule_update(p_enabled boolean, p_cron_expression text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'Administration de la plateforme requise' USING ERRCODE = '42501';
  END IF;
  UPDATE public._br_schedule_policy
  SET enabled = p_enabled, cron_expression = btrim(p_cron_expression), updated_by = auth.uid(), updated_at = now()
  WHERE id = 1;
  PERFORM public._br_v3_schedule_daily();
END;
$$;

REVOKE ALL ON FUNCTION public._br_v3_manage_tenant(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.br_v3_backup_request(uuid,text,uuid), public.br_v3_backup_list(uuid), public.br_v3_backup_copy(uuid),
  public.br_v3_platform_backups(), public.br_v3_schedule_suspend(uuid,boolean), public.br_v3_schedule_update(boolean,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.br_v3_backup_request(uuid,text,uuid), public.br_v3_backup_list(uuid),
  public.br_v3_backup_copy(uuid), public.br_v3_platform_backups(),
  public.br_v3_schedule_suspend(uuid,boolean), public.br_v3_schedule_update(boolean,text) TO authenticated;
