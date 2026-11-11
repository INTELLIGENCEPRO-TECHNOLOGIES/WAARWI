
-- ===== Vérification complète de la zone de préparation (aucune mutation métier) =====
CREATE OR REPLACE FUNCTION public._br_rs_verify(p_job uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET timezone = 'UTC' AS $$
DECLARE
  j public._br_restore_jobs%ROWTYPE;
  t record; f record;
  v_issues jsonb := '[]'::jsonb;
  v_rel regclass; v_n bigint; v_bad bigint; v_chk text; v_keys text[]; v_cols text[]; v_pk text[];
  v_tcol text; v_link text; v_sql text; v_err text; v_ccols text[]; v_pcols text[]; v_ptable text; v_pschema text;
  v_ppres text; v_cond text; v_fill boolean; v_sel text; v_ord text;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  IF j.operation <> 'restore' THEN
    RAISE EXCEPTION 'BRR-003: not a restore job' USING ERRCODE = '55000';
  END IF;

  IF j.source_format = 3 THEN
    IF NOT j.manifest_ok THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-040', 'detail', 'manifest not authenticated');
    END IF;
    SELECT count(*) INTO v_n FROM public._br_v3_archive_blocks b
    WHERE b.archive_id = j.source_archive_id
      AND NOT EXISTS (SELECT 1 FROM public._br_restore_blocks rb WHERE rb.job_id = p_job AND rb.block_no = b.block_no);
    IF v_n > 0 THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-046', 'detail', format('%s blocks not loaded', v_n));
    END IF;
  ELSE
    SELECT count(*) INTO v_n FROM public._br_restore_tables WHERE job_id = p_job AND presence = 'archived' AND NOT loaded;
    IF v_n > 0 THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-046', 'detail', format('%s tables not loaded', v_n));
    END IF;
  END IF;

  v_fill := EXISTS (SELECT 1 FROM public._br_restore_tables WHERE job_id = p_job AND table_name = 'cash_registers'
                    AND presence = 'historically_absent');

  FOR t IN SELECT * FROM public._br_restore_tables WHERE job_id = p_job ORDER BY restore_order, table_name LOOP
    v_rel := to_regclass(format('public.%I', t.table_name));
    IF v_rel IS NULL THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-071', 'table', t.table_name, 'detail', 'table missing');
      CONTINUE;
    END IF;
    IF t.presence = 'historically_absent' THEN CONTINUE; END IF;

    SELECT count(*) INTO v_n FROM public._br_restore_rows WHERE job_id = p_job AND table_name = t.table_name;
    IF v_n IS DISTINCT FROM t.expected_rows THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-030', 'table', t.table_name,
        'detail', format('rows %s, expected %s', v_n, coalesce(t.expected_rows::text, 'unknown')));
      CONTINUE;
    END IF;
    IF v_n = 0 THEN
      UPDATE public._br_restore_tables SET keys = '{}' WHERE job_id = p_job AND table_name = t.table_name;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public._br_restore_rows WHERE job_id = p_job AND table_name = t.table_name
               AND jsonb_typeof(row_data) <> 'object') THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-030', 'table', t.table_name, 'detail', 'row is not an object');
      CONTINUE;
    END IF;

    SELECT array_agg(s.k ORDER BY s.k) INTO v_keys FROM (
      SELECT DISTINCT jsonb_object_keys(r.row_data) AS k FROM public._br_restore_rows r
      WHERE r.job_id = p_job AND r.table_name = t.table_name) s;
    IF EXISTS (SELECT 1 FROM public._br_restore_rows r WHERE r.job_id = p_job AND r.table_name = t.table_name
               AND (SELECT count(*) FROM jsonb_object_keys(r.row_data)) <> cardinality(v_keys)) THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-033', 'table', t.table_name, 'detail', 'heterogeneous rows');
      CONTINUE;
    END IF;
    SELECT array_agg(k ORDER BY k) INTO v_cols FROM unnest(v_keys) k
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_rel AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);
    IF v_cols IS NOT NULL THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-033', 'table', t.table_name,
        'detail', 'unknown columns: ' || array_to_string(v_cols, ', '));
      CONTINUE;
    END IF;

    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols FROM pg_attribute a
    WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef
      AND a.attgenerated = '' AND a.attidentity = '' AND NOT (a.attname::text = ANY (v_keys))
      AND NOT (v_fill AND t.table_name = 'cash_sessions' AND a.attname = 'cash_register_id');
    IF v_cols IS NOT NULL THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-036', 'table', t.table_name,
        'detail', 'required columns absent: ' || array_to_string(v_cols, ', '));
      CONTINUE;
    END IF;
    SELECT array_agg(a.attname::text) INTO v_cols FROM pg_attribute a
    WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND a.attgenerated = ''
      AND a.attname::text = ANY (v_keys);
    IF v_cols IS NOT NULL THEN
      SELECT string_agg(format('r.row_data -> %L = %L::jsonb', c, 'null'), ' OR ') INTO v_cond FROM unnest(v_cols) c;
      EXECUTE format('SELECT count(*) FROM public._br_restore_rows r WHERE r.job_id = $1 AND r.table_name = $2 AND (%s)', v_cond)
        INTO v_bad USING p_job, t.table_name;
      IF v_bad > 0 THEN
        v_issues := v_issues || jsonb_build_object('code', 'BRR-036', 'table', t.table_name,
          'detail', format('%s rows with null in a required column', v_bad));
        CONTINUE;
      END IF;
    END IF;

    SELECT l.o_link, l.o_tcol INTO v_link, v_tcol FROM public._br_rs_parent_link(t.table_name) l;
    IF v_link = 'direct' THEN
      SELECT count(*) INTO v_bad FROM public._br_restore_rows r
      WHERE r.job_id = p_job AND r.table_name = t.table_name AND (r.row_data ->> v_tcol) IS DISTINCT FROM j.tenant_id::text;
      IF v_bad > 0 THEN
        v_issues := v_issues || jsonb_build_object('code', 'BRR-037', 'table', t.table_name,
          'detail', format('%s rows belong to another tenant', v_bad));
        CONTINUE;
      END IF;
    END IF;

    BEGIN
      EXECUTE format('SELECT count(*) FROM public._br_restore_rows r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I, r.row_data) p '
                     'WHERE r.job_id = $1 AND r.table_name = $2 AND p IS NOT DISTINCT FROM p', t.table_name)
        INTO v_n USING p_job, t.table_name;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_issues := v_issues || jsonb_build_object('code', 'BRR-035', 'table', t.table_name, 'detail', left(v_err, 300));
      CONTINUE;
    END;

    -- v3 : formule Lot B. v2 : sha256 de la charge (64 car.) ou md5 historique des lignes row_to_json (32 car.),
    -- reconstruit à partir des seules colonnes archivées dans l'ordre physique, trié par id::text sinon par texte.
    IF j.source_format = 3 THEN
      SELECT md5(string_agg(md5(r.row_data::text), '' ORDER BY r.ord)) INTO v_chk
      FROM public._br_restore_rows r WHERE r.job_id = p_job AND r.table_name = t.table_name;
    ELSIF length(t.expected_checksum) = 32 THEN
      SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY a.attnum) INTO v_sel FROM pg_attribute a
      WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname::text = ANY (v_keys);
      v_ord := CASE WHEN 'id' = ANY (v_keys) THEN 'x.r_id' ELSE 'x.j' END;
      EXECUTE format('SELECT md5(string_agg(md5(x.j), '''' ORDER BY %s)) FROM (SELECT row_to_json(s)::text AS j, r.row_data ->> ''id'' AS r_id '
                     'FROM public._br_restore_rows r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I, r.row_data) p '
                     'CROSS JOIN LATERAL (SELECT %s) s WHERE r.job_id = $1 AND r.table_name = $2) x', v_ord, t.table_name, v_sel)
        INTO v_chk USING p_job, t.table_name;
    ELSE
      SELECT encode(sha256(convert_to(string_agg(r.row_data::text, '' ORDER BY r.row_data::text), 'UTF8')), 'hex') INTO v_chk
      FROM public._br_restore_rows r WHERE r.job_id = p_job AND r.table_name = t.table_name;
    END IF;
    IF t.expected_checksum IS NULL OR v_chk IS DISTINCT FROM t.expected_checksum THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-031', 'table', t.table_name, 'detail', 'checksum mismatch');
      CONTINUE;
    END IF;

    v_pk := public._br_rs_pk_cols(v_rel);
    IF v_pk IS NOT NULL THEN
      SELECT string_agg(format('r.row_data -> %L', c), ', ') INTO v_cond FROM unnest(v_pk) c;
      EXECUTE format('SELECT count(*) - count(DISTINCT jsonb_build_array(%s)) FROM public._br_restore_rows r '
                     'WHERE r.job_id = $1 AND r.table_name = $2', v_cond) INTO v_bad USING p_job, t.table_name;
      IF v_bad > 0 THEN
        v_issues := v_issues || jsonb_build_object('code', 'BRR-038', 'table', t.table_name,
          'detail', format('%s duplicate keys', v_bad));
        CONTINUE;
      END IF;
    END IF;
    UPDATE public._br_restore_tables SET keys = v_keys WHERE job_id = p_job AND table_name = t.table_name;
  END LOOP;

  -- Références (internes à l'archive, tables historiquement absentes, et externes)
  IF jsonb_array_length(v_issues) = 0 THEN
    FOR f IN
      SELECT c.conname::text AS conname, cl.relname::text AS child, pcl.relname::text AS parent, pn.nspname::text AS pschema,
             c.conkey, c.confkey, c.conrelid, c.confrelid
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace cn ON cn.oid = cl.relnamespace AND cn.nspname = 'public'
      JOIN pg_class pcl ON pcl.oid = c.confrelid JOIN pg_namespace pn ON pn.oid = pcl.relnamespace
      JOIN public._br_restore_tables rt ON rt.job_id = p_job AND rt.table_name = cl.relname AND rt.presence = 'archived'
      WHERE c.contype = 'f' AND NOT (pn.nspname = 'public' AND pcl.relname = 'tenants')
      ORDER BY cl.relname, c.conname
    LOOP
      SELECT array_agg(a.attname::text ORDER BY k.n) INTO v_ccols
      FROM unnest(f.conkey) WITH ORDINALITY k(attnum, n) JOIN pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = k.attnum;
      SELECT array_agg(a.attname::text ORDER BY k.n) INTO v_pcols
      FROM unnest(f.confkey) WITH ORDINALITY k(attnum, n) JOIN pg_attribute a ON a.attrelid = f.confrelid AND a.attnum = k.attnum;
      SELECT keys INTO v_keys FROM public._br_restore_tables WHERE job_id = p_job AND table_name = f.child;
      IF v_keys IS NULL OR NOT (v_ccols <@ v_keys) THEN CONTINUE; END IF;
      SELECT string_agg(format('r.row_data ->> %L IS NOT NULL', c), ' AND ') INTO v_cond FROM unnest(v_ccols) c;
      SELECT rt.presence INTO v_ppres FROM public._br_restore_tables rt
      WHERE rt.job_id = p_job AND rt.table_name = f.parent AND f.pschema = 'public';
      IF v_ppres = 'archived' THEN
        v_sql := format('SELECT count(*) FROM public._br_restore_rows r WHERE r.job_id = $1 AND r.table_name = $2 AND %s '
                        'AND NOT EXISTS (SELECT 1 FROM public._br_restore_rows q WHERE q.job_id = $1 AND q.table_name = $3 AND %s)',
          v_cond, (SELECT string_agg(format('q.row_data ->> %L = r.row_data ->> %L', v_pcols[i], v_ccols[i]), ' AND ')
                   FROM generate_subscripts(v_ccols, 1) i));
      ELSE
        v_sql := format('SELECT count(*) FROM public._br_restore_rows r WHERE r.job_id = $1 AND r.table_name = $2 AND %s '
                        'AND NOT EXISTS (SELECT 1 FROM %I.%I x WHERE %s) AND $3 IS NOT NULL',
          v_cond, f.pschema, f.parent,
          (SELECT string_agg(format('x.%I::text = r.row_data ->> %L', v_pcols[i], v_ccols[i]), ' AND ')
           FROM generate_subscripts(v_ccols, 1) i));
      END IF;
      EXECUTE v_sql INTO v_bad USING p_job, f.child, f.parent;
      IF v_bad > 0 THEN
        v_issues := v_issues || jsonb_build_object('code', 'BRR-039', 'table', f.child, 'constraint', f.conname,
          'detail', format('%s rows reference missing %s.%s', v_bad, f.pschema, f.parent));
      END IF;
    END LOOP;
  END IF;

  IF jsonb_array_length(v_issues) > 0 THEN
    RETURN public._br_rs_fail(p_job, v_issues -> 0 ->> 'code', 'archive verification failed',
      jsonb_build_object('issues', v_issues));
  END IF;
  UPDATE public._br_restore_jobs
     SET status = 'prepared', prepared_at = now(), schema_fingerprint = public._br_rs_schema_fp(),
         verify_report = jsonb_build_object('issues', '[]'::jsonb,
           'tables', (SELECT jsonb_object_agg(rt.table_name, jsonb_build_object('presence', rt.presence, 'rows', rt.expected_rows))
                      FROM public._br_restore_tables rt WHERE rt.job_id = p_job)),
         updated_at = now()
   WHERE id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'prepared', 'issues', '[]'::jsonb);
END $$;
