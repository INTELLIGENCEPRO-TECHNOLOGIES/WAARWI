/*
  # Tenant backup/restore/reset functions

  - tenant_create_backup(label, auto) returns uuid
  - tenant_restore_backup(backup_id) returns void
  - tenant_reset_operations() returns void (keeps articles/customers/suppliers)
  - tenant_delete_article_safe(id), tenant_delete_customer_safe(id), tenant_delete_supplier_safe(id)
  - tenant_run_due_auto_backup() -> internal scheduler helper

  All functions are SECURITY DEFINER and operate ONLY on rows scoped to the
  caller's current_tenant_id(). Super admins cannot bypass without being
  members of the tenant.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- CREATE BACKUP
-- ─────────────────────────────────────────────────────────────────────────────
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
    'customers','suppliers','stock_levels','shop_settings',
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

  -- tenant row snapshot (for metadata restore reference only, not restored)
  SELECT to_jsonb(t.*) INTO v_tenant_row FROM public.tenants t WHERE id = v_tenant;
  v_payload := jsonb_set(v_payload, '{_tenant}', COALESCE(v_tenant_row, 'null'::jsonb));

  FOREACH v_table IN ARRAY v_tables LOOP
    EXECUTE format(
      'SELECT COALESCE(jsonb_agg(to_jsonb(r.*)), ''[]''::jsonb) FROM public.%I r WHERE r.tenant_id = $1',
      v_table
    ) INTO v_rows USING v_tenant;
    v_payload := jsonb_set(v_payload, ARRAY[v_table], COALESCE(v_rows, '[]'::jsonb));
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

-- ─────────────────────────────────────────────────────────────────────────────
-- RESTORE BACKUP
-- ─────────────────────────────────────────────────────────────────────────────
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
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No current tenant';
  END IF;

  SELECT payload INTO v_payload FROM public.tenant_backups
    WHERE id = p_backup_id AND tenant_id = v_tenant;
  IF v_payload IS NULL THEN
    RAISE EXCEPTION 'Backup not found';
  END IF;

  -- reverse order for deletion
  SELECT array_agg(t ORDER BY idx DESC)
    INTO v_delete_order
  FROM unnest(v_insert_order) WITH ORDINALITY AS a(t, idx);

  -- Delete all current tenant rows in reverse FK order
  FOREACH v_table IN ARRAY v_delete_order LOOP
    EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING v_tenant;
  END LOOP;

  -- Reinsert from snapshot in FK-safe order
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
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RESET OPERATIONS (keep structural: articles, customers, suppliers, etc.)
-- ─────────────────────────────────────────────────────────────────────────────
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

  -- Zero-out stock levels but keep the rows (articles remain with qty=0)
  UPDATE public.stock_levels SET quantity = 0 WHERE tenant_id = v_tenant;

  -- Reset customer balances & totals
  UPDATE public.customers
    SET credit_balance = 0
    WHERE tenant_id = v_tenant;

  UPDATE public.suppliers
    SET total_owed = 0
    WHERE tenant_id = v_tenant;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- SAFE DELETE: articles, customers, suppliers
-- Deletes only when no operational row references them.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_delete_article_safe(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_refs int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No current tenant'; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.articles WHERE id = p_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Article introuvable';
  END IF;

  SELECT
    (SELECT count(*) FROM public.sale_items WHERE article_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.quote_items WHERE article_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.supplier_order_items WHERE article_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.online_order_items WHERE article_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.sale_return_items WHERE article_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.stock_movements WHERE article_id = p_id AND tenant_id = v_tenant)
  INTO v_refs;

  IF v_refs > 0 THEN
    RAISE EXCEPTION 'Cet article est utilisé dans des opérations (%). Suppression impossible.', v_refs;
  END IF;

  DELETE FROM public.article_compatibilities WHERE article_id = p_id AND tenant_id = v_tenant;
  DELETE FROM public.stock_levels WHERE article_id = p_id AND tenant_id = v_tenant;
  DELETE FROM public.articles WHERE id = p_id AND tenant_id = v_tenant;
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_delete_customer_safe(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_refs int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No current tenant'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.customers WHERE id = p_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Client introuvable';
  END IF;

  SELECT
    (SELECT count(*) FROM public.sales WHERE customer_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.quotes WHERE customer_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.online_orders WHERE customer_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.customer_prepayments WHERE customer_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.sale_returns WHERE customer_id = p_id AND tenant_id = v_tenant)
  INTO v_refs;

  IF v_refs > 0 THEN
    RAISE EXCEPTION 'Ce client est utilisé dans des opérations (%). Suppression impossible.', v_refs;
  END IF;

  DELETE FROM public.customers WHERE id = p_id AND tenant_id = v_tenant;
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_delete_supplier_safe(p_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_refs int;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No current tenant'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.suppliers WHERE id = p_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'Fournisseur introuvable';
  END IF;

  SELECT
    (SELECT count(*) FROM public.supplier_orders WHERE supplier_id = p_id AND tenant_id = v_tenant)
    + (SELECT count(*) FROM public.supplier_payments WHERE supplier_id = p_id AND tenant_id = v_tenant)
  INTO v_refs;

  IF v_refs > 0 THEN
    RAISE EXCEPTION 'Ce fournisseur est utilisé dans des opérations (%). Suppression impossible.', v_refs;
  END IF;

  DELETE FROM public.suppliers WHERE id = p_id AND tenant_id = v_tenant;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- AUTO-BACKUP HELPER: run if schedule is due
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_run_due_auto_backup()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_cfg public.tenant_backup_settings%ROWTYPE;
  v_id uuid;
  v_keep int;
BEGIN
  IF v_tenant IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO v_cfg FROM public.tenant_backup_settings WHERE tenant_id = v_tenant;
  IF v_cfg.tenant_id IS NULL OR NOT v_cfg.auto_enabled THEN
    RETURN NULL;
  END IF;

  IF v_cfg.next_run_at IS NOT NULL AND v_cfg.next_run_at > now() THEN
    RETURN NULL;
  END IF;

  v_id := public.tenant_create_backup('Auto ' || to_char(now(), 'YYYY-MM-DD HH24:MI'), true);

  UPDATE public.tenant_backup_settings
    SET last_run_at = now(),
        next_run_at = now() + make_interval(hours => v_cfg.frequency_hours),
        updated_at = now()
    WHERE tenant_id = v_tenant;

  -- Retention: keep only the last N auto backups
  v_keep := GREATEST(COALESCE(v_cfg.keep_count, 10), 1);
  DELETE FROM public.tenant_backups
    WHERE tenant_id = v_tenant
      AND is_auto = true
      AND id NOT IN (
        SELECT id FROM public.tenant_backups
          WHERE tenant_id = v_tenant AND is_auto = true
          ORDER BY created_at DESC
          LIMIT v_keep
      );

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_create_backup(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_restore_backup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_reset_operations() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_delete_article_safe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_delete_customer_safe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_delete_supplier_safe(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_run_due_auto_backup() TO authenticated;
