/*
  # Fix anon INSERT policy on online_orders and online_order_items

  ## Problem
  The existing RLS policies use a subquery against shop_settings:
    tenant_id IN (SELECT tenant_id FROM shop_settings WHERE is_active = true)
  This subquery is re-evaluated under the anon role's RLS context, and due to
  a Postgres RLS quirk when the subquery target table also has RLS enabled,
  the check silently returns empty, causing the INSERT to fail even when a
  matching active shop_settings row exists.

  ## Fix
  Replace the subquery with a SECURITY DEFINER helper function
  `is_shop_active(tenant_id)` that runs as the function owner (bypassing RLS on
  shop_settings) and returns a stable boolean. Use this function in the INSERT
  WITH CHECK policies for online_orders and online_order_items.

  ## Security
  - The helper function only returns a boolean — it does not leak any data
  - Policies remain scoped to the anon role
  - Tenants can only insert when their shop_settings.is_active = true
*/

-- Helper function: checks if a tenant's shop is active (bypasses RLS on shop_settings)
CREATE OR REPLACE FUNCTION is_shop_active(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM shop_settings
    WHERE tenant_id = p_tenant_id AND is_active = true
  );
$$;

GRANT EXECUTE ON FUNCTION is_shop_active(uuid) TO anon, authenticated;

-- Replace anon INSERT policy on online_orders
DROP POLICY IF EXISTS "online_orders public insert" ON online_orders;
CREATE POLICY "online_orders public insert"
  ON online_orders
  FOR INSERT
  TO anon
  WITH CHECK (is_shop_active(tenant_id));

-- Replace anon INSERT policy on online_order_items
DROP POLICY IF EXISTS "online_order_items public insert" ON online_order_items;
CREATE POLICY "online_order_items public insert"
  ON online_order_items
  FOR INSERT
  TO anon
  WITH CHECK (is_shop_active(tenant_id));
