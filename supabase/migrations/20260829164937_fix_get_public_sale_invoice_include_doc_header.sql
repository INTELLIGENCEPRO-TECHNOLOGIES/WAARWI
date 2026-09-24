-- Update get_public_sale_invoice to include doc_header in the sale object
-- so the public invoice link displays delivery date, reference, warranty, etc.
CREATE OR REPLACE FUNCTION public.get_public_sale_invoice(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale   public.sales%ROWTYPE;
  v_items  jsonb;
  v_pays   jsonb;
  v_cust   jsonb;
  v_tenant jsonb;
BEGIN
  SELECT * INTO v_sale FROM public.sales WHERE public_code = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Items
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'name', i.name,
    'quantity', i.quantity,
    'unit_price', i.unit_price,
    'discount', i.discount,
    'total', i.total
  ) ORDER BY i.name), '[]'::jsonb)
  INTO v_items
  FROM public.sale_items i
  WHERE i.sale_id = v_sale.id;

  -- Payments
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'method_name', p.method_name,
    'amount', p.amount
  )), '[]'::jsonb)
  INTO v_pays
  FROM public.sale_payments p
  WHERE p.sale_id = v_sale.id;

  -- Customer
  IF v_sale.customer_id IS NOT NULL THEN
    SELECT jsonb_build_object(
      'name', c.name,
      'phone', c.phone,
      'email', c.email,
      'address', c.address
    ) INTO v_cust
    FROM public.customers c
    WHERE c.id = v_sale.customer_id;
  END IF;

  -- Tenant
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
  WHERE t.id = v_sale.tenant_id;

  RETURN jsonb_build_object(
    'sale', jsonb_build_object(
      'sale_number', v_sale.sale_number,
      'created_at', v_sale.created_at,
      'status', v_sale.status,
      'subtotal', v_sale.subtotal,
      'discount', v_sale.discount,
      'total', v_sale.total,
      'paid', COALESCE(v_sale.paid, 0),
      'note', v_sale.note,
      'doc_header', v_sale.doc_header
    ),
    'customer', v_cust,
    'tenant', v_tenant,
    'items', v_items,
    'payments', v_pays
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_sale_invoice(text) TO anon, authenticated;
