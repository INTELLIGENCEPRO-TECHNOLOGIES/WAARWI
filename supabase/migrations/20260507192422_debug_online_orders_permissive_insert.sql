DROP POLICY IF EXISTS "online_orders public insert" ON online_orders;
CREATE POLICY "online_orders public insert"
  ON online_orders
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);
