
-- ===== Réinitialisation transactionnelle (tout le tenant, structure conservée) =====
CREATE OR REPLACE FUNCTION public._br_rs_state_excluding(p_table text, p_tenant uuid, p_cols text[])
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_order text; v_out text;
BEGIN
  SELECT o.order_sql INTO v_order FROM public._br_capture_order(format('public.%I', p_table)::regclass, 't') o;
  EXECUTE format('SELECT count(*)::text || '':'' || coalesce(md5(string_agg(md5((to_jsonb(t) - $2)::text), '''' ORDER BY %s)), '''') '
                 'FROM public.%I t WHERE %s', v_order, p_table, public._br_rs_tenant_pred(p_table, 't'))
    INTO v_out USING p_tenant, coalesce(p_cols, '{}');
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_reset_run(p_job uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j public._br_restore_jobs%ROWTYPE; t record; v_safety jsonb; v_before jsonb := '{}'::jsonb; v_cols text[];
  v_zero CONSTANT jsonb := '{"customers":["balance","updated_at"],"suppliers":["balance","updated_at"],
    "vaults":["current_balance","updated_at"],"mt_accounts":["balance","updated_at"],
    "stock_levels":["quantity","reserved","updated_at"]}'::jsonb;
  v_n bigint; v_deleted jsonb := '{}'::jsonb; v_zeroed jsonb := '{}'::jsonb; v_err text; v_state text; v_report jsonb;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['prepared']);
  IF j.operation <> 'reset' THEN RAISE EXCEPTION 'BRR-003: not a reset job' USING ERRCODE = '55000'; END IF;
  BEGIN
    PERFORM public._br_rs_exec_preflight(j);
    v_safety := public._br_rs_take_safety(j.id, j.tenant_id);
    INSERT INTO public._br_restore_context (backend_pid, xact_id, tenant_id, job_id)
    VALUES (pg_backend_pid(), txid_current(), j.tenant_id, j.id)
    ON CONFLICT (backend_pid) DO UPDATE SET xact_id = EXCLUDED.xact_id, tenant_id = EXCLUDED.tenant_id, job_id = EXCLUDED.job_id;

    FOR t IN SELECT g.table_name FROM public._br_table_registry g
             WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect')
               AND NOT (g.reset_behavior = 'delete' AND g.table_name <> 'tenant_doc_counters') AND g.table_name <> 'stock_lots' LOOP
      v_cols := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_zero -> t.table_name, '[]'::jsonb)));
      v_before := v_before || jsonb_build_object(t.table_name, public._br_rs_state_excluding(t.table_name, j.tenant_id, v_cols));
    END LOOP;
    v_before := v_before || jsonb_build_object('profiles',
      (SELECT count(*)::text || ':' || coalesce(md5(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.id)), '')
       FROM public.profiles p WHERE p.tenant_id = j.tenant_id));

    FOR t IN SELECT g.table_name FROM public._br_table_registry g
             WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect')
               AND ((g.reset_behavior = 'delete' AND g.table_name <> 'tenant_doc_counters') OR g.table_name = 'stock_lots')
             ORDER BY g.restore_order DESC, g.table_name DESC LOOP
      EXECUTE format('DELETE FROM public.%I t WHERE %s', t.table_name, public._br_rs_tenant_pred(t.table_name, 't')) USING j.tenant_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN v_deleted := v_deleted || jsonb_build_object(t.table_name, v_n); END IF;
    END LOOP;

    UPDATE public.customers SET balance = 0 WHERE tenant_id = j.tenant_id AND balance IS DISTINCT FROM 0;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('customers', v_n);
    UPDATE public.suppliers SET balance = 0 WHERE tenant_id = j.tenant_id AND balance IS DISTINCT FROM 0;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('suppliers', v_n);
    UPDATE public.vaults SET current_balance = 0 WHERE tenant_id = j.tenant_id AND current_balance IS DISTINCT FROM 0;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('vaults', v_n);
    UPDATE public.mt_accounts SET balance = 0 WHERE tenant_id = j.tenant_id AND balance IS DISTINCT FROM 0;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('mt_accounts', v_n);
    UPDATE public.stock_levels SET quantity = 0, reserved = 0
     WHERE tenant_id = j.tenant_id AND (quantity IS DISTINCT FROM 0 OR reserved IS DISTINCT FROM 0);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('stock_levels', v_n);

    FOR t IN SELECT g.table_name FROM public._br_table_registry g
             WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect')
               AND ((g.reset_behavior = 'delete' AND g.table_name <> 'tenant_doc_counters') OR g.table_name = 'stock_lots') LOOP
      EXECUTE format('SELECT count(*) FROM public.%I t WHERE %s', t.table_name, public._br_rs_tenant_pred(t.table_name, 't'))
        INTO v_n USING j.tenant_id;
      IF v_n <> 0 THEN RAISE EXCEPTION 'BRR-078: % still has % rows', t.table_name, v_n USING ERRCODE = 'XX000'; END IF;
    END LOOP;
    FOR t IN SELECT e.key AS table_name, e.value #>> '{}' AS state FROM jsonb_each(v_before) e WHERE e.key <> 'profiles' LOOP
      v_cols := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_zero -> t.table_name, '[]'::jsonb)));
      IF public._br_rs_state_excluding(t.table_name, j.tenant_id, v_cols) IS DISTINCT FROM t.state THEN
        RAISE EXCEPTION 'BRR-078: preserved table % changed (cascade or trigger)', t.table_name USING ERRCODE = 'XX000';
      END IF;
    END LOOP;
    IF (SELECT count(*)::text || ':' || coalesce(md5(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.id)), '')
        FROM public.profiles p WHERE p.tenant_id = j.tenant_id) IS DISTINCT FROM v_before ->> 'profiles' THEN
      RAISE EXCEPTION 'BRR-078: profiles changed' USING ERRCODE = 'XX000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.customers WHERE tenant_id = j.tenant_id AND balance <> 0)
       OR EXISTS (SELECT 1 FROM public.suppliers WHERE tenant_id = j.tenant_id AND balance <> 0)
       OR EXISTS (SELECT 1 FROM public.vaults WHERE tenant_id = j.tenant_id AND current_balance <> 0)
       OR EXISTS (SELECT 1 FROM public.mt_accounts WHERE tenant_id = j.tenant_id AND balance <> 0)
       OR EXISTS (SELECT 1 FROM public.stock_levels WHERE tenant_id = j.tenant_id AND (quantity <> 0 OR reserved <> 0)) THEN
      RAISE EXCEPTION 'BRR-078: a balance is not zero after reset' USING ERRCODE = 'XX000';
    END IF;

    INSERT INTO public._br_tenant_epoch (tenant_id, changed_at, job_id) VALUES (j.tenant_id, clock_timestamp(), j.id)
    ON CONFLICT (tenant_id) DO UPDATE SET changed_at = EXCLUDED.changed_at, job_id = EXCLUDED.job_id;
    DELETE FROM public._br_tenant_maintenance WHERE tenant_id = j.tenant_id AND job_id = j.id;
    DELETE FROM public._br_restore_context WHERE backend_pid = pg_backend_pid();
    v_report := jsonb_build_object('safety', v_safety, 'deleted', v_deleted, 'zeroed', v_zeroed, 'scope', 'all_sites');
    UPDATE public._br_restore_jobs
       SET status = 'succeeded', swap_report = v_report, finished_at = clock_timestamp(),
           lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = j.id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    RETURN public._br_rs_fail(j.id, coalesce(substring(v_err from '^(BRR?-[0-9]{3})'), 'BRR-079'), v_err,
      jsonb_build_object('phase', 'reset', 'sqlstate', v_state, 'message', left(v_err, 500)));
  END;
  RETURN jsonb_build_object('job_id', j.id, 'status', 'succeeded', 'report', v_report);
END $$;

-- ===== Libération, abandon, reprise après crash =====
CREATE OR REPLACE FUNCTION public._br_rs_release(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  PERFORM public._br_rs_assert_server();
  DELETE FROM public._br_tenant_maintenance WHERE job_id = p_job;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('job_id', p_job, 'released', v_n);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_abandon(p_job uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._br_rs_actor_ok(p_actor, j.tenant_id) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;
  IF j.status NOT IN ('preparing','prepared') THEN
    RAISE EXCEPTION 'BRR-003: job is %', j.status USING ERRCODE = '55000';
  END IF;
  IF j.lease_expires_at IS NOT NULL AND j.lease_expires_at > clock_timestamp() THEN
    RAISE EXCEPTION 'BRR-060: job is leased by a worker' USING ERRCODE = '55006';
  END IF;
  UPDATE public._br_restore_jobs SET status = 'abandoned', finished_at = clock_timestamp(),
         lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = p_job;
  DELETE FROM public._br_restore_rows WHERE job_id = p_job;
  DELETE FROM public._br_restore_blocks WHERE job_id = p_job;
  DELETE FROM public._br_tenant_maintenance WHERE job_id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'abandoned');
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_recover()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_maint integer; v_ctx integer;
BEGIN
  PERFORM public._br_rs_assert_server();
  DELETE FROM public._br_tenant_maintenance m
   WHERE m.expires_at <= clock_timestamp()
      OR NOT EXISTS (SELECT 1 FROM public._br_restore_jobs j WHERE j.id = m.job_id AND j.status = 'prepared'
                     AND j.lease_expires_at > clock_timestamp());
  GET DIAGNOSTICS v_maint = ROW_COUNT;
  DELETE FROM public._br_restore_context c
   WHERE NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.pid = c.backend_pid);
  GET DIAGNOSTICS v_ctx = ROW_COUNT;
  RETURN jsonb_build_object('released_maintenance', v_maint, 'stale_contexts', v_ctx);
END $$;

-- ===== Orchestrateur côté serveur (indépendant d'une requête HTTP ; aucune planification installée) =====
CREATE OR REPLACE PROCEDURE public._br_rs_executor(p_job uuid, p_worker text, INOUT p_result jsonb DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE v_claim jsonb; v_tok uuid; v_r jsonb; v_status text; v_op text; v_fmt integer; v_req timestamptz;
BEGIN
  v_claim := public._br_rs_claim(p_job, p_worker);
  v_tok := (v_claim ->> 'token')::uuid;
  COMMIT;
  SELECT j.status, j.operation, j.source_format INTO v_status, v_op, v_fmt FROM public._br_restore_jobs j WHERE j.id = p_job;
  IF v_status = 'preparing' AND v_fmt = 2 THEN
    LOOP
      v_r := public._br_rs_load_v2(p_job, v_tok, 5);
      COMMIT;
      IF v_r ->> 'status' = 'failed' THEN p_result := v_r; RETURN; END IF;
      EXIT WHEN (v_r ->> 'done')::boolean;
    END LOOP;
    v_r := public._br_rs_verify(p_job, v_tok);
    COMMIT;
    IF v_r ->> 'status' <> 'prepared' THEN p_result := v_r; RETURN; END IF;
  ELSIF v_status = 'preparing' THEN
    PERFORM public._br_rs_unlease(p_job, v_tok);
    COMMIT;
    p_result := jsonb_build_object('job_id', p_job, 'status', 'preparing', 'awaiting', 'v3_block_worker');
    RETURN;
  END IF;
  SELECT j.execute_requested_at INTO v_req FROM public._br_restore_jobs j WHERE j.id = p_job;
  IF v_req IS NULL THEN
    PERFORM public._br_rs_unlease(p_job, v_tok);
    COMMIT;
    p_result := jsonb_build_object('job_id', p_job, 'status', 'prepared', 'awaiting', 'execute_request');
    RETURN;
  END IF;
  PERFORM public._br_rs_enter_maintenance(p_job, v_tok);
  COMMIT;
  IF v_op = 'reset' THEN v_r := public._br_rs_reset_run(p_job, v_tok);
  ELSE v_r := public._br_rs_swap(p_job, v_tok);
  END IF;
  COMMIT;
  PERFORM public._br_rs_release(p_job);
  COMMIT;
  p_result := v_r;
END $$;

-- ===== Droits : rien pour PUBLIC/anon/authenticated ; API serveur pour service_role =====
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname::text AS name, p.prokind
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE '\_br\_rs\_%' OR p.proname IN ('_br_gate', '_br_gate_check', '_br_lotd_install_hooks',
           '_br_lotd_hooks_status', '_br_restore_jobs_guard', '_br_restore_safety_guard'))
  LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated',
                   CASE WHEN f.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, f.sig);
    IF f.name IN ('_br_rs_request_restore', '_br_rs_request_reset', '_br_rs_claim', '_br_rs_unlease', '_br_rs_fail_job',
                  '_br_rs_load_v2', '_br_rs_v3_plan', '_br_rs_v3_manifest', '_br_rs_v3_load_block', '_br_rs_verify',
                  '_br_rs_request_execute', '_br_rs_enter_maintenance', '_br_rs_swap', '_br_rs_reset_run',
                  '_br_rs_release', '_br_rs_abandon', '_br_rs_recover', '_br_lotd_hooks_status', '_br_rs_executor') THEN
      EXECUTE format('GRANT EXECUTE ON %s %s TO service_role',
                     CASE WHEN f.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, f.sig);
    END IF;
  END LOOP;
END $$;
-- Évaluée dans les clauses WHEN des déclencheurs pour tout rôle ; ne révèle que l'état de la transaction courante.
GRANT EXECUTE ON FUNCTION public._br_restore_bypass() TO PUBLIC;
