-- Tenant-scoped V3 recovery. The legacy destructive endpoints keep their BR020 guard.
-- Installation of the write guards and activation of recovery are performed separately.
ALTER TABLE public._br_restore_jobs
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'storage'
    CHECK (source_type IN ('storage', 'lws', 'zip')),
  ADD COLUMN IF NOT EXISTS safety_archive_id uuid;

CREATE OR REPLACE FUNCTION public._br_rs_api_tenant(p_actor uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id
  FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
  WHERE p.id = p_actor AND p.is_active IS TRUE AND t.is_active IS TRUE
    AND (t.owner_user_id = p.id OR p.role = 'super_admin');
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_ready()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public._br_restore_config c WHERE c.id = 1 AND c.enabled)
    AND EXISTS (SELECT 1 FROM public._br_capture_executor_config c WHERE c.id AND c.enabled)
    AND EXISTS (SELECT 1 FROM public._br_v3_export_config c WHERE c.id = 1 AND c.enabled)
    AND EXISTS (SELECT 1 FROM cron.job c WHERE c.jobname = 'br_restore_executor' AND c.active);
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_authorize(p_actor uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE tenant uuid := public._br_rs_api_tenant(p_actor);
BEGIN
  PERFORM public._br_rs_assert_server();
  IF tenant IS NULL THEN
    RAISE EXCEPTION 'BRR-403: company owner required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._br_tenant_activation a WHERE a.tenant_id = tenant AND a.enabled) THEN
    RAISE EXCEPTION 'BRR-403: recovery is locked for this company' USING ERRCODE = '42501';
  END IF;
  IF NOT public._br_rs_api_ready() THEN
    RAISE EXCEPTION 'BRR-000: V3 recovery is suspended' USING ERRCODE = '55000';
  END IF;
  RETURN tenant;
END;
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_request(
  p_actor uuid, p_operation text, p_archive uuid DEFAULT NULL, p_source text DEFAULT 'storage'
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tenant uuid := public._br_rs_api_authorize(p_actor);
  existing public._br_restore_jobs%ROWTYPE;
  result jsonb;
BEGIN
  IF p_operation IS NULL OR p_operation NOT IN ('reset','restore_v3') OR p_source IS NULL
      OR p_source NOT IN ('storage','lws','zip') OR (p_operation = 'reset' AND (p_archive IS NOT NULL OR p_source <> 'storage')) THEN
    RAISE EXCEPTION 'BRR-010: unsupported recovery operation' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('waarwi.recovery.request:' || tenant::text, 0));
  SELECT * INTO existing FROM public._br_restore_jobs j
  WHERE j.tenant_id = tenant AND j.status IN ('preparing','prepared') FOR UPDATE;
  IF FOUND THEN
    IF existing.operation = (CASE WHEN p_operation = 'reset' THEN 'reset' ELSE 'restore' END)
        AND existing.source_archive_id IS NOT DISTINCT FROM p_archive AND existing.source_type = p_source THEN
      RETURN jsonb_build_object('job_id', existing.id, 'status', existing.status);
    END IF;
    RAISE EXCEPTION 'BRR-002: a recovery operation is already in progress' USING ERRCODE = '55006';
  END IF;

  IF p_operation = 'reset' THEN
    RETURN public._br_rs_request_reset(tenant, p_actor);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public._br_v3_archives a
    JOIN public._br_backup_jobs j ON j.id = a.job_id AND j.tenant_id = a.tenant_id
    WHERE a.id = p_archive AND a.tenant_id = tenant AND a.status = 'verified'
      AND a.blocks_verified = a.block_count AND j.period_key NOT LIKE 'manual_test:%'
      AND (p_source <> 'lws' OR EXISTS (
        SELECT 1 FROM public._br_v3_offsite_transfers tr WHERE tr.archive_id = a.id AND tr.tenant_id = tenant
          AND tr.status = 'confirmed' AND tr.manifest_confirmed AND tr.blocks_confirmed = a.block_count
          AND tr.remote_prefix = 'v3/' || tenant::text || '/' || a.id::text || '/'
      ))
  ) THEN
    RAISE EXCEPTION 'BRR-404: verified archive not found' USING ERRCODE = 'P0002';
  END IF;

  result := public._br_rs_request_restore(tenant, p_actor, 3, p_archive);
  IF result->>'status' = 'preparing' AND p_source <> 'storage' THEN
    UPDATE public._br_restore_jobs j SET source_type = p_source WHERE j.id = (result->>'job_id')::uuid;
  END IF;
  RETURN result - 'error';
END;
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_status(p_actor uuid, p_job uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tenant uuid := public._br_rs_api_tenant(p_actor);
  j public._br_restore_jobs%ROWTYPE;
  archive public._br_v3_archives%ROWTYPE;
  safety_status text;
BEGIN
  PERFORM public._br_rs_assert_server();
  IF tenant IS NULL THEN
    RAISE EXCEPTION 'BRR-403: company owner required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO j FROM public._br_restore_jobs r
  WHERE r.tenant_id = tenant AND (p_job IS NULL OR r.id = p_job)
  ORDER BY (r.status IN ('preparing','prepared')) DESC, r.created_at DESC, r.id DESC LIMIT 1;
  IF j.id IS NOT NULL THEN
    SELECT * INTO archive FROM public._br_v3_archives a WHERE a.id = j.source_archive_id AND a.tenant_id = tenant;
    SELECT coalesce(a.status,b.status) INTO safety_status
    FROM public._br_backup_jobs b LEFT JOIN public._br_v3_archives a ON a.job_id = b.id AND a.tenant_id = b.tenant_id
    WHERE b.tenant_id = tenant AND b.period_key = 'pre-op:' || j.id::text
    ORDER BY (a.status = 'verified') DESC NULLS LAST, a.created_at DESC NULLS LAST LIMIT 1;
  END IF;
  RETURN jsonb_build_object(
    'available', public._br_rs_api_ready(),
    'authorized', EXISTS (SELECT 1 FROM public._br_tenant_activation a WHERE a.tenant_id = tenant AND a.enabled),
    'scope', 'all_sites',
    'job', CASE WHEN j.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', j.id, 'operation', j.operation, 'status', j.status, 'source', j.source_type,
      'archive_id', archive.id, 'archive_created_at', j.source_captured_at, 'manifest_ok', j.manifest_ok,
      'total_blocks', archive.block_count,
      'loaded_blocks', (SELECT count(*) FROM public._br_restore_blocks WHERE job_id = j.id),
      'execute_requested', j.execute_requested_at IS NOT NULL, 'safety_status', safety_status,
      'error_code', j.error_code, 'finished_at', j.finished_at,
      'maintenance', EXISTS (SELECT 1 FROM public._br_tenant_maintenance m WHERE m.job_id = j.id)
    ) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_import_entry(p_actor uuid, p_job uuid, p_n integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tenant uuid := public._br_rs_api_authorize(p_actor);
  j public._br_restore_jobs%ROWTYPE;
  a public._br_v3_archives%ROWTYPE;
  b public._br_v3_archive_blocks%ROWTYPE;
BEGIN
  SELECT * INTO j FROM public._br_restore_jobs
  WHERE id = p_job AND tenant_id = tenant AND source_type = 'zip' AND source_format = 3;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRR-404: import not found' USING ERRCODE = 'P0002';
  END IF;
  IF j.status NOT IN ('preparing','prepared') OR coalesce(p_n, -1) < 0 OR (p_n > 0 AND NOT j.manifest_ok) THEN
    RAISE EXCEPTION 'BRR-003: import is not waiting for this file' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM public._br_v3_archives WHERE id = j.source_archive_id AND tenant_id = tenant AND status = 'verified';
  IF NOT FOUND OR p_n > a.block_count THEN
    RAISE EXCEPTION 'BRR-404: file not found in verified archive' USING ERRCODE = 'P0002';
  END IF;
  IF p_n > 0 THEN
    SELECT * INTO b FROM public._br_v3_archive_blocks WHERE archive_id = a.id AND block_no = p_n AND verified_at IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'BRR-404: verified block not found' USING ERRCODE = 'P0002'; END IF;
  END IF;
  RETURN jsonb_build_object(
    'archive_id', a.id, 'tenant_id', a.tenant_id, 'generation_id', a.generation_id,
    'key_id', CASE WHEN p_n = 0 THEN a.key_id ELSE b.key_id END,
    'stored_bytes', CASE WHEN p_n = 0 THEN a.manifest_bytes ELSE b.stored_bytes END,
    'stored_sha256', CASE WHEN p_n = 0 THEN a.manifest_sha256 ELSE b.stored_sha256 END,
    'plain_bytes', b.plain_bytes, 'table', b.table_name, 'rows', b.row_count,
    'accepted', CASE WHEN p_n = 0 THEN j.manifest_ok
      ELSE EXISTS (SELECT 1 FROM public._br_restore_blocks rb WHERE rb.job_id = p_job AND rb.block_no = p_n) END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_execute(p_actor uuid, p_job uuid, p_confirmation text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  tenant uuid := public._br_rs_api_authorize(p_actor);
  j public._br_restore_jobs%ROWTYPE;
  capture jsonb;
BEGIN
  SELECT * INTO j FROM public._br_restore_jobs r WHERE r.id = p_job AND r.tenant_id = tenant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRR-404: recovery job not found' USING ERRCODE = 'P0002'; END IF;
  IF p_confirmation IS DISTINCT FROM (CASE WHEN j.operation = 'reset' THEN 'RÉINITIALISER' ELSE 'RESTAURER' END) THEN
    RAISE EXCEPTION 'BRR-001: confirmation does not match' USING ERRCODE = '22023';
  END IF;
  IF j.status <> 'prepared' THEN
    RAISE EXCEPTION 'BRR-003: recovery job is not prepared' USING ERRCODE = '55000';
  END IF;
  IF j.execute_requested_at IS NOT NULL THEN
    RETURN jsonb_build_object('job_id', j.id, 'status', j.status, 'execute_requested', true);
  END IF;

  capture := public._br_v3_request_capture(tenant, 'pre-op:' || j.id::text, 'platform_manual');
  UPDATE public._br_backup_jobs SET label = CASE WHEN j.operation = 'reset' THEN 'Sécurité avant réinitialisation'
    ELSE 'Sécurité avant restauration' END WHERE id = (capture->>'job_id')::uuid AND tenant_id = tenant;
  RETURN public._br_rs_request_execute(j.id, p_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_abandon(p_actor uuid, p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM public._br_rs_assert_server();
  IF NOT EXISTS (SELECT 1 FROM public._br_restore_jobs WHERE id = p_job AND tenant_id = public._br_rs_api_tenant(p_actor)) THEN
    RAISE EXCEPTION 'BRR-404: recovery job not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public._br_rs_abandon(p_job, p_actor);
END;
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_next_v3_load()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT j.id FROM public._br_restore_jobs j
  JOIN public._br_tenant_activation a ON a.tenant_id = j.tenant_id AND a.enabled
  WHERE j.status = 'preparing' AND j.source_format = 3 AND j.source_type IN ('storage','lws') AND public._br_rs_api_ready()
    AND public._br_rs_api_tenant(j.requested_by) = j.tenant_id
    AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= now())
    AND (NOT j.manifest_ok OR EXISTS (
      SELECT 1 FROM public._br_v3_archive_blocks b WHERE b.archive_id = j.source_archive_id AND NOT EXISTS (
        SELECT 1 FROM public._br_restore_blocks rb WHERE rb.job_id = j.id AND rb.block_no = b.block_no)))
  ORDER BY j.updated_at, j.id LIMIT 1;
$$;

-- Performed while the tenant write gate is held exclusively, before any business rows change.
CREATE OR REPLACE FUNCTION public._br_rs_check_safety(p_job uuid, p_tenant uuid)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE generation uuid; actor uuid;
BEGIN
  SELECT a.generation_id, r.execute_requested_by INTO generation, actor FROM public._br_restore_jobs r
  JOIN public._br_v3_archives a ON a.id = r.safety_archive_id AND a.tenant_id = r.tenant_id
  JOIN public._br_backup_jobs b ON b.id = a.job_id AND b.tenant_id = r.tenant_id AND b.period_key = 'pre-op:' || r.id::text
  WHERE r.id = p_job AND r.tenant_id = p_tenant AND a.status = 'verified';
  IF public._br_rs_api_authorize(actor) IS DISTINCT FROM p_tenant THEN
    RAISE EXCEPTION 'BRR-403: recovery authorization changed' USING ERRCODE = '42501';
  END IF;
  IF generation IS NULL OR EXISTS (
    SELECT 1 FROM
    (SELECT table_name, rows, checksum FROM public._br_restore_safety_tables WHERE job_id = p_job AND tenant_id = p_tenant) live
    FULL JOIN
    (SELECT table_name, rows_captured, checksum FROM public._br_capture_progress WHERE generation_id = generation AND tenant_id = p_tenant) saved
    USING (table_name)
    WHERE live.rows IS DISTINCT FROM saved.rows_captured OR live.checksum IS DISTINCT FROM saved.checksum
  ) THEN
    RAISE EXCEPTION 'BRR-080: the verified safety archive no longer matches the tenant' USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._br_rs_dispatch_load()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE runner jsonb;
BEGIN
  IF public._br_rs_api_next_v3_load() IS NULL THEN RETURN; END IF;
  SELECT s.decrypted_secret::jsonb INTO runner FROM vault.decrypted_secrets s WHERE s.name = 'waarwi_backup_v3_runner';
  IF runner IS NULL OR coalesce(runner->>'url','') = '' OR coalesce(runner->'headers'->>'X-Cron-Secret','') = '' THEN
    RAISE EXCEPTION 'BRR-000: V3 recovery worker is not configured' USING ERRCODE = '55000';
  END IF;
  PERFORM net.http_post(url := runner->>'url', headers := runner->'headers', body := '{"action":"restore_load"}'::jsonb,
    timeout_milliseconds := 75000);
END;
$$;

-- pg_cron runs this CALL as a top-level command and commits the write gate independently.
CREATE OR REPLACE PROCEDURE public._br_rs_executor_next()
LANGUAGE plpgsql AS $$
DECLARE request record; result jsonb; verify_job uuid; token uuid;
BEGIN
  PERFORM public._br_rs_recover();
  IF NOT public._br_rs_api_ready() THEN RETURN; END IF;

  -- The complete schema/FK check can exceed the HTTP API statement timeout.
  SELECT j.id INTO verify_job FROM public._br_restore_jobs j
  JOIN public._br_tenant_activation a ON a.tenant_id = j.tenant_id AND a.enabled
  WHERE j.status = 'preparing' AND j.source_format = 3 AND j.manifest_ok
    AND public._br_rs_api_tenant(j.requested_by) = j.tenant_id
    AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= now())
    AND NOT EXISTS (
      SELECT 1 FROM public._br_v3_archive_blocks b WHERE b.archive_id = j.source_archive_id AND NOT EXISTS (
        SELECT 1 FROM public._br_restore_blocks rb WHERE rb.job_id = j.id AND rb.block_no = b.block_no))
  ORDER BY j.updated_at, j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
  IF FOUND THEN
    BEGIN
      result := public._br_rs_claim(verify_job, 'pg_cron:verify');
      token := (result->>'token')::uuid;
      PERFORM public._br_rs_verify(verify_job, token);
      PERFORM public._br_rs_unlease(verify_job, token);
    EXCEPTION WHEN OTHERS THEN
      PERFORM public._br_rs_fail(verify_job, 'BRR-077', 'staging verification failed');
    END;
    COMMIT;
  END IF;
  PERFORM public._br_rs_dispatch_load();

  -- A revoked authorization or a failed security backup must never reach the swap.
  FOR request IN
    SELECT j.id, b.status AS capture_status
    FROM public._br_restore_jobs j
    LEFT JOIN public._br_backup_jobs b ON b.tenant_id = j.tenant_id AND b.period_key = 'pre-op:' || j.id::text
    WHERE j.status = 'prepared' AND j.execute_requested_at IS NOT NULL
      AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= now())
      AND (b.status IN ('failed','cancelled','abandoned') OR
        public._br_rs_api_tenant(j.execute_requested_by) IS DISTINCT FROM j.tenant_id OR NOT EXISTS (
          SELECT 1 FROM public._br_tenant_activation a WHERE a.tenant_id = j.tenant_id AND a.enabled))
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    PERFORM public._br_rs_fail(request.id,
      CASE WHEN request.capture_status IN ('failed','cancelled','abandoned') THEN 'BRR-080' ELSE 'BRR-403' END,
      'recovery authorization or its safety backup is unavailable');
  END LOOP;

  SELECT j.id, j.tenant_id, a.id AS archive_id INTO request
  FROM public._br_restore_jobs j
  JOIN public._br_backup_jobs b ON b.tenant_id = j.tenant_id AND b.period_key = 'pre-op:' || j.id::text
  JOIN public._br_v3_archives a ON a.tenant_id = j.tenant_id AND a.job_id = b.id AND a.status = 'verified'
  WHERE j.status = 'prepared' AND j.execute_requested_at IS NOT NULL
    AND a.verified_at IS NOT NULL AND a.blocks_verified = a.block_count
    AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= now())
  ORDER BY j.execute_requested_at, j.id LIMIT 1 FOR UPDATE OF j SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public._br_restore_jobs SET safety_archive_id = request.archive_id WHERE id = request.id;
  COMMIT;
  CALL public._br_rs_executor(request.id, 'pg_cron:' || pg_backend_pid()::text, result);
  IF result->>'status' = 'succeeded' THEN
    BEGIN
      PERFORM realtime.send('{"table":"*"}'::jsonb, 'data_changed', 'waarwi:tenant:' || request.tenant_id::text, true);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'V3 recovery completed but the refresh notice failed (%).', SQLSTATE;
    END;
  END IF;
END;
$$;

-- Preserve the installed business checks, including those added after the base restore engine.
DO $migration$
DECLARE
  definition text;
  signature regprocedure;
  anchor CONSTANT text := 'v_safety := public._br_rs_take_safety(j.id, j.tenant_id);';
  foreign_branch CONSTANT text := E'      ELSE\n        v_sql := format(''SELECT count(*) FROM public._br_restore_rows r WHERE r.job_id = $1 AND r.table_name = $2 AND %s ';
  verify_sql CONSTANT text := 'EXECUTE v_sql INTO v_bad USING p_job, f.child, f.parent;';
BEGIN
  SELECT pg_get_functiondef('public._br_rs_v3_plan(uuid,uuid,integer)'::regprocedure) INTO definition;
  IF position('j.source_type' IN definition) = 0 THEN
    EXECUTE replace(definition, '''manifest_ok'', j.manifest_ok, ''remaining''',
      '''manifest_ok'', j.manifest_ok, ''source'', j.source_type, ''remaining''');
    IF position('j.source_type' IN pg_get_functiondef('public._br_rs_v3_plan(uuid,uuid,integer)'::regprocedure)) = 0 THEN
      RAISE EXCEPTION 'Unexpected V3 restore plan';
    END IF;
  END IF;
  -- A site-change audit may record a previous site from a former company.
  -- Permit that existing reference only; the execution gate still forbids
  -- changing any rows of the referenced company.
  SELECT pg_get_functiondef('public._br_rs_verify(uuid,uuid)'::regprocedure) INTO definition;
  IF position('f.child = ''site_change_log''' IN definition) = 0 THEN
    IF (length(definition) - length(replace(definition, foreign_branch, ''))) <> length(foreign_branch)
        OR (length(definition) - length(replace(definition, verify_sql, ''))) <> length(verify_sql) THEN
      RAISE EXCEPTION 'Unexpected restore foreign-key validation';
    END IF;
    definition := replace(definition, foreign_branch, $exception$
        IF f.child = 'site_change_log' AND f.parent = 'sites' AND f.pschema = 'public'
            AND v_ccols IN (ARRAY['previous_site_id'], ARRAY['new_site_id']) AND v_pcols = ARRAY['id'] THEN
          v_sql := v_sql || format(' AND NOT EXISTS (SELECT 1 FROM public.sites s WHERE s.tenant_id <> $4 AND s.id::text = r.row_data ->> %L)', v_ccols[1]);
        END IF;
$exception$ || foreign_branch);
    EXECUTE replace(definition, verify_sql, 'EXECUTE v_sql INTO v_bad USING p_job, f.child, f.parent, j.tenant_id;');
  END IF;
  FOREACH signature IN ARRAY ARRAY['public._br_rs_swap(uuid,uuid)'::regprocedure, 'public._br_rs_reset_run(uuid,uuid)'::regprocedure] LOOP
    SELECT pg_get_functiondef(signature) INTO definition;
    IF position('_br_rs_check_safety' IN definition) = 0 THEN
      IF (length(definition) - length(replace(definition, anchor, ''))) <> length(anchor) THEN
        RAISE EXCEPTION 'Unexpected safety check in %', signature;
      END IF;
      EXECUTE replace(definition, anchor, anchor ||
        E'\n    PERFORM public._br_rs_check_safety(j.id, j.tenant_id);');
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET timezone = %L', signature, 'UTC');
  END LOOP;
END;
$migration$;

-- Private service bridge. The Edge role can stage verified blocks but cannot execute a swap.
REVOKE ALL ON FUNCTION public._br_rs_api_tenant(uuid), public._br_rs_api_ready(),
  public._br_rs_api_authorize(uuid), public._br_rs_check_safety(uuid,uuid), public._br_rs_dispatch_load(),
  public._br_rs_api_request(uuid,text,uuid,text), public._br_rs_api_status(uuid,uuid),
  public._br_rs_api_import_entry(uuid,uuid,integer), public._br_rs_api_execute(uuid,uuid,text),
  public._br_rs_api_abandon(uuid,uuid), public._br_rs_api_next_v3_load()
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON PROCEDURE public._br_rs_executor_next(), public._br_rs_executor(uuid,text,jsonb)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._br_rs_request_restore(uuid,uuid,integer,uuid), public._br_rs_request_reset(uuid,uuid),
  public._br_rs_request_execute(uuid,uuid), public._br_rs_enter_maintenance(uuid,uuid), public._br_rs_swap(uuid,uuid),
  public._br_rs_reset_run(uuid,uuid), public._br_rs_load_v2(uuid,uuid,integer), public._br_rs_release(uuid)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._br_rs_api_request(uuid,text,uuid,text), public._br_rs_api_status(uuid,uuid),
  public._br_rs_api_import_entry(uuid,uuid,integer), public._br_rs_api_execute(uuid,uuid,text),
  public._br_rs_api_abandon(uuid,uuid), public._br_rs_api_next_v3_load()
TO service_role;
