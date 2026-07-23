/*
# Site change audit log

## Purpose
Tracks every site change in the application to diagnose unexpected site-switching issues.
When the global currentSite changes (either by user action or by a system fallback), a row is logged.

## New Tables
- `site_change_log`
  - `id` (uuid, primary key)
  - `tenant_id` (uuid, FK to tenants)
  - `user_id` (uuid, FK to auth.users)
  - `previous_site_id` (uuid, FK to sites)
  - `new_site_id` (uuid, FK to sites)
  - `trigger` (text: 'user_explicit', 'dataTick_fallback', 'initial_load')
  - `created_at` (timestamptz)

## Security
- RLS enabled
- Authenticated users can insert their own logs
- Authenticated users can read logs for their tenant
*/

CREATE TABLE IF NOT EXISTS site_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  new_site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  trigger text NOT NULL CHECK (trigger IN ('user_explicit', 'dataTick_fallback', 'initial_load')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_change_log_tenant ON site_change_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_site_change_log_user ON site_change_log(user_id, created_at DESC);

ALTER TABLE site_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_site_change_log" ON site_change_log;
CREATE POLICY "select_own_site_change_log" ON site_change_log FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

DROP POLICY IF EXISTS "insert_own_site_change_log" ON site_change_log;
CREATE POLICY "insert_own_site_change_log" ON site_change_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "no_update_site_change_log" ON site_change_log;
CREATE POLICY "no_update_site_change_log" ON site_change_log FOR UPDATE
  TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "no_delete_site_change_log" ON site_change_log;
CREATE POLICY "no_delete_site_change_log" ON site_change_log FOR DELETE
  TO authenticated
  USING (false);
