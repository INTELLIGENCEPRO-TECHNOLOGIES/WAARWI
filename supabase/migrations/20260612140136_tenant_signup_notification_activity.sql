/*
# Tenant signup notification and activity tracking

1. New columns on `tenants`:
   - `approval_token` (uuid) - one-time token for email-based auto-approval
   - `last_active_at` (timestamptz) - tracks when tenant last used the app

2. New functions:
   - `auto_approve_tenant_by_token(uuid)` - approves tenant via email link token
   - `touch_tenant_activity()` - updates last_active_at for current tenant
   - `tenant_activity_overview()` - returns activity summary for all approved tenants (super_admin only)

3. Security:
   - `auto_approve_tenant_by_token` granted to anon + authenticated (public link)
   - `touch_tenant_activity` granted to authenticated
   - `tenant_activity_overview` enforces is_super_admin() check internally
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'approval_token') THEN
    ALTER TABLE tenants ADD COLUMN approval_token uuid DEFAULT gen_random_uuid();
  END IF;
END $$;

UPDATE tenants SET approval_token = gen_random_uuid() WHERE approval_token IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'last_active_at') THEN
    ALTER TABLE tenants ADD COLUMN last_active_at timestamptz;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.auto_approve_tenant_by_token(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_tenant_name text;
  v_tenant_email text;
BEGIN
  SELECT id, name, email INTO v_tenant_id, v_tenant_name, v_tenant_email
  FROM tenants
  WHERE approval_token = p_token
    AND approval_status = 'pending';

  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token invalide ou tenant deja traite');
  END IF;

  UPDATE tenants SET
    approval_status = 'approved',
    approved_at = now(),
    is_active = true,
    status = 'active',
    approval_token = NULL
  WHERE id = v_tenant_id;

  INSERT INTO platform_events (actor_id, actor_email, tenant_id, action, payload)
  VALUES (
    '00000000-0000-0000-0000-000000000000',
    'system@waarwi.com',
    v_tenant_id,
    'tenant.auto_approve',
    jsonb_build_object('method', 'email_link')
  );

  RETURN jsonb_build_object('success', true, 'tenant_name', v_tenant_name, 'tenant_email', v_tenant_email);
END;
$$;

GRANT EXECUTE ON FUNCTION public.auto_approve_tenant_by_token(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.touch_tenant_activity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tid uuid;
BEGIN
  v_tid := current_tenant_id();
  IF v_tid IS NOT NULL THEN
    UPDATE tenants SET last_active_at = now() WHERE id = v_tid;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_tenant_activity() TO authenticated;

CREATE OR REPLACE FUNCTION public.tenant_activity_overview()
RETURNS TABLE (
  tenant_id uuid,
  tenant_name text,
  last_active_at timestamptz,
  total_sales bigint,
  total_articles bigint,
  total_users bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    t.last_active_at,
    (SELECT count(*) FROM sales s WHERE s.tenant_id = t.id)::bigint AS total_sales,
    (SELECT count(*) FROM articles a WHERE a.tenant_id = t.id)::bigint AS total_articles,
    (SELECT count(*) FROM profiles p WHERE p.tenant_id = t.id)::bigint AS total_users,
    t.created_at
  FROM tenants t
  WHERE t.approval_status = 'approved'
  ORDER BY t.last_active_at DESC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_activity_overview() TO authenticated;