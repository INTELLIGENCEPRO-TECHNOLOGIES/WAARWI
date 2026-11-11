
-- ===== Gardes d'intégrité des tables du moteur =====
CREATE OR REPLACE FUNCTION public._br_restore_jobs_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
      RAISE EXCEPTION 'BRR-081: restore jobs are never deleted' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('succeeded','failed','abandoned') THEN
    RAISE EXCEPTION 'BRR-081: terminal job is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.operation <> OLD.operation
     OR NEW.source_format IS DISTINCT FROM OLD.source_format
     OR NEW.source_backup_id IS DISTINCT FROM OLD.source_backup_id
     OR NEW.source_archive_id IS DISTINCT FROM OLD.source_archive_id
     OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'BRR-081: job identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS _br_restore_jobs_guard ON public._br_restore_jobs;
CREATE TRIGGER _br_restore_jobs_guard BEFORE UPDATE OR DELETE ON public._br_restore_jobs
  FOR EACH ROW EXECUTE FUNCTION public._br_restore_jobs_guard();

CREATE OR REPLACE FUNCTION public._br_restore_safety_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'BRR-082: safety backup is immutable' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
    RAISE EXCEPTION 'BRR-082: safety backup is never deleted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS _br_restore_safety_guard ON public._br_restore_safety;
CREATE TRIGGER _br_restore_safety_guard BEFORE UPDATE OR DELETE ON public._br_restore_safety
  FOR EACH ROW EXECUTE FUNCTION public._br_restore_safety_guard();
DROP TRIGGER IF EXISTS _br_restore_safety_guard ON public._br_restore_safety_tables;
CREATE TRIGGER _br_restore_safety_guard BEFORE UPDATE OR DELETE ON public._br_restore_safety_tables
  FOR EACH ROW EXECUTE FUNCTION public._br_restore_safety_guard();

-- ===== Contexte serveur =====
CREATE OR REPLACE FUNCTION public._br_rs_assert_server() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._br_is_verified_server() THEN
    RAISE EXCEPTION 'BRR-403: server context required' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_actor_ok(p_actor uuid, p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_actor IS NOT NULL AND p_tenant IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = p_actor AND p.tenant_id = p_tenant AND coalesce(p.is_active, true)
      AND (p.role = 'super_admin' OR t.owner_user_id = p_actor));
$$;

-- Le contexte privilégié est une ligne privée liée au processus ET à la transaction courante.
CREATE OR REPLACE FUNCTION public._br_restore_bypass() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public._br_restore_context c
                 WHERE c.backend_pid = pg_backend_pid() AND c.xact_id = txid_current_if_assigned());
$$;

-- ===== Lien entreprise d'une table du registre =====
CREATE OR REPLACE FUNCTION public._br_rs_parent_link(p_table text,
  OUT o_link text, OUT o_tcol text, OUT o_parent text, OUT o_fk text, OUT o_pk text, OUT o_ptcol text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_rel regclass; v_n integer;
BEGIN
  SELECT r.tenant_link, r.tenant_id_column, r.parent_table INTO o_link, o_tcol, o_parent
  FROM public._br_table_registry r
  WHERE r.schema_name = 'public' AND r.table_name = p_table AND r.tenant_link IN ('direct','indirect');
  IF o_link IS NULL THEN
    RAISE EXCEPTION 'BRR-071: % is not a registered tenant table', p_table USING ERRCODE = '55000';
  END IF;
  v_rel := to_regclass(format('public.%I', p_table));
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'BRR-071: registered table % is missing', p_table USING ERRCODE = '55000';
  END IF;
  IF o_link = 'direct' THEN
    IF o_tcol IS NULL THEN
      RAISE EXCEPTION 'BRR-071: tenant column missing for %', p_table USING ERRCODE = '55000';
    END IF;
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c
  WHERE c.conrelid = v_rel AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
    AND c.confrelid = to_regclass(format('public.%I', o_parent));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BRR-071: cannot resolve parent link for %', p_table USING ERRCODE = '55000';
  END IF;
  SELECT a.attname::text, pa.attname::text INTO o_fk, o_pk
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
  WHERE c.conrelid = v_rel AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
    AND c.confrelid = to_regclass(format('public.%I', o_parent));
  SELECT r2.tenant_id_column INTO o_ptcol FROM public._br_table_registry r2
  WHERE r2.schema_name = 'public' AND r2.table_name = o_parent AND r2.tenant_link = 'direct';
  IF o_ptcol IS NULL THEN
    RAISE EXCEPTION 'BRR-071: parent % is not a direct tenant table', o_parent USING ERRCODE = '55000';
  END IF;
END $$;

-- Prédicat « ligne de l'entreprise $1 » pour une table du registre.
CREATE OR REPLACE FUNCTION public._br_rs_tenant_pred(p_table text, p_alias text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE l record;
BEGIN
  SELECT * INTO l FROM public._br_rs_parent_link(p_table);
  IF l.o_link = 'direct' THEN
    RETURN format('%I.%I = $1', p_alias, l.o_tcol);
  END IF;
  RETURN format('%I.%I IN (SELECT pp.%I FROM public.%I pp WHERE pp.%I = $1)',
    p_alias, l.o_fk, l.o_pk, l.o_parent, l.o_ptcol);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_pk_cols(p_rel regclass) RETURNS text[]
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT array_agg(a.attname::text ORDER BY k.n)
  FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indrelid = p_rel AND i.indisprimary;
$$;

-- Empreinte de structure (formule du lot B) sur les tables du registre.
CREATE OR REPLACE FUNCTION public._br_rs_schema_fp() RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT md5(string_agg(c.relname::text || '.' || a.attname::text || ':' || format_type(a.atttypid, a.atttypmod), ','
             ORDER BY c.relname::text, a.attnum))
  FROM public._br_table_registry r
  JOIN pg_class c ON c.relname = r.table_name
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect') AND c.relkind = 'r';
$$;

-- ===== Porte d'écriture par entreprise =====
CREATE OR REPLACE FUNCTION public._br_gate_check(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_exp timestamptz; v_changed timestamptz;
BEGIN
  IF p_tenant IS NULL THEN RETURN; END IF;
  -- Verrou partagé : l'échange/la réinitialisation prend le verrou exclusif et attend les écritures en cours.
  PERFORM pg_advisory_xact_lock_shared(1112689732, hashtext(p_tenant::text));
  SELECT m.expires_at INTO v_exp FROM public._br_tenant_maintenance m WHERE m.tenant_id = p_tenant;
  IF v_exp IS NOT NULL AND v_exp > clock_timestamp() THEN
    RAISE EXCEPTION 'BR-503: maintenance en cours pour cette entreprise, réessayez plus tard'
      USING ERRCODE = '55006', HINT = 'BR-503';
  END IF;
  SELECT e.changed_at INTO v_changed FROM public._br_tenant_epoch e WHERE e.tenant_id = p_tenant;
  IF v_changed IS NOT NULL AND v_changed > transaction_timestamp() THEN
    RAISE EXCEPTION 'BR-504: les données ont été remplacées pendant cette transaction, recommencez'
      USING ERRCODE = '40001', HINT = 'BR-504';
  END IF;
END $$;

-- Arguments : (colonne_entreprise) pour une table directe ; (parent, fk, pk_parent, colonne_entreprise_parent) sinon.
CREATE OR REPLACE FUNCTION public._br_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_new uuid; v_old uuid;
BEGIN
  IF public._br_restore_bypass() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_NARGS = 1 THEN
    IF TG_OP <> 'INSERT' THEN v_old := (to_jsonb(OLD) ->> TG_ARGV[0])::uuid; END IF;
    IF TG_OP <> 'DELETE' THEN v_new := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid; END IF;
  ELSIF TG_NARGS = 4 THEN
    IF TG_OP <> 'INSERT' THEN
      EXECUTE format('SELECT p.%I FROM public.%I p WHERE p.%I::text = $1', TG_ARGV[3], TG_ARGV[0], TG_ARGV[2])
        INTO v_old USING to_jsonb(OLD) ->> TG_ARGV[1];
    END IF;
    IF TG_OP <> 'DELETE' THEN
      EXECUTE format('SELECT p.%I FROM public.%I p WHERE p.%I::text = $1', TG_ARGV[3], TG_ARGV[0], TG_ARGV[2])
        INTO v_new USING to_jsonb(NEW) ->> TG_ARGV[1];
    END IF;
  ELSE
    RAISE EXCEPTION 'BRR-072: invalid gate arguments on %', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  PERFORM public._br_gate_check(v_old);
  IF v_new IS DISTINCT FROM v_old THEN PERFORM public._br_gate_check(v_new); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- ===== Installation des crochets (NON exécutée par cette migration) =====
CREATE OR REPLACE FUNCTION public._br_lotd_install_hooks() RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r record; t record; l record;
  v_args text; v_new text; v_gates integer := 0; v_wrapped integer := 0;
BEGIN
  PERFORM public._br_rs_assert_server();
  FOR r IN SELECT reg.table_name FROM public._br_table_registry reg
           WHERE reg.schema_name = 'public' AND reg.tenant_link IN ('direct','indirect') ORDER BY reg.table_name
  LOOP
    SELECT * INTO l FROM public._br_rs_parent_link(r.table_name);
    IF l.o_link = 'direct' THEN
      v_args := quote_literal(l.o_tcol);
    ELSE
      v_args := format('%L, %L, %L, %L', l.o_parent, l.o_fk, l.o_pk, l.o_ptcol);
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS _br_gate ON public.%I', r.table_name);
    EXECUTE format('CREATE TRIGGER _br_gate BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public._br_gate(%s)', r.table_name, v_args);
    v_gates := v_gates + 1;
  END LOOP;

  FOR t IN
    SELECT tg.tgname::text AS tgname, c.relname::text AS relname, tg.tgqual IS NOT NULL AS has_when,
           tg.tgenabled::text AS enabled, pg_get_triggerdef(tg.oid) AS def
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT tg.tgisinternal AND tg.tgname <> '_br_gate'
      AND (c.relname IN (SELECT reg.table_name FROM public._br_table_registry reg
                         WHERE reg.schema_name = 'public' AND reg.tenant_link IN ('direct','indirect'))
           OR c.relname = 'profiles')
  LOOP
    IF position('_br_restore_bypass' in t.def) > 0 THEN CONTINUE; END IF;
    IF t.has_when THEN
      v_new := regexp_replace(t.def, ' WHEN \(', ' WHEN (NOT public._br_restore_bypass() AND ');
    ELSE
      v_new := regexp_replace(t.def, ' FOR EACH (ROW|STATEMENT) EXECUTE ',
                              ' FOR EACH \1 WHEN (NOT public._br_restore_bypass()) EXECUTE ');
    END IF;
    IF v_new = t.def THEN
      RAISE EXCEPTION 'BRR-072: cannot wrap trigger % on %', t.tgname, t.relname USING ERRCODE = '55000';
    END IF;
    EXECUTE format('DROP TRIGGER %I ON public.%I', t.tgname, t.relname);
    EXECUTE v_new;
    IF t.enabled = 'D' THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', t.relname, t.tgname);
    ELSIF t.enabled = 'R' THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE REPLICA TRIGGER %I', t.relname, t.tgname);
    ELSIF t.enabled = 'A' THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', t.relname, t.tgname);
    END IF;
    v_wrapped := v_wrapped + 1;
  END LOOP;
  RETURN jsonb_build_object('gates', v_gates, 'wrapped', v_wrapped);
END $$;

CREATE OR REPLACE FUNCTION public._br_lotd_hooks_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH reg AS (
    SELECT r.table_name FROM public._br_table_registry r
    WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect')
  ), missing AS (
    SELECT reg.table_name FROM reg WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger tg
      WHERE tg.tgrelid = to_regclass(format('public.%I', reg.table_name))
        AND tg.tgname = '_br_gate' AND tg.tgenabled <> 'D')
  ), unwrapped AS (
    SELECT c.relname::text || '.' || tg.tgname::text AS name
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE NOT tg.tgisinternal AND tg.tgname <> '_br_gate' AND tg.tgenabled <> 'D'
      AND (c.relname IN (SELECT reg.table_name FROM reg) OR c.relname = 'profiles')
      AND position('_br_restore_bypass' in pg_get_triggerdef(tg.oid)) = 0
  )
  SELECT jsonb_build_object(
    'missing_gate', coalesce((SELECT jsonb_agg(m.table_name ORDER BY m.table_name) FROM missing m), '[]'::jsonb),
    'unwrapped', coalesce((SELECT jsonb_agg(u.name ORDER BY u.name) FROM unwrapped u), '[]'::jsonb),
    'ok', NOT EXISTS (SELECT 1 FROM missing) AND NOT EXISTS (SELECT 1 FROM unwrapped));
$$;
