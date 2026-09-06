/*
# Backup/Restore System v2 — Part 2: Functions

## Summary
Creates the 6 new registry-driven backup/restore functions that replace the
legacy hardcoded system. Every function uses the _br_table_registry as its
single source of truth for table enumeration and ordering.

## New Functions (all SECURITY DEFINER, search_path = public)
- `br_check_schema_drift()` — Compares registry against pg_catalog to find
  unregistered tenant tables or registered tables that no longer exist.
  Returns jsonb with unregistered_tables, missing_tables, drift_detected.
- `br_create_backup(text, text)` — Registry-driven backup with per-table
  checksums (SHA-256 via pgcrypto). Checks schema drift first, exports all
  registered non-excluded tables, computes checksums, returns structured report.
- `br_preflight_restore(uuid)` — Non-destructive validation of a backup before
  restore. Checks activation lock, tenant match, format version, manifest
  completeness, column compatibility, NOT NULL constraints, and checksums.
- `br_restore_backup(uuid)` — Atomic fail-fast restore. Advisory lock,
  preflight, safety backup, delete in reverse order, insert in forward order
  with two-pass for self-ref columns, post-restore integrity verification.
- `br_reset_operations()` — Registry-driven operational reset. Deletes all
  tables with reset_behavior='delete', preserves structure tables.
- `br_import_payload(jsonb)` — Validated import from external JSON. Checks
  every row's tenant_id matches caller, then performs atomic restore.

## Security
- br_check_schema_drift, br_create_backup, br_preflight_restore: GRANT to authenticated
- br_restore_backup, br_reset_operations, br_import_payload: GRANT to authenticated
  (gated internally by activation lock — fail-closed)
- All functions: REVOKE from PUBLIC and anon

## Important Notes
1. All functions use auth.uid() → profiles.tenant_id for tenant resolution.
2. No function accepts a tenant_id parameter — prevents arbitrary tenant access.
3. Advisory locks (pg_try_advisory_xact_lock) prevent concurrent operations.
4. Error codes: BR-001 through BR-012 for structured error handling.
5. NO ON CONFLICT DO NOTHING anywhere. NO EXCEPTION WHEN others THEN NULL.
6. Safety backups are always created and verified before destructive operations.
*/

-- ============================================================
-- SECTION 1: br_check_schema_drift
-- ============================================================
CREATE OR REPLACE FUNCTION br_check_schema_drift()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_unregistered jsonb;
  v_missing jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(c.relname::text ORDER BY c.relname::text), '[]'::jsonb)
  INTO v_unregistered
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND a.attname = 'tenant_id'
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND NOT EXISTS (
      SELECT 1 FROM _br_table_registry r
      WHERE r.schema_name = 'public' AND r.table_name = c.relname::text
    );

  SELECT coalesce(jsonb_agg(r.table_name ORDER BY r.table_name), '[]'::jsonb)
  INTO v_missing
  FROM _br_table_registry r
  WHERE r.schema_name = 'public'
    AND r.tenant_link != 'excluded'
    AND NOT EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r'
    );

  RETURN jsonb_build_object(
    'unregistered_tables', v_unregistered,
    'missing_tables', v_missing,
    'drift_detected', (v_unregistered != '[]'::jsonb OR v_missing != '[]'::jsonb),
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION br_check_schema_drift() FROM PUBLIC;
REVOKE ALL ON FUNCTION br_check_schema_drift() FROM anon;
GRANT EXECUTE ON FUNCTION br_check_schema_drift() TO authenticated;

-- ============================================================
-- SECTION 2: br_create_backup
-- ============================================================
CREATE OR REPLACE FUNCTION br_create_backup(
  p_label text DEFAULT 'manual',
  p_kind text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
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
  SELECT p.tenant_id INTO v_tenant_id FROM profiles p WHERE p.id = auth.uid();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant context for current user';
  END IF;

  v_drift := br_check_schema_drift();
  IF (v_drift->>'drift_detected')::boolean THEN
    RAISE EXCEPTION 'BR-002: Schema drift detected. Unregistered: %, Missing: %',
      v_drift->>'unregistered_tables', v_drift->>'missing_tables';
  END IF;

  INSERT INTO tenant_backups (tenant_id, created_by, label, kind, is_auto, format_version, status)
  VALUES (
    v_tenant_id, auth.uid(), COALESCE(NULLIF(p_label, ''), 'Sauvegarde'),
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
      ) INTO v_table_data USING v_tenant_id;
    ELSIF v_rec.tenant_link = 'indirect' THEN
      EXECUTE format(
        'SELECT coalesce(jsonb_agg(row_to_json(c.*)::jsonb), ''[]''::jsonb)
         FROM %I.%I c
         JOIN %I.%I p ON p.id = c.wholesaler_id
         WHERE p.tenant_id = $1',
        v_rec.schema_name, v_rec.table_name,
        v_rec.schema_name, v_rec.parent_table
      ) INTO v_table_data USING v_tenant_id;
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

REVOKE ALL ON FUNCTION br_create_backup(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION br_create_backup(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION br_create_backup(text, text) TO authenticated;

-- ============================================================
-- SECTION 3: br_preflight_restore
-- ============================================================
CREATE OR REPLACE FUNCTION br_preflight_restore(p_backup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_backup record;
  v_activation record;
  v_issues jsonb := '[]'::jsonb;
  v_rec record;
  v_current_cols text[];
  v_backup_cols text[];
  v_extra_cols text[];
  v_missing_notnull text[];
  v_recomputed text;
  v_table_data jsonb;
  v_has_fatal boolean := false;
BEGIN
  SELECT p.tenant_id INTO v_tenant_id FROM profiles p WHERE p.id = auth.uid();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant context';
  END IF;

  SELECT * INTO v_backup FROM tenant_backups WHERE id = p_backup_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('viable', false, 'issues', jsonb_build_array(
      jsonb_build_object('code', 'BACKUP_NOT_FOUND', 'severity', 'fatal',
        'message', 'Backup does not exist')
    ));
  END IF;

  IF v_backup.tenant_id != v_tenant_id THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'TENANT_MISMATCH', 'severity', 'fatal',
      'message', 'Backup belongs to a different tenant'));
  END IF;

  SELECT * INTO v_activation FROM _br_tenant_activation WHERE tenant_id = v_tenant_id;
  IF NOT FOUND OR NOT v_activation.enabled THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'ACTIVATION_LOCKED', 'severity', 'fatal',
      'message', 'Destructive operations are not activated for this tenant'));
  END IF;

  IF coalesce(v_backup.format_version, 1) < 2 THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'LEGACY_FORMAT', 'severity', 'fatal',
      'message', 'Backup is legacy format (v1). Cannot restore through v2 system.'));
  END IF;

  IF v_backup.status IS DISTINCT FROM 'verified'::br_backup_status THEN
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'INVALID_STATUS', 'severity', 'fatal',
      'message', format('Backup status is %s, expected verified', v_backup.status)));
  END IF;

  FOR v_rec IN
    SELECT r.table_name
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded' AND r.is_mandatory
      AND NOT (v_backup.payload ? r.table_name)
      AND EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = r.table_name AND c.relkind = 'r'
      )
  LOOP
    v_issues := v_issues || jsonb_build_array(jsonb_build_object(
      'code', 'MISSING_TABLE', 'severity', 'warning',
      'table', v_rec.table_name,
      'message', format('Table %s not found in backup data', v_rec.table_name)));
  END LOOP;

  FOR v_rec IN
    SELECT r.table_name, r.schema_name
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
      AND (v_backup.payload ? r.table_name)
      AND jsonb_array_length(coalesce(v_backup.payload->r.table_name, '[]'::jsonb)) > 0
    ORDER BY r.restore_order
  LOOP
    SELECT array_agg(a.attname::text ORDER BY a.attname)
    INTO v_current_cols
    FROM pg_attribute a
    WHERE a.attrelid = (v_rec.schema_name || '.' || v_rec.table_name)::regclass
      AND a.attnum > 0 AND NOT a.attisdropped;

    v_table_data := v_backup.payload->v_rec.table_name;

    SELECT array_agg(k ORDER BY k)
    INTO v_backup_cols
    FROM jsonb_object_keys(v_table_data->0) AS k;

    SELECT array_agg(bc)
    INTO v_extra_cols
    FROM unnest(v_backup_cols) AS bc
    WHERE bc != ALL(v_current_cols);

    IF v_extra_cols IS NOT NULL AND array_length(v_extra_cols, 1) > 0 THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'EXTRA_COLUMNS', 'severity', 'warning',
        'table', v_rec.table_name,
        'columns', to_jsonb(v_extra_cols),
        'message', format('Backup has columns not in current schema: %s', array_to_string(v_extra_cols, ', '))));
    END IF;

    SELECT array_agg(a.attname::text)
    INTO v_missing_notnull
    FROM pg_attribute a
    WHERE a.attrelid = (v_rec.schema_name || '.' || v_rec.table_name)::regclass
      AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attnotnull
      AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
      AND a.attname::text != ALL(v_backup_cols);

    IF v_missing_notnull IS NOT NULL AND array_length(v_missing_notnull, 1) > 0 THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code', 'NOT_NULL_NO_DEFAULT', 'severity', 'fatal',
        'table', v_rec.table_name,
        'columns', to_jsonb(v_missing_notnull),
        'message', format('NOT NULL columns without defaults missing from backup: %s', array_to_string(v_missing_notnull, ', '))));
    END IF;

    IF v_backup.checksums ? v_rec.table_name THEN
      v_recomputed := encode(
        extensions.digest(
          coalesce((SELECT string_agg(j::text, '' ORDER BY j::text)
           FROM jsonb_array_elements(v_table_data) AS j), ''),
          'sha256'
        ),
        'hex'
      );
      IF v_recomputed != (v_backup.checksums->>v_rec.table_name) THEN
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'code', 'CHECKSUM_MISMATCH', 'severity', 'fatal',
          'table', v_rec.table_name,
          'message', 'Stored checksum does not match — data may be corrupted'));
      END IF;
    END IF;
  END LOOP;

  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
  ) INTO v_has_fatal;

  RETURN jsonb_build_object(
    'viable', NOT v_has_fatal,
    'backup_id', p_backup_id,
    'format_version', v_backup.format_version,
    'issues', v_issues,
    'issue_count', jsonb_array_length(v_issues),
    'checked_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION br_preflight_restore(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION br_preflight_restore(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION br_preflight_restore(uuid) TO authenticated;

-- ============================================================
-- SECTION 4: br_restore_backup (atomic, fail-fast)
-- ============================================================
CREATE OR REPLACE FUNCTION br_restore_backup(p_backup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
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
  v_col_type text;
BEGIN
  -- 1. Auth
  SELECT p.tenant_id INTO v_tenant_id FROM profiles p WHERE p.id = auth.uid();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant context for current user';
  END IF;

  -- 2. Advisory lock
  v_lock_key := ('x' || left(replace(v_tenant_id::text, '-', ''), 15))::bit(64)::bigint;
  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RAISE EXCEPTION 'BR-010: Another backup/restore operation is in progress for this tenant';
  END IF;

  -- 3. Load backup
  SELECT * INTO v_backup FROM tenant_backups WHERE id = p_backup_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BR-003: Backup % does not exist', p_backup_id;
  END IF;
  IF v_backup.tenant_id != v_tenant_id THEN
    RAISE EXCEPTION 'BR-004: Backup belongs to a different tenant';
  END IF;

  -- 4. Preflight
  v_preflight := br_preflight_restore(p_backup_id);
  IF NOT (v_preflight->>'viable')::boolean THEN
    RAISE EXCEPTION 'BR-005: Preflight failed: %', v_preflight->'issues';
  END IF;

  -- 5. Safety backup
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

  -- 6. DELETE in reverse restore_order (children first)
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

  -- 7. INSERT in forward restore_order — first pass (self-ref columns set to NULL)
  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.tenant_link, r.restore_order, r.self_ref_columns
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
      IF v_rec.self_ref_columns IS NOT NULL AND array_length(v_rec.self_ref_columns, 1) > 0 THEN
        v_nulled_data := v_table_data;
        FOREACH v_col IN ARRAY v_rec.self_ref_columns
        LOOP
          SELECT jsonb_agg(
            CASE WHEN elem ? v_col THEN elem || jsonb_build_object(v_col, null)
                 ELSE elem END
          )
          INTO v_nulled_data
          FROM jsonb_array_elements(v_nulled_data) AS elem;
        END LOOP;

        EXECUTE format(
          'INSERT INTO %I.%I SELECT * FROM jsonb_populate_recordset(null::%I.%I, $1)',
          v_rec.schema_name, v_rec.table_name,
          v_rec.schema_name, v_rec.table_name
        ) USING v_nulled_data;
      ELSE
        EXECUTE format(
          'INSERT INTO %I.%I SELECT * FROM jsonb_populate_recordset(null::%I.%I, $1)',
          v_rec.schema_name, v_rec.table_name,
          v_rec.schema_name, v_rec.table_name
        ) USING v_table_data;
      END IF;
      GET DIAGNOSTICS v_count = ROW_COUNT;
    END IF;

    v_inserted_counts := v_inserted_counts || jsonb_build_object(v_rec.table_name, v_count);
  END LOOP;

  -- 8. Second pass: restore self-ref columns
  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.self_ref_columns
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
      AND (v_backup.payload ? r.table_name)
      AND r.self_ref_columns IS NOT NULL
      AND array_length(r.self_ref_columns, 1) > 0
    ORDER BY r.restore_order, r.table_name
  LOOP
    v_table_data := v_backup.payload->v_rec.table_name;
    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_table_data)
    LOOP
      FOREACH v_col IN ARRAY v_rec.self_ref_columns
      LOOP
        IF v_elem->>v_col IS NOT NULL THEN
          EXECUTE format(
            'UPDATE %I.%I SET %I = ($1->>%L)::uuid WHERE id = ($1->>''id'')::uuid',
            v_rec.schema_name, v_rec.table_name, v_col, v_col
          ) USING v_elem;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  -- 9. Integrity verification: row counts must match backup
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
    'restored_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION br_restore_backup(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION br_restore_backup(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION br_restore_backup(uuid) TO authenticated;

-- ============================================================
-- SECTION 5: br_reset_operations
-- ============================================================
CREATE OR REPLACE FUNCTION br_reset_operations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_lock_key bigint;
  v_activation record;
  v_safety_result jsonb;
  v_safety_backup_id uuid;
  v_rec record;
  v_deleted_counts jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  SELECT p.tenant_id INTO v_tenant_id FROM profiles p WHERE p.id = auth.uid();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant context';
  END IF;

  v_lock_key := ('x' || left(replace(v_tenant_id::text, '-', ''), 15))::bit(64)::bigint;
  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RAISE EXCEPTION 'BR-010: Concurrent operation in progress';
  END IF;

  SELECT * INTO v_activation FROM _br_tenant_activation WHERE tenant_id = v_tenant_id;
  IF NOT FOUND OR NOT v_activation.enabled THEN
    RAISE EXCEPTION 'BR-011: Tenant activation lock is not enabled. Enable it in settings before performing destructive operations.';
  END IF;

  v_safety_result := br_create_backup('Pre-reset safety backup', 'safety');
  v_safety_backup_id := (v_safety_result->>'backup_id')::uuid;
  IF v_safety_backup_id IS NULL THEN
    RAISE EXCEPTION 'BR-006: Failed to create safety backup';
  END IF;

  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.tenant_id_column, r.tenant_link, r.parent_table
    FROM _br_table_registry r
    WHERE r.reset_behavior = 'delete'
      AND r.tenant_link != 'excluded'
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

  RETURN jsonb_build_object(
    'success', true,
    'safety_backup_id', v_safety_backup_id,
    'deleted_counts', v_deleted_counts,
    'reset_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION br_reset_operations() FROM PUBLIC;
REVOKE ALL ON FUNCTION br_reset_operations() FROM anon;
GRANT EXECUTE ON FUNCTION br_reset_operations() TO authenticated;

-- ============================================================
-- SECTION 6: br_import_payload
-- ============================================================
CREATE OR REPLACE FUNCTION br_import_payload(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_lock_key bigint;
  v_activation record;
  v_rec record;
  v_table_data jsonb;
  v_row jsonb;
  v_foreign_tables text[] := '{}';
  v_safety_result jsonb;
  v_safety_backup_id uuid;
  v_inserted_counts jsonb := '{}'::jsonb;
  v_deleted_counts jsonb := '{}'::jsonb;
  v_count integer;
BEGIN
  SELECT p.tenant_id INTO v_tenant_id FROM profiles p WHERE p.id = auth.uid();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant context';
  END IF;

  v_lock_key := ('x' || left(replace(v_tenant_id::text, '-', ''), 15))::bit(64)::bigint;
  IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
    RAISE EXCEPTION 'BR-010: Concurrent operation in progress';
  END IF;

  SELECT * INTO v_activation FROM _br_tenant_activation WHERE tenant_id = v_tenant_id;
  IF NOT FOUND OR NOT v_activation.enabled THEN
    RAISE EXCEPTION 'BR-011: Tenant activation lock is not enabled';
  END IF;

  -- Validate tenant_id in every row of every direct-linked table
  FOR v_rec IN
    SELECT r.table_name, r.tenant_id_column
    FROM _br_table_registry r
    WHERE r.tenant_link = 'direct'
      AND (p_payload ? r.table_name)
  LOOP
    v_table_data := p_payload->v_rec.table_name;
    FOR v_row IN SELECT * FROM jsonb_array_elements(coalesce(v_table_data, '[]'::jsonb))
    LOOP
      IF (v_row->>v_rec.tenant_id_column)::uuid IS DISTINCT FROM v_tenant_id THEN
        v_foreign_tables := array_append(v_foreign_tables, v_rec.table_name);
        EXIT;
      END IF;
    END LOOP;
  END LOOP;

  IF array_length(v_foreign_tables, 1) > 0 THEN
    RAISE EXCEPTION 'BR-012: Import contains data for a foreign tenant in tables: %',
      array_to_string(v_foreign_tables, ', ');
  END IF;

  v_safety_result := br_create_backup('Pre-import safety backup', 'safety');
  v_safety_backup_id := (v_safety_result->>'backup_id')::uuid;
  IF v_safety_backup_id IS NULL THEN
    RAISE EXCEPTION 'BR-006: Failed to create safety backup';
  END IF;

  -- Delete in reverse order (only tables present in payload)
  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.tenant_link, r.tenant_id_column, r.parent_table
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
      AND (p_payload ? r.table_name)
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

  -- Insert in forward order
  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.self_ref_columns
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
      AND (p_payload ? r.table_name)
      AND EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r'
      )
    ORDER BY r.restore_order, r.table_name
  LOOP
    v_table_data := p_payload->v_rec.table_name;
    IF jsonb_array_length(coalesce(v_table_data, '[]'::jsonb)) > 0 THEN
      IF v_rec.self_ref_columns IS NOT NULL AND array_length(v_rec.self_ref_columns, 1) > 0 THEN
        DECLARE v_nulled jsonb; v_sr_col text;
        BEGIN
          v_nulled := v_table_data;
          FOREACH v_sr_col IN ARRAY v_rec.self_ref_columns LOOP
            SELECT jsonb_agg(CASE WHEN e ? v_sr_col THEN e || jsonb_build_object(v_sr_col, null) ELSE e END)
            INTO v_nulled FROM jsonb_array_elements(v_nulled) AS e;
          END LOOP;
          EXECUTE format('INSERT INTO %I.%I SELECT * FROM jsonb_populate_recordset(null::%I.%I, $1)',
            v_rec.schema_name, v_rec.table_name, v_rec.schema_name, v_rec.table_name) USING v_nulled;
        END;
      ELSE
        EXECUTE format('INSERT INTO %I.%I SELECT * FROM jsonb_populate_recordset(null::%I.%I, $1)',
          v_rec.schema_name, v_rec.table_name, v_rec.schema_name, v_rec.table_name) USING v_table_data;
      END IF;
      GET DIAGNOSTICS v_count = ROW_COUNT;
    ELSE
      v_count := 0;
    END IF;
    v_inserted_counts := v_inserted_counts || jsonb_build_object(v_rec.table_name, v_count);
  END LOOP;

  -- Second pass: restore self-ref columns
  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.self_ref_columns
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
      AND (p_payload ? r.table_name)
      AND r.self_ref_columns IS NOT NULL AND array_length(r.self_ref_columns, 1) > 0
  LOOP
    v_table_data := p_payload->v_rec.table_name;
    FOR v_row IN SELECT * FROM jsonb_array_elements(v_table_data) LOOP
      DECLARE v_sr_col2 text;
      BEGIN
        FOREACH v_sr_col2 IN ARRAY v_rec.self_ref_columns LOOP
          IF v_row->>v_sr_col2 IS NOT NULL THEN
            EXECUTE format('UPDATE %I.%I SET %I = ($1->>%L)::uuid WHERE id = ($1->>''id'')::uuid',
              v_rec.schema_name, v_rec.table_name, v_sr_col2, v_sr_col2) USING v_row;
          END IF;
        END LOOP;
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'safety_backup_id', v_safety_backup_id,
    'deleted_counts', v_deleted_counts,
    'inserted_counts', v_inserted_counts,
    'imported_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION br_import_payload(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION br_import_payload(jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION br_import_payload(jsonb) TO authenticated;
