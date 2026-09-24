/*
# Fix backup timeout for large tenants: replace jsonb_agg with text-based aggregation

## Problem
- `_br_create_backup_for_tenant_extended` times out on tenants with 35K+ rows per table
- Root cause: `jsonb_agg(row_to_json(t.*)::jsonb)` builds a 26MB+ JSONB binary array incrementally
  which is extremely slow (>180s for 35K rows) due to per-element parsing and memory reallocation
- The Sept 13 backup failure was caused by data growth pushing the largest tenant past the timeout

## Changes
1. **Replace `jsonb_agg` with text-based `string_agg`**: Build JSON arrays as text strings
   (`'[' || string_agg(row_to_json(t.*)::text, ',') || ']'`), avoiding expensive JSONB binary
   construction. Cast to JSONB only once at the end.
2. **Split data extraction and checksum into separate queries**: Avoids double-materialization
   of the CTE. Each query does one thing efficiently.
3. **Temp table stores text, not jsonb**: The per-table data is stored as text in `_br_ext_work`,
   cast to JSONB only during the final UPDATE.
4. **Use `t.id::text` directly** as sort key instead of `j->>'id'` (no JSONB field access).
5. **Increase per-statement timeout to 300s** and work_mem to 64MB.

## Modified Functions
- `_br_create_backup_for_tenant_extended` (complete rewrite of query strategy)
*/

CREATE OR REPLACE FUNCTION _br_create_backup_for_tenant_extended(
  p_tenant_id uuid,
  p_label text DEFAULT '',
  p_kind text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '300s'
SET work_mem = '64MB'
AS $$
DECLARE
  v_backup_id     uuid;
  v_drift         jsonb;
  v_fingerprint   text;
  v_rec           record;
  v_table_exists  boolean;
  v_table_data_text text;
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
  v_stage         text := 'init';
  v_current_table text := '';
BEGIN
  -- Validate tenant
  v_stage := 'validate_tenant';
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant_id provided';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'BR-001: Tenant % does not exist', p_tenant_id;
  END IF;

  -- Schema drift check
  v_stage := 'schema_drift';
  v_drift := br_check_schema_drift();
  IF (v_drift->>'drift_detected')::boolean THEN
    RAISE EXCEPTION 'BR-002: Schema drift detected. Unregistered: %, Missing: %',
      v_drift->>'unregistered_tables', v_drift->>'missing_tables';
  END IF;

  -- Create backup row
  v_stage := 'create_backup_row';
  INSERT INTO tenant_backups (tenant_id, created_by, label, kind, is_auto, format_version, status)
  VALUES (
    p_tenant_id, NULL, COALESCE(NULLIF(p_label, ''), 'Sauvegarde'),
    p_kind, (p_kind = 'auto'), 2, 'creating'::br_backup_status
  )
  RETURNING id INTO v_backup_id;

  -- Schema fingerprint
  v_stage := 'fingerprint';
  SELECT md5(string_agg(table_name || ':' || restore_order::text, ',' ORDER BY table_name))
  INTO v_fingerprint
  FROM _br_table_registry
  WHERE tenant_link != 'excluded';

  -- Create temp table for per-table results (text, not jsonb)
  v_stage := 'create_temp';
  CREATE TEMPORARY TABLE _br_ext_work (
    schema_name   text    NOT NULL,
    table_name    text    NOT NULL,
    restore_order integer NOT NULL,
    table_data    text    NOT NULL DEFAULT '[]',
    row_count     integer NOT NULL DEFAULT 0,
    checksum      text    NOT NULL DEFAULT ''
  ) ON COMMIT DROP;

  -- Loop through registry
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

    -- Step 1: Extract data as TEXT (not jsonb) and get count
    IF v_rec.tenant_link = 'direct' THEN
      EXECUTE format(
        'SELECT
           ''['' || coalesce(string_agg(row_to_json(t.*)::text, '','' ORDER BY t.id), '''') || '']'',
           count(*)::integer
         FROM %I.%I t WHERE t.%I = $1',
        v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
      ) INTO v_table_data_text, v_count USING p_tenant_id;

    ELSIF v_rec.tenant_link = 'indirect' THEN
      EXECUTE format(
        'SELECT
           ''['' || coalesce(string_agg(row_to_json(c.*)::text, '','' ORDER BY c.id), '''') || '']'',
           count(*)::integer
         FROM %I.%I c
         JOIN %I.%I p ON p.id = c.wholesaler_id
         WHERE p.tenant_id = $1',
        v_rec.schema_name, v_rec.table_name,
        v_rec.schema_name, v_rec.parent_table
      ) INTO v_table_data_text, v_count USING p_tenant_id;
    END IF;

    -- Step 2: Compute checksum separately (avoids double materialization)
    IF v_count > 0 THEN
      IF v_rec.tenant_link = 'direct' THEN
        EXECUTE format(
          'SELECT md5(string_agg(md5(row_to_json(t.*)::text), '''' ORDER BY t.id::text))
           FROM %I.%I t WHERE t.%I = $1',
          v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
        ) INTO v_checksum USING p_tenant_id;

      ELSIF v_rec.tenant_link = 'indirect' THEN
        EXECUTE format(
          'SELECT md5(string_agg(md5(row_to_json(c.*)::text), '''' ORDER BY c.id::text))
           FROM %I.%I c
           JOIN %I.%I p ON p.id = c.wholesaler_id
           WHERE p.tenant_id = $1',
          v_rec.schema_name, v_rec.table_name,
          v_rec.schema_name, v_rec.parent_table
        ) INTO v_checksum USING p_tenant_id;
      END IF;
    ELSE
      v_checksum := '';
    END IF;

    INSERT INTO _br_ext_work (schema_name, table_name, restore_order, table_data, row_count, checksum)
    VALUES (v_rec.schema_name, v_rec.table_name, v_rec.restore_order,
            coalesce(v_table_data_text, '[]'), coalesce(v_count, 0), coalesce(v_checksum, ''));
  END LOOP;

  -- Build all aggregates from temp table, casting text→jsonb only here
  v_stage := 'aggregate';
  v_current_table := '';

  SELECT
    jsonb_object_agg(w.table_name, w.table_data::jsonb),
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
    md5(string_agg(w.checksum, '' ORDER BY w.restore_order, w.table_name)),
    count(*)::bigint,
    coalesce(sum(w.row_count), 0)::bigint
  INTO v_payload, v_row_counts, v_checksums, v_manifest, v_global_hash, v_table_count, v_total_rows
  FROM _br_ext_work w;

  -- Compute size
  v_stage := 'size';
  v_size_bytes := octet_length(v_payload::text);

  -- Update backup row
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
$$;
