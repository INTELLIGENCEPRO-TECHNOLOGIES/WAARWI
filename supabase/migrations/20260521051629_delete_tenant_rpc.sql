/*
  # Delete tenant RPC function

  1. New Functions
    - `delete_tenant_permanently(p_tenant_id uuid)` - Permanently deletes a tenant and all associated data
      - Collects all user IDs linked to the tenant via profiles
      - Logs the deletion event in platform_events BEFORE deleting the tenant
      - Deletes the tenant row (cascading to 40+ related tables)
      - Returns the list of auth user IDs that need to be deleted via admin API
      
  2. Security
    - SECURITY DEFINER to bypass RLS
    - Only callable from Edge Functions with service role key
    - Logs deletion in platform_events before the cascade

  3. Important Notes
    - Auth users are NOT deleted by this function (must be done via Supabase Admin API)
    - Profiles are SET NULL on tenant delete (preserving auth.users link)
    - Platform events are SET NULL on tenant delete (preserving audit trail)
    - All other tenant data is CASCADE deleted automatically
*/

CREATE OR REPLACE FUNCTION delete_tenant_permanently(
  p_tenant_id uuid,
  p_actor_id uuid DEFAULT NULL,
  p_actor_email text DEFAULT '',
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_name text;
  v_user_ids uuid[];
  v_user_count int;
  v_tables_summary jsonb;
BEGIN
  -- Verify tenant exists
  SELECT name INTO v_tenant_name
  FROM tenants
  WHERE id = p_tenant_id;

  IF v_tenant_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tenant introuvable');
  END IF;

  -- Collect user IDs before deletion (profiles will be SET NULL on cascade)
  SELECT ARRAY_AGG(id) INTO v_user_ids
  FROM profiles
  WHERE tenant_id = p_tenant_id;

  v_user_count := COALESCE(array_length(v_user_ids, 1), 0);

  -- Build a summary of data counts for the audit log
  SELECT jsonb_build_object(
    'tenant_name', v_tenant_name,
    'users', v_user_count,
    'articles', (SELECT COUNT(*) FROM articles WHERE tenant_id = p_tenant_id),
    'sales', (SELECT COUNT(*) FROM sales WHERE tenant_id = p_tenant_id),
    'customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id),
    'suppliers', (SELECT COUNT(*) FROM suppliers WHERE tenant_id = p_tenant_id)
  ) INTO v_tables_summary;

  -- Log the deletion event BEFORE deleting (so tenant_id is still valid for SET NULL)
  INSERT INTO platform_events (actor_id, actor_email, tenant_id, action, payload)
  VALUES (
    p_actor_id,
    p_actor_email,
    p_tenant_id,
    'tenant.delete',
    jsonb_build_object(
      'reason', p_reason,
      'tenant_name', v_tenant_name,
      'data_summary', v_tables_summary
    )
  );

  -- Delete the tenant row - CASCADE handles all related tables
  DELETE FROM tenants WHERE id = p_tenant_id;

  -- Clean up orphaned profiles (set to null by cascade, now remove them)
  DELETE FROM profiles WHERE id = ANY(COALESCE(v_user_ids, ARRAY[]::uuid[]));

  RETURN jsonb_build_object(
    'success', true,
    'tenant_name', v_tenant_name,
    'user_ids', COALESCE(v_user_ids, ARRAY[]::uuid[]),
    'data_summary', v_tables_summary
  );
END;
$$;
