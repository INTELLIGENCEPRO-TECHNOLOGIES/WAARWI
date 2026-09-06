/*
# Fix cross-order FK violations during restore INSERT phase

## Problem
During restore, rows are inserted in restore_order ASC. When a child table
at a lower order has a nullable FK to a parent at a higher order, the INSERT
fails because the parent row doesn't exist yet.

Affected pairs:
- customer_prepayments(50).cash_movement_id -> cash_movements(70)
- ipm_bordereaux(60).facture_ipm_id -> ipm_factures(70)
- cash_movements(70).sale_return_id -> sale_returns(80)
- sale_payments(70).source_return_id -> sale_returns(80)

## Solution
Add a `deferred_fk_columns` text[] column to the registry (same pattern as
self_ref_columns). These columns are NULLed on first-pass INSERT and restored
in a second pass after all rows exist. Update br_restore_backup and
br_import_payload to handle deferred_fk_columns identically to self_ref_columns.
*/

-- 1. Add column
ALTER TABLE _br_table_registry ADD COLUMN IF NOT EXISTS deferred_fk_columns text[] DEFAULT '{}';

-- 2. Populate for the 4 affected tables
UPDATE _br_table_registry SET deferred_fk_columns = '{cash_movement_id}'
WHERE table_name = 'customer_prepayments' AND schema_name = 'public';

UPDATE _br_table_registry SET deferred_fk_columns = '{facture_ipm_id}'
WHERE table_name = 'ipm_bordereaux' AND schema_name = 'public';

UPDATE _br_table_registry SET deferred_fk_columns = '{sale_return_id}'
WHERE table_name = 'cash_movements' AND schema_name = 'public';

UPDATE _br_table_registry SET deferred_fk_columns = '{source_return_id}'
WHERE table_name = 'sale_payments' AND schema_name = 'public';

-- 3. Also check same-order NO ACTION FKs that could bite during INSERT
-- (vault_movements at 65 is parent of cash_movements/supplier_payments at 70 — OK, parent inserts first)
-- sales(60).accounting_entry_id -> journal_entries(60) — same order, SET NULL — could fail on INSERT
-- supplier_orders(60).accounting_entry_id -> journal_entries(60) — same order, SET NULL — could fail
-- quotes(60).converted_sale_id -> sales(60) — same order, SET NULL — could fail
UPDATE _br_table_registry SET deferred_fk_columns = '{accounting_entry_id}'
WHERE table_name = 'sales' AND schema_name = 'public';

UPDATE _br_table_registry SET deferred_fk_columns = '{accounting_entry_id}'
WHERE table_name = 'supplier_orders' AND schema_name = 'public';

UPDATE _br_table_registry SET deferred_fk_columns = '{converted_sale_id}'
WHERE table_name = 'quotes' AND schema_name = 'public';

-- customer_payments(70).target_adjustment_id -> balance_adjustments(70) — same order
UPDATE _br_table_registry SET deferred_fk_columns = '{target_adjustment_id}'
WHERE table_name = 'customer_payments' AND schema_name = 'public';

-- supplier_payments(70).vault_movement_id -> vault_movements(65) — parent lower, inserts first — OK
-- cash_movements(70).vault_movement_id -> vault_movements(65) — parent lower, inserts first — OK

-- 4. Rewrite br_restore_backup to handle deferred_fk_columns
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
  v_all_deferred text[];
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

  -- INSERT in forward restore_order — first pass (self_ref + deferred FK columns NULLed)
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

      IF array_length(v_all_deferred, 1) > 0 THEN
        v_nulled_data := v_table_data;
        FOREACH v_col IN ARRAY v_all_deferred LOOP
          SELECT jsonb_agg(
            CASE WHEN elem ? v_col THEN elem || jsonb_build_object(v_col, null) ELSE elem END
          ) INTO v_nulled_data
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
    'restored_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION br_restore_backup(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION br_restore_backup(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION br_restore_backup(uuid) TO authenticated;

-- 5. Rewrite br_import_payload with same deferred FK handling
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
  v_col text;
  v_all_deferred text[];
  v_nulled_data jsonb;
  v_elem jsonb;
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

  FOR v_rec IN
    SELECT r.table_name, r.tenant_id_column
    FROM _br_table_registry r
    WHERE r.tenant_link = 'direct' AND (p_payload ? r.table_name)
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

  -- Delete in reverse order
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

  -- Insert in forward order — first pass with deferred columns NULLed
  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.self_ref_columns, r.deferred_fk_columns
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
      v_all_deferred := coalesce(v_rec.self_ref_columns, '{}') || coalesce(v_rec.deferred_fk_columns, '{}');

      IF array_length(v_all_deferred, 1) > 0 THEN
        v_nulled_data := v_table_data;
        FOREACH v_col IN ARRAY v_all_deferred LOOP
          SELECT jsonb_agg(CASE WHEN e ? v_col THEN e || jsonb_build_object(v_col, null) ELSE e END)
          INTO v_nulled_data FROM jsonb_array_elements(v_nulled_data) AS e;
        END LOOP;
        EXECUTE format('INSERT INTO %I.%I SELECT * FROM jsonb_populate_recordset(null::%I.%I, $1)',
          v_rec.schema_name, v_rec.table_name, v_rec.schema_name, v_rec.table_name) USING v_nulled_data;
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

  -- Second pass: restore deferred columns
  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.self_ref_columns, r.deferred_fk_columns
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
      AND (p_payload ? r.table_name)
      AND (
        (r.self_ref_columns IS NOT NULL AND array_length(r.self_ref_columns, 1) > 0)
        OR (r.deferred_fk_columns IS NOT NULL AND array_length(r.deferred_fk_columns, 1) > 0)
      )
  LOOP
    v_table_data := p_payload->v_rec.table_name;
    v_all_deferred := coalesce(v_rec.self_ref_columns, '{}') || coalesce(v_rec.deferred_fk_columns, '{}');

    FOR v_elem IN SELECT * FROM jsonb_array_elements(v_table_data) LOOP
      FOREACH v_col IN ARRAY v_all_deferred LOOP
        IF v_elem->>v_col IS NOT NULL THEN
          EXECUTE format('UPDATE %I.%I SET %I = ($1->>%L)::uuid WHERE id = ($1->>''id'')::uuid',
            v_rec.schema_name, v_rec.table_name, v_col, v_col) USING v_elem;
        END IF;
      END LOOP;
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
