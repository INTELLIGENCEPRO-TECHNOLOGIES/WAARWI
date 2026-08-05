/*
# Fix restore/backup/reset to include mt_expenses, mt_expense_categories, mt_customers, mt_customer_ledger

## Problem
The tables `mt_expenses`, `mt_expense_categories`, `mt_customers`, and `mt_customer_ledger`
were created in migration 20260709021934 but were never added to the four tenant lifecycle
functions: `reset_tenant_data`, `tenant_reset_operations`, `tenant_create_backup`, and
`tenant_restore_backup`.

This caused a foreign key violation when restoring a backup: the restore function deletes
`mt_service_points` (parent) before `mt_expenses` (child with `ON DELETE RESTRICT` FK to
`mt_service_points`), so the delete fails with:
  "update or delete on table mt_service_points violates foreign key constraint
   mt_expenses_service_point_id_fkey on table mt_expenses"

## Fix
Add the four new tables to all four functions in the correct dependency order:

1. **reset_tenant_data**: children first in the delete array:
   - `mt_customer_ledger`, `mt_expenses`, `mt_expense_categories`, `mt_customers`
   - inserted BEFORE `mt_service_points` / `mt_service_point_services` so they are deleted first.

2. **tenant_reset_operations**: `mt_expenses` and `mt_customer_ledger` are operational data
   that should be wiped. `mt_expense_categories` and `mt_customers` are configuration and kept.
   - Add `mt_customer_ledger` and `mt_expenses` to the ops delete array.

3. **tenant_create_backup**: add all four tables to the backup payload array so they are
   included in backups.

4. **tenant_restore_backup**: add all four tables to `v_insert_order` in the correct
   parent-before-child order so the reverse delete order removes children first.
   - Insert order: `mt_expense_categories` → `mt_customers` → `mt_expenses` → `mt_customer_ledger`
   - These go after `mt_service_points` (parent of mt_expenses.service_point_id) and after
     `mt_operations` (parent of mt_customer_ledger.operation_id) and after `mt_customers`
     (parent of mt_customer_ledger.customer_id).

## Security
No new tables or policies — only function definitions are updated. All existing RLS policies
on the four tables remain unchanged.
*/

-- ============================================================
-- 1) reset_tenant_data — add new MT child tables before mt_service_points
-- ============================================================
CREATE OR REPLACE FUNCTION public.reset_tenant_data(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    -- Money Transfer (children first)
    'mt_customer_ledger','mt_expenses','mt_expense_categories','mt_customers',
    'mt_closures','mt_operations','mt_accounts','mt_service_point_services','mt_wholesalers','mt_service_points','mt_services',
    -- Balance adjustments (must delete before customers/suppliers)
    'balance_adjustments',
    -- IPM (children first)
    'ipm_rejets','ipm_reglements','ipm_factures','ipm_ventes','ipm_bordereaux',
    'ipm_beneficiaires','ipm_conventions','ipm_organismes','ipm_parametres',
    -- Pricing tiers
    'article_pricing_tiers','pricing_tier_definitions',
    -- Stock documents
    'stock_documents',
    -- Existing tables
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
  -- NULL out FK references to avoid FK violations
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

  BEGIN
    UPDATE public.online_orders SET sale_id = NULL
      WHERE tenant_id = p_tenant_id AND sale_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    UPDATE public.stock_movements SET stock_document_id = NULL
      WHERE tenant_id = p_tenant_id AND stock_document_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    UPDATE public.ipm_ventes SET bordereau_id = NULL
      WHERE tenant_id = p_tenant_id AND bordereau_id IS NOT NULL;
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


-- ============================================================
-- 2) tenant_reset_operations — add mt_expenses + mt_customer_ledger to ops wipe
-- ============================================================
CREATE OR REPLACE FUNCTION public.tenant_reset_operations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ops text[] := ARRAY[
    -- Money Transfer operational data (keep services/points config, categories, customers)
    'mt_customer_ledger','mt_expenses',
    'mt_closures','mt_operations',
    -- Balance adjustments
    'balance_adjustments',
    -- IPM operational data (keep organismes, conventions, beneficiaires, parametres)
    'ipm_rejets','ipm_reglements','ipm_factures','ipm_ventes','ipm_bordereaux',
    -- Stock documents
    'stock_documents',
    -- Existing operational tables
    'journal_lines','journal_entries',
    'stock_movements','stock_lots',
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

  -- NULL out FK before delete
  BEGIN
    UPDATE public.stock_movements SET stock_document_id = NULL
      WHERE tenant_id = v_tenant AND stock_document_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.ipm_ventes SET bordereau_id = NULL
      WHERE tenant_id = v_tenant AND bordereau_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  FOREACH v_table IN ARRAY v_ops LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING v_tenant;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  -- Zero-out stock levels but keep the rows
  UPDATE public.stock_levels SET quantity = 0 WHERE tenant_id = v_tenant;

  -- Reset MT account balances to 0 but keep accounts structure
  BEGIN
    UPDATE public.mt_accounts SET balance = 0, updated_at = now() WHERE tenant_id = v_tenant;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Reset customer and supplier balances to 0
  BEGIN
    UPDATE public.customers SET balance = 0 WHERE tenant_id = v_tenant;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    UPDATE public.customers SET credit_balance = 0 WHERE tenant_id = v_tenant;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    UPDATE public.suppliers SET balance = 0 WHERE tenant_id = v_tenant;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  BEGIN
    UPDATE public.suppliers SET total_owed = 0 WHERE tenant_id = v_tenant;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_reset_operations() TO authenticated;


-- ============================================================
-- 3) tenant_create_backup — add the four new tables to backup payload
-- ============================================================
CREATE OR REPLACE FUNCTION public.tenant_create_backup(
  p_label text DEFAULT '',
  p_auto boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_payload jsonb := '{}'::jsonb;
  v_tables text[] := ARRAY[
    -- structural
    'sites','accounts','payment_methods','part_categories',
    'vehicle_brands','vehicle_models','articles','article_compatibilities',
    'customers','suppliers','stock_levels','stock_lots','shop_settings',
    -- pricing
    'pricing_tier_definitions','article_pricing_tiers','customer_exception_prices',
    -- IPM
    'ipm_organismes','ipm_conventions','ipm_beneficiaires','ipm_bordereaux',
    'ipm_ventes','ipm_factures','ipm_reglements','ipm_rejets','ipm_parametres',
    -- stock documents
    'stock_documents',
    -- balance adjustments
    'balance_adjustments',
    -- Money Transfer (config + operational)
    'mt_services','mt_service_points','mt_wholesalers','mt_service_point_services',
    'mt_expense_categories','mt_customers',
    'mt_accounts','mt_operations','mt_closures',
    'mt_expenses','mt_customer_ledger',
    -- operational
    'sales','sale_items','sale_payments','sale_returns','sale_return_items',
    'quotes','quote_items',
    'supplier_orders','supplier_order_items','supplier_payments',
    'online_orders','online_order_items','online_order_status_history',
    'cash_sessions','cash_movements','cash_control_lines','cash_regularizations',
    'customer_prepayments','stock_movements',
    'journal_entries','journal_lines',
    'notifications','tenant_doc_counters'
  ];
  v_table text;
  v_rows jsonb;
  v_backup_id uuid;
  v_tenant_row jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No current tenant';
  END IF;

  SELECT to_jsonb(t.*) INTO v_tenant_row FROM public.tenants t WHERE id = v_tenant;
  v_payload := jsonb_set(v_payload, '{_tenant}', COALESCE(v_tenant_row, 'null'::jsonb));

  FOREACH v_table IN ARRAY v_tables LOOP
    BEGIN
      EXECUTE format(
        'SELECT COALESCE(jsonb_agg(to_jsonb(r.*)), ''[]''::jsonb) FROM public.%I r WHERE r.tenant_id = $1',
        v_table
      ) INTO v_rows USING v_tenant;
      v_payload := jsonb_set(v_payload, ARRAY[v_table], COALESCE(v_rows, '[]'::jsonb));
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  INSERT INTO public.tenant_backups (
    tenant_id, created_by, label, kind, is_auto, size_bytes, payload
  ) VALUES (
    v_tenant,
    auth.uid(),
    COALESCE(NULLIF(p_label, ''), to_char(now(), 'YYYY-MM-DD HH24:MI')),
    CASE WHEN p_auto THEN 'auto' ELSE 'manual' END,
    p_auto,
    octet_length(v_payload::text),
    v_payload
  ) RETURNING id INTO v_backup_id;

  RETURN v_backup_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_create_backup(text, boolean) TO authenticated;


-- ============================================================
-- 4) tenant_restore_backup — add the four new tables to insert/delete order
-- ============================================================
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
    -- pricing
    'pricing_tier_definitions','article_pricing_tiers','customer_exception_prices',
    -- IPM (parent first)
    'ipm_organismes','ipm_conventions','ipm_beneficiaires','ipm_bordereaux',
    'ipm_ventes','ipm_factures','ipm_reglements','ipm_rejets','ipm_parametres',
    -- stock documents
    'stock_documents',
    -- balance adjustments
    'balance_adjustments',
    -- Money Transfer (parents first)
    'mt_services','mt_service_points','mt_wholesalers','mt_service_point_services',
    'mt_expense_categories','mt_customers',
    'mt_accounts','mt_operations','mt_closures',
    'mt_expenses','mt_customer_ledger',
    -- operational
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

  -- NULL out FK references before deletion
  BEGIN
    UPDATE public.sales SET accounting_entry_id = NULL
      WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.sale_payments SET accounting_entry_id = NULL
      WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.supplier_orders SET accounting_entry_id = NULL
      WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.supplier_payments SET accounting_entry_id = NULL
      WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.cash_movements SET accounting_entry_id = NULL
      WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.online_orders SET sale_id = NULL
      WHERE tenant_id = v_tenant AND sale_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.stock_movements SET stock_document_id = NULL
      WHERE tenant_id = v_tenant AND stock_document_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.ipm_ventes SET bordereau_id = NULL
      WHERE tenant_id = v_tenant AND bordereau_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;

  -- Delete existing data
  FOREACH v_table IN ARRAY v_delete_order LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING v_tenant;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  BEGIN
    DELETE FROM public.accounts WHERE tenant_id = v_tenant;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  -- Insert data from backup payload
  FOREACH v_table IN ARRAY v_insert_order LOOP
    v_rows := v_payload->v_table;
    IF v_rows IS NULL OR jsonb_array_length(v_rows) = 0 THEN
      CONTINUE;
    END IF;

    BEGIN
      v_first := v_rows->0;
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
          );

      IF v_present_keys IS NULL OR array_length(v_present_keys, 1) IS NULL THEN
        CONTINUE;
      END IF;

      v_cols := array_to_string(v_present_keys, ', ');

      EXECUTE format(
        'INSERT INTO public.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::public.%I, $1) ON CONFLICT DO NOTHING',
        v_table, v_cols, v_cols, v_table
      ) USING v_rows;

    EXCEPTION WHEN undefined_table OR undefined_column OR others THEN
      NULL;
    END;
  END LOOP;

  -- Restore tenant metadata if present
  IF v_payload ? '_tenant' AND v_payload->'_tenant' IS NOT NULL THEN
    BEGIN
      UPDATE public.tenants SET
        name = COALESCE((v_payload->'_tenant'->>'name'), name),
        phone = COALESCE((v_payload->'_tenant'->>'phone'), phone),
        address = COALESCE((v_payload->'_tenant'->>'address'), address),
        email = COALESCE((v_payload->'_tenant'->>'email'), email)
      WHERE id = v_tenant;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_restore_backup(uuid) TO authenticated;