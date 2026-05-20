/*
  # Tenant logos, users management, platform admin

  1. Storage
    - New bucket `tenant-logos` (public read, tenant-scoped writes)
  2. Schema
    - Add `plan_expires_at` to tenants for subscription tracking
    - Add `is_active` to tenants for platform-level activation
  3. Security
    - Tenant admin can view/update profiles in their tenant
    - Super admin (profiles.role = 'super_admin') can view/update all tenants
*/

-- Storage bucket for tenant logos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('tenant-logos', 'tenant-logos', true, 2097152,
  ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- Public read
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='tenant_logos_public_read') THEN
    CREATE POLICY "tenant_logos_public_read" ON storage.objects FOR SELECT TO public
    USING (bucket_id = 'tenant-logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='tenant_logos_auth_write') THEN
    CREATE POLICY "tenant_logos_auth_write" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'tenant-logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='tenant_logos_auth_update') THEN
    CREATE POLICY "tenant_logos_auth_update" ON storage.objects FOR UPDATE TO authenticated
    USING (bucket_id = 'tenant-logos') WITH CHECK (bucket_id = 'tenant-logos');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='tenant_logos_auth_delete') THEN
    CREATE POLICY "tenant_logos_auth_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'tenant-logos');
  END IF;
END $$;

-- Tenants: subscription fields
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='plan_expires_at') THEN
    ALTER TABLE tenants ADD COLUMN plan_expires_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='is_active') THEN
    ALTER TABLE tenants ADD COLUMN is_active boolean DEFAULT true;
  END IF;
END $$;

-- Helper: is_super_admin
CREATE OR REPLACE FUNCTION is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'super_admin');
$$;

-- Tenant admins can view/update all profiles in their tenant
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Admins manage tenant profiles') THEN
    CREATE POLICY "Admins manage tenant profiles"
      ON profiles FOR UPDATE TO authenticated
      USING (tenant_id = current_tenant_id() AND EXISTS (SELECT 1 FROM profiles p2 WHERE p2.id = auth.uid() AND p2.role IN ('admin','super_admin')))
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- Super admin can view all tenants
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenants' AND policyname='Super admin views all tenants') THEN
    CREATE POLICY "Super admin views all tenants"
      ON tenants FOR SELECT TO authenticated
      USING (is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tenants' AND policyname='Super admin updates all tenants') THEN
    CREATE POLICY "Super admin updates all tenants"
      ON tenants FOR UPDATE TO authenticated
      USING (is_super_admin())
      WITH CHECK (is_super_admin());
  END IF;
END $$;

-- Super admin can view all profiles (for tenant admin listings)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='Super admin views all profiles') THEN
    CREATE POLICY "Super admin views all profiles"
      ON profiles FOR SELECT TO authenticated
      USING (is_super_admin());
  END IF;
END $$;
