-- F6: the UPDATE policy's WITH CHECK was weaker than its USING, so a tenant admin
-- could escalate a profile. Make the write check identical to the read check.
DROP POLICY IF EXISTS "Admins manage tenant profiles" ON public.profiles;

CREATE POLICY "Admins manage tenant profiles" ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM profiles p2
      WHERE p2.id = auth.uid() AND p2.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
    )
  )
  WITH CHECK (
    tenant_id = current_tenant_id()
    AND EXISTS (
      SELECT 1 FROM profiles p2
      WHERE p2.id = auth.uid() AND p2.role = ANY (ARRAY['admin'::text, 'super_admin'::text])
    )
  );
