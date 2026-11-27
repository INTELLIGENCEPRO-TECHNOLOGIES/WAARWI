-- A hosted backup worker cannot run for 15 minutes. Expired runs must release
-- their per-tenant slots even when a worker exits before it finalizes the run.
CREATE OR REPLACE FUNCTION public._br_recover_expired_schedule_runs()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  resumed integer := 0;
  old_run public._br_schedule_runs;
  succeeded integer;
  skipped integer;
  failed integer;
  reason text := 'Le traitement de cette sauvegarde a été interrompu. Les tâches expirées ont été libérées.';
BEGIN
  FOR old_run IN
    SELECT r.*
    FROM public._br_schedule_runs r
    WHERE r.started_at < clock_timestamp() - interval '15 minutes'
      AND (r.status = 'running' OR EXISTS (
        SELECT 1 FROM public._br_schedule_run_items i
        WHERE i.run_id = r.id AND i.status IN ('pending', 'running')
      ))
    ORDER BY r.started_at, r.id
    FOR UPDATE OF r SKIP LOCKED
  LOOP
    UPDATE public._br_schedule_run_items
    SET status = 'failed', finished_at = clock_timestamp(), error_message = reason
    WHERE run_id = old_run.id AND status IN ('pending', 'running');

    SELECT count(*) FILTER (WHERE status = 'succeeded'),
           count(*) FILTER (WHERE status = 'skipped'),
           count(*) FILTER (WHERE status = 'failed')
      INTO succeeded, skipped, failed
    FROM public._br_schedule_run_items WHERE run_id = old_run.id;

    succeeded := greatest(succeeded, old_run.tenants_succeeded);
    skipped := greatest(skipped, old_run.tenants_skipped);
    failed := greatest(failed, old_run.tenants_total - succeeded - skipped);

    UPDATE public._br_schedule_runs
    SET finished_at = coalesce(finished_at, clock_timestamp()),
        status = CASE WHEN failed = 0 THEN 'completed'
                      WHEN succeeded > 0 THEN 'partial_failure'
                      ELSE 'failed' END,
        tenants_succeeded = succeeded,
        tenants_skipped = skipped,
        tenants_failed = failed,
        error_summary = coalesce(error_summary, '[]'::jsonb)
          || jsonb_build_array(jsonb_build_object('tenant_id', NULL, 'error', reason))
    WHERE id = old_run.id;

    resumed := resumed + 1;
  END LOOP;
  RETURN resumed;
END;
$$;

-- Keep the existing unique guard as the authority for concurrent runs.
-- One tenant already being backed up must not block all the other tenants.
CREATE OR REPLACE FUNCTION public._br_reserve_schedule_items(p_run_id uuid, p_tenant_ids uuid[])
RETURNS TABLE (tenant_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public._br_schedule_run_items AS item(run_id, tenant_id, status)
  SELECT p_run_id, candidate.tenant_id, 'pending'
  FROM (SELECT DISTINCT unnest(p_tenant_ids) AS tenant_id) candidate
  JOIN public._br_schedule_runs r ON r.id = p_run_id AND r.status = 'running'
  ORDER BY candidate.tenant_id
  ON CONFLICT (tenant_id) WHERE status IN ('pending', 'running') DO NOTHING
  RETURNING item.tenant_id;
$$;

-- Register the external transfer in the same transaction as the verified
-- scheduled archive, even if the scheduler stops before handling its reply.
CREATE OR REPLACE FUNCTION public._br_queue_verified_auto_backup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public._br_offsite_transfers(
    source_backup_id, backup_id, tenant_id, remote_path, status
  )
  SELECT NEW.id, NEW.id, NEW.tenant_id,
    rtrim(coalesce(nullif(config.root_folder, ''), '/Waarwi'), '/')
      || '/' || NEW.tenant_id::text || '/'
      || to_char(NEW.created_at AT TIME ZONE 'UTC', 'YYYY/MM/DD')
      || '_' || NEW.id::text || '.waarwi.enc',
    'queued'
  FROM public._br_offsite_config config
  WHERE config.id = 1 AND config.enabled AND config.auto_transfer
  ON CONFLICT (source_backup_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._br_recover_expired_schedule_runs(),
  public._br_reserve_schedule_items(uuid, uuid[]), public._br_queue_verified_auto_backup()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._br_recover_expired_schedule_runs(),
  public._br_reserve_schedule_items(uuid, uuid[]) TO service_role;

DROP TRIGGER IF EXISTS br_queue_verified_auto_backup ON public.tenant_backups;
CREATE TRIGGER br_queue_verified_auto_backup
AFTER INSERT OR UPDATE OF status ON public.tenant_backups
FOR EACH ROW WHEN (NEW.kind = 'auto' AND NEW.is_auto AND NEW.status = 'verified')
EXECUTE FUNCTION public._br_queue_verified_auto_backup();
