/*
  # Add login background image to tenants

  1. Modified Tables
    - `tenants`
      - `login_bg_url` (text, nullable) - URL for the login page background image

  2. Function Updates
    - Replaced `public_tenant_branding` RPC to include login_bg_url in returned data

  3. Notes
    - Background image is optional; when null, Auth page renders as before
    - Image should be uploaded compressed for fast loading
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'login_bg_url'
  ) THEN
    ALTER TABLE tenants ADD COLUMN login_bg_url text;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public_tenant_branding(text);

CREATE FUNCTION public_tenant_branding(p_domain text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'legal_name', t.legal_name,
    'logo_url', t.logo_url,
    'primary_color', t.primary_color,
    'business_type', t.business_type,
    'approval_status', t.approval_status,
    'phone', t.phone,
    'address', t.address,
    'tagline', COALESCE(
      (SELECT ss.slogan FROM shop_settings ss WHERE ss.tenant_id = t.id LIMIT 1),
      t.slogan
    ),
    'login_bg_url', t.login_bg_url
  ) INTO result
  FROM tenants t
  WHERE t.is_active = true
    AND t.approval_status = 'approved'
    AND (t.custom_domain = lower(p_domain) OR t.subdomain = split_part(lower(p_domain), '.', 1))
  LIMIT 1;

  RETURN result;
END;
$$;
