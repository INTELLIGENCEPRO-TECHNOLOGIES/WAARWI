/*
  # Fix tenant reset FK constraint on journal_entries

  The reset function fails because sales.accounting_entry_id references journal_entries.
  We must NULL these references before deleting data, AND handle the case where
  the reset_tenant_data function is called directly (not just restore).
*/

-- Ensure reset_tenant_data properly handles accounting FK refs
CREATE OR REPLACE FUNCTION reset_tenant_data(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'tenant_doc_counters','notifications','stock_movements','stock_lots','customer_prepayments',
    'cash_regularizations','cash_control_lines','cash_movements',
    'online_order_status_history','online_order_items','online_orders',
    'supplier_payments','supplier_order_items','supplier_orders',
    'quote_items','quotes',
    'sale_return_items','sale_returns','sale_payments','sale_items','sales',
    'journal_lines','journal_entries',
    'stock_levels','article_compatibilities','articles','part_categories',
    'vehicle_models','vehicle_brands',
    'customer_exception_prices','customers','suppliers',
    'cash_sessions','payment_methods','sites'
  ];
BEGIN
  -- First: NULL out all accounting FK references to avoid FK violations
  UPDATE sales SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;
  UPDATE sale_payments SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;
  UPDATE supplier_orders SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;
  UPDATE supplier_payments SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;
  UPDATE cash_movements SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;

  -- Delete data from each table
  FOREACH v_table IN ARRAY v_tables
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING p_tenant_id;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL; -- Skip tables that don't exist yet
    END;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION reset_tenant_data TO authenticated;
