/*
  # Restore EXECUTE on current_tenant_id helper

  The previous hardening migration revoked EXECUTE from PUBLIC/anon on
  `public.current_tenant_id()`. This function is referenced by nearly
  every RLS policy in the schema. When PostgreSQL evaluates an RLS
  policy, it uses the current role's privileges, and revoking PUBLIC
  can break RLS evaluation for roles that never had an explicit GRANT.

  This migration restores safe usage:
  1. Re-grants EXECUTE on `current_tenant_id()` to PUBLIC.
     The function is inherently safe: it returns only the caller's own
     tenant_id (via auth.uid()). Exposing it to anon simply returns NULL
     since anon has no auth.uid(). There is no data leakage risk.

  ## Notes
  1. No schema changes — only privilege adjustment.
  2. All other hardening from the previous migration remains in place.
*/

GRANT EXECUTE ON FUNCTION public.current_tenant_id() TO PUBLIC;
