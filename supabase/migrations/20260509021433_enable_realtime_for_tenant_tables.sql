/*
  # Enable Realtime publication for live sync

  Adds the main tenant-scoped tables to the `supabase_realtime` publication so
  clients subscribed via `supabase.channel(...).on('postgres_changes',...)`
  receive INSERT/UPDATE/DELETE events in real time.

  Tables covered: the ones the UI currently re-queries on every page
  (articles, stock, sales, cash sessions, billing, online orders, tiers,
  suppliers, shop settings, and tenants itself for branding/config).

  Safe/idempotent: uses `DO`-wrapped ALTER PUBLICATION with existence checks.
  RLS still applies — clients only receive rows they would see through the
  normal SELECT policies.
*/

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'tenants',
    'profiles',
    'sites',
    'articles',
    'part_categories',
    'stock_levels',
    'stock_movements',
    'vehicle_brands',
    'vehicle_models',
    'article_compatibilities',
    'payment_methods',
    'cash_sessions',
    'sales',
    'sale_items',
    'sale_payments',
    'quotes',
    'quote_items',
    'sale_returns',
    'sale_return_items',
    'customers',
    'suppliers',
    'supplier_orders',
    'supplier_order_items',
    'supplier_payments',
    'online_orders',
    'online_order_items',
    'shop_settings',
    'tenant_messages'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t)
       AND NOT EXISTS (
         SELECT 1 FROM pg_publication_tables
         WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
       )
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;