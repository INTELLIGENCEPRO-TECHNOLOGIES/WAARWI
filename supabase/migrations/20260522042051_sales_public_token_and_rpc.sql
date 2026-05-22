/*
  # Add public sharing for sale invoices

  1. New Columns
    - `sales.public_code` (text, unique, auto-generated) - short code for public invoice URL

  2. New Functions
    - `_gen_sale_public_code()` - generates unique 10-char alphanumeric code
    - `get_public_sale_invoice(p_token text)` - returns invoice data for public viewing (no auth required)

  3. Security
    - `get_public_sale_invoice` is granted to anon and authenticated roles
    - Only exposes invoice summary data, not sensitive business info

  4. Important Notes
    - Uses same pattern as supplier_orders public_code
    - Backfills existing sales with generated codes
    - Trigger auto-generates code on INSERT
*/

-- 1. Code generator function
CREATE OR REPLACE FUNCTION public._gen_sale_public_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_alphabet text := 'abcdefghijklmnopqrstuvwxyz0123456789';
  v_code text;
  v_i int;
  v_attempts int := 0;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..10 LOOP
      v_code := v_code || substr(
        v_alphabet,
        1 + floor(random() * length(v_alphabet))::int,
        1
      );
    END LOOP;

    PERFORM 1 FROM public.sales WHERE public_code = v_code LIMIT 1;
    IF NOT FOUND THEN
      RETURN v_code;
    END IF;

    v_attempts := v_attempts + 1;
    IF v_attempts > 50 THEN
      RAISE EXCEPTION 'Impossible de générer un code public unique pour la vente';
    END IF;
  END LOOP;
END;
$$;

-- 2. Add column
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS public_code text;

-- 3. Backfill existing rows
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.sales WHERE public_code IS NULL LOOP
    UPDATE public.sales SET public_code = public._gen_sale_public_code() WHERE id = r.id;
  END LOOP;
END $$;

-- 4. Set NOT NULL + UNIQUE + DEFAULT
ALTER TABLE public.sales
  ALTER COLUMN public_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sales_public_code_key
  ON public.sales(public_code);

ALTER TABLE public.sales
  ALTER COLUMN public_code SET DEFAULT (public._gen_sale_public_code());

-- 5. Auto-generate trigger
CREATE OR REPLACE FUNCTION public._trg_sale_public_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.public_code IS NULL OR NEW.public_code = '' THEN
    NEW.public_code := public._gen_sale_public_code();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sale_public_code ON public.sales;
CREATE TRIGGER trg_sale_public_code
  BEFORE INSERT ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public._trg_sale_public_code();

-- 6. Public RPC to fetch invoice by token
CREATE OR REPLACE FUNCTION public.get_public_sale_invoice(p_token text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
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
      'paid', v_sale.paid,
      'note', v_sale.note
    ),
    'customer', v_cust,
    'tenant', v_tenant,
    'items', v_items,
    'payments', v_pays
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_sale_invoice(text) TO anon, authenticated;
