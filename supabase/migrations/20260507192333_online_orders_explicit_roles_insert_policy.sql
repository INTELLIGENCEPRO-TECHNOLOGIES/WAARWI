/*
  # Use explicit role list for online_orders INSERT policy

  ## Problem
  Using `TO public` on RLS policies can interact unexpectedly with the PostgreSQL
  planner. An anon role test still hit RLS rejection.

  ## Fix
  Use explicit `TO anon, authenticated` role list instead of `public`.
*/

DROP POLICY IF EXISTS "online_orders public insert" ON online_orders;
CREATE POLICY "online_orders public insert"
  ON online_orders
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (is_shop_active(tenant_id));

DROP POLICY IF EXISTS "online_order_items public insert" ON online_order_items;
CREATE POLICY "online_order_items public insert"
  ON online_order_items
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (is_shop_active(tenant_id));
