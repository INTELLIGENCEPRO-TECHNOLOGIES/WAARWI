-- STATUS: PREPARED, NOT EXECUTED.
-- Run ONLY in an isolated Supabase project (branch or throwaway copy) that has
-- migrations up to 20261110235000 and synthetic tenants. NEVER in production.
-- Goal: measure the real pg_cron behaviour that cannot be measured locally
-- (pg_cron is not available in the local PostgreSQL used by the tests).

-- Step 1: effective duration limit of a pg_cron session (expected: 120 s global
-- statement_timeout unless SET LOCAL is used; this is an inference, to be confirmed).
SELECT cron.schedule('br_probe_sleep_150', '* * * * *', $$SELECT pg_sleep(150)$$);
SELECT cron.schedule('br_probe_sleep_150_local', '* * * * *',
  $$SET LOCAL statement_timeout = '200s'; SELECT pg_sleep(150)$$);
-- wait ~4 minutes, then:
SELECT j.jobname, d.status, d.return_message, d.end_time - d.start_time AS duration
FROM cron.job_run_details d JOIN cron.job j USING (jobid)
WHERE j.jobname LIKE 'br_probe_%' ORDER BY d.start_time DESC LIMIT 10;
SELECT cron.unschedule('br_probe_sleep_150');
SELECT cron.unschedule('br_probe_sleep_150_local');

-- Step 2: run the real executor through pg_cron on one synthetic tenant.
UPDATE public._br_capture_executor_config SET enabled = true;
SELECT public._br_v3_request_capture('<synthetic tenant uuid>'::uuid, 'cron-check-1');
SELECT public._br_capture_executor_schedule(true);
-- wait 2 minutes, then:
SELECT status::text, attempts, worker_id, error_code, error_class, capacity_failures, capture_generation_id
FROM public._br_backup_jobs ORDER BY created_at DESC LIMIT 5;
SELECT d.status, d.return_message, d.end_time - d.start_time AS duration
FROM cron.job_run_details d JOIN cron.job j USING (jobid)
WHERE j.jobname = 'br_capture_executor' ORDER BY d.start_time DESC LIMIT 5;

-- Step 3: overrun through pg_cron (capacity classification, no infinite retry).
UPDATE public._br_capture_executor_config SET capture_timeout_seconds = 1;
-- request a capture on the largest synthetic tenant, wait 3 minutes, re-run the
-- two queries of step 2: expected capacity_failures 1 then failed / BRJ-043.

-- Step 4: always disable afterwards.
SELECT public._br_capture_executor_schedule(false);
UPDATE public._br_capture_executor_config SET enabled = false, capture_timeout_seconds = 900;
SELECT count(*) AS must_be_zero FROM cron.job WHERE jobname LIKE 'br_%';
