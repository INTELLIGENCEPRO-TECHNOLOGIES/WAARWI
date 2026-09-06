/*
# Grant write access on activation lock for platform admins

The _br_tenant_activation table needs INSERT/UPDATE by authenticated users
(platform admins) to toggle the activation lock from the admin UI.
RLS remains enabled with no policies — only service_role bypasses RLS.
Platform admin calls use service_role key via the `call()` helper, but
direct supabase client calls from PlatformAdmin use the anon/authenticated key.
We add a restrictive RLS policy that allows only platform admins (super_admin role).
*/

GRANT INSERT, UPDATE ON _br_tenant_activation TO authenticated;

DROP POLICY IF EXISTS "platform_admin_manage_activation" ON _br_tenant_activation;
CREATE POLICY "platform_admin_manage_activation" ON _br_tenant_activation
  FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  );

DROP POLICY IF EXISTS "authenticated_select_own_activation" ON _br_tenant_activation;
CREATE POLICY "authenticated_select_own_activation" ON _br_tenant_activation
  FOR SELECT TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM profiles WHERE profiles.id = auth.uid())
  );
