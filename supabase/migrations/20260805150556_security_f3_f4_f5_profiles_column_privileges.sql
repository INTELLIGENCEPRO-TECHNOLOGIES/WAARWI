-- F3, F4, F5: the profiles UPDATE policies are row-scoped while the client held
-- UPDATE on every column, so a user could set their own role, permissions or
-- tenant_id. Narrow UPDATE to the columns the app actually writes from the
-- browser (POS auto-print preferences, Settings site assignment, own name/phone).
-- Privileged changes continue to flow through the admin-users edge function,
-- which uses the service role and is unaffected by these grants.

REVOKE UPDATE ON public.profiles FROM authenticated, anon;
REVOKE INSERT, DELETE ON public.profiles FROM anon;

GRANT UPDATE (full_name, phone, default_site_id, assigned_site_ids,
              auto_print_ticket, auto_print_invoice)
  ON public.profiles TO authenticated;
