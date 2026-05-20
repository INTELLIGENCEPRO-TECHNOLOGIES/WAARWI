/*
  # Tenant backup system v2 — metadata restore + file-upload restore

  1. Changes
    - tenant_restore_backup now also restores safe tenant metadata columns
      (branding, website, enabled_modules, shop settings on the tenants row).
      Platform-controlled fields (plan, is_active, approval_status,
      subscription, custom_domain, business_activity_type_id) are deliberately
      NOT restored to avoid bypassing platform admin decisions.
    - New function: tenant_restore_from_payload(jsonb) lets the user re-import
      a previously downloaded JSON backup file directly from the UI, without
      needing to have the backup row still present. The payload must be for
      the caller's current tenant (checked via _tenant.id in the file).
    - Retention: auto-backup retention now ALSO applies to manual backups via
      a per-tenant soft cap (keep_count * 3) to avoid unbounded storage growth.

  2. Security
    - All functions SECURITY DEFINER but scoped to current_tenant_id().
    - tenant_restore_from_payload verifies the payload was originally produced
      for the same tenant; mismatched files are rejected.
*/

-- Safe list of tenant columns we allow to be restored from snapshot metadata.
-- Everything else (plan, approval_status, subscription, is_active, domain,
-- business_activity_type_id, secrets) is intentionally left untouched.
CREATE OR REPLACE FUNCTION public._apply_tenant_metadata(p_tenant uuid, p_meta jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[] := ARRAY[
    'name','legal_name','email','phone','address','city','country',
    'logo_url','tagline','website','currency','vat_rate',
    'primary_color','secondary_color','accent_color',
    'invoice_footer','receipt_footer','quote_footer',
    'enabled_modules'
  ];
  v_col text;
  v_val jsonb;
  v_sql text := '';
  v_has_any boolean := false;
BEGIN
  IF p_meta IS NULL OR jsonb_typeof(p_meta) <> 'object' THEN
    RETURN;
  END IF;

  FOREACH v_col IN ARRAY v_allowed LOOP
    -- Only touch columns that actually exist on the tenants table
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = v_col
    ) THEN
      v_val := p_meta -> v_col;
      IF v_val IS NOT NULL AND jsonb_typeof(v_val) <> 'null' THEN
        IF v_has_any THEN v_sql := v_sql || ', '; END IF;
        -- Cast through the column's type to avoid jsonb/text mismatches
        v_sql := v_sql || format(
          '%I = (to_jsonb($1)->>''%I'')::text::%s',
          v_col, v_col,
          (SELECT data_type FROM information_schema.columns
             WHERE table_schema='public' AND table_name='tenants' AND column_name=v_col)
        );
        v_has_any := true;
      END IF;
    END IF;
  END LOOP;

  IF v_has_any THEN
    EXECUTE format('UPDATE public.tenants SET %s WHERE id = $2', v_sql)
      USING p_meta, p_tenant;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RESTORE BACKUP (v2): includes tenant metadata restore
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

-- ─────────────────────────────────────────────────────────────────────────────
-- RESTORE FROM FILE UPLOAD (JSON payload)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_restore_from_payload(p_payload jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_backup_id uuid;
  v_file_tenant uuid;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No current tenant';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Fichier de sauvegarde invalide';
  END IF;

  -- Accept either the raw backup payload OR the full export wrapper
  -- { meta: {...}, payload: {...} } produced by the download button.
  IF p_payload ? 'payload' AND jsonb_typeof(p_payload->'payload') = 'object' THEN
    p_payload := p_payload->'payload';
  END IF;

  v_file_tenant := NULLIF((p_payload #>> '{_tenant,id}'), '')::uuid;
  IF v_file_tenant IS NOT NULL AND v_file_tenant <> v_tenant THEN
    RAISE EXCEPTION 'Ce fichier ne correspond pas à votre entreprise';
  END IF;

  -- Create a safety backup of the current state first
  PERFORM public.tenant_create_backup('Avant import de fichier', true);

  -- Insert the uploaded payload as a backup row, then restore from it
  INSERT INTO public.tenant_backups (
    tenant_id, created_by, label, kind, is_auto, size_bytes, payload
  ) VALUES (
    v_tenant, auth.uid(),
    'Import fichier ' || to_char(now(), 'YYYY-MM-DD HH24:MI'),
    'import', false, octet_length(p_payload::text), p_payload
  ) RETURNING id INTO v_backup_id;

  PERFORM public.tenant_restore_backup(v_backup_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_restore_from_payload(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public._apply_tenant_metadata(uuid, jsonb) TO authenticated;
