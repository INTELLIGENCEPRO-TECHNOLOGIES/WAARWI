/*
# Fix restore: temporarily drop partial unique indexes that reference self-ref columns

## Problem
During backup restoration, self-referencing columns (like `parent_id` on `part_categories`) are
NULLed during pass 1 to break circular FK dependencies, then restored in pass 2.

However, partial unique indexes whose WHERE clause includes conditions like `parent_id IS NULL`
become overly broad when all rows temporarily have `parent_id = NULL`. This causes
"duplicate key value violates unique constraint" errors for rows that are valid in their
final state (e.g., a subcategory named "Freins" and a top-level category also named "Freins").

## Fix
Rewrite `br_restore_backup` to:
1. Before the INSERT phase, discover and DROP any partial unique indexes on tables that have
   self_ref_columns, where the index definition references one of those self-ref columns.
2. After pass 2 (self-ref columns restored), recreate those indexes exactly.

This is fully contained within the restore transaction — if anything fails, the DROP is rolled back.

## Affected tables
- `part_categories`: indexes `idx_part_categories_unique_name_global` and
  `idx_part_categories_unique_name_site` both filter on `parent_id IS NULL`.

## Security
- No RLS or policy changes.
- No new tables or columns.
*/

CREATE OR REPLACE FUNCTION public.br_restore_backup(p_backup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_backup record;
v_preflight jsonb;
v_safety_result jsonb;
v_safety_backup_id uuid;
v_rec record;
v_table_data jsonb;
v_inserted_counts jsonb := '{}'::jsonb;
v_deleted_counts jsonb := '{}'::jsonb;
v_count integer;
v_lock_key bigint;
v_col text;
v_nulled_data jsonb;
v_elem jsonb;
v_all_deferred text[];
v_insert_cols text[];
v_col_list text;
v_payload_keys text[];
v_dropped_indexes text[] := '{}';
v_idx record;
BEGIN
SELECT p.tenant_id INTO v_tenant_id FROM profiles p WHERE p.id = auth.uid();
IF v_tenant_id IS NULL THEN
RAISE EXCEPTION 'BR-001: No tenant context for current user';
END IF;

v_lock_key := ('x' || left(replace(v_tenant_id::text, '-', ''), 15))::bit(64)::bigint;
IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
RAISE EXCEPTION 'BR-010: Another backup/restore operation is in progress for this tenant';
END IF;

SELECT * INTO v_backup FROM tenant_backups WHERE id = p_backup_id;
IF NOT FOUND THEN
RAISE EXCEPTION 'BR-003: Backup % does not exist', p_backup_id;
END IF;
IF v_backup.tenant_id != v_tenant_id THEN
RAISE EXCEPTION 'BR-004: Backup belongs to a different tenant';
END IF;

v_preflight := br_preflight_restore(p_backup_id);
IF NOT (v_preflight->>'viable')::boolean THEN
RAISE EXCEPTION 'BR-005: Preflight failed: %', v_preflight->'issues';
END IF;

v_safety_result := br_create_backup('Pre-restore safety backup', 'safety');
v_safety_backup_id := (v_safety_result->>'backup_id')::uuid;
IF v_safety_backup_id IS NULL THEN
RAISE EXCEPTION 'BR-006: Failed to create safety backup';
END IF;
IF NOT EXISTS (
SELECT 1 FROM tenant_backups WHERE id = v_safety_backup_id AND status = 'verified'::br_backup_status
) THEN
RAISE EXCEPTION 'BR-007: Safety backup failed verification';
END IF;

-- DELETE in reverse restore_order
FOR v_rec IN
SELECT r.schema_name, r.table_name, r.tenant_link, r.tenant_id_column, r.parent_table
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded'
AND EXISTS (
SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r'
)
ORDER BY r.restore_order DESC, r.table_name DESC
LOOP
IF v_rec.tenant_link = 'direct' THEN
EXECUTE format('DELETE FROM %I.%I WHERE %I = $1',
v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
) USING v_tenant_id;
ELSIF v_rec.tenant_link = 'indirect' THEN
EXECUTE format(
'DELETE FROM %I.%I WHERE wholesaler_id IN (SELECT id FROM %I.%I WHERE tenant_id = $1)',
v_rec.schema_name, v_rec.table_name,
v_rec.schema_name, v_rec.parent_table
) USING v_tenant_id;
END IF;
GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted_counts := v_deleted_counts || jsonb_build_object(v_rec.table_name, v_count);
END LOOP;

-- Pre-INSERT: drop partial unique indexes that reference self-ref columns
-- These indexes become overly broad when self-ref columns are temporarily NULLed
FOR v_idx IN
  SELECT i.indexname, i.indexdef, i.schemaname
  FROM pg_indexes i
  JOIN _br_table_registry r
    ON r.schema_name = i.schemaname AND r.table_name = i.tablename
  JOIN pg_index pi
    ON pi.indexrelid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass
  WHERE r.self_ref_columns IS NOT NULL
    AND array_length(r.self_ref_columns, 1) > 0
    AND pi.indisunique
    AND pi.indpred IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM unnest(r.self_ref_columns) AS sc
      WHERE i.indexdef ILIKE '%' || sc || '%'
    )
LOOP
  EXECUTE format('DROP INDEX %I.%I', v_idx.schemaname, v_idx.indexname);
  v_dropped_indexes := v_dropped_indexes || v_idx.indexdef;
END LOOP;

-- INSERT in forward restore_order — first pass
FOR v_rec IN
SELECT r.schema_name, r.table_name, r.tenant_link, r.restore_order,
r.self_ref_columns, r.deferred_fk_columns
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded'
AND (v_backup.payload ? r.table_name)
AND EXISTS (
SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r'
)
ORDER BY r.restore_order, r.table_name
LOOP
v_table_data := v_backup.payload->v_rec.table_name;
v_count := 0;

IF jsonb_array_length(coalesce(v_table_data, '[]'::jsonb)) > 0 THEN
v_all_deferred := coalesce(v_rec.self_ref_columns, '{}') || coalesce(v_rec.deferred_fk_columns, '{}');

-- Get payload keys from first row
SELECT array_agg(k) INTO v_payload_keys FROM jsonb_object_keys(v_table_data->0) AS k;

-- Build insertable column list (excludes generated + deferred)
v_insert_cols := _br_insertable_columns(v_rec.schema_name, v_rec.table_name, v_payload_keys, v_all_deferred);

IF array_length(v_insert_cols, 1) IS NULL OR array_length(v_insert_cols, 1) = 0 THEN
CONTINUE;
END IF;

v_col_list := (SELECT string_agg(format('%I', c), ', ') FROM unnest(v_insert_cols) AS c);

EXECUTE format(
'INSERT INTO %I.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::%I.%I, $1)',
v_rec.schema_name, v_rec.table_name, v_col_list, v_col_list,
v_rec.schema_name, v_rec.table_name
) USING v_table_data;

GET DIAGNOSTICS v_count = ROW_COUNT;
END IF;

v_inserted_counts := v_inserted_counts || jsonb_build_object(v_rec.table_name, v_count);
END LOOP;

-- Second pass: restore self_ref + deferred FK columns
FOR v_rec IN
SELECT r.schema_name, r.table_name, r.self_ref_columns, r.deferred_fk_columns
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded'
AND (v_backup.payload ? r.table_name)
AND (
(r.self_ref_columns IS NOT NULL AND array_length(r.self_ref_columns, 1) > 0)
OR (r.deferred_fk_columns IS NOT NULL AND array_length(r.deferred_fk_columns, 1) > 0)
)
ORDER BY r.restore_order, r.table_name
LOOP
v_table_data := v_backup.payload->v_rec.table_name;
v_all_deferred := coalesce(v_rec.self_ref_columns, '{}') || coalesce(v_rec.deferred_fk_columns, '{}');

FOR v_elem IN SELECT * FROM jsonb_array_elements(v_table_data)
LOOP
FOREACH v_col IN ARRAY v_all_deferred LOOP
IF v_elem->>v_col IS NOT NULL THEN
EXECUTE format(
'UPDATE %I.%I SET %I = ($1->>%L)::uuid WHERE id = ($1->>''id'')::uuid',
v_rec.schema_name, v_rec.table_name, v_col, v_col
) USING v_elem;
END IF;
END LOOP;
END LOOP;
END LOOP;

-- Post pass-2: recreate the dropped partial unique indexes
FOR i IN 1..coalesce(array_length(v_dropped_indexes, 1), 0) LOOP
  EXECUTE v_dropped_indexes[i];
END LOOP;

-- Integrity verification
FOR v_rec IN
SELECT r.schema_name, r.table_name, r.tenant_link, r.tenant_id_column, r.parent_table
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded'
AND (v_backup.payload ? r.table_name)
AND EXISTS (
SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r'
)
ORDER BY r.restore_order
LOOP
IF v_rec.tenant_link = 'direct' THEN
EXECUTE format('SELECT count(*)::integer FROM %I.%I WHERE %I = $1',
v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
) INTO v_count USING v_tenant_id;
ELSIF v_rec.tenant_link = 'indirect' THEN
EXECUTE format(
'SELECT count(*)::integer FROM %I.%I WHERE wholesaler_id IN (SELECT id FROM %I.%I WHERE tenant_id = $1)',
v_rec.schema_name, v_rec.table_name,
v_rec.schema_name, v_rec.parent_table
) INTO v_count USING v_tenant_id;
END IF;

IF v_count != coalesce((v_backup.row_counts->>v_rec.table_name)::integer, 0) THEN
RAISE EXCEPTION 'BR-008: Integrity check failed for %. Expected % rows, found %',
v_rec.table_name,
coalesce(v_backup.row_counts->>v_rec.table_name, '0'),
v_count;
END IF;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'backup_id', p_backup_id,
'safety_backup_id', v_safety_backup_id,
'deleted_counts', v_deleted_counts,
'inserted_counts', v_inserted_counts,
'integrity_verified', true,
'dropped_indexes_recreated', array_length(v_dropped_indexes, 1),
'restored_at', now()
);
END;
$function$;
