-- Held carts (paused tickets) persistence
CREATE TABLE IF NOT EXISTS public.held_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cash_session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT '',
  cart_data jsonb NOT NULL DEFAULT '[]'::jsonb,
  customer_data jsonb DEFAULT NULL,
  discount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE held_carts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_tenant_held_carts" ON held_carts FOR SELECT
  TO authenticated USING (tenant_id = public.current_tenant_id());
CREATE POLICY "insert_own_tenant_held_carts" ON held_carts FOR INSERT
  TO authenticated WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "update_own_tenant_held_carts" ON held_carts FOR UPDATE
  TO authenticated USING (tenant_id = public.current_tenant_id()) WITH CHECK (tenant_id = public.current_tenant_id());
CREATE POLICY "delete_own_tenant_held_carts" ON held_carts FOR DELETE
  TO authenticated USING (tenant_id = public.current_tenant_id());
