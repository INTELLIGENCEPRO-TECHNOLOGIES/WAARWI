-- A gateway timeout can happen after PostgreSQL has started creating an archive.
-- Link only a verified archive whose tenant and capture start match this run item.
CREATE OR REPLACE FUNCTION public._br_reconcile_schedule_backup(p_run_id uuid, p_tenant_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  scheduled_run public._br_schedule_runs;
  item public._br_schedule_run_items;
  candidates uuid[];
  archive_id uuid;
  succeeded integer;
  failed integer;
  skipped integer;
BEGIN
  SELECT r.* INTO scheduled_run FROM public._br_schedule_runs r WHERE r.id = p_run_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT i.* INTO item FROM public._br_schedule_run_items i
  WHERE i.run_id = p_run_id AND i.tenant_id = p_tenant_id
    AND i.status IN ('running', 'failed', 'succeeded')
  FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF item.status = 'succeeded' THEN RETURN item.backup_id; END IF;
  IF item.started_at IS NULL
    OR (item.status = 'failed' AND coalesce(item.error_message, '') NOT ILIKE '%upstream request timeout%')
  THEN RETURN NULL; END IF;

  SELECT array_agg(found.id) INTO candidates
  FROM (
    SELECT b.id
    FROM public.tenant_backups b
    WHERE b.tenant_id = p_tenant_id AND b.kind = 'auto' AND b.is_auto AND b.status = 'verified'
      AND b.label = 'Sauvegarde planifiée'
      AND b.created_at >= item.started_at
      AND b.created_at <= coalesce(item.finished_at, clock_timestamp())
      AND NOT EXISTS (
        SELECT 1 FROM public._br_schedule_run_items other
        WHERE other.backup_id = b.id AND other.id <> item.id
      )
    ORDER BY b.created_at, b.id
    LIMIT 2
  ) found;
  IF coalesce(cardinality(candidates), 0) <> 1 THEN RETURN NULL; END IF;
  archive_id := candidates[1];

  UPDATE public._br_schedule_run_items i
  SET status = 'succeeded', backup_id = archive_id, finished_at = clock_timestamp(),
      size_bytes = b.size_bytes,
      row_count = (SELECT sum(count.value::integer) FROM jsonb_each_text(b.row_counts) count),
      error_message = NULL
  FROM public.tenant_backups b WHERE i.id = item.id AND b.id = archive_id;

  IF scheduled_run.status <> 'running' THEN
    SELECT count(*) FILTER (WHERE i.status = 'succeeded'),
           count(*) FILTER (WHERE i.status = 'failed'),
           count(*) FILTER (WHERE i.status = 'skipped')
    INTO succeeded, failed, skipped
    FROM public._br_schedule_run_items i WHERE i.run_id = p_run_id;
    UPDATE public._br_schedule_runs r
    SET tenants_succeeded = succeeded, tenants_failed = failed, tenants_skipped = skipped,
        status = CASE WHEN failed = 0 THEN 'completed'
                      WHEN succeeded > 0 THEN 'partial_failure' ELSE 'failed' END,
        error_summary = (
          SELECT jsonb_agg(entry)
          FROM jsonb_array_elements(coalesce(r.error_summary,'[]'::jsonb)) entry
          WHERE NOT ((entry->>'tenant_id') IS NOT DISTINCT FROM p_tenant_id::text
                     AND coalesce(entry->>'error','') ILIKE '%upstream request timeout%')
        )
    WHERE r.id = p_run_id;
  END IF;
  RETURN archive_id;
END;
$$;

REVOKE ALL ON FUNCTION public._br_reconcile_schedule_backup(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._br_reconcile_schedule_backup(uuid, uuid) TO service_role;
