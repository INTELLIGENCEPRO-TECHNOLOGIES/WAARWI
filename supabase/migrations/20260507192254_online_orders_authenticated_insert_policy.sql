/*
  # Allow authenticated users to insert online orders too

  ## Problem
  A logged-in back-office user who tests the public shop in the same browser
  hits online_orders INSERT as `authenticated`, not `anon`. The existing INSERT
  policy only covered `anon`, so the insert was rejected as RLS violation.

  ## Fix
  Extend the public INSERT policies to cover both anon and authenticated roles
  by using the broader `public` role. is_shop_active() still restricts inserts
  to active-shop tenants.
*/

DROP POLICY IF EXISTS "online_orders public insert" ON online_orders;
CREATE POLICY "online_orders public insert"
  ON online_orders
  FOR INSERT
  TO public
  WITH CHECK (is_shop_active(tenant_id));

DROP POLICY IF EXISTS "online_order_items public insert" ON online_order_items;
CREATE POLICY "online_order_items public insert"
  ON online_order_items
  FOR INSERT
  TO public
  WITH CHECK (is_shop_active(tenant_id));
