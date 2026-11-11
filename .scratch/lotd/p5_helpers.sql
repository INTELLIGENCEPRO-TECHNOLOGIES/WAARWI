
-- ===== Outils internes du moteur (appelés uniquement depuis swap / reset) =====
CREATE OR REPLACE FUNCTION public._br_rs_live_state(p_table text, p_tenant uuid, OUT o_rows bigint, OUT o_checksum text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_order text;
BEGIN
  SELECT o.order_sql INTO v_order FROM public._br_capture_order(format('public.%I', p_table)::regclass, 't') o;
  EXECUTE format('SELECT count(*), md5(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY %s)) FROM public.%I t WHERE %s',
                 v_order, p_table, public._br_rs_tenant_pred(p_table, 't'))
    INTO o_rows, o_checksum USING p_tenant;
END $$;

-- Sauvegarde de sécurité de toutes les tables du registre pour le tenant, vérifiée relecture contre vivant.
CREATE OR REPLACE FUNCTION public._br_rs_take_safety(p_job uuid, p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r record; v_order text; v_rows bigint; v_chk text; v_live_rows bigint; v_live_chk text; v_total bigint := 0; v_n integer := 0;
BEGIN
  FOR r IN SELECT g.table_name FROM public._br_table_registry g
           WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect') ORDER BY g.restore_order, g.table_name LOOP
    SELECT o.order_sql INTO v_order FROM public._br_capture_order(format('public.%I', r.table_name)::regclass, 't') o;
    EXECUTE format('INSERT INTO public._br_restore_safety (job_id, tenant_id, table_name, ord, row_data) '
                   'SELECT $2, $1, %L, row_number() OVER (ORDER BY %s), to_jsonb(t) FROM public.%I t WHERE %s',
                   r.table_name, v_order, r.table_name, public._br_rs_tenant_pred(r.table_name, 't'))
      USING p_tenant, p_job;
    SELECT count(*), md5(string_agg(md5(s.row_data::text), '' ORDER BY s.ord)) INTO v_rows, v_chk
    FROM public._br_restore_safety s WHERE s.job_id = p_job AND s.table_name = r.table_name;
    SELECT l.o_rows, l.o_checksum INTO v_live_rows, v_live_chk FROM public._br_rs_live_state(r.table_name, p_tenant) l;
    IF v_rows <> v_live_rows OR v_chk IS DISTINCT FROM v_live_chk THEN
      RAISE EXCEPTION 'BRR-050: safety backup of % does not match live data', r.table_name USING ERRCODE = 'XX001';
    END IF;
    INSERT INTO public._br_restore_safety_tables (job_id, tenant_id, table_name, rows, checksum)
    VALUES (p_job, p_tenant, r.table_name, v_rows, v_chk);
    v_total := v_total + v_rows; v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('tables', v_n, 'rows', v_total);
END $$;

-- Prédicat « toutes les références sortantes existent » (hors auto-références), sur l'alias d'un enregistrement.
CREATE OR REPLACE FUNCTION public._br_rs_fk_filter(p_table text, p_alias text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(string_agg(
    format('(%s OR EXISTS (SELECT 1 FROM %I.%I x WHERE %s))',
      (SELECT string_agg(format('%I.%I IS NULL', p_alias, a.attname), ' OR ')
       FROM unnest(c.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum),
      pn.nspname, pc.relname,
      (SELECT string_agg(format('x.%I = %I.%I', pa.attname, p_alias, ca.attname), ' AND ')
       FROM unnest(c.conkey, c.confkey) z(ck, pk)
       JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = z.ck
       JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = z.pk)), ' AND '), 'true')
  FROM pg_constraint c
  JOIN pg_class pc ON pc.oid = c.confrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE c.contype = 'f' AND c.conrelid = format('public.%I', p_table)::regclass AND c.confrelid <> c.conrelid;
$$;

-- Insère les lignes d'une table depuis la zone de préparation ('stage') ou la sauvegarde de sécurité ('safety').
CREATE OR REPLACE FUNCTION public._br_rs_insert_table(p_job uuid, p_table text, p_src text, p_keys text[],
  p_deferred text[], p_filter boolean, p_fill_register boolean)
RETURNS bigint LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_src text; v_cols text[]; v_sel text; v_ins text; v_self text[]; v_pk text[]; v_where text := 'true';
  v_n bigint; v_total bigint := 0; v_left bigint;
BEGIN
  v_src := CASE p_src WHEN 'stage' THEN 'public._br_restore_rows' WHEN 'safety' THEN 'public._br_restore_safety' END;
  IF v_src IS NULL THEN RAISE EXCEPTION 'BRR-099: bad source'; END IF;
  v_cols := public._br_insertable_columns('public', p_table, p_keys, coalesce(p_deferred, '{}'));
  IF coalesce(cardinality(v_cols), 0) = 0 THEN RETURN 0; END IF;
  SELECT string_agg(format('%I', c), ', ' ORDER BY n) INTO v_ins FROM unnest(v_cols) WITH ORDINALITY u(c, n);
  SELECT string_agg(format('p.%I', c), ', ' ORDER BY n) INTO v_sel FROM unnest(v_cols) WITH ORDINALITY u(c, n);
  IF p_fill_register AND NOT ('cash_register_id' = ANY (v_cols)) THEN
    v_ins := v_ins || ', cash_register_id';
    v_sel := v_sel || ', (SELECT cr.id FROM public.cash_registers cr WHERE cr.tenant_id = p.tenant_id AND cr.site_id = p.site_id '
                      'ORDER BY cr.is_default DESC, cr.created_at LIMIT 1)';
  ELSIF p_fill_register THEN
    v_sel := replace(v_sel, 'p.cash_register_id', 'coalesce(p.cash_register_id, (SELECT cr.id FROM public.cash_registers cr '
      'WHERE cr.tenant_id = p.tenant_id AND cr.site_id = p.site_id ORDER BY cr.is_default DESC, cr.created_at LIMIT 1))');
  END IF;
  IF p_filter THEN v_where := public._br_rs_fk_filter(p_table, 'p'); END IF;

  SELECT coalesce(g.self_ref_columns, '{}') INTO v_self FROM public._br_table_registry g
  WHERE g.schema_name = 'public' AND g.table_name = p_table;
  v_self := ARRAY(SELECT s FROM unnest(coalesce(v_self, '{}')) s WHERE s = ANY (v_cols));

  IF cardinality(v_self) = 0 THEN
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM %s r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I, r.row_data) p '
                   'WHERE r.job_id = $1 AND r.table_name = $2 AND %s ORDER BY r.ord', p_table, v_ins, v_sel, v_src, p_table, v_where)
      USING p_job, p_table;
    GET DIAGNOSTICS v_total = ROW_COUNT;
    RETURN v_total;
  END IF;

  v_pk := public._br_rs_pk_cols(format('public.%I', p_table)::regclass);
  IF coalesce(cardinality(v_pk), 0) <> 1 THEN
    RAISE EXCEPTION 'BRR-075: self-referencing table % needs a single-column key', p_table USING ERRCODE = 'XX000';
  END IF;
  LOOP
    EXECUTE format('INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM %4$s r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I, r.row_data) p '
                   'WHERE r.job_id = $1 AND r.table_name = $2 AND %5$s AND NOT EXISTS (SELECT 1 FROM public.%1$I e WHERE e.%6$I = p.%6$I) AND %7$s ORDER BY r.ord',
                   p_table, v_ins, v_sel, v_src, v_where, v_pk[1],
                   (SELECT string_agg(format('(p.%1$I IS NULL OR EXISTS (SELECT 1 FROM public.%2$I y WHERE y.%3$I = p.%1$I))', s, p_table, v_pk[1]), ' AND ')
                    FROM unnest(v_self) s))
      USING p_job, p_table;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    EXIT WHEN v_n = 0;
  END LOOP;
  IF NOT p_filter THEN
    EXECUTE format('SELECT count(*) FROM %s r WHERE r.job_id = $1 AND r.table_name = $2', v_src) INTO v_left USING p_job, p_table;
    IF v_left <> v_total THEN
      RAISE EXCEPTION 'BRR-075: % rows of % form an unresolvable self-reference', v_left - v_total, p_table USING ERRCODE = 'XX000';
    END IF;
  END IF;
  RETURN v_total;
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_apply_deferred(p_job uuid, p_table text, p_cols text[])
RETURNS bigint LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_pk text[]; v_n bigint;
BEGIN
  IF coalesce(cardinality(p_cols), 0) = 0 THEN RETURN 0; END IF;
  v_pk := public._br_rs_pk_cols(format('public.%I', p_table)::regclass);
  IF coalesce(cardinality(v_pk), 0) <> 1 THEN
    RAISE EXCEPTION 'BRR-075: table % with deferred columns needs a single-column key', p_table USING ERRCODE = 'XX000';
  END IF;
  EXECUTE format('UPDATE public.%1$I x SET (%2$s) = ROW(%3$s) FROM public._br_restore_rows r '
                 'CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I, r.row_data) p '
                 'WHERE r.job_id = $1 AND r.table_name = $2 AND x.%4$I = p.%4$I',
                 p_table,
                 (SELECT string_agg(format('%I', c), ', ') FROM unnest(p_cols) c),
                 (SELECT string_agg(format('p.%I', c), ', ') FROM unnest(p_cols) c), v_pk[1])
    USING p_job, p_table;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Compteurs : max(courant avant opération, archivé, plus grand numéro présent). Retourne les écarts justifiés.
CREATE OR REPLACE FUNCTION public._br_rs_fix_counters(p_tenant uuid, p_before jsonb, p_seq_before jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  k text; s record; v_arch bigint; v_before bigint; v_found bigint; v_final bigint; v_prefix text;
  v_report jsonb := '{}'::jsonb; v_seq record; v_cur integer;
BEGIN
  FOR k IN SELECT x FROM jsonb_object_keys(coalesce(p_before, '{}'::jsonb)) x
           UNION SELECT c.doc_kind FROM public.tenant_doc_counters c WHERE c.tenant_id = p_tenant
           UNION SELECT cs.doc_kind FROM public._br_rs_counter_sources cs WHERE cs.doc_kind <> 'cm_*'
  LOOP
    SELECT c.last_number INTO v_arch FROM public.tenant_doc_counters c WHERE c.tenant_id = p_tenant AND c.doc_kind = k;
    v_before := (p_before ->> k)::bigint;
    v_found := NULL;
    SELECT * INTO s FROM public._br_rs_counter_sources cs
    WHERE cs.doc_kind = k OR (cs.doc_kind = 'cm_*' AND k LIKE 'cm\_%') ORDER BY (cs.doc_kind = k) DESC LIMIT 1;
    IF FOUND THEN
      v_prefix := coalesce(s.prefix, substr(k, 4));
      IF v_prefix ~ '^[A-Za-z0-9]{1,10}$' THEN
        EXECUTE format('SELECT max((substring(x.%I from %L))::bigint) FROM public.%I x WHERE %s',
                       s.column_name, '^' || v_prefix || '-0*([0-9]{1,18})$', s.table_name,
                       public._br_rs_tenant_pred(s.table_name, 'x'))
          INTO v_found USING p_tenant;
      END IF;
    END IF;
    v_final := greatest(coalesce(v_before, 0), coalesce(v_arch, 0), coalesce(v_found, 0));
    IF v_arch IS NULL AND v_final = 0 THEN CONTINUE; END IF;
    IF v_arch IS NULL THEN
      INSERT INTO public.tenant_doc_counters (tenant_id, doc_kind, last_number) VALUES (p_tenant, k, v_final);
    ELSIF v_final <> v_arch THEN
      UPDATE public.tenant_doc_counters SET last_number = v_final WHERE tenant_id = p_tenant AND doc_kind = k;
    END IF;
    IF v_final IS DISTINCT FROM v_arch THEN
      v_report := v_report || jsonb_build_object(k, jsonb_build_object('archived', v_arch, 'before', v_before,
                                                                      'max_number_found', v_found, 'final', v_final));
    END IF;
  END LOOP;

  FOR v_seq IN SELECT e.key AS k, (e.value)::text::integer AS n FROM jsonb_each(coalesce(p_seq_before, '{}'::jsonb)) e LOOP
    SELECT a.last_number INTO v_cur FROM public.accounting_sequences a
    WHERE a.tenant_id = p_tenant AND a.journal_type || '|' || a.fiscal_year = v_seq.k;
    IF NOT FOUND THEN
      INSERT INTO public.accounting_sequences (tenant_id, journal_type, fiscal_year, last_number)
      VALUES (p_tenant, split_part(v_seq.k, '|', 1), split_part(v_seq.k, '|', 2)::integer, v_seq.n);
      v_cur := NULL;
    ELSIF v_cur < v_seq.n THEN
      UPDATE public.accounting_sequences SET last_number = v_seq.n
      WHERE tenant_id = p_tenant AND journal_type || '|' || fiscal_year = v_seq.k;
    ELSE CONTINUE;
    END IF;
    v_report := v_report || jsonb_build_object('accounting:' || v_seq.k, jsonb_build_object('archived', v_cur, 'final', v_seq.n));
  END LOOP;
  RETURN v_report;
END $$;

-- Vérifications communes avant toute mutation (swap / reset). Prend le verrou exclusif du tenant.
CREATE OR REPLACE FUNCTION public._br_rs_exec_preflight(p_job public._br_restore_jobs)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_hooks jsonb; v_drift jsonb; v_timeout integer;
BEGIN
  IF p_job.execute_requested_at IS NULL THEN
    RAISE EXCEPTION 'BRR-005: execution was not requested' USING ERRCODE = '55000';
  END IF;
  v_hooks := public._br_lotd_hooks_status();
  IF NOT coalesce((v_hooks ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'BRR-070: write gate and trigger guards are not installed' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._br_tenant_maintenance m
                 WHERE m.tenant_id = p_job.tenant_id AND m.job_id = p_job.id AND m.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'BRR-072: tenant is not in maintenance for this job' USING ERRCODE = '55000';
  END IF;
  SELECT c.swap_lock_timeout_ms INTO v_timeout FROM public._br_restore_config c WHERE c.id = 1;
  PERFORM set_config('lock_timeout', greatest(coalesce(v_timeout, 60000), 1000)::text || 'ms', true);
  BEGIN
    PERFORM pg_advisory_xact_lock(1112689732, hashtext(p_job.tenant_id::text));
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'BRR-074: in-flight writes did not finish in time' USING ERRCODE = '55P03';
  END;
  PERFORM set_config('lock_timeout', '0', true);
  v_drift := public.br_check_schema_drift();
  IF coalesce((v_drift ->> 'drift_detected')::boolean, true) THEN
    RAISE EXCEPTION 'BRR-073: schema drift detected' USING ERRCODE = '55000';
  END IF;
  IF p_job.schema_fingerprint IS DISTINCT FROM public._br_rs_schema_fp() THEN
    RAISE EXCEPTION 'BRR-073: schema changed since verification' USING ERRCODE = '55000';
  END IF;
END $$;
