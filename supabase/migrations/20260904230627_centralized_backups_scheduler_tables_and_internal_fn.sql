/*
# Centralized Backups: Internal function + scheduling tables

## Overview
Extracts the core backup creation logic into a service-role-only internal
function `_br_create_backup_for_tenant(uuid, text, text)` so the scheduler
edge function can create backups for any tenant without impersonating a user.
The existing `br_create_backup` becomes a thin wrapper that resolves the
caller's tenant_id via `auth.uid()` and delegates.

## New Tables

### `_br_schedule_policy`
Global scheduling policy (singleton row):
- `id` (int, PK, default 1, CHECK = 1) — enforces single row
- `enabled` (bool, default false) — master switch
- `cron_expression` (text) — e.g. '0 2 * * *'
- `timezone` (text) — e.g. 'Africa/Dakar'
- `retention_daily` (int) — number of daily backups to keep
- `retention_weekly` (int) — number of weekly backups to keep
- `retention_monthly` (int) — number of monthly backups to keep
- `max_concurrent` (int) — max tenants backed up simultaneously
- `updated_at`, `updated_by`

### `_br_tenant_schedule_override`
Per-tenant overrides (opt-out or custom frequency):
- `tenant_id` (uuid, PK, FK tenants)
- `suspended` (bool) — skip this tenant
- `custom_cron` (text, nullable) — override global cron
- `custom_retention_daily` (int, nullable)
- `notes` (text)
- `updated_at`, `updated_by`

### `_br_schedule_runs`
Execution history for each scheduler invocation:
- `id` (uuid, PK)
- `started_at`, `finished_at`
- `status` (text: running, completed, partial_failure, failed)
- `tenants_total`, `tenants_succeeded`, `tenants_failed`, `tenants_skipped`
- `error_summary` (jsonb)
- `triggered_by` (text: cron, manual)

### `_br_schedule_run_items`
Per-tenant result within a run:
- `id` (uuid, PK)
- `run_id` (uuid, FK _br_schedule_runs)
- `tenant_id` (uuid, FK tenants)
- `backup_id` (uuid, nullable, FK tenant_backups)
- `status` (text: pending, running, succeeded, failed, skipped)
- `started_at`, `finished_at`
- `error_message` (text)
- `retry_count` (int)
- `size_bytes` (bigint)
- `row_count` (int)

## Security
- `_br_create_backup_for_tenant` is SECURITY DEFINER, revoked from PUBLIC/anon/authenticated
- All scheduling tables have RLS enabled with no policies (service_role only access)
- The existing `br_create_backup` wrapper keeps its current behavior and grants

## Notes
- No data modifications
- Forward-only migration
- Scheduler is disabled by default (enabled = false)
*/

-- ===========================================================================
-- 1. Internal backup function accepting explicit tenant_id
-- ===========================================================================
CREATE OR REPLACE FUNCTION _br_create_backup_for_tenant(
  p_tenant_id uuid,
  p_label text DEFAULT 'auto',
  p_kind text DEFAULT 'auto'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_backup_id uuid;
  v_drift jsonb;
  v_payload jsonb := '{}'::jsonb;
  v_row_counts jsonb := '{}'::jsonb;
  v_checksums jsonb := '{}'::jsonb;
  v_manifest jsonb := '[]'::jsonb;
  v_global_parts text := '';
  v_rec record;
  v_table_data jsonb;
  v_count integer;
  v_checksum text;
  v_fingerprint text;
  v_table_exists boolean;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant_id provided';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'BR-001: Tenant % does not exist', p_tenant_id;
  END IF;

  v_drift := br_check_schema_drift();
  IF (v_drift->>'drift_detected')::boolean THEN
    RAISE EXCEPTION 'BR-002: Schema drift detected. Unregistered: %, Missing: %',
      v_drift->>'unregistered_tables', v_drift->>'missing_tables';
  END IF;

  INSERT INTO tenant_backups (tenant_id, created_by, label, kind, is_auto, format_version, status)
  VALUES (
    p_tenant_id, NULL, COALESCE(NULLIF(p_label, ''), 'Sauvegarde'),
    p_kind, (p_kind = 'auto'), 2, 'creating'::br_backup_status
  )
  RETURNING id INTO v_backup_id;

  SELECT md5(string_agg(table_name || ':' || restore_order::text, ',' ORDER BY table_name))
  INTO v_fingerprint
  FROM _br_table_registry
  WHERE tenant_link != 'excluded';

  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.tenant_link, r.tenant_id_column,
           r.parent_table, r.restore_order
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
    ORDER BY r.restore_order, r.table_name
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = v_rec.schema_name AND c.relname = v_rec.table_name AND c.relkind = 'r'
    ) INTO v_table_exists;

    IF NOT v_table_exists THEN
      CONTINUE;
    END IF;

    IF v_rec.tenant_link = 'direct' THEN
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(row_to_json(t.*)::jsonb), ''[]''::jsonb) FROM %I.%I t WHERE t.%I = $1',
        v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
      ) INTO v_table_data USING p_tenant_id;
    ELSIF v_rec.tenant_link = 'indirect' THEN
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(row_to_json(c.*)::jsonb), ''[]''::jsonb)
         FROM %I.%I c
         JOIN %I.%I p ON p.id = c.wholesaler_id
         WHERE p.tenant_id = $1',
        v_rec.schema_name, v_rec.table_name,
        v_rec.schema_name, v_rec.parent_table
      ) INTO v_table_data USING p_tenant_id;
    END IF;

    v_count := jsonb_array_length(coalesce(v_table_data, '[]'::jsonb));

    v_checksum := encode(
      extensions.digest(
        coalesce((SELECT string_agg(j::text, '' ORDER BY j::text)
          FROM jsonb_array_elements(coalesce(v_table_data, '[]'::jsonb)) AS j), ''),
        'sha256'
      ),
      'hex'
    );

    v_payload := v_payload || jsonb_build_object(v_rec.table_name, v_table_data);
    v_row_counts := v_row_counts || jsonb_build_object(v_rec.table_name, v_count);
    v_checksums := v_checksums || jsonb_build_object(v_rec.table_name, v_checksum);
    v_manifest := v_manifest || jsonb_build_array(jsonb_build_object(
      'table', v_rec.table_name,
      'order', v_rec.restore_order,
      'rows', v_count,
      'checksum', v_checksum
    ));
    v_global_parts := v_global_parts || v_checksum;
  END LOOP;

  UPDATE tenant_backups SET
    payload = v_payload,
    format_version = 2,
    schema_fingerprint = v_fingerprint,
    manifest = v_manifest,
    row_counts = v_row_counts,
    checksums = v_checksums,
    global_checksum = encode(extensions.digest(v_global_parts, 'sha256'), 'hex'),
    size_bytes = octet_length(v_payload::text),
    status = 'verified'::br_backup_status,
    verified_at = now()
  WHERE id = v_backup_id;

  RETURN jsonb_build_object(
    'success', true,
    'backup_id', v_backup_id,
    'format_version', 2,
    'table_count', (SELECT count(*) FROM jsonb_object_keys(v_row_counts) AS k),
    'total_rows', (SELECT coalesce(sum(v::bigint), 0) FROM jsonb_each_text(v_row_counts) AS x(k, v)),
    'row_counts', v_row_counts,
    'global_checksum', encode(extensions.digest(v_global_parts, 'sha256'), 'hex'),
    'size_bytes', octet_length(v_payload::text),
    'created_at', now()
  );

EXCEPTION WHEN others THEN
  IF v_backup_id IS NOT NULL THEN
    UPDATE tenant_backups SET
      status = 'failed'::br_backup_status,
      error_message = SQLERRM
    WHERE id = v_backup_id;
  END IF;
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION _br_create_backup_for_tenant(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _br_create_backup_for_tenant(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION _br_create_backup_for_tenant(uuid, text, text) FROM authenticated;

-- ===========================================================================
-- 2. Rewrite br_create_backup as wrapper (same signature, same behavior)
-- ===========================================================================
CREATE OR REPLACE FUNCTION br_create_backup(p_label text DEFAULT 'manual', p_kind text DEFAULT 'manual')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT p.tenant_id INTO v_tenant_id FROM profiles p WHERE p.id = auth.uid();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant context for current user';
  END IF;
  RETURN _br_create_backup_for_tenant(v_tenant_id, p_label, p_kind);
END;
$$;

REVOKE ALL ON FUNCTION br_create_backup(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION br_create_backup(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION br_create_backup(text, text) TO authenticated;

-- ===========================================================================
-- 3. Global schedule policy (singleton)
-- ===========================================================================
CREATE TABLE IF NOT EXISTS _br_schedule_policy (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT false,
  cron_expression text NOT NULL DEFAULT '0 2 * * *',
  timezone text NOT NULL DEFAULT 'Africa/Dakar',
  retention_daily integer NOT NULL DEFAULT 7,
  retention_weekly integer NOT NULL DEFAULT 4,
  retention_monthly integer NOT NULL DEFAULT 6,
  max_concurrent integer NOT NULL DEFAULT 2,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE _br_schedule_policy ENABLE ROW LEVEL SECURITY;

INSERT INTO _br_schedule_policy (id, enabled, cron_expression, timezone, retention_daily, retention_weekly, retention_monthly, max_concurrent)
VALUES (1, false, '0 2 * * *', 'Africa/Dakar', 7, 4, 6, 2)
ON CONFLICT (id) DO NOTHING;

-- ===========================================================================
-- 4. Per-tenant schedule overrides
-- ===========================================================================
CREATE TABLE IF NOT EXISTS _br_tenant_schedule_override (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  suspended boolean NOT NULL DEFAULT false,
  custom_cron text,
  custom_retention_daily integer,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE _br_tenant_schedule_override ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- 5. Schedule run history
-- ===========================================================================
CREATE TABLE IF NOT EXISTS _br_schedule_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'partial_failure', 'failed')),
  tenants_total integer NOT NULL DEFAULT 0,
  tenants_succeeded integer NOT NULL DEFAULT 0,
  tenants_failed integer NOT NULL DEFAULT 0,
  tenants_skipped integer NOT NULL DEFAULT 0,
  error_summary jsonb DEFAULT '[]'::jsonb,
  triggered_by text NOT NULL DEFAULT 'cron' CHECK (triggered_by IN ('cron', 'manual'))
);

ALTER TABLE _br_schedule_runs ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- 6. Per-tenant run items
-- ===========================================================================
CREATE TABLE IF NOT EXISTS _br_schedule_run_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES _br_schedule_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  backup_id uuid REFERENCES tenant_backups(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  retry_count integer NOT NULL DEFAULT 0,
  size_bytes bigint,
  row_count integer
);

ALTER TABLE _br_schedule_run_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_br_run_items_run_id ON _br_schedule_run_items(run_id);
CREATE INDEX IF NOT EXISTS idx_br_run_items_tenant_id ON _br_schedule_run_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_br_run_items_status ON _br_schedule_run_items(status);

-- ===========================================================================
-- 7. Concurrency guard: prevent duplicate run for same tenant in same window
-- ===========================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_br_run_items_unique_pending
  ON _br_schedule_run_items(tenant_id)
  WHERE status IN ('pending', 'running');
