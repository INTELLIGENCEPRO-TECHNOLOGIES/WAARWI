-- F9: token-based tenant approval must only be reachable through the admin-users
-- edge function, which holds the service role. No browser client calls it.
REVOKE ALL ON FUNCTION public.auto_approve_tenant_by_token(uuid) FROM anon, authenticated;
