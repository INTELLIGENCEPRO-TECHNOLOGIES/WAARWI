/*
  # Fix tenant_reset_operations column names
  Use actual columns: customers.balance, suppliers.balance.
*/
CREATE OR REPLACE FUNCTION public.tenant_reset_operations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ops text[] := ARRAY[
    'journal_lines','journal_entries',
    'stock_movements',
    'cash_control_lines','cash_regularizations','cash_movements',
    'sale_payments','sale_return_items','sale_returns',
    'sale_items','sales',
    'quote_items','quotes',
    'supplier_payments','supplier_order_items','supplier_orders',
    'online_order_status_history','online_order_items','online_orders',
    'customer_prepayments',
    'notifications',
    'cash_sessions',
    'tenant_doc_counters'
  ];
  v_table text;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No current tenant';
  END IF;

  FOREACH v_table IN ARRAY v_ops LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING v_tenant;
  END LOOP;

  UPDATE public.stock_levels SET quantity = 0 WHERE tenant_id = v_tenant;
  UPDATE public.customers SET balance = 0 WHERE tenant_id = v_tenant;
  UPDATE public.suppliers SET balance = 0 WHERE tenant_id = v_tenant;
END;
$$;
