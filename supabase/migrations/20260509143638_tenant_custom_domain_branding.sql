/*
  # Custom domain & public branding per tenant

  1. Schema
    - Adds `custom_domain` (text, unique, lowercase) and `subdomain` (text, unique) on `tenants`.
    - `subdomain` is used for automatic `{subdomain}.app.tld` access.
    - `custom_domain` is the fully-qualified domain the tenant configures with a CNAME.

  2. Public branding access
    - Creates a SECURITY DEFINER RPC `public_tenant_branding(p_domain text)` that returns
      only the non-sensitive branding fields (name, logo, primary color, business type,
      approval status). Anyone (including anon users on the login page) can call it.
    - No direct table policy is opened — access stays restricted to the RPC.

  3. Indexes
    - Unique indexes on `custom_domain` and `subdomain` for fast lookup and integrity.

  Safe/idempotent: uses IF NOT EXISTS and DO-wrapped blocks.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'custom_domain'
  ) THEN
    ALTER TABLE public.tenants ADD COLUMN custom_domain text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'subdomain'
  ) THEN
    ALTER TABLE public.tenants ADD COLUMN subdomain text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_custom_domain_key
  ON public.tenants (lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tenants_subdomain_key
  ON public.tenants (lower(subdomain))
  WHERE subdomain IS NOT NULL;

CREATE OR REPLACE FUNCTION public.public_tenant_branding(p_domain text)
RETURNS TABLE (
  id uuid,
  name text,
  legal_name text,
  logo_url text,
  primary_color text,
  business_type text,
  approval_status text,
  phone text,
  address text,
  tagline text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.name,
    COALESCE(t.legal_name, t.name) AS legal_name,
    t.logo_url,
    COALESCE(t.primary_color, '#1e40af') AS primary_color,
    t.business_type,
    t.approval_status,
    t.phone,
    t.address,
    COALESCE(ss.tagline, '') AS tagline
  FROM public.tenants t
  LEFT JOIN public.shop_settings ss ON ss.tenant_id = t.id
  WHERE p_domain IS NOT NULL
    AND (
      lower(t.custom_domain) = lower(p_domain)
      OR lower(t.subdomain) = lower(split_part(p_domain, '.', 1))
    )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.public_tenant_branding(text) TO anon, authenticated;