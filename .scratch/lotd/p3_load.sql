
-- ===== Cycle de vie des jobs =====
CREATE OR REPLACE FUNCTION public._br_rs_fail(p_job uuid, p_code text, p_message text, p_report jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public._br_restore_jobs
     SET status = 'failed', error_code = p_code, error_message = left(p_message, 2000),
         verify_report = coalesce(p_report, verify_report), finished_at = clock_timestamp(),
         lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = p_job AND status IN ('preparing','prepared');
  DELETE FROM public._br_restore_rows WHERE job_id = p_job;
  DELETE FROM public._br_tenant_maintenance WHERE job_id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'failed', 'error_code', p_code, 'error', left(p_message, 500));
END $$;

-- Verrouille le job, contrôle le bail et l'état, puis prolonge le bail.
CREATE OR REPLACE FUNCTION public._br_rs_lock(p_job uuid, p_token uuid, p_states text[])
RETURNS public._br_restore_jobs LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; v_ttl integer; v_enabled boolean;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled, c.lease_seconds INTO v_enabled, v_ttl FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (j.status = ANY (p_states)) THEN
    RAISE EXCEPTION 'BRR-003: job is %', j.status USING ERRCODE = '55000';
  END IF;
  IF j.lease_token IS DISTINCT FROM p_token OR j.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'BRR-061: lease lost' USING ERRCODE = '55000';
  END IF;
  UPDATE public._br_restore_jobs
     SET lease_expires_at = clock_timestamp() + make_interval(secs => v_ttl), updated_at = now()
   WHERE id = p_job RETURNING * INTO j;
  RETURN j;
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_request_restore(p_tenant uuid, p_actor uuid, p_format integer, p_source uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_enabled boolean; v_job uuid; v_captured timestamptz; v_keys text[];
  v_counts jsonb; v_checks jsonb; v_status text; v_owner uuid; v_fmt integer; v_gen uuid;
  v_missing text[]; v_unknown text[]; v_n integer;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled INTO v_enabled FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  IF NOT public._br_rs_actor_ok(p_actor, p_tenant) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;

  IF p_format = 2 THEN
    SELECT tb.tenant_id, tb.format_version, tb.status::text, tb.created_at, tb.row_counts, tb.checksums
      INTO v_owner, v_fmt, v_status, v_captured, v_counts, v_checks
    FROM public.tenant_backups tb WHERE tb.id = p_source;
    IF v_owner IS NULL OR v_owner <> p_tenant THEN
      RAISE EXCEPTION 'BRR-404: source not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_fmt IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'BRR-010: unsupported archive format %', coalesce(v_fmt::text, 'unknown') USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'verified' THEN
      RAISE EXCEPTION 'BRR-011: archive is not verified' USING ERRCODE = '55000';
    END IF;
    SELECT array_agg(k) INTO v_keys
    FROM jsonb_object_keys((SELECT tb.payload FROM public.tenant_backups tb WHERE tb.id = p_source)) k;
    v_keys := coalesce(v_keys, '{}');
  ELSIF p_format = 3 THEN
    SELECT a.tenant_id, a.status, g.captured_at, a.generation_id INTO v_owner, v_status, v_captured, v_gen
    FROM public._br_v3_archives a
    LEFT JOIN public._br_capture_generations g ON g.id = a.generation_id
    WHERE a.id = p_source;
    IF v_owner IS NULL OR v_owner <> p_tenant THEN
      RAISE EXCEPTION 'BRR-404: source not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_status <> 'verified' OR v_captured IS NULL THEN
      RAISE EXCEPTION 'BRR-011: archive is not verified' USING ERRCODE = '55000';
    END IF;
    SELECT array_agg(p.table_name), jsonb_object_agg(p.table_name, p.rows_captured),
           jsonb_object_agg(p.table_name, p.checksum)
      INTO v_keys, v_counts, v_checks
    FROM public._br_capture_progress p WHERE p.generation_id = v_gen;
    v_keys := coalesce(v_keys, '{}');
  ELSE
    RAISE EXCEPTION 'BRR-010: unsupported archive format %', coalesce(p_format::text, 'null') USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public._br_restore_jobs (tenant_id, operation, source_format, source_backup_id, source_archive_id,
      source_captured_at, requested_by)
    VALUES (p_tenant, 'restore', p_format, CASE WHEN p_format = 2 THEN p_source END,
      CASE WHEN p_format = 3 THEN p_source END, v_captured, p_actor)
    RETURNING id INTO v_job;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BRR-002: another restore or reset is already in progress for this tenant' USING ERRCODE = '55006';
  END;

  INSERT INTO public._br_restore_tables (job_id, tenant_id, table_name, restore_order, presence, expected_rows, expected_checksum)
  SELECT v_job, p_tenant, r.table_name, r.restore_order,
         CASE WHEN r.table_name = ANY (v_keys) THEN 'archived' ELSE 'historically_absent' END,
         CASE WHEN r.table_name = ANY (v_keys) THEN (v_counts ->> r.table_name)::bigint END,
         CASE WHEN r.table_name = ANY (v_keys) THEN v_checks ->> r.table_name END
  FROM public._br_table_registry r
  WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect')
    AND (r.table_name = ANY (v_keys) OR r.created_at > v_captured);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  SELECT array_agg(r.table_name ORDER BY r.table_name) INTO v_missing
  FROM public._br_table_registry r
  WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect')
    AND NOT (r.table_name = ANY (v_keys)) AND r.created_at <= v_captured;
  SELECT array_agg(k ORDER BY k) INTO v_unknown FROM unnest(v_keys) k
  WHERE NOT EXISTS (SELECT 1 FROM public._br_table_registry r
                    WHERE r.schema_name = 'public' AND r.table_name = k AND r.tenant_link IN ('direct','indirect'))
    AND NOT (p_format = 2 AND k LIKE '\_%');

  IF v_missing IS NOT NULL THEN
    RETURN public._br_rs_fail(v_job, 'BRR-020', 'mandatory tables missing from archive: ' || array_to_string(v_missing, ', '),
      jsonb_build_object('missing_tables', to_jsonb(v_missing)));
  END IF;
  IF v_unknown IS NOT NULL THEN
    RETURN public._br_rs_fail(v_job, 'BRR-032', 'archive contains unknown tables: ' || array_to_string(v_unknown, ', '),
      jsonb_build_object('unknown_tables', to_jsonb(v_unknown)));
  END IF;
  RETURN jsonb_build_object('job_id', v_job, 'status', 'preparing', 'tables', v_n,
    'historically_absent', (SELECT coalesce(jsonb_agg(t.table_name ORDER BY t.table_name), '[]'::jsonb)
                            FROM public._br_restore_tables t WHERE t.job_id = v_job AND t.presence = 'historically_absent'));
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_request_reset(p_tenant uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_enabled boolean; v_job uuid;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled INTO v_enabled FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  IF NOT public._br_rs_actor_ok(p_actor, p_tenant) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;
  BEGIN
    INSERT INTO public._br_restore_jobs (tenant_id, operation, requested_by, status, prepared_at)
    VALUES (p_tenant, 'reset', p_actor, 'prepared', now()) RETURNING id INTO v_job;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BRR-002: another restore or reset is already in progress for this tenant' USING ERRCODE = '55006';
  END;
  UPDATE public._br_restore_jobs SET schema_fingerprint = public._br_rs_schema_fp() WHERE id = v_job;
  RETURN jsonb_build_object('job_id', v_job, 'status', 'prepared', 'scope', 'all_sites');
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_claim(p_job uuid, p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; v_tok uuid := gen_random_uuid(); v_ttl integer; v_enabled boolean;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled, c.lease_seconds INTO v_enabled, v_ttl FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002'; END IF;
  IF j.status NOT IN ('preparing','prepared') THEN
    RAISE EXCEPTION 'BRR-003: job is %', j.status USING ERRCODE = '55000';
  END IF;
  IF j.lease_expires_at IS NOT NULL AND j.lease_expires_at > clock_timestamp() THEN
    RAISE EXCEPTION 'BRR-060: job is leased by another worker' USING ERRCODE = '55006';
  END IF;
  UPDATE public._br_restore_jobs
     SET fence = fence + 1, lease_token = v_tok, lease_owner = left(coalesce(p_worker, 'worker'), 100),
         lease_expires_at = clock_timestamp() + make_interval(secs => v_ttl), updated_at = now()
   WHERE id = p_job RETURNING * INTO j;
  RETURN jsonb_build_object('job_id', j.id, 'token', v_tok, 'fence', j.fence, 'operation', j.operation,
    'format', j.source_format, 'status', j.status, 'tenant_id', j.tenant_id);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_unlease(p_job uuid, p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._br_rs_assert_server();
  UPDATE public._br_restore_jobs SET lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = p_job AND lease_token = p_token AND status IN ('preparing','prepared');
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_fail_job(p_job uuid, p_token uuid, p_code text, p_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._br_rs_lock(p_job, p_token, ARRAY['preparing','prepared']);
  IF p_code !~ '^BR[A-Z]?-[0-9]{3}$' THEN p_code := 'BRR-099'; END IF;
  RETURN public._br_rs_fail(p_job, p_code, coalesce(p_message, 'worker integrity failure'));
END $$;

-- ===== Chargement v2 : table par table depuis tenant_backups.payload =====
CREATE OR REPLACE FUNCTION public._br_rs_load_v2(p_job uuid, p_token uuid, p_max_tables integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; t record; v_type text; v_n bigint; v_done integer := 0; v_left integer;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  IF j.source_format IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'BRR-010: job is not a v2 restore' USING ERRCODE = '22023';
  END IF;
  FOR t IN SELECT rt.table_name FROM public._br_restore_tables rt
           WHERE rt.job_id = p_job AND rt.presence = 'archived' AND NOT rt.loaded
           ORDER BY rt.restore_order, rt.table_name LIMIT greatest(coalesce(p_max_tables, 1), 1)
  LOOP
    SELECT jsonb_typeof(tb.payload -> t.table_name) INTO v_type FROM public.tenant_backups tb WHERE tb.id = j.source_backup_id;
    IF v_type IS DISTINCT FROM 'array' THEN
      RETURN public._br_rs_fail(p_job, 'BRR-030', format('table %s is not an array in the archive', t.table_name));
    END IF;
    DELETE FROM public._br_restore_rows WHERE job_id = p_job AND table_name = t.table_name;
    INSERT INTO public._br_restore_rows (job_id, table_name, ord, row_data)
    SELECT p_job, t.table_name, e.ord, e.val
    FROM public.tenant_backups tb
    CROSS JOIN LATERAL jsonb_array_elements(tb.payload -> t.table_name) WITH ORDINALITY AS e(val, ord)
    WHERE tb.id = j.source_backup_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE public._br_restore_tables SET loaded = true, loaded_rows = v_n WHERE job_id = p_job AND table_name = t.table_name;
    v_done := v_done + 1;
  END LOOP;
  SELECT count(*) INTO v_left FROM public._br_restore_tables
  WHERE job_id = p_job AND presence = 'archived' AND NOT loaded;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'loaded_now', v_done, 'remaining', v_left, 'done', v_left = 0);
END $$;

-- ===== Chargement v3 : manifeste puis blocs déchiffrés par le worker =====
CREATE OR REPLACE FUNCTION public._br_rs_v3_plan(p_job uuid, p_token uuid, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; a public._br_v3_archives%ROWTYPE; v_blocks jsonb; v_left integer;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  IF j.source_format IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'BRR-010: job is not a v3 restore' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public._br_v3_archives WHERE id = j.source_archive_id;
  IF NOT FOUND OR a.status <> 'verified' OR a.tenant_id <> j.tenant_id THEN
    RETURN public._br_rs_fail(p_job, 'BRR-011', 'archive is no longer verified');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('block_no', b.block_no, 'table', b.table_name, 'ord_from', b.ord_from,
           'ord_to', b.ord_to, 'rows', b.row_count, 'plain_bytes', b.plain_bytes, 'object_path', b.object_path,
           'key_id', b.key_id) ORDER BY b.block_no), '[]'::jsonb)
    INTO v_blocks
  FROM (SELECT * FROM public._br_v3_archive_blocks b0
        WHERE b0.archive_id = a.id
          AND NOT EXISTS (SELECT 1 FROM public._br_restore_blocks rb WHERE rb.job_id = p_job AND rb.block_no = b0.block_no)
        ORDER BY b0.block_no LIMIT greatest(coalesce(p_limit, 1), 1)) b;
  SELECT count(*) INTO v_left FROM public._br_v3_archive_blocks b
  WHERE b.archive_id = a.id
    AND NOT EXISTS (SELECT 1 FROM public._br_restore_blocks rb WHERE rb.job_id = p_job AND rb.block_no = b.block_no);
  RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'manifest_ok', j.manifest_ok, 'remaining', v_left,
    'archive', jsonb_build_object('id', a.id, 'tenant_id', a.tenant_id, 'generation_id', a.generation_id,
      'key_id', a.key_id, 'manifest_path', a.manifest_path, 'manifest_bytes', a.manifest_bytes),
    'blocks', v_blocks);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_v3_manifest(p_job uuid, p_token uuid, p_stored_sha256 text, p_plain_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; a public._br_v3_archives%ROWTYPE; v_ref text;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  SELECT * INTO a FROM public._br_v3_archives WHERE id = j.source_archive_id;
  IF p_stored_sha256 IS DISTINCT FROM a.manifest_sha256 OR p_plain_sha256 IS DISTINCT FROM a.manifest_plain_sha256 THEN
    RETURN public._br_rs_fail(p_job, 'BRR-041', 'manifest altered or mismatched');
  END IF;
  v_ref := encode(sha256(convert_to(public._br_v3_manifest_text(a.id), 'UTF8')), 'hex');
  IF v_ref IS DISTINCT FROM a.manifest_plain_sha256 THEN
    RETURN public._br_rs_fail(p_job, 'BRR-042', 'server-side archive metadata no longer matches the manifest');
  END IF;
  UPDATE public._br_restore_jobs SET manifest_ok = true, updated_at = now() WHERE id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'manifest_ok', true);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_v3_load_block(p_job uuid, p_token uuid, p_block_no integer,
  p_stored_sha256 text, p_lines text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; a public._br_v3_archives%ROWTYPE; k public._br_v3_archive_blocks%ROWTYPE;
  v_body text;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  IF NOT j.manifest_ok THEN
    RAISE EXCEPTION 'BRR-040: manifest not authenticated yet' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM public._br_v3_archives WHERE id = j.source_archive_id;
  SELECT * INTO k FROM public._br_v3_archive_blocks WHERE archive_id = a.id AND block_no = p_block_no;
  IF NOT FOUND OR k.verified_at IS NULL THEN
    RETURN public._br_rs_fail(p_job, 'BRR-043', format('block %s unknown or not verified', p_block_no));
  END IF;
  IF EXISTS (SELECT 1 FROM public._br_restore_blocks WHERE job_id = p_job AND block_no = p_block_no) THEN
    RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'block_no', p_block_no, 'already_loaded', true);
  END IF;
  IF p_stored_sha256 IS DISTINCT FROM k.stored_sha256 THEN
    RETURN public._br_rs_fail(p_job, 'BRR-044', format('stored object of block %s altered', p_block_no));
  END IF;
  IF coalesce(cardinality(p_lines), 0) <> k.row_count OR array_position(p_lines, NULL) IS NOT NULL THEN
    RETURN public._br_rs_fail(p_job, 'BRR-045', format('block %s row count mismatch', p_block_no));
  END IF;
  v_body := jsonb_build_object('format', 'waarwi-br-block', 'format_version', 3, 'tenant_id', a.tenant_id,
              'archive_id', a.id, 'generation_id', a.generation_id, 'block_no', k.block_no,
              'table', k.table_name, 'ord_from', k.ord_from, 'ord_to', k.ord_to, 'rows', k.row_count)::text
            || E'\n' || array_to_string(p_lines, E'\n') || E'\n';
  IF octet_length(v_body) <> k.plain_bytes OR encode(sha256(convert_to(v_body, 'UTF8')), 'hex') <> k.plain_sha256 THEN
    RETURN public._br_rs_fail(p_job, 'BRR-045', format('block %s content does not match its verified hash', p_block_no));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._br_restore_tables WHERE job_id = p_job AND table_name = k.table_name AND presence = 'archived') THEN
    RETURN public._br_rs_fail(p_job, 'BRR-032', format('block %s targets unplanned table %s', p_block_no, k.table_name));
  END IF;
  INSERT INTO public._br_restore_rows (job_id, table_name, ord, row_data)
  SELECT p_job, k.table_name, k.ord_from + l.n - 1, l.line::jsonb
  FROM unnest(p_lines) WITH ORDINALITY AS l(line, n);
  INSERT INTO public._br_restore_blocks (job_id, block_no, rows) VALUES (p_job, p_block_no, k.row_count);
  UPDATE public._br_restore_tables SET loaded_rows = loaded_rows + k.row_count
   WHERE job_id = p_job AND table_name = k.table_name;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'block_no', p_block_no, 'rows', k.row_count);
END $$;
