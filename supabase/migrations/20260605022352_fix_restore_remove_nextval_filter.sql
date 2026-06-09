-- Fix tenant_restore_backup: remove overly aggressive column_default filter
-- The filter was excluding columns that have any default (like uuid_generate_v4()),
-- which prevented data from being restored.

CREATE OR REPLACE FUNCTION public.tenant_restore_backup(p_backup_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_payload jsonb;
  v_insert_order text[] := ARRAY[
    'sites','accounts','payment_methods','part_categories',
    'vehicle_brands','vehicle_models','customers','suppliers',
    'articles','article_compatibilities','stock_levels','stock_lots','shop_settings',
    'cash_sessions',
    'journal_entries','journal_lines',
    'sales','sale_items','sale_payments','sale_returns','sale_return_items',
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

  -- Delete all existing tenant data
  FOREACH v_table IN ARRAY v_delete_order LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING v_tenant;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  -- Insert from backup
  FOREACH v_table IN ARRAY v_insert_order LOOP
    v_rows := v_payload->v_table;
    IF v_rows IS NULL OR jsonb_array_length(v_rows) = 0 THEN
      CONTINUE;
    END IF;
    BEGIN
      v_first := v_rows->0;
      -- Get columns present in BOTH the table schema AND the backup JSON
      -- Only exclude generated columns (not columns with defaults)
      SELECT array_agg(c.column_name::text) INTO v_present_keys
        FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = v_table
         AND c.is_generated = 'NEVER'
         AND c.column_name = ANY(ARRAY(SELECT jsonb_object_keys(v_first)));

      IF v_present_keys IS NULL OR array_length(v_present_keys, 1) = 0 THEN
        CONTINUE;
      END IF;

      v_cols := array_to_string(v_present_keys, ', ');
      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(NULL::public.%I, $1) ON CONFLICT DO NOTHING',
        v_table, v_cols, v_cols, v_table
      ) USING v_rows;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Restore skip %: %', v_table, SQLERRM;
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_restore_backup(uuid) TO authenticated;
