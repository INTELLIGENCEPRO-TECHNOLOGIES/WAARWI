/*
# Offsite backup storage schema + FK fix for retention

1. New Tables: _br_offsite_config, _br_offsite_transfers
2. FK fix: _br_schedule_run_items.backup_id -> ON DELETE SET NULL
3. Registry entries + pg_cron helper for offsite worker
*/

CREATE TABLE IF NOT EXISTS _br_offsite_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  webdav_base_url text NOT NULL DEFAULT 'https://rs1.cloudlws.com/files',
  root_folder text NOT NULL DEFAULT '/Waarwi',
  auto_transfer boolean NOT NULL DEFAULT true,
  encryption_key_id text,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);
ALTER TABLE _br_offsite_config ENABLE ROW LEVEL SECURITY;
INSERT INTO _br_offsite_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS _br_offsite_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backup_id uuid NOT NULL REFERENCES tenant_backups(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  remote_path text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'uploading', 'verified', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  size_bytes bigint,
  remote_checksum text,
  local_checksum text,
  error_message text,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  verified_at timestamptz,
  created_by uuid REFERENCES auth.users(id)
);
ALTER TABLE _br_offsite_transfers ENABLE ROW LEVEL SECURITY;
CREATE UNIQUE INDEX IF NOT EXISTS uq_offsite_transfer_backup ON _br_offsite_transfers (backup_id);
CREATE INDEX IF NOT EXISTS idx_offsite_transfers_status ON _br_offsite_transfers (status) WHERE status IN ('queued', 'uploading', 'failed');
CREATE INDEX IF NOT EXISTS idx_offsite_transfers_tenant ON _br_offsite_transfers (tenant_id);

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = '_br_schedule_run_items_backup_id_fkey'
    AND table_name = '_br_schedule_run_items'
  ) THEN
    ALTER TABLE _br_schedule_run_items DROP CONSTRAINT _br_schedule_run_items_backup_id_fkey;
    ALTER TABLE _br_schedule_run_items ADD CONSTRAINT _br_schedule_run_items_backup_id_fkey
      FOREIGN KEY (backup_id) REFERENCES tenant_backups(id) ON DELETE SET NULL;
  END IF;
END $$;

INSERT INTO _br_table_registry (schema_name, table_name, tenant_link, category, exclusion_reason)
VALUES
  ('public', '_br_offsite_config', 'excluded', 'backup_system', 'offsite config singleton'),
  ('public', '_br_offsite_transfers', 'excluded', 'backup_system', 'offsite transfer log')
ON CONFLICT (schema_name, table_name) DO NOTHING;

CREATE OR REPLACE FUNCTION _br_manage_offsite_cron(
  p_action text, p_function_url text DEFAULT NULL, p_cron_secret text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, cron, net, extensions
AS $$
DECLARE
  v_job_name text := 'offsite_transfer_worker';
  v_existing_jobid bigint;
BEGIN
  IF p_action = 'upsert' THEN
    IF p_function_url IS NULL OR p_cron_secret IS NULL THEN
      RAISE EXCEPTION 'function_url and cron_secret required';
    END IF;
    SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname = v_job_name;
    IF v_existing_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_job_name); END IF;
    PERFORM cron.schedule(v_job_name, '*/10 * * * *',
      format('SELECT net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb)',
        p_function_url,
        json_build_object('Content-Type','application/json','X-Cron-Secret',p_cron_secret)::text,
        json_build_object('action','process_queue')::text));
    RETURN jsonb_build_object('success', true, 'job_name', v_job_name);
  ELSIF p_action = 'remove' THEN
    SELECT jobid INTO v_existing_jobid FROM cron.job WHERE jobname = v_job_name;
    IF v_existing_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_job_name); END IF;
    RETURN jsonb_build_object('success', true, 'removed', v_existing_jobid IS NOT NULL);
  ELSIF p_action = 'status' THEN
    RETURN COALESCE(
      (SELECT jsonb_build_object('exists',true,'jobid',j.jobid,'schedule',j.schedule,'active',j.active)
       FROM cron.job j WHERE j.jobname = v_job_name),
      jsonb_build_object('exists', false));
  ELSE RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;
END;$$;

REVOKE ALL ON FUNCTION _br_manage_offsite_cron(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _br_manage_offsite_cron(text,text,text) FROM anon;
REVOKE ALL ON FUNCTION _br_manage_offsite_cron(text,text,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION _br_manage_offsite_cron(text,text,text) TO service_role;
