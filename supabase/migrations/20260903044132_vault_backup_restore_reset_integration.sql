/*
  # Coffre — intégration aux sauvegardes, restaurations et réinitialisations

  Met à jour les fonctions de sauvegarde/restauration/réinitialisation pour prendre en
  charge les tables du coffre (vaults + vault_movements) sans jamais casser l'existant.

  ## Ordonnancement des clés étrangères
  - Sauvegarde : ajout de 'vaults' et 'vault_movements' aux tables exportées (ordre sans
    incidence à l'export).
  - Restauration : 'vaults' est réinséré juste après 'sites' (dont il dépend), et
    'vault_movements' après le groupe caisse ; les colonnes de liaison
    cash_movements.vault_movement_id et supplier_payments.vault_movement_id sont mises à
    NULL avant suppression puis rétablies en phase différée, exactement comme les autres
    liaisons croisées existantes.
  - Réinitialisations : suppression des mouvements de coffre avant les coffres ; pour la
    réinitialisation des opérations, les coffres sont conservés mais leur solde est remis
    à 0 afin de rester cohérent avec un registre vidé.

  Non-régression : aucun tenant n'ayant de données de coffre, ces changements n'ont aucun
  effet sur les sauvegardes/restaurations actuelles.
*/

-- =====================================================================
-- 1) tenant_create_backup(text)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tenant_create_backup(p_label text DEFAULT NULL::text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_payload jsonb := '{}'::jsonb;
  v_backup_id uuid;
  v_table text;
  v_tables text[] := ARRAY[
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
    'vaults','vault_movements',
    'notifications','tenant_doc_counters'
  ];
  v_rows jsonb;
BEGIN
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'No current tenant';
  END IF;

  SELECT jsonb_build_object('_tenant', jsonb_build_object(
    'name', t.name, 'phone', t.phone, 'address', t.address, 'email', t.email
  )) INTO v_payload FROM tenants t WHERE t.id = v_tenant;

  FOREACH v_table IN ARRAY v_tables LOOP
    BEGIN
      EXECUTE format(
        'SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), ''[]''::jsonb) FROM public.%I t WHERE t.tenant_id = $1',
        v_table
      ) INTO v_rows USING v_tenant;
      v_payload := v_payload || jsonb_build_object(v_table, v_rows);
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      v_payload := v_payload || jsonb_build_object(v_table, '[]'::jsonb);
    END;
  END LOOP;

  INSERT INTO public.tenant_backups (tenant_id, label, payload)
  VALUES (v_tenant, COALESCE(p_label, 'manual'), v_payload)
  RETURNING id INTO v_backup_id;

  RETURN v_backup_id;
END;
$function$;

-- =====================================================================
-- 2) tenant_create_backup(text, boolean)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tenant_create_backup(p_label text DEFAULT ''::text, p_auto boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_payload jsonb := '{}'::jsonb;
  v_tables text[] := ARRAY[
    'sites','accounts','payment_methods','part_categories',
    'vehicle_brands','vehicle_models','articles','article_compatibilities',
    'customers','suppliers','stock_levels','stock_lots','shop_settings',
    'pricing_tier_definitions','article_pricing_tiers','customer_exception_prices',
    'ipm_organismes','ipm_conventions','ipm_beneficiaires','ipm_bordereaux',
    'ipm_ventes','ipm_factures','ipm_reglements','ipm_rejets','ipm_parametres',
    'stock_documents',
    'balance_adjustments','credit_allocations','customer_payments','balance_regularization_log',
    'mt_services','mt_service_points','mt_wholesalers','mt_service_point_services',
    'mt_expense_categories','mt_customers',
    'mt_accounts','mt_operations','mt_closures',
    'mt_expenses','mt_customer_ledger',
    'role_permissions',
    'held_carts',
    'sales','sale_items','sale_returns','sale_return_items','sale_payments',
    'quotes','quote_items',
    'supplier_orders','supplier_order_items','supplier_payments',
    'online_orders','online_order_items','online_order_status_history',
    'cash_sessions','cash_movements','cash_control_lines','cash_regularizations',
    'customer_prepayments','stock_movements',
    'vaults','vault_movements',
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
$function$;

-- =====================================================================
-- 3) tenant_restore_backup(uuid)
-- =====================================================================
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
    'sites','vaults','accounts','payment_methods','part_categories',
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
    'vault_movements',
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
    ARRAY['cash_movements', 'sale_return_id'],
    ARRAY['cash_movements', 'vault_movement_id'],
    ARRAY['supplier_payments', 'vault_movement_id']
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
  BEGIN UPDATE public.supplier_payments SET vault_movement_id = NULL WHERE tenant_id = v_tenant AND vault_movement_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.cash_movements SET accounting_entry_id = NULL WHERE tenant_id = v_tenant AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.cash_movements SET sale_return_id = NULL WHERE tenant_id = v_tenant AND sale_return_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.cash_movements SET vault_movement_id = NULL WHERE tenant_id = v_tenant AND vault_movement_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
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

-- =====================================================================
-- 4) reset_tenant_data(uuid)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reset_tenant_data(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'mt_customer_ledger','mt_expenses','mt_expense_categories','mt_customers',
    'mt_closures','mt_operations','mt_accounts','mt_service_point_services','mt_wholesalers','mt_service_points','mt_services',
    'credit_allocations','customer_payments','balance_regularization_log',
    'balance_adjustments',
    'ipm_rejets','ipm_reglements','ipm_factures','ipm_ventes','ipm_bordereaux',
    'ipm_beneficiaires','ipm_conventions','ipm_organismes','ipm_parametres',
    'article_pricing_tiers','pricing_tier_definitions',
    'stock_documents',
    'held_carts',
    'tenant_doc_counters','notifications','stock_movements','stock_lots','customer_prepayments',
    'cash_regularizations','cash_control_lines','cash_movements',
    'online_order_status_history','online_order_items','online_orders',
    'supplier_payments','supplier_order_items','supplier_orders',
    'quote_items','quotes',
    'sale_return_items','sale_returns','sale_payments','sale_items','sales',
    'journal_lines','journal_entries',
    'vault_movements','vaults',
    'stock_levels','article_compatibilities','articles','part_categories',
    'vehicle_models','vehicle_brands',
    'customer_exception_prices','customers','suppliers',
    'cash_sessions','payment_methods',
    'role_permissions','sites'
  ];
BEGIN
  -- NULL out FK references to avoid FK violations during delete
  BEGIN UPDATE public.sales SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.sale_payments SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.sale_payments SET source_return_id = NULL WHERE tenant_id = p_tenant_id AND source_return_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.supplier_orders SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.supplier_payments SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.supplier_payments SET vault_movement_id = NULL WHERE tenant_id = p_tenant_id AND vault_movement_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.cash_movements SET accounting_entry_id = NULL WHERE tenant_id = p_tenant_id AND accounting_entry_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.cash_movements SET sale_return_id = NULL WHERE tenant_id = p_tenant_id AND sale_return_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.cash_movements SET vault_movement_id = NULL WHERE tenant_id = p_tenant_id AND vault_movement_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.online_orders SET sale_id = NULL WHERE tenant_id = p_tenant_id AND sale_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.stock_movements SET stock_document_id = NULL WHERE tenant_id = p_tenant_id AND stock_document_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;
  BEGIN UPDATE public.ipm_ventes SET bordereau_id = NULL WHERE tenant_id = p_tenant_id AND bordereau_id IS NOT NULL; EXCEPTION WHEN undefined_column THEN NULL; END;

  FOREACH v_table IN ARRAY v_tables
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING p_tenant_id;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  BEGIN
    DELETE FROM public.accounts WHERE tenant_id = p_tenant_id;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;
END;
$function$;

-- =====================================================================
-- 5) tenant_reset_operations()
-- =====================================================================
CREATE OR REPLACE FUNCTION public.tenant_reset_operations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_ops text[] := ARRAY[
    'mt_customer_ledger','mt_expenses',
    'mt_closures','mt_operations',
    'credit_allocations','customer_payments','balance_regularization_log',
    'balance_adjustments',
    'ipm_rejets','ipm_reglements','ipm_factures','ipm_ventes','ipm_bordereaux',
    'stock_documents',
    'held_carts',
    'journal_lines','journal_entries',
    'stock_movements','stock_lots',
    'cash_control_lines','cash_regularizations','cash_movements',
    'sale_payments','sale_return_items','sale_returns',
    'sale_items','sales',
    'quote_items','quotes',
    'supplier_payments','supplier_order_items','supplier_orders',
    'online_order_status_history','online_order_items','online_orders',
    'vault_movements',
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
    UPDATE public.sale_payments SET source_return_id = NULL
    WHERE tenant_id = v_tenant AND source_return_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.cash_movements SET sale_return_id = NULL
    WHERE tenant_id = v_tenant AND sale_return_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.cash_movements SET vault_movement_id = NULL
    WHERE tenant_id = v_tenant AND vault_movement_id IS NOT NULL;
  EXCEPTION WHEN undefined_column THEN NULL;
  END;
  BEGIN
    UPDATE public.supplier_payments SET vault_movement_id = NULL
    WHERE tenant_id = v_tenant AND vault_movement_id IS NOT NULL;
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

  FOREACH v_table IN ARRAY v_ops LOOP
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE tenant_id = $1', v_table) USING v_tenant;
    EXCEPTION WHEN undefined_table OR undefined_column THEN
      NULL;
    END;
  END LOOP;

  -- Zero-out stock levels but keep the rows
  UPDATE public.stock_levels SET quantity = 0 WHERE tenant_id = v_tenant;

  -- Keep vault structure but reset its balance to stay consistent with an emptied ledger
  BEGIN
    UPDATE public.vaults SET current_balance = 0, updated_at = now() WHERE tenant_id = v_tenant;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

  BEGIN
    UPDATE public.mt_accounts SET balance = 0, updated_at = now() WHERE tenant_id = v_tenant;
  EXCEPTION WHEN undefined_table THEN NULL;
  END;

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
$function$;
