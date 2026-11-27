-- The database captures a consistent snapshot. Edge workers encrypt, verify
-- and copy the bounded blocks. The existing scheduling policy stays in use.
CREATE OR REPLACE FUNCTION public._br_v3_enqueue_daily()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  policy record;
BEGIN
  SELECT p.enabled, p.timezone INTO policy FROM public._br_schedule_policy p WHERE p.id = 1;
  IF NOT coalesce(policy.enabled, false) OR NOT EXISTS (
    SELECT 1 FROM public._br_capture_executor_config c WHERE c.enabled
  ) THEN
    RETURN jsonb_build_object('skipped', true);
  END IF;
  RETURN public._br_jobs_enqueue_period(
    'v3:daily:' || to_char(now() AT TIME ZONE policy.timezone, 'YYYY-MM-DD'),
    now(), 'auto', 'auto'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._br_v3_dispatch_backups()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  config record;
  runner jsonb;
  ready_archive uuid;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('waarwi.backup.v3.dispatch', 0)) THEN RETURN; END IF;
  PERFORM public._br_jobs_recover_expired(10, 300);
  SELECT c.enabled, c.offsite_enabled INTO config FROM public._br_v3_export_config c WHERE c.id = 1;
  IF NOT coalesce(config.enabled OR config.offsite_enabled, false) THEN RETURN; END IF;

  SELECT s.decrypted_secret::jsonb INTO runner
  FROM vault.decrypted_secrets s WHERE s.name = 'waarwi_backup_v3_runner';
  IF runner IS NULL OR coalesce(runner->>'url', '') = ''
     OR coalesce(runner->'headers'->>'X-Cron-Secret', '') = '' THEN
    RAISE EXCEPTION 'BRV-045: configuration de planification V3 manquante';
  END IF;

  IF config.enabled AND EXISTS (
    SELECT 1 FROM public._br_backup_jobs j
    WHERE j.status IN ('capture_ready','exporting') AND NOT EXISTS (
      SELECT 1 FROM public._br_v3_archives a WHERE a.job_id = j.id AND a.export_lease_expires_at > now()
    )
  ) THEN
    PERFORM net.http_post(
      url := runner->>'url', headers := runner->'headers',
      body := '{"action":"run_export"}'::jsonb, timeout_milliseconds := 75000
    );
  END IF;

  IF NOT config.offsite_enabled THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public._br_offsite_config c WHERE c.id = 1 AND c.auto_transfer) THEN
    FOR ready_archive IN
      SELECT a.id FROM public._br_v3_archives a
      JOIN public._br_backup_jobs j ON j.id = a.job_id
      WHERE a.status = 'verified' AND j.period_key NOT LIKE 'manual_test:%'
        AND NOT EXISTS (SELECT 1 FROM public._br_v3_offsite_transfers t WHERE t.archive_id = a.id)
      ORDER BY a.verified_at, a.id LIMIT 8
    LOOP
      PERFORM public._br_v3_offsite_request(ready_archive);
    END LOOP;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public._br_v3_offsite_transfers t
    WHERE t.status IN ('pending','in_progress')
      AND (t.lease_expires_at IS NULL OR t.lease_expires_at <= now())
  ) THEN
    PERFORM net.http_post(
      url := runner->>'url', headers := runner->'headers',
      body := '{"action":"run_offsite"}'::jsonb, timeout_milliseconds := 75000
    );
  END IF;
END;
$$;

-- Apply settings using pg_cron rather than calling a V2 Edge endpoint.
CREATE OR REPLACE FUNCTION public._br_v3_schedule_daily()
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  policy record;
BEGIN
  SELECT p.enabled, p.cron_expression INTO policy FROM public._br_schedule_policy p WHERE p.id = 1;
  IF NOT coalesce(policy.enabled, false) THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'br_v3_backup_daily') THEN
      PERFORM cron.unschedule('br_v3_backup_daily');
    END IF;
    RETURN false;
  END IF;
  PERFORM cron.schedule('br_v3_backup_daily', policy.cron_expression, 'SELECT public._br_v3_enqueue_daily()');
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public._br_v3_enqueue_daily(), public._br_v3_dispatch_backups(), public._br_v3_schedule_daily()
  FROM PUBLIC, anon, authenticated, service_role;
