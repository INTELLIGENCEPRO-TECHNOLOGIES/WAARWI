/*
  # Supplier orders — public share token

  1. Changes
    - Add `public_token` (text, unique) to `supplier_orders` so a purchase order can be shared
      via a stable, unguessable URL (sent by WhatsApp / email) without requiring login.
    - Backfill existing rows with random tokens.

  2. Security
    - The token itself is the capability (like a signed URL). We expose a SECURITY DEFINER RPC
      `get_public_supplier_order(p_token)` that returns only safe, presentation-ready data
      (tenant branding, supplier contact, line items). No RLS opening on base tables.
*/

ALTER TABLE public.supplier_orders
  ADD COLUMN IF NOT EXISTS public_token text;

UPDATE public.supplier_orders
  SET public_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
  WHERE public_token IS NULL;

ALTER TABLE public.supplier_orders
  ALTER COLUMN public_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_orders_public_token_key
  ON public.supplier_orders(public_token);

ALTER TABLE public.supplier_orders
  ALTER COLUMN public_token SET DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));

CREATE OR REPLACE FUNCTION public.get_public_supplier_order(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order  public.supplier_orders%ROWTYPE;
  v_items  jsonb;
  v_supp   jsonb;
  v_tenant jsonb;
BEGIN
  SELECT * INTO v_order FROM public.supplier_orders WHERE public_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', i.name,
    'supplier_ref', i.supplier_ref,
    'quantity_ordered', i.quantity_ordered,
    'quantity_received', i.quantity_received,
    'unit_price', i.unit_price,
    'total', i.total
  ) ORDER BY i.name), '[]'::jsonb)
  INTO v_items
  FROM public.supplier_order_items i
  WHERE i.order_id = v_order.id;

  SELECT jsonb_build_object(
    'name', s.name,
    'phone', s.phone,
    'email', s.email,
    'address', s.address
  ) INTO v_supp
  FROM public.suppliers s
  WHERE s.id = v_order.supplier_id;

  SELECT jsonb_build_object(
    'name', t.name,
    'legal_name', t.legal_name,
    'ninea', t.ninea,
    'rccm', t.rccm,
    'address', t.address,
    'phone', t.phone,
    'email', t.email,
    'website', t.website,
    'logo_url', t.logo_url,
    'business_type', t.business_type
  ) INTO v_tenant
  FROM public.tenants t
  WHERE t.id = v_order.tenant_id;

  RETURN jsonb_build_object(
    'order', jsonb_build_object(
      'order_number', v_order.order_number,
      'created_at', v_order.created_at,
      'expected_date', v_order.expected_date,
      'status', v_order.status,
      'subtotal', v_order.subtotal,
      'discount', v_order.discount,
      'total', v_order.total,
      'note', v_order.note
    ),
    'supplier', v_supp,
    'tenant', v_tenant,
    'items', v_items
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_supplier_order(text) TO anon, authenticated;
