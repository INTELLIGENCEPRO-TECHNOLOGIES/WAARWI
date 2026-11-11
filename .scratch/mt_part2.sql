
CREATE OR REPLACE FUNCTION public._br_v3_mt_capture_claim()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
  j public._br_backup_jobs%ROWTYPE;
  cfg public._br_capture_executor_config%ROWTYPE;
  v_slot smallint;
  v_con text;
  v_lease integer;
  v_worker text := 'trial:' || pg_backend_pid();
BEGIN
  PERFORM set_config('waarwi.br_executor_claim', '', false);
  SELECT * INTO t FROM public._br_v3_manual_test_target WHERE id = 1;
  IF NOT FOUND OR NOT t.armed OR t.job_id IS NULL THEN
    RETURN jsonb_build_object('state', 'idle');
  END IF;
  SELECT * INTO j FROM public._br_backup_jobs x WHERE x.id = t.job_id AND x.tenant_id = t.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'idle');
  END IF;
  IF j.status IN ('succeeded', 'failed', 'cancelled') THEN
    PERFORM public._br_v3_mt_schedule(false);
    RETURN jsonb_build_object('state', 'finished', 'status', j.status);
  END IF;
  IF j.status IN ('leased', 'processing') AND j.lease_expires_at < now() THEN
    IF public._br_job_try_reconcile(j.id, 'recover_expired') IS NULL THEN
      PERFORM public._br_job_apply_failure(j.id, 'LEASE_EXPIRED', 'Lease expired before completion', 300,
                                           'lease_expired_recovered');
    END IF;
    SELECT * INTO j FROM public._br_backup_jobs x WHERE x.id = t.job_id;
  END IF;
  IF j.status <> 'pending' OR j.next_attempt_at > now() THEN
    RETURN jsonb_build_object('state', 'idle', 'status', j.status);
  END IF;

  SELECT * INTO cfg FROM public._br_capture_executor_config c WHERE c.id;
  v_lease := cfg.capture_timeout_seconds + cfg.lease_margin_seconds;
  FOR v_slot IN
    SELECT s.slot_no FROM public._br_capture_slots s
    WHERE NOT EXISTS (SELECT 1 FROM public._br_backup_jobs o WHERE o.slot_no = s.slot_no)
    ORDER BY s.slot_no
  LOOP
    BEGIN
      UPDATE public._br_backup_jobs x
         SET status = 'leased', attempts = x.attempts + 1, claim_fence = x.claim_fence + 1,
             slot_no = v_slot, worker_id = v_worker, lease_token = gen_random_uuid(),
             lease_started_at = now(), lease_expires_at = now() + make_interval(secs => v_lease),
             heartbeat_at = now(), error_class = NULL
       WHERE x.id = t.job_id AND x.tenant_id = t.tenant_id AND x.status = 'pending'
      RETURNING x.* INTO j;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'idle');
      END IF;
      PERFORM public._br_job_log(j.id, j.tenant_id, 'leased', 'pending', 'leased', j.attempts, v_worker,
        jsonb_build_object('lease_seconds', v_lease, 'claim_fence', j.claim_fence, 'slot_no', j.slot_no,
                           'manual_test', true));
      PERFORM public._br_job_mark_processing(j.id, j.lease_token);
      PERFORM set_config('waarwi.br_executor_claim',
        jsonb_build_object('job_id', j.id, 'lease_token', j.lease_token)::text, false);
      RETURN jsonb_build_object('state', 'claimed', 'job_id', j.id, 'attempt', j.attempts);
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con = 'uq_br_backup_jobs_slot' THEN
        CONTINUE;
      ELSIF v_con = 'uq_br_backup_jobs_one_active_per_tenant' THEN
        RETURN jsonb_build_object('state', 'busy');
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('state', 'no_slot');
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_mt_export_claim(p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
  cfg public._br_v3_export_config%ROWTYPE;
  a public._br_v3_archives%ROWTYPE;
  j public._br_backup_jobs%ROWTYPE;
  v_id uuid;
  v_chk jsonb;
  v_reg text;
BEGIN
  IF p_worker_id IS NULL OR char_length(p_worker_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'BRV-001: invalid worker_id' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public._br_v3_manual_test_target WHERE id = 1;
  IF NOT FOUND OR NOT t.armed OR t.job_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO cfg FROM public._br_v3_export_config WHERE id = 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  FOR a IN SELECT * FROM public._br_v3_archives x
           WHERE x.job_id = t.job_id AND x.tenant_id = t.tenant_id
             AND x.status IN ('exporting','verifying','publishing')
             AND (x.export_lease_expires_at IS NULL OR x.export_lease_expires_at <= clock_timestamp())
           ORDER BY x.created_at, x.id
           FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT public._br_v3_binding_ok(a) THEN
      PERFORM public._br_v3_terminate(a.id, 'abandoned', 'JOB_DETACHED', 'Job or generation changed during export');
      CONTINUE;
    END IF;
    IF a.export_claims >= cfg.max_export_claims THEN
      PERFORM public._br_v3_terminate(a.id, 'failed', 'BRV-046', 'Too many export attempts');
      CONTINUE;
    END IF;
    v_id := a.id;
    EXIT;
  END LOOP;

  IF v_id IS NULL THEN
    SELECT * INTO j FROM public._br_backup_jobs x
    WHERE x.id = t.job_id AND x.tenant_id = t.tenant_id
      AND x.status = 'capture_ready' AND x.capture_generation_id IS NOT NULL
    FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      v_chk := public._br_capture_verify_staging(j.capture_generation_id, true);
      IF coalesce((v_chk->>'ok')::boolean, false) THEN
        SELECT md5(string_agg(r.schema_name || '.' || r.table_name || ':' || r.tenant_link || ':' ||
                              coalesce(r.tenant_id_column, '') || ':' || coalesce(r.parent_table, '') || ':' ||
                              r.restore_order, '|' ORDER BY r.schema_name, r.table_name))
          INTO v_reg FROM public._br_table_registry r;
        v_id := gen_random_uuid();
        INSERT INTO public._br_v3_archives (id, tenant_id, job_id, generation_id, storage_bucket, storage_prefix,
          registry_fingerprint, block_target_bytes, row_max_bytes, max_rows_per_block)
        VALUES (v_id, j.tenant_id, j.id, j.capture_generation_id, cfg.storage_bucket,
          format('tenants/%s/archives/%s/', j.tenant_id, v_id), v_reg,
          cfg.block_target_bytes, cfg.row_max_bytes, cfg.max_rows_per_block);
        UPDATE public._br_backup_jobs SET status = 'exporting', heartbeat_at = now() WHERE id = j.id;
        PERFORM public._br_job_log(j.id, j.tenant_id, 'export_started', 'capture_ready', 'exporting', j.attempts,
          p_worker_id, jsonb_build_object('archive_id', v_id, 'generation_id', j.capture_generation_id,
                                          'manual_test', true));
      END IF;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public._br_v3_archives
     SET export_fence = export_fence + 1, export_lease_token = gen_random_uuid(),
         export_lease_expires_at = clock_timestamp() + make_interval(secs => cfg.lease_seconds),
         export_worker_id = p_worker_id, export_claims = export_claims + 1
   WHERE id = v_id
  RETURNING * INTO a;

  RETURN jsonb_build_object('archive_id', a.id, 'tenant_id', a.tenant_id, 'job_id', a.job_id,
    'generation_id', a.generation_id, 'status', a.status, 'export_fence', a.export_fence,
    'lease_token', a.export_lease_token, 'lease_expires_at', a.export_lease_expires_at,
    'storage_bucket', a.storage_bucket, 'storage_prefix', a.storage_prefix, 'key_id', a.key_id,
    'next_block_no', a.next_block_no, 'blocks_verified', a.blocks_verified, 'block_count', a.block_count,
    'block_target_bytes', a.block_target_bytes, 'row_max_bytes', a.row_max_bytes,
    'max_blocks_per_invocation', cfg.max_blocks_per_invocation);
END $$;

CREATE OR REPLACE FUNCTION public.br_v3_manual_test_request()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
  v_status text;
  v_req jsonb;
  v_job uuid;
BEGIN
  t := public._br_v3_mt_authorize();
  PERFORM 1 FROM public._br_v3_manual_test_target WHERE id = 1 FOR UPDATE;
  t := public._br_v3_mt_authorize();
  IF t.job_id IS NOT NULL THEN
    SELECT j.status INTO v_status FROM public._br_backup_jobs j WHERE j.id = t.job_id AND j.tenant_id = t.tenant_id;
    IF v_status IS NOT NULL AND v_status NOT IN ('succeeded', 'failed', 'cancelled') THEN
      PERFORM public._br_v3_mt_schedule(true);
      RETURN public._br_v3_mt_state(t.job_id) || jsonb_build_object('created', false);
    END IF;
  END IF;
  v_req := public._br_v3_request_capture(t.tenant_id,
    'manual_test:' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISSMS'), 'platform_manual', 3);
  v_job := (v_req->>'job_id')::uuid;
  UPDATE public._br_v3_manual_test_target SET job_id = v_job, requested_at = now(), updated_at = now() WHERE id = 1;
  PERFORM public._br_v3_mt_schedule(true);
  RETURN public._br_v3_mt_state(v_job) || jsonb_build_object('created', coalesce((v_req->>'created')::boolean, false));
END $$;

CREATE OR REPLACE FUNCTION public.br_v3_manual_test_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
BEGIN
  t := public._br_v3_mt_authorize();
  RETURN public._br_v3_mt_state(t.job_id);
END $$;

REVOKE ALL ON FUNCTION
  public._br_v3_mt_authorize(),
  public._br_v3_mt_runner_token(),
  public._br_v3_mt_runner_ok(text),
  public._br_v3_mt_schedule(boolean),
  public._br_v3_mt_state(uuid),
  public._br_v3_mt_capture_claim(),
  public._br_v3_mt_export_claim(text),
  public.br_v3_manual_test_request(),
  public.br_v3_manual_test_status()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public._br_v3_mt_runner_ok(text), public._br_v3_mt_export_claim(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.br_v3_manual_test_request(), public.br_v3_manual_test_status() TO authenticated;
