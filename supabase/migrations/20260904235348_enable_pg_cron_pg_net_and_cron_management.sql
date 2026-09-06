/*
# Enable pg_cron + pg_net and create cron job management helpers

1. Changes
   - Enables the `pg_cron` and `pg_net` extensions.
   - Creates a SECURITY DEFINER function `_br_manage_backup_cron` that:
     - 'upsert': creates or updates the cron job for backup-scheduler
     - 'remove': removes the cron job
     - 'status': returns the current cron job info
   - Grants EXECUTE only to service_role (edge function uses service_role key).
   - Adds a `cron_job_name` column to `_br_schedule_policy` for tracking.

2. Security
   - Function is SECURITY DEFINER with fixed search_path to prevent path injection.
   - Only service_role can execute it.
   - pg_cron jobs run as postgres, calling the edge function via pg_net.
*/

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = '_br_schedule_policy' AND column_name = 'cron_job_name'
  ) THEN
    ALTER TABLE _br_schedule_policy ADD COLUMN cron_job_name text;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION _br_manage_backup_cron(
  p_action text,
  p_cron_expression text DEFAULT NULL,
  p_timezone text DEFAULT 'Africa/Dakar',
  p_function_url text DEFAULT NULL,
  p_cron_secret text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, net, extensions
AS $$
DECLARE
  v_job_name text := 'backup_scheduler_auto';
  v_existing_jobid bigint;
  v_result jsonb;
BEGIN
  IF p_action = 'upsert' THEN
    IF p_cron_expression IS NULL OR p_function_url IS NULL OR p_cron_secret IS NULL THEN
      RAISE EXCEPTION 'cron_expression, function_url, and cron_secret are required for upsert';
    END IF;

    SELECT jobid INTO v_existing_jobid
    FROM cron.job
    WHERE jobname = v_job_name;

    IF v_existing_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_name);
    END IF;

    PERFORM cron.schedule(
      v_job_name,
      p_cron_expression,
      format(
        'SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
        p_function_url,
        json_build_object('Content-Type', 'application/json', 'X-Cron-Secret', p_cron_secret)::text,
        json_build_object('action', 'run_scheduled')::text
      )
    );

    UPDATE _br_schedule_policy SET cron_job_name = v_job_name WHERE id = 1;

    RETURN jsonb_build_object('success', true, 'job_name', v_job_name);

  ELSIF p_action = 'remove' THEN
    SELECT jobid INTO v_existing_jobid
    FROM cron.job
    WHERE jobname = v_job_name;

    IF v_existing_jobid IS NOT NULL THEN
      PERFORM cron.unschedule(v_job_name);
    END IF;

    UPDATE _br_schedule_policy SET cron_job_name = NULL WHERE id = 1;

    RETURN jsonb_build_object('success', true, 'removed', v_existing_jobid IS NOT NULL);

  ELSIF p_action = 'status' THEN
    SELECT jsonb_build_object(
      'exists', true,
      'jobid', j.jobid,
      'schedule', j.schedule,
      'active', j.active,
      'jobname', j.jobname
    ) INTO v_result
    FROM cron.job j
    WHERE j.jobname = v_job_name;

    IF v_result IS NULL THEN
      v_result := jsonb_build_object('exists', false);
    END IF;

    RETURN v_result;
  ELSE
    RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION _br_manage_backup_cron(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _br_manage_backup_cron(text, text, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION _br_manage_backup_cron(text, text, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION _br_manage_backup_cron(text, text, text, text, text) TO service_role;
