/*
  # Site Isolation Phase 1 — Owner, Access Mode, SQL Helpers

  ## 1. New Columns
  - `tenants.owner_user_id` (uuid, FK → auth.users) — founding user
  - `profiles.site_access_mode` (text, NOT NULL DEFAULT 'selected') — 'all' or 'selected'

  ## 2-3. Backfill both columns
  ## 4. SQL Security Helpers (SECURITY DEFINER)
  ## 5. Ownership transfer RPC (super_admin only)
  ## 6. Triggers for new tenants
*/

-- 1. NEW COLUMNS
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='owner_user_id') THEN
    ALTER TABLE tenants ADD COLUMN owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='site_access_mode') THEN
    ALTER TABLE profiles ADD COLUMN site_access_mode text NOT NULL DEFAULT 'selected';
  END IF;
END $$;

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS chk_site_access_mode;
ALTER TABLE profiles ADD CONSTRAINT chk_site_access_mode CHECK (site_access_mode IN ('all', 'selected'));

-- 2. BACKFILL tenants.owner_user_id
UPDATE tenants t
SET owner_user_id = sub.uid
FROM (
  SELECT DISTINCT ON (t2.id) t2.id AS tid, p.id AS uid
  FROM tenants t2
  JOIN profiles p ON p.tenant_id = t2.id AND p.is_active = true
  WHERE t2.owner_user_id IS NULL
  ORDER BY t2.id,
    CASE WHEN lower(trim(p.email)) = lower(trim(t2.email)) AND t2.email != '' THEN 0 ELSE 1 END,
    CASE WHEN p.role = 'admin' THEN 0 ELSE 1 END,
    p.created_at ASC
) sub
WHERE t.id = sub.tid AND t.owner_user_id IS NULL;

-- 3. BACKFILL profiles.site_access_mode

-- A: owners get 'all'
UPDATE profiles p
SET site_access_mode = 'all'
FROM tenants t
WHERE t.id = p.tenant_id AND t.owner_user_id = p.id;

-- B: non-owner with assigned_site_ids → normalize to root sites
UPDATE profiles p
SET assigned_site_ids = (
  SELECT array_agg(DISTINCT COALESCE(s.parent_site_id, s.id))
  FROM unnest(p.assigned_site_ids) AS aid(id)
  JOIN sites s ON s.id = aid.id AND s.tenant_id = p.tenant_id
),
site_access_mode = 'selected'
WHERE p.assigned_site_ids IS NOT NULL
  AND array_length(p.assigned_site_ids, 1) > 0
  AND p.site_access_mode != 'all';

-- C: remaining 'selected' with no sites → try default_site_id or single-root
WITH single_root AS (
  SELECT s.tenant_id, (array_agg(s.id))[1] AS site_id
  FROM sites s
  WHERE NOT s.is_warehouse AND s.is_active
  GROUP BY s.tenant_id
  HAVING count(*) = 1
)
UPDATE profiles p
SET assigned_site_ids = ARRAY[COALESCE(
  (SELECT s.id FROM sites s WHERE s.id = p.default_site_id AND s.tenant_id = p.tenant_id AND NOT s.is_warehouse AND s.is_active),
  (SELECT sr.site_id FROM single_root sr WHERE sr.tenant_id = p.tenant_id)
)]
WHERE p.site_access_mode = 'selected'
  AND (p.assigned_site_ids IS NULL OR array_length(p.assigned_site_ids, 1) IS NULL)
  AND p.tenant_id IS NOT NULL
  AND (
    EXISTS (SELECT 1 FROM sites s WHERE s.id = p.default_site_id AND s.tenant_id = p.tenant_id AND NOT s.is_warehouse AND s.is_active)
    OR EXISTS (SELECT 1 FROM single_root sr WHERE sr.tenant_id = p.tenant_id)
  );

-- 4. SQL SECURITY HELPERS

CREATE OR REPLACE FUNCTION current_user_is_owner()
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenants t
    JOIN profiles p ON p.tenant_id = t.id
    WHERE p.id = auth.uid() AND t.owner_user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION resolve_root_site_id(p_site_id uuid)
RETURNS uuid
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT COALESCE(s.parent_site_id, s.id) FROM sites s WHERE s.id = p_site_id;
$$;

CREATE OR REPLACE FUNCTION current_user_accessible_site_ids()
RETURNS uuid[]
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_prof record;
  v_result uuid[];
BEGIN
  SELECT p.id, p.tenant_id, p.site_access_mode, p.assigned_site_ids, p.role
  INTO v_prof FROM profiles p WHERE p.id = auth.uid();
  IF v_prof IS NULL OR v_prof.tenant_id IS NULL THEN RETURN '{}'; END IF;

  IF v_prof.role = 'super_admin'
     OR v_prof.site_access_mode = 'all'
     OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = v_prof.tenant_id AND t.owner_user_id = v_prof.id)
  THEN
    SELECT array_agg(s.id) INTO v_result
    FROM sites s WHERE s.tenant_id = v_prof.tenant_id AND s.is_active = true;
    RETURN COALESCE(v_result, '{}');
  END IF;

  IF v_prof.assigned_site_ids IS NOT NULL AND array_length(v_prof.assigned_site_ids, 1) > 0 THEN
    SELECT array_agg(s.id) INTO v_result
    FROM sites s
    WHERE s.tenant_id = v_prof.tenant_id AND s.is_active = true
      AND (s.id = ANY(v_prof.assigned_site_ids) OR s.parent_site_id = ANY(v_prof.assigned_site_ids));
    RETURN COALESCE(v_result, '{}');
  END IF;

  RETURN '{}';
END;
$$;

CREATE OR REPLACE FUNCTION current_user_can_access_site(p_site_id uuid)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT p_site_id = ANY(current_user_accessible_site_ids());
$$;

GRANT EXECUTE ON FUNCTION current_user_is_owner() TO authenticated;
GRANT EXECUTE ON FUNCTION resolve_root_site_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_accessible_site_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION current_user_can_access_site(uuid) TO authenticated;

-- 5. OWNERSHIP TRANSFER RPC
CREATE OR REPLACE FUNCTION transfer_tenant_ownership(p_tenant_id uuid, p_new_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller record;
  v_target record;
  v_old_owner uuid;
BEGIN
  SELECT * INTO v_caller FROM profiles WHERE id = auth.uid();
  IF v_caller IS NULL OR v_caller.role != 'super_admin' THEN
    RAISE EXCEPTION 'FORBIDDEN: only super_admin can transfer ownership';
  END IF;

  SELECT owner_user_id INTO v_old_owner FROM tenants WHERE id = p_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tenant not found'; END IF;

  SELECT * INTO v_target FROM profiles WHERE id = p_new_owner_id AND tenant_id = p_tenant_id;
  IF v_target IS NULL THEN RAISE EXCEPTION 'Target user not in this tenant'; END IF;

  UPDATE tenants SET owner_user_id = p_new_owner_id WHERE id = p_tenant_id;
  UPDATE profiles SET site_access_mode = 'all', role = 'admin' WHERE id = p_new_owner_id;

  INSERT INTO platform_events (actor_id, actor_email, tenant_id, action, payload)
  VALUES (auth.uid(), v_caller.email, p_tenant_id, 'transfer_ownership',
    jsonb_build_object('old_owner_id', v_old_owner, 'new_owner_id', p_new_owner_id, 'new_owner_email', v_target.email));

  RETURN jsonb_build_object('success', true, 'old_owner_id', v_old_owner, 'new_owner_id', p_new_owner_id);
END;
$$;

REVOKE ALL ON FUNCTION transfer_tenant_ownership(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION transfer_tenant_ownership(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION transfer_tenant_ownership(uuid, uuid) TO authenticated;

-- 6. TRIGGERS FOR NEW TENANTS
CREATE OR REPLACE FUNCTION _set_owner_on_provision()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.owner_user_id IS NULL THEN NEW.owner_user_id := auth.uid(); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_owner_on_provision ON tenants;
CREATE TRIGGER trg_set_owner_on_provision
  BEFORE INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION _set_owner_on_provision();

CREATE OR REPLACE FUNCTION _set_owner_access_mode()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM tenants t WHERE t.id = NEW.tenant_id AND t.owner_user_id = NEW.id
  ) THEN
    NEW.site_access_mode := 'all';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_owner_access_mode ON profiles;
CREATE TRIGGER trg_set_owner_access_mode
  BEFORE INSERT OR UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION _set_owner_access_mode();
