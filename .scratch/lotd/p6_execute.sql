
-- ===== Demande d'exécution et maintenance =====
CREATE OR REPLACE FUNCTION public._br_rs_request_execute(p_job uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; v_enabled boolean;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled INTO v_enabled FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._br_rs_actor_ok(p_actor, j.tenant_id) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;
  IF j.status <> 'prepared' THEN
    RAISE EXCEPTION 'BRR-003: job is %', j.status USING ERRCODE = '55000';
  END IF;
  IF j.execute_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'BRR-004: execution already requested' USING ERRCODE = '55006';
  END IF;
  UPDATE public._br_restore_jobs SET execute_requested_at = now(), execute_requested_by = p_actor, updated_at = now()
   WHERE id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'prepared', 'execute_requested', true, 'scope', 'all_sites');
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_enter_maintenance(p_job uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; v_ttl integer; v_owner uuid;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['prepared']);
  IF j.execute_requested_at IS NULL THEN
    RAISE EXCEPTION 'BRR-005: execution was not requested' USING ERRCODE = '55000';
  END IF;
  SELECT c.maintenance_ttl_seconds INTO v_ttl FROM public._br_restore_config c WHERE c.id = 1;
  INSERT INTO public._br_tenant_maintenance AS m (tenant_id, job_id, started_at, expires_at)
  VALUES (j.tenant_id, j.id, clock_timestamp(), clock_timestamp() + make_interval(secs => v_ttl))
  ON CONFLICT (tenant_id) DO UPDATE SET job_id = EXCLUDED.job_id, started_at = EXCLUDED.started_at, expires_at = EXCLUDED.expires_at
    WHERE m.job_id = EXCLUDED.job_id OR m.expires_at <= clock_timestamp();
  SELECT m.job_id INTO v_owner FROM public._br_tenant_maintenance m WHERE m.tenant_id = j.tenant_id;
  IF v_owner IS DISTINCT FROM j.id THEN
    RAISE EXCEPTION 'BRR-002: tenant already in maintenance for another job' USING ERRCODE = '55006';
  END IF;
  RETURN jsonb_build_object('job_id', p_job, 'maintenance', true);
END $$;

-- ===== Restauration atomique =====
CREATE OR REPLACE FUNCTION public._br_rs_swap(p_job uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j public._br_restore_jobs%ROWTYPE; t record; s record;
  v_safety jsonb; v_before jsonb; v_seq jsonb; v_prof jsonb; v_counters jsonb; v_kept jsonb := '{}'::jsonb;
  v_fill boolean; v_n bigint; v_rows bigint; v_chk text; v_def text[]; v_keys text[]; v_prof_set integer; v_deleted bigint := 0;
  v_inserted bigint := 0; v_err text; v_state text; v_report jsonb;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['prepared']);
  IF j.operation <> 'restore' THEN RAISE EXCEPTION 'BRR-003: not a restore job' USING ERRCODE = '55000'; END IF;
  BEGIN
    PERFORM public._br_rs_exec_preflight(j);
    v_safety := public._br_rs_take_safety(j.id, j.tenant_id);
    INSERT INTO public._br_restore_context (backend_pid, xact_id, tenant_id, job_id)
    VALUES (pg_backend_pid(), txid_current(), j.tenant_id, j.id)
    ON CONFLICT (backend_pid) DO UPDATE SET xact_id = EXCLUDED.xact_id, tenant_id = EXCLUDED.tenant_id, job_id = EXCLUDED.job_id;

    SELECT jsonb_object_agg(c.doc_kind, c.last_number) INTO v_before FROM public.tenant_doc_counters c WHERE c.tenant_id = j.tenant_id;
    SELECT jsonb_object_agg(a.journal_type || '|' || a.fiscal_year, a.last_number) INTO v_seq
    FROM public.accounting_sequences a WHERE a.tenant_id = j.tenant_id;
    SELECT jsonb_object_agg(p.id::text, p.default_site_id) INTO v_prof
    FROM public.profiles p WHERE p.tenant_id = j.tenant_id AND p.default_site_id IS NOT NULL;
    v_fill := EXISTS (SELECT 1 FROM public._br_restore_tables WHERE job_id = j.id AND table_name = 'cash_registers'
                      AND presence = 'historically_absent');

    FOR t IN SELECT g.table_name FROM public._br_table_registry g
             WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect')
             ORDER BY g.restore_order DESC, g.table_name DESC LOOP
      EXECUTE format('DELETE FROM public.%I t WHERE %s', t.table_name, public._br_rs_tenant_pred(t.table_name, 't')) USING j.tenant_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_deleted := v_deleted + v_n;
    END LOOP;

    FOR t IN SELECT rt.table_name, rt.presence, rt.expected_rows, rt.keys, g.category, g.deferred_fk_columns
             FROM public._br_restore_tables rt
             JOIN public._br_table_registry g ON g.schema_name = 'public' AND g.table_name = rt.table_name
             WHERE rt.job_id = j.id ORDER BY rt.restore_order, rt.table_name LOOP
      IF t.presence = 'archived' AND t.expected_rows > 0 THEN
        v_def := ARRAY(SELECT c FROM unnest(coalesce(t.deferred_fk_columns, '{}')) c WHERE c = ANY (t.keys));
        v_n := public._br_rs_insert_table(j.id, t.table_name, 'stage', t.keys, v_def, false,
                                          v_fill AND t.table_name = 'cash_sessions');
        v_inserted := v_inserted + v_n;
      ELSIF t.presence = 'historically_absent' AND t.category = 'structure' THEN
        SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys((
          SELECT sf.row_data FROM public._br_restore_safety sf
          WHERE sf.job_id = j.id AND sf.table_name = t.table_name ORDER BY sf.ord LIMIT 1)) k;
        v_n := CASE WHEN v_keys IS NULL THEN 0
                    ELSE public._br_rs_insert_table(j.id, t.table_name, 'safety', v_keys, '{}', true, false) END;
        SELECT st.rows INTO v_rows FROM public._br_restore_safety_tables st WHERE st.job_id = j.id AND st.table_name = t.table_name;
        v_kept := v_kept || jsonb_build_object(t.table_name, jsonb_build_object('before', v_rows, 'kept', v_n));
      END IF;
      IF v_fill AND t.table_name = 'cash_registers' THEN
        FOR s IN SELECT st.id FROM public.sites st WHERE st.tenant_id = j.tenant_id ORDER BY st.id LOOP
          PERFORM public._ensure_default_cash_register(j.tenant_id, s.id);
        END LOOP;
      END IF;
    END LOOP;

    FOR t IN SELECT rt.table_name, rt.keys, g.deferred_fk_columns FROM public._br_restore_tables rt
             JOIN public._br_table_registry g ON g.schema_name = 'public' AND g.table_name = rt.table_name
             WHERE rt.job_id = j.id AND rt.presence = 'archived' AND rt.expected_rows > 0
               AND coalesce(cardinality(g.deferred_fk_columns), 0) > 0 LOOP
      PERFORM public._br_rs_apply_deferred(j.id, t.table_name,
        ARRAY(SELECT c FROM unnest(t.deferred_fk_columns) c WHERE c = ANY (t.keys)));
    END LOOP;

    v_counters := public._br_rs_fix_counters(j.tenant_id, v_before, v_seq);

    UPDATE public.profiles p SET default_site_id = (v_prof ->> p.id::text)::uuid
     WHERE p.tenant_id = j.tenant_id AND p.default_site_id IS NULL AND v_prof ? p.id::text
       AND EXISTS (SELECT 1 FROM public.sites st WHERE st.id = (v_prof ->> p.id::text)::uuid AND st.tenant_id = j.tenant_id);
    GET DIAGNOSTICS v_prof_set = ROW_COUNT;

    FOR t IN SELECT rt.table_name, rt.presence, rt.expected_rows, rt.expected_checksum, g.category
             FROM public._br_restore_tables rt
             JOIN public._br_table_registry g ON g.schema_name = 'public' AND g.table_name = rt.table_name
             WHERE rt.job_id = j.id LOOP
      SELECT l.o_rows, l.o_checksum INTO v_rows, v_chk FROM public._br_rs_live_state(t.table_name, j.tenant_id) l;
      IF t.presence = 'archived' THEN
        IF t.table_name IN ('tenant_doc_counters', 'accounting_sequences') THEN
          IF v_rows < t.expected_rows THEN
            RAISE EXCEPTION 'BRR-077: % has % rows, archive %', t.table_name, v_rows, t.expected_rows USING ERRCODE = 'XX000';
          END IF;
        ELSIF v_rows <> t.expected_rows THEN
          RAISE EXCEPTION 'BRR-077: % has % rows, archive %', t.table_name, v_rows, t.expected_rows USING ERRCODE = 'XX000';
        ELSIF j.source_format = 3 AND v_chk IS DISTINCT FROM t.expected_checksum THEN
          RAISE EXCEPTION 'BRR-077: % content differs from archive', t.table_name USING ERRCODE = 'XX000';
        END IF;
      ELSIF t.category = 'structure' THEN
        IF v_rows < coalesce((v_kept -> t.table_name ->> 'kept')::bigint, 0)
           OR (t.table_name <> 'cash_registers' AND v_rows <> coalesce((v_kept -> t.table_name ->> 'kept')::bigint, 0)) THEN
          RAISE EXCEPTION 'BRR-077: % kept rows mismatch', t.table_name USING ERRCODE = 'XX000';
        END IF;
      ELSIF v_rows <> 0 THEN
        RAISE EXCEPTION 'BRR-077: historically absent table % is not empty', t.table_name USING ERRCODE = 'XX000';
      END IF;
    END LOOP;

    INSERT INTO public._br_tenant_epoch (tenant_id, changed_at, job_id) VALUES (j.tenant_id, clock_timestamp(), j.id)
    ON CONFLICT (tenant_id) DO UPDATE SET changed_at = EXCLUDED.changed_at, job_id = EXCLUDED.job_id;
    DELETE FROM public._br_tenant_maintenance WHERE tenant_id = j.tenant_id AND job_id = j.id;
    DELETE FROM public._br_restore_context WHERE backend_pid = pg_backend_pid();

    v_report := jsonb_build_object('safety', v_safety, 'deleted_rows', v_deleted, 'inserted_rows', v_inserted,
      'kept_historically_absent', v_kept, 'counters', v_counters, 'default_site_restored', v_prof_set,
      'default_site_cleared', coalesce((SELECT count(*) FROM jsonb_object_keys(coalesce(v_prof, '{}'::jsonb))), 0) - v_prof_set);
    UPDATE public._br_restore_jobs
       SET status = 'succeeded', swap_report = v_report, finished_at = clock_timestamp(),
           lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = j.id;
    DELETE FROM public._br_restore_rows WHERE job_id = j.id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    RETURN public._br_rs_fail(j.id, coalesce(substring(v_err from '^(BRR?-[0-9]{3})'), 'BRR-079'), v_err,
      jsonb_build_object('phase', 'swap', 'sqlstate', v_state, 'message', left(v_err, 500)));
  END;
  RETURN jsonb_build_object('job_id', j.id, 'status', 'succeeded', 'report', v_report);
END $$;
