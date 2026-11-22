create schema if not exists waarwi_sync;
revoke all on schema waarwi_sync from public, anon, authenticated;

create policy "Waarwi private change notices"
on realtime.messages for select to authenticated
using (
  extension = 'broadcast'
  and topic = (select realtime.topic())
  and exists (
    select 1
    from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active is not false
      and (
        ((select realtime.topic()) = 'waarwi:shared' and (p.tenant_id is not null or p.role = 'super_admin'))
        or ((select realtime.topic()) = 'waarwi:platform' and p.role = 'super_admin')
        or (select realtime.topic()) = 'waarwi:tenant:' || p.tenant_id::text
      )
  )
);

-- Each statement emits at most one notice for each affected tenant and table.
-- Notices contain a table name only. All reads continue to use the application's RLS.
create function waarwi_sync.notify_statement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  tenant_ids uuid[];
  changed boolean;
  affected_tenant uuid;
  row_source text;
  topic_mode text := tg_argv[0];
  tenant_key text := case when tg_table_name = 'tenants' then 'id' else 'tenant_id' end;
  notice jsonb := jsonb_build_object('table', tg_table_name);
begin
  if tg_op = 'INSERT' then
    row_source := 'select * from new_rows';
  elsif tg_op = 'DELETE' then
    row_source := 'select * from old_rows';
  elsif tg_table_name = 'tenants' then
    -- La présence ne modifie pas les informations affichées par les modules.
    row_source := 'select n.* from new_rows n left join old_rows o on o.id = n.id
      where (to_jsonb(n) - ''last_active_at'') is distinct from (to_jsonb(o) - ''last_active_at'')';
  else
    row_source := 'select * from new_rows union all select * from old_rows';
  end if;

  if topic_mode in ('shared', 'platform') then
    execute 'select exists (' || row_source || ')' into changed;
    if changed then perform realtime.send(notice, 'data_changed', 'waarwi:' || topic_mode, true); end if;
    return null;
  end if;

  if tg_table_name = 'mt_wholesaler_services' then
    execute format('select array_agg(distinct w.tenant_id) from (%s) r
      join public.mt_wholesalers w on w.id = r.wholesaler_id', row_source) into tenant_ids;
  else
    execute format('select array_agg(distinct r.%I) from (%s) r', tenant_key, row_source) into tenant_ids;
  end if;
  if tenant_ids is null then return null; end if;

  foreach affected_tenant in array tenant_ids loop
    if affected_tenant is not null then
      perform realtime.send(notice, 'data_changed', 'waarwi:tenant:' || affected_tenant::text, true);
    elsif tg_table_name = 'tenant_messages' then
      perform realtime.send(notice, 'data_changed', 'waarwi:shared', true);
    end if;
  end loop;
  if topic_mode = 'tenant_and_platform' then
    perform realtime.send(notice, 'data_changed', 'waarwi:platform', true);
  end if;
  return null;
end;
$$;

revoke all on function waarwi_sync.notify_statement() from public, anon, authenticated;

do $$
declare
  table_name text;
  topic_mode text;
  tenant_tables constant text[] := array[
    'tenants', 'profiles', 'sites', 'role_permissions', 'tenant_messages',
    'tenant_subscriptions', 'tenant_subscription_payments',
    'articles', 'part_categories', 'categories', 'vehicle_brands', 'vehicle_models',
    'article_compatibilities', 'article_pricing_tiers', 'pricing_tier_definitions', 'customer_exception_prices',
    'stock_levels', 'stock_movements', 'stock_lots', 'stock_documents',
    'payment_methods', 'cash_sessions', 'cash_movements', 'cash_control_lines', 'cash_regularizations',
    'cash_registers', 'cash_register_settings', 'cash_register_assignments', 'cash_supervision_requests',
    'sales', 'sale_items', 'sale_payments', 'sale_returns', 'sale_return_items', 'held_carts',
    'quotes', 'quote_items', 'document_settings', 'expense_categories', 'expense_category_site_settings',
    'customers', 'suppliers', 'balance_adjustments', 'credit_allocations', 'customer_payments', 'customer_prepayments',
    'supplier_orders', 'supplier_order_items', 'supplier_order_receptions', 'supplier_payments',
    'online_orders', 'online_order_items', 'online_order_status_history', 'shop_settings',
    'accounts', 'accounting_accounts', 'accounting_account_mappings', 'journal_entries', 'journal_lines',
    'vaults', 'vault_movements', 'sales_representatives', 'rep_commission_settings',
    'ipm_beneficiaires', 'ipm_bordereaux', 'ipm_conventions', 'ipm_factures', 'ipm_organismes',
    'ipm_parametres', 'ipm_reglements', 'ipm_rejets', 'ipm_ventes',
    'mt_accounts', 'mt_closures', 'mt_commission_tiers', 'mt_customer_ledger', 'mt_customers',
    'mt_expense_categories', 'mt_expenses', 'mt_init_balances', 'mt_init_status', 'mt_operations',
    'mt_reconciliations', 'mt_service_point_services', 'mt_service_points', 'mt_services', 'mt_wholesalers', 'mt_wholesaler_services',
    'tenant_backup_settings', 'tenant_backups'
  ];
  shared_tables constant text[] := array[
    'plans', 'business_activity_types', 'master_catalogs', 'master_catalog_categories', 'master_catalog_items', 'app_releases'
  ];
  platform_tables constant text[] := array['platform_events', 'platform_login_config', 'landing_config'];
begin
  foreach table_name in array tenant_tables || shared_tables || platform_tables loop
    -- Optional modules may be absent in development databases.
    if not exists (
      select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relkind = 'r'
      and (table_name in ('tenants', 'mt_wholesaler_services') or table_name = any(shared_tables || platform_tables) or exists (
        select 1 from pg_catalog.pg_attribute a where a.attrelid = c.oid and a.attname = 'tenant_id'
        and not a.attisdropped and a.atttypid = 'uuid'::regtype
      ))
    ) then continue; end if;

    topic_mode := case
      when table_name = any(shared_tables) then 'shared'
      when table_name = any(platform_tables) then 'platform'
      when table_name in ('tenants', 'profiles', 'tenant_messages', 'tenant_subscriptions', 'tenant_subscription_payments') then 'tenant_and_platform'
      else 'tenant'
    end;
    execute format('create trigger waarwi_sync_insert after insert on public.%I
      referencing new table as new_rows for each statement execute function waarwi_sync.notify_statement(%L)', table_name, topic_mode);
    execute format('create trigger waarwi_sync_update after update on public.%I
      referencing old table as old_rows new table as new_rows for each statement execute function waarwi_sync.notify_statement(%L)', table_name, topic_mode);
    execute format('create trigger waarwi_sync_delete after delete on public.%I
      referencing old table as old_rows for each statement execute function waarwi_sync.notify_statement(%L)', table_name, topic_mode);
  end loop;
end;
$$;
