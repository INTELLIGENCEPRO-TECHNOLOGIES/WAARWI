-- F7: "Members update their tenant" is row-scoped while the client held UPDATE on
-- all 46 columns, letting any member change plan, subscription, approval and module
-- state. Narrow UPDATE to the identity/appearance columns the settings screens write.
-- Plan, approval and module changes keep flowing through the admin-users edge
-- function (service role) and the platform admin screens.

REVOKE UPDATE ON public.tenants FROM authenticated, anon;
REVOKE INSERT, DELETE ON public.tenants FROM anon, authenticated;

GRANT UPDATE (name, legal_name, ninea, rccm, address, phone, email, website,
              slogan, logo_url, public_slug, settings, ticket_header_config,
              primary_color, currency)
  ON public.tenants TO authenticated;
