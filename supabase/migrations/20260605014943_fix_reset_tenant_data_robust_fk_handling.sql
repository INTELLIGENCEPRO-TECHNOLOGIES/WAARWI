/*
  Fix reset_tenant_data: ensure FK NULLing covers ALL referencing tables
  and uses a more robust approach with explicit SET NULL before any deletes.
*/

CREATE OR REPLACE FUNCTION public.reset_tenant_data(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
  -- First: NULL out ALL accounting FK references to avoid FK violations
  -- Use explicit schema and handle case where columns might not exist
  BEGIN
    UPDATE public.sales SET accounting_entry_id = NULL
      WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    UPDATE public.sale_payments SET accounting_entry_id = NULL
      WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    UPDATE public.supplier_orders SET accounting_entry_id = NULL
      WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    UPDATE public.supplier_payments SET accounting_entry_id = NULL
      WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    UPDATE public.cash_movements SET accounting_entry_id = NULL
      WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  -- Also NULL any sale_id references in online_orders to avoid FK issues
  BEGIN
    UPDATE public.online_orders SET sale_id = NULL
      WHERE tenant_id = p_tenant_id AND sale_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  -- Delete data from each table in dependency order
  FOREACH v_table IN ARRAY v_tables
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING p_tenant_id;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  -- Also clean accounts table if it exists
  BEGIN
    DELETE FROM public.accounts WHERE tenant_id = p_tenant_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_tenant_data(uuid) TO authenticated;
