-- Install the tested write barriers and start the V3 executor without requesting a recovery.
CREATE OR REPLACE FUNCTION public._br_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  old_tenant uuid;
  new_tenant uuid;
  restore_tenant uuid;
BEGIN
  IF TG_NARGS = 1 THEN
    IF TG_OP <> 'INSERT' THEN old_tenant := (to_jsonb(OLD)->>TG_ARGV[0])::uuid; END IF;
    IF TG_OP <> 'DELETE' THEN new_tenant := (to_jsonb(NEW)->>TG_ARGV[0])::uuid; END IF;
  ELSIF TG_NARGS = 4 THEN
    IF TG_OP <> 'INSERT' THEN
      EXECUTE format('SELECT p.%I FROM public.%I p WHERE p.%I::text = $1', TG_ARGV[3], TG_ARGV[0], TG_ARGV[2])
      INTO old_tenant USING to_jsonb(OLD)->>TG_ARGV[1];
    END IF;
    IF TG_OP <> 'DELETE' THEN
      EXECUTE format('SELECT p.%I FROM public.%I p WHERE p.%I::text = $1', TG_ARGV[3], TG_ARGV[0], TG_ARGV[2])
      INTO new_tenant USING to_jsonb(NEW)->>TG_ARGV[1];
    END IF;
  ELSE
    RAISE EXCEPTION 'BRR-072: invalid write gate arguments on %', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;

  SELECT c.tenant_id INTO restore_tenant FROM public._br_restore_context c
  WHERE c.backend_pid = pg_backend_pid() AND c.xact_id = txid_current_if_assigned();
  IF restore_tenant IS NOT NULL THEN
    -- An indirect row belongs to its parent. During a cascade the deleted parent
    -- can be absent from the snapshot; its own BEFORE trigger already checked it.
    IF (TG_OP <> 'INSERT' AND (TG_NARGS = 1 OR old_tenant IS NOT NULL) AND old_tenant IS DISTINCT FROM restore_tenant)
       OR (TG_OP <> 'DELETE' AND (TG_NARGS = 1 OR new_tenant IS NOT NULL) AND new_tenant IS DISTINCT FROM restore_tenant) THEN
      RAISE EXCEPTION 'BRR-076: recovery would modify a row outside this company' USING ERRCODE = '42501';
    END IF;
  ELSE
    PERFORM public._br_gate_check(old_tenant);
    IF new_tenant IS DISTINCT FROM old_tenant THEN PERFORM public._br_gate_check(new_tenant); END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public._br_lotd_hooks_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH protected AS (
    SELECT r.table_name FROM public._br_table_registry r
    WHERE r.schema_name = 'public' AND (r.tenant_link IN ('direct','indirect') OR r.table_name = 'document_edit_leases')
    UNION SELECT 'profiles'
  ), missing AS (
    SELECT p.table_name FROM protected p
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger tg
      WHERE tg.tgrelid = to_regclass(format('public.%I', p.table_name))
        AND tg.tgname = '_br_gate' AND tg.tgenabled IN ('O','A')
        AND tg.tgfoid = 'public._br_gate()'::regprocedure
    )
  ), unwrapped AS (
    SELECT c.relname::text || '.' || tg.tgname::text AS name
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN protected p ON p.table_name = c.relname
    WHERE c.relnamespace = 'public'::regnamespace AND NOT tg.tgisinternal
      AND tg.tgname <> '_br_gate' AND tg.tgenabled IN ('O','A')
      AND position('_br_restore_bypass' IN pg_get_triggerdef(tg.oid)) = 0
  ), unprotected_cascades AS (
    SELECT child.relname || '.' || fk.conname AS name
    FROM pg_constraint fk
    JOIN pg_class parent ON parent.oid = fk.confrelid AND parent.relnamespace = 'public'::regnamespace
    JOIN protected p ON p.table_name = parent.relname
    JOIN pg_class child ON child.oid = fk.conrelid
    WHERE fk.contype = 'f' AND fk.confdeltype IN ('c','n','d')
      AND NOT EXISTS (SELECT FROM protected x WHERE x.table_name = child.relname AND child.relnamespace = 'public'::regnamespace)
      AND EXISTS (SELECT FROM public._br_table_registry r WHERE r.schema_name = 'public'
        AND r.table_name = parent.relname AND r.tenant_link IN ('direct','indirect'))
  )
  SELECT jsonb_build_object(
    'missing_gate', coalesce((SELECT jsonb_agg(table_name ORDER BY table_name) FROM missing), '[]'::jsonb),
    'unwrapped', coalesce((SELECT jsonb_agg(name ORDER BY name) FROM unwrapped), '[]'::jsonb),
    'unprotected_cascades', coalesce((SELECT jsonb_agg(name ORDER BY name) FROM unprotected_cascades), '[]'::jsonb),
    'ok', NOT EXISTS (SELECT FROM missing) AND NOT EXISTS (SELECT FROM unwrapped) AND NOT EXISTS (SELECT FROM unprotected_cascades)
  );
$$;

-- This authorization was already scoped per company. Require an active platform
-- profile when editing it, including through an existing authenticated session.
ALTER POLICY platform_admin_manage_activation ON public._br_tenant_activation
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin' AND p.is_active IS TRUE))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'super_admin' AND p.is_active IS TRUE));

DO $activation$
DECLARE
  hooks jsonb;
BEGIN
  IF NOT public._br_is_verified_server() THEN
    RAISE EXCEPTION 'V3 activation requires the database administrator';
  END IF;
  IF EXISTS (SELECT FROM public._br_restore_jobs WHERE status IN ('preparing','prepared')) OR
     EXISTS (SELECT FROM public._br_tenant_maintenance) THEN
    RAISE EXCEPTION 'A recovery operation is already in progress';
  END IF;
  IF coalesce((public.br_check_schema_drift()->>'drift_detected')::boolean, true) THEN
    RAISE EXCEPTION 'BRR-073: schema drift detected';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'waarwi_backup_v3_runner') THEN
    RAISE EXCEPTION 'BRR-000: V3 recovery worker is not configured';
  END IF;
  -- A busy relation aborts this migration instead of queueing behind a store transaction.
  PERFORM set_config('lock_timeout', '250ms', true);
  PERFORM public._br_lotd_install_hooks();
  CREATE OR REPLACE TRIGGER _br_gate BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public._br_gate('tenant_id');

  hooks := public._br_lotd_hooks_status();
  IF NOT (hooks->>'ok')::boolean THEN
    RAISE EXCEPTION 'BRR-070: incomplete write protection: %', hooks;
  END IF;

  PERFORM cron.schedule('br_restore_executor', '* * * * *', 'CALL public._br_rs_executor_next()');
  UPDATE public._br_restore_config SET enabled = true, updated_at = now() WHERE id = 1;
  IF NOT public._br_rs_api_ready() THEN
    RAISE EXCEPTION 'BRR-000: V3 recovery services are not ready';
  END IF;
END;
$activation$;
