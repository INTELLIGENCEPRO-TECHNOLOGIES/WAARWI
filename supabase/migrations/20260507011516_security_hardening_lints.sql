/*
  # Security hardening (lint fixes)

  1. Fix mutable search_path on `public.create_pos_sale`
     - Pin `search_path = public` to prevent role-based hijacking.

  2. Tighten RLS on `public.tenants`
     - Drop permissive `Authenticated create tenant` policy (WITH CHECK true).
     - Tenant creation must go through the SECURITY DEFINER `provision_tenant`
       RPC; direct INSERTs are no longer allowed for authenticated users.

  3. Storage bucket `brand-logos`
     - Remove broad public SELECT policy on `storage.objects` that allowed
       listing all files. Object URLs for public buckets remain accessible
       directly without needing a SELECT policy.

  4. SECURITY DEFINER function hardening
     - Revoke EXECUTE from `PUBLIC` and `anon` on sensitive RPCs.
     - Explicitly grant EXECUTE only to `authenticated` (intended callers).
     - `provision_tenant` remains callable by `authenticated` for signup
       flow (user must be logged in but without a tenant yet).

  ## Notes
  1. No data is modified; only permissions and policy definitions.
  2. Behavior for legitimate authenticated users is unchanged.
*/

-- 1. Pin search_path on create_pos_sale
ALTER FUNCTION public.create_pos_sale(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric,
  p_note text
) SET search_path = public;

-- 2. Tighten tenants INSERT policy
DROP POLICY IF EXISTS "Authenticated create tenant" ON public.tenants;
-- Intentionally no direct INSERT policy; use provision_tenant RPC.

-- 3. Remove broad SELECT policy on storage.objects for brand-logos
DROP POLICY IF EXISTS "Brand logos are publicly readable" ON storage.objects;

-- 4. Revoke execute from anon/PUBLIC on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.current_tenant_id() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_tenant_id() TO authenticated;

REVOKE EXECUTE ON FUNCTION public.adjust_stock(
  p_article_id uuid, p_site_id uuid, p_quantity numeric,
  p_movement_type text, p_note text
) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.adjust_stock(
  p_article_id uuid, p_site_id uuid, p_quantity numeric,
  p_movement_type text, p_note text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.create_pos_sale(
  p_site_id uuid, p_cash_session_id uuid, p_customer_id uuid,
  p_items jsonb, p_payments jsonb, p_discount numeric, p_note text
) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_pos_sale(
  p_site_id uuid, p_cash_session_id uuid, p_customer_id uuid,
  p_items jsonb, p_payments jsonb, p_discount numeric, p_note text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.provision_tenant(
  p_company_name text, p_user_full_name text
) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.provision_tenant(
  p_company_name text, p_user_full_name text
) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.provision_vehicle_models(
  p_tenant_id uuid
) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.provision_vehicle_models(
  p_tenant_id uuid
) TO authenticated;
