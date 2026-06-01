/*
  # Fix restore insert order: journal_entries must be inserted before sales

  1. Problem
    - `sales.accounting_entry_id` references `journal_entries.id`
    - But in the insert order, `sales` was inserted BEFORE `journal_entries`
    - When the backup contains accounted sales, the FK check fails on INSERT

  2. Fix
    - Move `journal_entries` and `journal_lines` to be inserted BEFORE `sales`
    - This ensures the referenced entries exist when sales are restored
    - Delete order is automatically reversed so journal_lines/entries are deleted first
*/

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
    'articles','article_compatibilities','stock_levels','shop_settings',
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
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No current tenant';
  END IF;

  SELECT payload INTO v_payload FROM public.tenant_backups
    WHERE id = p_backup_id AND tenant_id = v_tenant;
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Backup not found';
  END IF;

  -- Clear FK references to journal_entries BEFORE deleting
  UPDATE public.sales SET accounting_entry_id = NULL, accounting_status = 'not_accounted'
    WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;
  UPDATE public.sale_payments SET accounting_entry_id = NULL, accounting_status = 'not_accounted'
    WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;
  UPDATE public.supplier_orders SET accounting_entry_id = NULL, accounting_status = 'not_accounted'
    WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;
  UPDATE public.supplier_payments SET accounting_entry_id = NULL, accounting_status = 'not_accounted'
    WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;
  UPDATE public.cash_movements SET accounting_entry_id = NULL
    WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;

  SELECT array_agg(t ORDER BY idx DESC)
    INTO v_delete_order
  FROM unnest(v_insert_order) WITH ORDINALITY AS a(t, idx);

  FOREACH v_table IN ARRAY v_delete_order LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING v_tenant;
  END LOOP;

  FOREACH v_table IN ARRAY v_insert_order LOOP
    v_rows := v_payload -> v_table;
    IF v_rows IS NULL OR jsonb_array_length(v_rows) = 0 THEN
      CONTINUE;
    END IF;

    v_first := v_rows -> 0;
    SELECT COALESCE(array_agg(k), ARRAY[]::text[])
      INTO v_present_keys
      FROM jsonb_object_keys(v_first) AS k;

    SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
      INTO v_cols
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = v_table
       AND is_generated = 'NEVER'
       AND NOT (
         column_name <> ALL (v_present_keys)
         AND column_default IS NOT NULL
       );

    IF v_cols IS NULL THEN CONTINUE; END IF;

    EXECUTE format(
      'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::public.%I, $1)',
      v_table, v_cols, v_cols, v_table
    ) USING v_rows;
  END LOOP;

  PERFORM public._apply_tenant_metadata(v_tenant, v_payload -> '_tenant');
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_restore_backup(uuid) TO authenticated;
