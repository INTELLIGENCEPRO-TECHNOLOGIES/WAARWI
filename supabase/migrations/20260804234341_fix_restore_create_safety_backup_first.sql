-- Make tenant_restore_backup create a safety backup BEFORE deleting anything.
-- This prevents data loss if a restore is triggered from an empty/invalid backup.
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
    'sales','sale_items','sale_payments','sale_returns','sale_return_items',
    'quotes','quote_items',
    'supplier_orders','supplier_order_items','supplier_payments',
    'online_orders','online_order_items','online_order_status_history',
    'cash_movements','cash_control_lines','cash_regularizations',
    'customer_prepayments','stock_movements',
    'journal_entries','journal_lines',
    'notifications','tenant_doc_counters'
  ];
  v_delete_order text[];
  v_table text;
  v_rows jsonb;
  v_safety_label text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No current tenant';
  END IF;

  SELECT payload INTO v_payload FROM public.tenant_backups
    WHERE id = p_backup_id AND tenant_id = v_tenant;
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Backup not found';
  END IF;

  -- Create a safety backup of the CURRENT state before any deletion
  v_safety_label := 'Avant restauration ' || to_char(now(), 'YYYY-MM-DD HH24:MI:SS');
  PERFORM public.tenant_create_backup(v_safety_label, true);

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
    EXECUTE format(
      'INSERT INTO public.%I SELECT * FROM jsonb_populate_recordset(null::public.%I, $1)',
      v_table, v_table
    ) USING v_rows;
  END LOOP;

  -- Apply safe tenant metadata from the snapshot
  PERFORM public._apply_tenant_metadata(v_tenant, v_payload -> '_tenant');
END;
$$;
