/*
# Optimize _br_create_backup_for_tenant_extended with temp-table strategy + add 8 missing indexes

## Summary
Replaces the simple wrapper `_br_create_backup_for_tenant_extended` with a fully
self-contained, optimized implementation that avoids O(n^2) JSONB concatenation.
Also adds `tenant_id` indexes on 8 tables that were missing them, causing seq-scans
during backup.

## Problem
The original function builds the backup payload by concatenating JSONB objects in a loop
(`v_payload := v_payload || ...`), which copies the entire accumulated payload on every
iteration. With 89+ mandatory tables this becomes extremely slow. Additionally, 8 tables
lack a `tenant_id` index, forcing full sequential scans.

## New indexes (8)
- `idx_brperf_sale_items_tenant` on sale_items(tenant_id)
- `idx_brperf_journal_entries_tenant` on journal_entries(tenant_id)
- `idx_brperf_journal_lines_tenant` on journal_lines(tenant_id)
- `idx_brperf_audit_logs_tenant` on audit_logs(tenant_id)
- `idx_brperf_notifications_tenant` on notifications(tenant_id)
- `idx_brperf_sale_lot_deductions_tenant` on sale_lot_deductions(tenant_id)
- `idx_brperf_sale_return_items_tenant` on sale_return_items(tenant_id)
- `idx_brperf_supplier_order_items_tenant` on supplier_order_items(tenant_id)

## Optimized function
- Same signature: `_br_create_backup_for_tenant_extended(uuid, text, text) -> jsonb`
- Same SECURITY DEFINER, search_path, service_role only
- SET statement_timeout = '60s', work_mem = '16MB'
- Uses a temp table (ON COMMIT DROP) to collect per-table results
- Builds all aggregates (payload, row_counts, checksums, manifest, global_checksum)
  in a single pass from the temp table after the loop
- Identical output keys, checksum algorithm, manifest format, and tenant_backups row

## Important notes
1. `_br_create_backup_for_tenant` is NOT modified
2. Restore, verify, offsite, checksum functions are NOT modified
3. No data is modified, deleted, or archived
4. No role-level or database-level timeout changes
5. Backup format version 2 is preserved exactly
*/

-- ============================================================
-- STEP 1: Create 8 missing tenant_id indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_brperf_sale_items_tenant
  ON public.sale_items (tenant_id);

CREATE INDEX IF NOT EXISTS idx_brperf_journal_entries_tenant
  ON public.journal_entries (tenant_id);

CREATE INDEX IF NOT EXISTS idx_brperf_journal_lines_tenant
  ON public.journal_lines (tenant_id);

CREATE INDEX IF NOT EXISTS idx_brperf_audit_logs_tenant
  ON public.audit_logs (tenant_id);

CREATE INDEX IF NOT EXISTS idx_brperf_notifications_tenant
  ON public.notifications (tenant_id);

CREATE INDEX IF NOT EXISTS idx_brperf_sale_lot_deductions_tenant
  ON public.sale_lot_deductions (tenant_id);

CREATE INDEX IF NOT EXISTS idx_brperf_sale_return_items_tenant
  ON public.sale_return_items (tenant_id);

CREATE INDEX IF NOT EXISTS idx_brperf_supplier_order_items_tenant
  ON public.supplier_order_items (tenant_id);

-- Refresh planner stats for these tables
ANALYZE sale_items;
ANALYZE journal_entries;
ANALYZE journal_lines;
ANALYZE audit_logs;
ANALYZE notifications;
ANALYZE sale_lot_deductions;
ANALYZE sale_return_items;
ANALYZE supplier_order_items;

-- ============================================================
-- STEP 2: Replace _br_create_backup_for_tenant_extended
-- ============================================================

CREATE OR REPLACE FUNCTION public._br_create_backup_for_tenant_extended(
  p_tenant_id uuid,
  p_label text DEFAULT 'auto'::text,
  p_kind text DEFAULT 'auto'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
SET statement_timeout TO '60s'
SET work_mem TO '16MB'
AS $fn$
DECLARE
  v_backup_id     uuid;
  v_drift         jsonb;
  v_fingerprint   text;
  v_rec           record;
  v_table_exists  boolean;
  v_table_data    jsonb;
  v_count         integer;
  v_checksum      text;
  v_payload       jsonb;
  v_row_counts    jsonb;
  v_checksums     jsonb;
  v_manifest      jsonb;
  v_global_hash   text;
  v_size_bytes    integer;
  v_table_count   bigint;
  v_total_rows    bigint;
  -- Traceability
  v_stage         text := 'init';
  v_current_table text := '';
BEGIN
  -- ---- Validate tenant ----
  v_stage := 'validate_tenant';
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant_id provided';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'BR-001: Tenant % does not exist', p_tenant_id;
  END IF;

  -- ---- Schema drift check ----
  v_stage := 'schema_drift';
  v_drift := br_check_schema_drift();
  IF (v_drift->>'drift_detected')::boolean THEN
    RAISE EXCEPTION 'BR-002: Schema drift detected. Unregistered: %, Missing: %',
      v_drift->>'unregistered_tables', v_drift->>'missing_tables';
  END IF;

  -- ---- Create backup row ----
  v_stage := 'create_backup_row';
  INSERT INTO tenant_backups (tenant_id, created_by, label, kind, is_auto, format_version, status)
  VALUES (
    p_tenant_id, NULL, COALESCE(NULLIF(p_label, ''), 'Sauvegarde'),
    p_kind, (p_kind = 'auto'), 2, 'creating'::br_backup_status
  )
  RETURNING id INTO v_backup_id;

  -- ---- Schema fingerprint (identical to original) ----
  v_stage := 'fingerprint';
  SELECT md5(string_agg(table_name || ':' || restore_order::text, ',' ORDER BY table_name))
  INTO v_fingerprint
  FROM _br_table_registry
  WHERE tenant_link != 'excluded';

  -- ---- Create temp table for per-table results ----
  v_stage := 'create_temp';
  CREATE TEMPORARY TABLE _br_ext_work (
    schema_name   text    NOT NULL,
    table_name    text    NOT NULL,
    restore_order integer NOT NULL,
    table_data    jsonb   NOT NULL DEFAULT '[]'::jsonb,
    row_count     integer NOT NULL DEFAULT 0,
    checksum      text    NOT NULL DEFAULT ''
  ) ON COMMIT DROP;

  -- ---- Loop through registry ----
  v_stage := 'loop';
  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.tenant_link, r.tenant_id_column,
           r.parent_table, r.restore_order
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
    ORDER BY r.restore_order, r.table_name
  LOOP
    v_current_table := v_rec.schema_name || '.' || v_rec.table_name;

    SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = v_rec.schema_name AND c.relname = v_rec.table_name AND c.relkind = 'r'
    ) INTO v_table_exists;

    IF NOT v_table_exists THEN
      CONTINUE;
    END IF;

    -- Fetch data + count + checksum in a single dynamic statement
    IF v_rec.tenant_link = 'direct' THEN
      EXECUTE format(
        'WITH rows_json AS MATERIALIZED (
           SELECT row_to_json(t.*)::jsonb AS j FROM %I.%I t WHERE t.%I = $1
         )
         SELECT
           coalesce(jsonb_agg(j), ''[]''::jsonb),
           count(*)::integer,
           encode(extensions.digest(
             coalesce(string_agg(j::text, '''' ORDER BY j::text), ''''),
             ''sha256''
           ), ''hex'')
         FROM rows_json',
        v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
      ) INTO v_table_data, v_count, v_checksum USING p_tenant_id;

    ELSIF v_rec.tenant_link = 'indirect' THEN
      EXECUTE format(
        'WITH rows_json AS MATERIALIZED (
           SELECT row_to_json(c.*)::jsonb AS j
           FROM %I.%I c
           JOIN %I.%I p ON p.id = c.wholesaler_id
           WHERE p.tenant_id = $1
         )
         SELECT
           coalesce(jsonb_agg(j), ''[]''::jsonb),
           count(*)::integer,
           encode(extensions.digest(
             coalesce(string_agg(j::text, '''' ORDER BY j::text), ''''),
             ''sha256''
           ), ''hex'')
         FROM rows_json',
        v_rec.schema_name, v_rec.table_name,
        v_rec.schema_name, v_rec.parent_table
      ) INTO v_table_data, v_count, v_checksum USING p_tenant_id;
    END IF;

    -- Insert into temp table (no JSONB concatenation on accumulated state)
    INSERT INTO _br_ext_work (schema_name, table_name, restore_order, table_data, row_count, checksum)
    VALUES (v_rec.schema_name, v_rec.table_name, v_rec.restore_order,
            coalesce(v_table_data, '[]'::jsonb), coalesce(v_count, 0), coalesce(v_checksum, ''));
  END LOOP;

  -- ---- Build all aggregates in a single pass from temp table ----
  v_stage := 'aggregate';
  v_current_table := '';

  SELECT
    jsonb_object_agg(w.table_name, w.table_data),
    jsonb_object_agg(w.table_name, w.row_count),
    jsonb_object_agg(w.table_name, w.checksum),
    jsonb_agg(
      jsonb_build_object(
        'table', w.table_name,
        'order', w.restore_order,
        'rows', w.row_count,
        'checksum', w.checksum
      ) ORDER BY w.restore_order, w.table_name
    ),
    encode(extensions.digest(
      string_agg(w.checksum, '' ORDER BY w.restore_order, w.table_name),
      'sha256'
    ), 'hex'),
    count(*)::bigint,
    coalesce(sum(w.row_count), 0)::bigint
  INTO v_payload, v_row_counts, v_checksums, v_manifest, v_global_hash, v_table_count, v_total_rows
  FROM _br_ext_work w;

  -- Compute size once
  v_stage := 'size';
  v_size_bytes := octet_length(v_payload::text);

  -- ---- Update backup row ----
  v_stage := 'update_backup';
  UPDATE tenant_backups SET
    payload           = v_payload,
    format_version    = 2,
    schema_fingerprint = v_fingerprint,
    manifest          = v_manifest,
    row_counts        = v_row_counts,
    checksums         = v_checksums,
    global_checksum   = v_global_hash,
    size_bytes        = v_size_bytes,
    status            = 'verified'::br_backup_status,
    verified_at       = now()
  WHERE id = v_backup_id;

  -- ---- Return (identical keys to original) ----
  v_stage := 'return';
  RETURN jsonb_build_object(
    'success', true,
    'backup_id', v_backup_id,
    'format_version', 2,
    'table_count', v_table_count,
    'total_rows', v_total_rows,
    'row_counts', v_row_counts,
    'global_checksum', v_global_hash,
    'size_bytes', v_size_bytes,
    'created_at', now()
  );

EXCEPTION WHEN others THEN
  IF v_backup_id IS NOT NULL THEN
    UPDATE tenant_backups SET
      status = 'failed'::br_backup_status,
      error_message = format('[BR-EXT][stage=%s][table=%s] %s', v_stage, v_current_table, SQLERRM)
    WHERE id = v_backup_id;
  END IF;
  RAISE EXCEPTION '%', format('[BR-EXT][stage=%s][table=%s] %s', v_stage, v_current_table, SQLERRM)
    USING ERRCODE = SQLSTATE;
END;
$fn$;

-- ============================================================
-- STEP 3: Security — restrict execution
-- ============================================================

REVOKE ALL ON FUNCTION public._br_create_backup_for_tenant_extended(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._br_create_backup_for_tenant_extended(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public._br_create_backup_for_tenant_extended(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._br_create_backup_for_tenant_extended(uuid, text, text) TO service_role;

-- ============================================================
-- STEP 4: Reload PostgREST schema cache
-- ============================================================

NOTIFY pgrst, 'reload schema';
