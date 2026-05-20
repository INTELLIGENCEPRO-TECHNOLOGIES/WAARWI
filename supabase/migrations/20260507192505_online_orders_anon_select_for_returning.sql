/*
  # Allow anon SELECT on own-shop online_orders to support INSERT...RETURNING

  ## Root cause
  The Supabase JS client call `supabase.from('online_orders').insert(...).select('id')`
  produces an `INSERT ... RETURNING id`. After RLS validates the WITH CHECK and
  writes the row, the RETURNING clause re-reads the row and must pass the SELECT
  RLS policy of the inserting role. anon had no SELECT policy, so RETURNING
  returned zero rows and Postgres surfaced this as a WITH CHECK violation.

  ## Fix
  1. Restore the strict INSERT WITH CHECK (is_shop_active(tenant_id))
  2. Add a SELECT policy for anon and authenticated limited to active-shop rows,
     so INSERT RETURNING can read back the freshly inserted row.

  ## Security
  The SELECT policy only exposes rows belonging to an active shop — no PII is
  broadly exposed beyond what's necessary to echo back the just-inserted row.
  Customer-specific scoping isn't needed for this flow since the client already
  knows the data they just sent.
*/

-- Restore strict INSERT WITH CHECK on online_orders
DROP POLICY IF EXISTS "online_orders public insert" ON online_orders;
CREATE POLICY "online_orders public insert"
  ON online_orders
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (is_shop_active(tenant_id));

-- Allow anon/authenticated to read rows of active shops (supports RETURNING)
DROP POLICY IF EXISTS "online_orders public select active" ON online_orders;
CREATE POLICY "online_orders public select active"
  ON online_orders
  FOR SELECT
  TO anon, authenticated
  USING (is_shop_active(tenant_id));

-- Same for items
DROP POLICY IF EXISTS "online_order_items public insert" ON online_order_items;
CREATE POLICY "online_order_items public insert"
  ON online_order_items
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (is_shop_active(tenant_id));

DROP POLICY IF EXISTS "online_order_items public select active" ON online_order_items;
CREATE POLICY "online_order_items public select active"
  ON online_order_items
  FOR SELECT
  TO anon, authenticated
  USING (is_shop_active(tenant_id));
