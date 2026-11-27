-- V2 archives can be retired only after a newer, byte-verified V3 copy on LWS.
CREATE OR REPLACE FUNCTION public._br_v3_has_remote_replacement(p_tenant_id uuid, p_not_before timestamptz)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public._br_v3_archives a
    JOIN public._br_capture_generations g ON g.id = a.generation_id AND g.tenant_id = a.tenant_id
    JOIN public._br_v3_offsite_transfers t ON t.archive_id = a.id AND t.tenant_id = a.tenant_id
    WHERE a.tenant_id = p_tenant_id AND a.status = 'verified' AND a.blocks_verified = a.block_count
      AND g.captured_at >= p_not_before AND t.status = 'confirmed'
      AND t.blocks_confirmed = a.block_count AND t.manifest_confirmed AND t.confirmed_at IS NOT NULL
  )
$$;

CREATE OR REPLACE FUNCTION public._br_v2_retirement_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH candidates AS (
    SELECT tenant_id, max(created_at) AS last_archive FROM public.tenant_backups WHERE format_version = 2 GROUP BY tenant_id
    UNION ALL
    SELECT tenant_id, max(queued_at) FROM public._br_offsite_transfers
    WHERE NOT EXISTS (
      SELECT 1 FROM public.tenant_backups b WHERE b.id = source_backup_id
    ) GROUP BY tenant_id
  ), companies AS (
    SELECT tenant_id, max(last_archive) AS last_archive FROM candidates GROUP BY tenant_id
  )
  SELECT jsonb_build_object(
    'local_archives', (SELECT count(*) FROM public.tenant_backups WHERE format_version = 2),
    'remote_entries', (SELECT count(*) FROM public._br_offsite_transfers),
    'unprotected_companies', (SELECT count(*) FROM companies
      WHERE NOT public._br_v3_has_remote_replacement(tenant_id, last_archive)),
    'v2_active', EXISTS (SELECT 1 FROM cron.job WHERE jobname IN ('backup_scheduler_auto','offsite_transfer_worker') AND active),
    'v3_active', (SELECT count(*) = 3 FROM cron.job WHERE jobname IN ('br_capture_executor','br_v3_backup_daily','br_v3_backup_dispatch') AND active)
  )
$$;

CREATE OR REPLACE FUNCTION public._br_protect_latest_verified_backup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  latest_backup uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM 'verified' OR NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
    RETURN OLD;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('br_backup_delete:' || OLD.tenant_id::text, 0));
  SELECT b.id INTO latest_backup FROM public.tenant_backups b
  WHERE b.tenant_id = OLD.tenant_id AND b.status = 'verified'
  ORDER BY b.created_at DESC, b.id DESC LIMIT 1;
  IF latest_backup = OLD.id AND NOT (
    OLD.format_version = 2 AND public._br_is_verified_server()
    AND current_setting('waarwi.backup_v2_retirement', true) IS NOT DISTINCT FROM 'confirmed'
    AND public._br_v3_has_remote_replacement(OLD.tenant_id, OLD.created_at)
  ) THEN
    RAISE EXCEPTION 'La dernière sauvegarde vérifiée ne peut pas être supprimée.'
      USING ERRCODE = '42501', HINT = 'BR-022';
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public._br_v2_retire_database(p_expected_backups integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  state jsonb;
  removed_archives integer;
  removed_runs integer;
  removed_items integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('waarwi.backup.v2.retirement', 0));
  state := public._br_v2_retirement_status();
  IF (state->>'local_archives')::integer IS DISTINCT FROM p_expected_backups
     OR (state->>'remote_entries')::integer <> 0 OR (state->>'unprotected_companies')::integer <> 0
     OR (state->>'v2_active')::boolean OR NOT (state->>'v3_active')::boolean
     OR EXISTS (SELECT 1 FROM public._br_schedule_runs WHERE status = 'running')
     OR EXISTS (SELECT 1 FROM public._br_schedule_run_items WHERE status IN ('pending','running')) THEN
    RAISE EXCEPTION 'BRV-061: la suppression V2 est bloquée par la vérification de la bascule';
  END IF;

  PERFORM set_config('waarwi.backup_v2_retirement', 'confirmed', true);
  DELETE FROM public.tenant_backups WHERE format_version = 2;
  GET DIAGNOSTICS removed_archives = ROW_COUNT;
  SELECT count(*) INTO removed_items FROM public._br_schedule_run_items;
  DELETE FROM public._br_schedule_runs;
  GET DIAGNOSTICS removed_runs = ROW_COUNT;
  PERFORM set_config('waarwi.backup_v2_retirement', '', true);
  RETURN jsonb_build_object('archives', removed_archives, 'runs', removed_runs, 'items', removed_items);
END;
$$;

REVOKE ALL ON FUNCTION public._br_v3_has_remote_replacement(uuid,timestamptz), public._br_v2_retirement_status(),
  public._br_v2_retire_database(integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._br_v2_retirement_status() TO service_role;

-- Legacy clients can no longer create a V2 archive, rehydrate it or reinstall its cron.
REVOKE EXECUTE ON FUNCTION public.br_create_backup(text,text), public._br_create_backup_for_tenant(uuid,text,text),
  public._br_create_backup_for_tenant_extended(uuid,text,text), public._br_export_offsite_document_text(uuid),
  public._br_export_offsite_document_raw(uuid), public._br_rehydrate_offsite_backup(uuid,text),
  public._br_rehydrate_offsite_document_raw(text), public._br_manage_backup_cron(text,text,text,text,text),
  public._br_manage_offsite_cron(text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
