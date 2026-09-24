-- F8: the public shop policy exposed all 46 tenant columns to anon, including
-- approval_token (the only credential of the token approval flow), the billing
-- block and the responsible person's details. Restrict anon reads to the columns
-- the public storefront actually needs; signed-in members keep full SELECT via RLS.

REVOKE SELECT ON public.tenants FROM anon;

GRANT SELECT (id, name, legal_name, logo_url, phone, email, address, website,
              currency, enabled_modules, is_active, approval_status, business_type,
              public_slug, custom_domain, subdomain, primary_color, slogan,
              login_bg_url, ticket_header_config)
  ON public.tenants TO anon;
