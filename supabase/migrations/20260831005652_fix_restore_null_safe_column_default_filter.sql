/*
# Fix tenant_restore_backup: NULL-safe column_default filter

## Root Cause
The column filter `c.column_default NOT LIKE 'nextval%'` silently excludes ALL columns
where column_default IS NULL because in SQL, `NULL NOT LIKE 'anything'` evaluates to NULL
(not TRUE), which is treated as FALSE in a WHERE clause.

This means critical columns like tenant_id, name, email, phone (any column without a 
default value) were excluded from the INSERT statement. The restore attempted to insert
rows without tenant_id or name, which fails on NOT NULL constraints. The exception handler
caught the error silently, resulting in 0 rows inserted for every table.

## Fix Applied
Changed `AND c.column_default NOT LIKE 'nextval%'` to 
`AND (c.column_default IS NULL OR c.column_default NOT LIKE 'nextval%')` 
in the column-filtering logic.

This fix is applied to tenant_restore_backup. The same bug existed in all previous
versions of this function since its creation.

## Impact
- sites: was inserting 7/17 columns -> now 17/17
- customers: was inserting 12/16 columns -> now 16/16  
- articles: was inserting 26/35 columns -> now 35/35
- sales: was inserting 12/23 columns -> now 23/23
*/

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

  v_selfref_table text;
  v_selfref_col text;
  v_selfref_pairs text[][] := ARRAY[
    ARRAY['sites', 'parent_site_id'],
    ARRAY['part_categories', 'parent_id'],
    ARRAY['mt_operations', 'related_operation_id'],
    ARRAY['categories', 'parent_id'],
    ARRAY['master_catalog_categories', 'parent_id']
  ];

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

  v_len := array_length(v_insert_order, 1);
  v_delete_order := ARRAY[]::text[];
  FOR i IN REVERSE v_len..1 LOOP
    v_delete_order := v_delete_order || v_insert_order[i];
  END LOOP;

  -- NULL out FK references before deletion
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

  BEGIN DELETE FROM public.accounts WHERE tenant_id = v_tenant; EXCEPTION WHEN undefined_table THEN NULL; END;

  -- Insert data from backup payload
  FOREACH v_table IN ARRAY v_insert_order LOOP
    v_rows := v_payload->v_table;
    IF v_rows IS NULL OR jsonb_typeof(v_rows) != 'array' OR jsonb_array_length(v_rows) = 0 THEN
      CONTINUE;
    END IF;

    BEGIN
      v_first := v_rows->0;

      v_is_selfref := false;
      v_selfref_column := NULL;
      FOR i IN 1..array_length(v_selfref_pairs, 1) LOOP
        IF v_selfref_pairs[i][1] = v_table THEN
          v_is_selfref := true;
          v_selfref_column := v_selfref_pairs[i][2];
          EXIT;
        END IF;
      END LOOP;

      -- FIX: Added (c.column_default IS NULL OR ...) to handle NULL defaults correctly
      SELECT array_agg(k) INTO v_present_keys
      FROM jsonb_object_keys(v_first) AS k
      WHERE k NOT IN ('updated_at')
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = v_table
            AND c.column_name = k
            AND c.is_generated = 'NEVER'
            AND (c.column_default IS NULL OR c.column_default NOT LIKE 'nextval%')
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

  -- Phase 3: Update deferred FK columns
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
END;
$function$;
