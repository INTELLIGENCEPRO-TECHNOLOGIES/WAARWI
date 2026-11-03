/*
# Fix permanent tenant deletion blocked by register assignments

1. Problem
- Deleting a tenant cascades `profiles.tenant_id` to NULL (ON DELETE SET NULL).
- `cash_register_assignments.cra_profile_fk` references `profiles(tenant_id, id)` with no ON UPDATE action,
  so that update is rejected and the whole deletion fails.

2. Change
- `delete_tenant_permanently` now removes the tenant's register assignments before deleting the tenant.
  These rows would be deleted anyway by the tenant deletion cascade; nothing else changes.

3. Security
- Function body, SECURITY DEFINER, search_path and the platform-operator guard are unchanged.
  CREATE OR REPLACE keeps existing EXECUTE grants.
*/

CREATE OR REPLACE FUNCTION public.delete_tenant_permanently(p_tenant_id uuid, p_actor_id uuid DEFAULT NULL::uuid, p_actor_email text DEFAULT ''::text, p_reason text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_tenant_name text;
v_user_ids uuid[];
v_user_count int;
v_tables_summary jsonb;
v_actor_id uuid;
v_actor_email text;
BEGIN
PERFORM public.assert_platform_operator();

v_actor_id := coalesce(auth.uid(), p_actor_id);
v_actor_email := coalesce((SELECT email FROM profiles WHERE id = auth.uid()), p_actor_email);

SELECT name INTO v_tenant_name FROM tenants WHERE id = p_tenant_id;

IF v_tenant_name IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Tenant introuvable');
END IF;

SELECT ARRAY_AGG(id) INTO v_user_ids FROM profiles WHERE tenant_id = p_tenant_id;
v_user_count := COALESCE(array_length(v_user_ids, 1), 0);

SELECT jsonb_build_object(
'tenant_name', v_tenant_name,
'users', v_user_count,
'articles', (SELECT COUNT(*) FROM articles WHERE tenant_id = p_tenant_id),
'sales', (SELECT COUNT(*) FROM sales WHERE tenant_id = p_tenant_id),
'customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id),
'suppliers', (SELECT COUNT(*) FROM suppliers WHERE tenant_id = p_tenant_id)
) INTO v_tables_summary;

INSERT INTO platform_events (actor_id, actor_email, tenant_id, action, payload)
VALUES (v_actor_id, v_actor_email, p_tenant_id, 'tenant.delete',
jsonb_build_object('reason', p_reason, 'tenant_name', v_tenant_name, 'data_summary', v_tables_summary));

DELETE FROM cash_register_assignments WHERE tenant_id = p_tenant_id;
DELETE FROM tenants WHERE id = p_tenant_id;
DELETE FROM profiles WHERE id = ANY(COALESCE(v_user_ids, ARRAY[]::uuid[]));

RETURN jsonb_build_object(
'success', true,
'tenant_name', v_tenant_name,
'user_ids', COALESCE(v_user_ids, ARRAY[]::uuid[]),
'data_summary', v_tables_summary
);
END;
$function$;