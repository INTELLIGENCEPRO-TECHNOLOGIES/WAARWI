/*
  # is_shop_active() uses enabled_modules

  Redefines the helper function used by the online_orders / online_order_items
  RLS policies to gate public access on the tenant's `enabled_modules.online_orders`
  rather than on `shop_settings.is_active`.
*/

CREATE OR REPLACE FUNCTION public.is_shop_active(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenants t
    WHERE t.id = p_tenant_id
      AND t.public_slug IS NOT NULL
      AND COALESCE(t.is_active, true)
      AND COALESCE(t.approval_status, 'approved') = 'approved'
      AND (
        t.enabled_modules IS NULL
        OR jsonb_typeof(t.enabled_modules) <> 'array'
        OR t.enabled_modules ? 'online_orders'
      )
  );
$$;