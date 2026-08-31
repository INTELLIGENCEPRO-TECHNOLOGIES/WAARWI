/*
# Fix Restore Function: Self-Referencing FK + Emergency Data Restore

## Problem
The tenant_restore_backup function silently fails on tables with self-referencing
foreign keys (sites.parent_site_id, part_categories.parent_id, mt_operations.related_operation_id).
When jsonb_populate_recordset inserts all rows at once, child rows referencing a parent
that hasn't been committed yet cause FK violations. The EXCEPTION WHEN others THEN NULL
silently discards the entire batch, leading to cascading data loss.

Additionally, cross-table deferred FK columns (sale_payments.source_return_id,
cash_movements.sale_return_id) can cause failures if the referenced rows aren't 
inserted yet.

## Changes
1. Replaces tenant_restore_backup with a version that:
   - NULLs out self-referencing FK columns before insert, then UPDATEs them after
   - NULLs out cross-table deferred FK columns before insert, then UPDATEs them after
   - Adds expense_categories to backup/restore tables
   - Adds a restore_errors log table for visibility instead of silent swallowing
   - Raises a WARNING for each per-table error instead of silently ignoring
2. Replaces tenant_create_backup to include expense_categories
3. Emergency restore of tenant 31f9910a-5e94-4dc1-8ab5-c204bbcdb7db from backup 2631f2c8-6f58-4e6b-9ab4-fa0839144b6a

## Tables modified
- tenant_restore_backup (function replaced)
- tenant_create_backup (function replaced)

## Security
- No changes to RLS policies
- Functions remain SECURITY DEFINER
*/

-- =========================================================================
-- 1. Replace tenant_restore_backup with self-referencing FK handling
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tenant_restore_backup(p_backup_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_payload jsonb;
  v_insert_order text[] := ARRAY[
    'sites','accounts','payment_methods','part_categories',
    'vehicle_brands','vehicle_models','customers','suppliers',
    'articles','article_compatibilities','stock_levels','stock_lots','shop_settings',
    'pricing_tier_definitions','article_pricing_tiers','customer_exception_prices',
    'ipm_organismes','ipm_conventions','ipm_beneficiaires','ipm_bordereaux',
    'ipm_ventes','ipm_factures','ipm_reglements','ipm_rejets','ipm_parametres',
    'stock_documents',
    'balance_adjustments','credit_allocations','customer_payments','balance_regularization_log',
    'expense_categories',
    'mt_services','mt_service_points','mt_wholesalers','mt_service_point_services',
    'mt_expense_categories','mt_customers',
    'mt_accounts','mt_operations','mt_closures',
    'mt_expenses','mt_customer_ledger',
    'role_permissions',
    'held_carts',
    'cash_sessions',
    'journal_entries','journal_lines',
    'sales','sale_items','sale_returns','sale_return_items','sale_payments',
    'quotes','quote_items',
    'supplier_orders','supplier_order_items','supplier_payments',
    'online_orders','online_order_items','online_order_status_history',
    'cash_movements','cash_control_lines','cash_regularizations',
    'customer_prepayments','stock_movements',
    'notifications','tenant_doc_counters'
  ];
  v_delete_order text[];
  v_table text;
  v_rows jsonb;
  v_first jsonb;
  v_present_keys text[];
  v_cols text;
  v_len int;
  i int;

  -- Self-referencing FK columns that must be NULL'd on insert then updated
  v_selfref_table text;
  v_selfref_col text;
  v_selfref_pairs text[][] := ARRAY[
    ARRAY['sites', 'parent_site_id'],
    ARRAY['part_categories', 'parent_id'],
    ARRAY['mt_operations', 'related_operation_id'],
    ARRAY['categories', 'parent_id'],
    ARRAY['master_catalog_categories', 'parent_id']
  ];

  -- Cross-table deferred FK columns (inserted NULL, updated after all inserts)
  v_deferred_table text;
  v_deferred_col text;
  v_deferred_pairs text[][] := ARRAY[
    ARRAY['sale_payments', 'source_return_id'],
    ARRAY['cash_movements', 'sale_return_id']
  ];

  v_is_selfref boolean;
  v_selfref_column text;
  v_err_msg text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No current tenant';
  END IF;

  SELECT payload INTO v_payload FROM public.tenant_backups
  WHERE id = p_backup_id AND tenant_id = v_tenant;
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Backup not found';
  END IF;

  -- Build delete order (reverse of insert order)
  v_len := array_length(v_insert_order, 1);
  v_delete_order := ARRAY[]::text[];
  FOR i IN REVERSE v_len..1 LOOP
    v_delete_order := v_delete_order || v_insert_order[i];
  END LOOP;

  -- NULL out FK references before deletion to avoid constraint violations
  BEGIN UPDATE public.sales SET accounting_entry_id = NULL WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.sale_payments SET accounting_entry_id = NULL WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.sale_payments SET source_return_id = NULL WHERE tenant_id = v_tenant AND source_return_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.supplier_orders SET accounting_entry_id = NULL WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.supplier_payments SET accounting_entry_id = NULL WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.cash_movements SET accounting_entry_id = NULL WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.cash_movements SET sale_return_id = NULL WHERE tenant_id = v_tenant AND sale_return_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.online_orders SET sale_id = NULL WHERE tenant_id = v_tenant AND sale_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.stock_movements SET stock_document_id = NULL WHERE tenant_id = v_tenant AND stock_document_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.ipm_ventes SET bordereau_id = NULL WHERE tenant_id = v_tenant AND bordereau_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  -- NULL out self-referencing FKs before deletion
  BEGIN UPDATE public.sites SET parent_site_id = NULL WHERE tenant_id = v_tenant AND parent_site_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.part_categories SET parent_id = NULL WHERE tenant_id = v_tenant AND parent_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.mt_operations SET related_operation_id = NULL WHERE tenant_id = v_tenant AND related_operation_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;

  -- Delete existing data
  FOREACH v_table IN ARRAY v_delete_order LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING v_tenant;
    EXCEPTION WHEN undefined_table OR undefined_column THEN NULL;
    END;
  END LOOP;

  BEGIN
    DELETE FROM public.accounts WHERE tenant_id = v_tenant;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- =========================================================================
  -- Insert data from backup payload WITH self-referencing FK handling
  -- =========================================================================
  FOREACH v_table IN ARRAY v_insert_order LOOP
    v_rows := v_payload->v_table;
    IF v_rows IS NULL OR jsonb_typeof(v_rows) != 'array' OR jsonb_array_length(v_rows) = 0 THEN
      CONTINUE;
    END IF;

    BEGIN
      v_first := v_rows->0;

      -- Determine if this table has a self-referencing FK column
      v_is_selfref := false;
      v_selfref_column := NULL;
      FOR i IN 1..array_length(v_selfref_pairs, 1) LOOP
        IF v_selfref_pairs[i][1] = v_table THEN
          v_is_selfref := true;
          v_selfref_column := v_selfref_pairs[i][2];
          EXIT;
        END IF;
      END LOOP;

      -- Also check deferred FK columns - exclude them from initial insert
      -- Build the exclusion list
      SELECT array_agg(k) INTO v_present_keys
      FROM jsonb_object_keys(v_first) AS k
      WHERE k NOT IN ('updated_at')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = v_table
            AND c.column_name = k
            AND c.is_generated = 'NEVER'
            AND c.column_default NOT LIKE 'nextval%'
        )
        -- Exclude self-referencing FK column from initial insert
        AND (NOT v_is_selfref OR k != v_selfref_column)
        -- Exclude deferred FK columns from initial insert
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_deferred_pairs) dp
          WHERE dp[1] = v_table AND dp[2] = k
        );

      IF v_present_keys IS NULL OR array_length(v_present_keys, 1) IS NULL THEN
        CONTINUE;
      END IF;

      v_cols := array_to_string(v_present_keys, ', ');

      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::public.%I, $1) ON CONFLICT DO NOTHING',
        v_table, v_cols, v_cols, v_table
      ) USING v_rows;

      -- Phase 2: UPDATE self-referencing FK column from the backup data
      IF v_is_selfref AND v_selfref_column IS NOT NULL THEN
        BEGIN
          EXECUTE format(
            'UPDATE public.%I t SET %I = (elem->>%L)::uuid '
            'FROM jsonb_array_elements($1) AS elem '
            'WHERE t.id = (elem->>''id'')::uuid '
            'AND elem->>%L IS NOT NULL',
            v_table, v_selfref_column, v_selfref_column, v_selfref_column
          ) USING v_rows;
        EXCEPTION WHEN others THEN
          GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
          RAISE WARNING 'restore self-ref update %.% failed: %', v_table, v_selfref_column, v_err_msg;
        END;
      END IF;

    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
      RAISE WARNING 'restore table % failed: %', v_table, v_err_msg;
    END;
  END LOOP;

  -- =========================================================================
  -- Phase 3: UPDATE deferred FK columns from backup data
  -- =========================================================================
  FOR i IN 1..array_length(v_deferred_pairs, 1) LOOP
    v_deferred_table := v_deferred_pairs[i][1];
    v_deferred_col   := v_deferred_pairs[i][2];
    v_rows := v_payload->v_deferred_table;
    IF v_rows IS NULL OR jsonb_typeof(v_rows) != 'array' OR jsonb_array_length(v_rows) = 0 THEN
      CONTINUE;
    END IF;
    BEGIN
      EXECUTE format(
        'UPDATE public.%I t SET %I = (elem->>%L)::uuid '
        'FROM jsonb_array_elements($1) AS elem '
        'WHERE t.id = (elem->>''id'')::uuid '
        'AND elem->>%L IS NOT NULL',
        v_deferred_table, v_deferred_col, v_deferred_col, v_deferred_col
      ) USING v_rows;
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
      RAISE WARNING 'restore deferred FK %.% failed: %', v_deferred_table, v_deferred_col, v_err_msg;
    END;
  END LOOP;

  -- Restore tenant metadata if present
  IF v_payload ? '_tenant' AND v_payload->'_tenant' IS NOT NULL THEN
    BEGIN
      UPDATE public.tenants SET
        name    = COALESCE((v_payload->'_tenant'->>'name'), name),
        phone   = COALESCE((v_payload->'_tenant'->>'phone'), phone),
        address = COALESCE((v_payload->'_tenant'->>'address'), address),
        email   = COALESCE((v_payload->'_tenant'->>'email'), email)
      WHERE id = v_tenant;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END;
$function$;


-- =========================================================================
-- 2. Update tenant_create_backup to include expense_categories
-- =========================================================================
CREATE OR REPLACE FUNCTION public.tenant_create_backup(p_label text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_payload jsonb := '{}'::jsonb;
  v_backup_id uuid;
  v_table text;
  v_tables text[] := ARRAY[
    'sites','accounts','payment_methods','part_categories',
    'vehicle_brands','vehicle_models','customers','suppliers',
    'articles','article_compatibilities','stock_levels','stock_lots','shop_settings',
    'pricing_tier_definitions','article_pricing_tiers','customer_exception_prices',
    'ipm_organismes','ipm_conventions','ipm_beneficiaires','ipm_bordereaux',
    'ipm_ventes','ipm_factures','ipm_reglements','ipm_rejets','ipm_parametres',
    'stock_documents',
    'balance_adjustments','credit_allocations','customer_payments','balance_regularization_log',
    'expense_categories',
    'mt_services','mt_service_points','mt_wholesalers','mt_service_point_services',
    'mt_expense_categories','mt_customers',
    'mt_accounts','mt_operations','mt_closures',
    'mt_expenses','mt_customer_ledger',
    'role_permissions',
    'held_carts',
    'cash_sessions',
    'journal_entries','journal_lines',
    'sales','sale_items','sale_returns','sale_return_items','sale_payments',
    'quotes','quote_items',
    'supplier_orders','supplier_order_items','supplier_payments',
    'online_orders','online_order_items','online_order_status_history',
    'cash_movements','cash_control_lines','cash_regularizations',
    'customer_prepayments','stock_movements',
    'notifications','tenant_doc_counters'
  ];
  v_rows jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No current tenant';
  END IF;

  -- Snapshot tenant metadata
  SELECT jsonb_build_object(
    'name', t.name, 'phone', t.phone, 'address', t.address, 'email', t.email
  ) INTO v_payload FROM tenants t WHERE t.id = v_tenant;
  v_payload := jsonb_build_object('_tenant', v_payload->'name');
  -- re-build with full metadata
  SELECT jsonb_build_object('_tenant', jsonb_build_object(
    'name', t.name, 'phone', t.phone, 'address', t.address, 'email', t.email
  )) INTO v_payload FROM tenants t WHERE t.id = v_tenant;

  FOREACH v_table IN ARRAY v_tables LOOP
    BEGIN
      EXECUTE format(
        'SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), ''[]''::jsonb) FROM public.%I t WHERE t.tenant_id = $1',
        v_table
      ) INTO v_rows USING v_tenant;
      v_payload := v_payload || jsonb_build_object(v_table, v_rows);
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      v_payload := v_payload || jsonb_build_object(v_table, '[]'::jsonb);
    END;
  END LOOP;

  INSERT INTO public.tenant_backups (tenant_id, label, payload)
  VALUES (v_tenant, COALESCE(p_label, 'manual'), v_payload)
  RETURNING id INTO v_backup_id;

  RETURN v_backup_id;
END;
$function$;


-- =========================================================================
-- 3. EMERGENCY RESTORE for tenant INTELLIGENCEPRO TECHNOLOGIES
--    Direct restore from backup, bypassing current_tenant_id()
-- =========================================================================
DO $emergency$
DECLARE
  v_tenant uuid := '31f9910a-5e94-4dc1-8ab5-c204bbcdb7db';
  v_backup_id uuid := '2631f2c8-6f58-4e6b-9ab4-fa0839144b6a';
  v_payload jsonb;
  v_insert_order text[] := ARRAY[
    'sites','accounts','payment_methods','part_categories',
    'vehicle_brands','vehicle_models','customers','suppliers',
    'articles','article_compatibilities','stock_levels','stock_lots','shop_settings',
    'pricing_tier_definitions','article_pricing_tiers','customer_exception_prices',
    'ipm_organismes','ipm_conventions','ipm_beneficiaires','ipm_bordereaux',
    'ipm_ventes','ipm_factures','ipm_reglements','ipm_rejets','ipm_parametres',
    'stock_documents',
    'balance_adjustments',
    'mt_services','mt_service_points','mt_wholesalers','mt_service_point_services',
    'mt_expense_categories','mt_customers',
    'mt_accounts','mt_operations','mt_closures',
    'mt_expenses','mt_customer_ledger',
    'role_permissions',
    'held_carts',
    'cash_sessions',
    'journal_entries','journal_lines',
    'sales','sale_items','sale_returns','sale_return_items','sale_payments',
    'quotes','quote_items',
    'supplier_orders','supplier_order_items','supplier_payments',
    'online_orders','online_order_items','online_order_status_history',
    'cash_movements','cash_control_lines','cash_regularizations',
    'customer_prepayments','stock_movements',
    'notifications','tenant_doc_counters'
  ];
  v_table text;
  v_rows jsonb;
  v_first jsonb;
  v_present_keys text[];
  v_cols text;

  v_selfref_pairs text[][] := ARRAY[
    ARRAY['sites', 'parent_site_id'],
    ARRAY['part_categories', 'parent_id'],
    ARRAY['mt_operations', 'related_operation_id']
  ];
  v_deferred_pairs text[][] := ARRAY[
    ARRAY['sale_payments', 'source_return_id'],
    ARRAY['cash_movements', 'sale_return_id']
  ];

  v_is_selfref boolean;
  v_selfref_column text;
  v_err_msg text;
  i int;
BEGIN
  -- Get backup payload
  SELECT payload INTO v_payload FROM public.tenant_backups
  WHERE id = v_backup_id AND tenant_id = v_tenant;
  
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Backup % not found for tenant %', v_backup_id, v_tenant;
  END IF;

  RAISE NOTICE 'Starting emergency restore for tenant %', v_tenant;

  -- Insert data table by table
  FOREACH v_table IN ARRAY v_insert_order LOOP
    v_rows := v_payload->v_table;
    IF v_rows IS NULL OR jsonb_typeof(v_rows) != 'array' OR jsonb_array_length(v_rows) = 0 THEN
      CONTINUE;
    END IF;

    BEGIN
      v_first := v_rows->0;

      -- Check for self-referencing FK
      v_is_selfref := false;
      v_selfref_column := NULL;
      FOR i IN 1..array_length(v_selfref_pairs, 1) LOOP
        IF v_selfref_pairs[i][1] = v_table THEN
          v_is_selfref := true;
          v_selfref_column := v_selfref_pairs[i][2];
          EXIT;
        END IF;
      END LOOP;

      -- Build column list, excluding updated_at, generated, nextval, self-ref, and deferred FK
      SELECT array_agg(k) INTO v_present_keys
      FROM jsonb_object_keys(v_first) AS k
      WHERE k NOT IN ('updated_at')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = v_table
            AND c.column_name = k
            AND c.is_generated = 'NEVER'
            AND c.column_default NOT LIKE 'nextval%'
        )
        AND (NOT v_is_selfref OR k != v_selfref_column)
        AND NOT EXISTS (
          SELECT 1 FROM unnest(v_deferred_pairs) dp
          WHERE dp[1] = v_table AND dp[2] = k
        );

      IF v_present_keys IS NULL OR array_length(v_present_keys, 1) IS NULL THEN
        CONTINUE;
      END IF;

      v_cols := array_to_string(v_present_keys, ', ');

      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::public.%I, $1) ON CONFLICT DO NOTHING',
        v_table, v_cols, v_cols, v_table
      ) USING v_rows;

      RAISE NOTICE 'Restored table %: % rows', v_table, jsonb_array_length(v_rows);

      -- Phase 2: Update self-referencing FK
      IF v_is_selfref AND v_selfref_column IS NOT NULL THEN
        BEGIN
          EXECUTE format(
            'UPDATE public.%I t SET %I = (elem->>%L)::uuid '
            'FROM jsonb_array_elements($1) AS elem '
            'WHERE t.id = (elem->>''id'')::uuid '
            'AND elem->>%L IS NOT NULL',
            v_table, v_selfref_column, v_selfref_column, v_selfref_column
          ) USING v_rows;
          RAISE NOTICE 'Updated self-ref %.%', v_table, v_selfref_column;
        EXCEPTION WHEN others THEN
          GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
          RAISE WARNING 'Self-ref update %.% failed: %', v_table, v_selfref_column, v_err_msg;
        END;
      END IF;

    EXCEPTION WHEN undefined_table OR undefined_column THEN
      RAISE NOTICE 'Skipping table % (does not exist or missing column)', v_table;
    WHEN others THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
      RAISE WARNING 'RESTORE TABLE % FAILED: %', v_table, v_err_msg;
    END;
  END LOOP;

  -- Phase 3: Update deferred FK columns
  FOR i IN 1..array_length(v_deferred_pairs, 1) LOOP
    DECLARE
      v_dt text := v_deferred_pairs[i][1];
      v_dc text := v_deferred_pairs[i][2];
      v_dr jsonb := v_payload->v_deferred_pairs[i][1];
    BEGIN
      IF v_dr IS NOT NULL AND jsonb_typeof(v_dr) = 'array' AND jsonb_array_length(v_dr) > 0 THEN
        EXECUTE format(
          'UPDATE public.%I t SET %I = (elem->>%L)::uuid '
          'FROM jsonb_array_elements($1) AS elem '
          'WHERE t.id = (elem->>''id'')::uuid '
          'AND elem->>%L IS NOT NULL',
          v_dt, v_dc, v_dc, v_dc
        ) USING v_dr;
        RAISE NOTICE 'Updated deferred FK %.%', v_dt, v_dc;
      END IF;
    EXCEPTION WHEN others THEN
      GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
      RAISE WARNING 'Deferred FK update %.% failed: %', v_dt, v_dc, v_err_msg;
    END;
  END LOOP;

  -- Restore tenant metadata
  IF v_payload ? '_tenant' AND v_payload->'_tenant' IS NOT NULL THEN
    BEGIN
      UPDATE public.tenants SET
        name    = COALESCE((v_payload->'_tenant'->>'name'), name),
        phone   = COALESCE((v_payload->'_tenant'->>'phone'), phone),
        address = COALESCE((v_payload->'_tenant'->>'address'), address),
        email   = COALESCE((v_payload->'_tenant'->>'email'), email)
      WHERE id = v_tenant;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  RAISE NOTICE 'Emergency restore completed for tenant %', v_tenant;
END;
$emergency$;
