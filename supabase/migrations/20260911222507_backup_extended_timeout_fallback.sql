/*
# Extended timeout fallback for backup creation

## Summary
Creates a wrapper function `_br_create_backup_for_tenant_extended` that calls
the original `_br_create_backup_for_tenant` with a 60-second statement timeout
instead of the default 8s inherited from the authenticator role.

## Purpose
Four tenants with large datasets consistently fail backup with
"canceling statement due to statement timeout" (PostgreSQL error 57014).
The authenticator role has statement_timeout=8s, which is too short for
these tenants. This wrapper applies a per-function 60s timeout without
changing any global or role-level settings.

## New Function
- `_br_create_backup_for_tenant_extended(uuid, text, text)` → jsonb
  - SECURITY DEFINER, search_path = public, pg_temp
  - SET statement_timeout TO '60s'
  - Delegates to `_br_create_backup_for_tenant` with identical parameters
  - Granted to service_role only

## Important notes
1. The original `_br_create_backup_for_tenant` is NOT modified.
2. No role-level or database-level timeout changes.
3. No changes to backup format, checksums, restore, or offsite transfer.
*/

CREATE OR REPLACE FUNCTION public._br_create_backup_for_tenant_extended(
  p_tenant_id uuid,
  p_label text DEFAULT 'auto'::text,
  p_kind text DEFAULT 'auto'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'pg_temp'
SET statement_timeout TO '60s'
AS $fn$
BEGIN
  RETURN public._br_create_backup_for_tenant(p_tenant_id, p_label, p_kind);
END;
$fn$;

REVOKE ALL ON FUNCTION public._br_create_backup_for_tenant_extended(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._br_create_backup_for_tenant_extended(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public._br_create_backup_for_tenant_extended(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._br_create_backup_for_tenant_extended(uuid, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
