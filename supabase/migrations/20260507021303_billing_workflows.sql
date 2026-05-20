/*
  # Billing workflows — quote→sale conversion, payment registration, credit application

  ## Summary
  Adds three RPC helpers and a credit tracking column to support the unified
  Facturation page workflows without changing any existing business logic:

  1. `convert_quote_to_sale(quote_id, site_id, cash_session_id, payments)` —
     Creates a sale + sale_items + sale_payments from a quote and marks the
     quote as `converted` (sets `converted_sale_id`). Does not touch stock
     (reserved flow stays with POS).
  2. `register_sale_payment(sale_id, payment_method_id, method_name, amount,
     reference, cash_session_id)` — Adds a single payment row on an existing
     sale, updates `sales.paid` and `sales.status` (paid/partial).
  3. `apply_credit_to_sale(credit_id, sale_id, amount)` — Applies part or all
     of an available credit (sale_returns with refund_method='avoir') as a
     payment on a sale, increments `sale_returns.credit_used`, registers a
     matching sale_payment row.

  ## Schema changes
  - `sale_returns.credit_used` (numeric, default 0) — tracks cumulative amount
    of an avoir already applied to sales. Non-destructive addition.

  ## Security
  - All RPCs are SECURITY DEFINER, use `current_tenant_id()` and check tenancy.
  - RLS on sale_returns unchanged.
*/

-- 1) credit_used tracker on sale_returns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='sale_returns' AND column_name='credit_used'
  ) THEN
    ALTER TABLE sale_returns ADD COLUMN credit_used numeric DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- 2) convert_quote_to_sale
CREATE OR REPLACE FUNCTION convert_quote_to_sale(
  p_quote_id uuid,
  p_site_id uuid,
  p_cash_session_id uuid DEFAULT NULL,
  p_payments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_quote record;
  v_sale_id uuid;
  v_sale_number text;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_payment jsonb;
  v_item record;
BEGIN
  v_tenant_id := current_tenant_id();
  v_user_id := auth.uid();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT * INTO v_quote FROM quotes
  WHERE id = p_quote_id AND tenant_id = v_tenant_id;

  IF v_quote.id IS NULL THEN RAISE EXCEPTION 'Devis introuvable'; END IF;
  IF v_quote.converted_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Devis déjà converti';
  END IF;

  v_subtotal := COALESCE(v_quote.subtotal, 0);
  v_total := COALESCE(v_quote.total, 0);

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_paid := v_paid + COALESCE((v_payment->>'amount')::numeric, 0);
  END LOOP;

  v_sale_number := 'F-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  INSERT INTO sales (
    tenant_id, site_id, cash_session_id, customer_id, user_id,
    sale_number, subtotal, discount, total, paid, status, source, note
  ) VALUES (
    v_tenant_id, p_site_id, p_cash_session_id, v_quote.customer_id, v_user_id,
    v_sale_number, v_subtotal, COALESCE(v_quote.discount, 0), v_total, v_paid,
    CASE WHEN v_paid >= v_total THEN 'paid' ELSE 'partial' END,
    'quote', COALESCE(v_quote.note, '')
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM quote_items WHERE quote_id = p_quote_id LOOP
    INSERT INTO sale_items (
      tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total
    ) VALUES (
      v_tenant_id, v_sale_id, v_item.article_id, v_item.name,
      v_item.quantity, v_item.unit_price, v_item.discount, v_item.total
    );
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO sale_payments (
      tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference
    ) VALUES (
      v_tenant_id, v_sale_id, p_cash_session_id,
      NULLIF(v_payment->>'payment_method_id','')::uuid,
      v_payment->>'method_name',
      (v_payment->>'amount')::numeric,
      COALESCE(v_payment->>'reference', '')
    );
  END LOOP;

  UPDATE quotes SET status = 'converted', converted_sale_id = v_sale_id
  WHERE id = p_quote_id;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number);
END;
$$;

-- 3) register_sale_payment
CREATE OR REPLACE FUNCTION register_sale_payment(
  p_sale_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT '',
  p_cash_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale record;
  v_new_paid numeric;
  v_new_status text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Facture introuvable'; END IF;

  INSERT INTO sale_payments (
    tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference
  ) VALUES (
    v_tenant_id, p_sale_id, p_cash_session_id, p_payment_method_id,
    COALESCE(p_method_name, ''), p_amount, COALESCE(p_reference, '')
  );

  v_new_paid := COALESCE(v_sale.paid, 0) + p_amount;
  v_new_status := CASE
    WHEN v_sale.status = 'cancelled' THEN 'cancelled'
    WHEN v_new_paid >= v_sale.total THEN 'paid'
    ELSE 'partial'
  END;

  UPDATE sales SET paid = v_new_paid, status = v_new_status WHERE id = p_sale_id;

  RETURN jsonb_build_object('paid', v_new_paid, 'status', v_new_status);
END;
$$;

-- 4) apply_credit_to_sale
CREATE OR REPLACE FUNCTION apply_credit_to_sale(
  p_credit_id uuid,
  p_sale_id uuid,
  p_amount numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_credit record;
  v_sale record;
  v_available numeric;
  v_to_apply numeric;
  v_remaining numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT * INTO v_credit FROM sale_returns
  WHERE id = p_credit_id AND tenant_id = v_tenant_id AND refund_method = 'avoir';
  IF v_credit.id IS NULL THEN RAISE EXCEPTION 'Avoir introuvable'; END IF;
  IF v_credit.status <> 'approved' THEN RAISE EXCEPTION 'Avoir non disponible'; END IF;

  v_available := COALESCE(v_credit.total, 0) - COALESCE(v_credit.credit_used, 0);
  IF v_available <= 0 THEN RAISE EXCEPTION 'Avoir entièrement utilisé'; END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Facture introuvable'; END IF;

  v_remaining := COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0);
  v_to_apply := LEAST(p_amount, v_available, v_remaining);
  IF v_to_apply <= 0 THEN RAISE EXCEPTION 'Rien à appliquer'; END IF;

  INSERT INTO sale_payments (
    tenant_id, sale_id, payment_method_id, method_name, amount, reference
  ) VALUES (
    v_tenant_id, p_sale_id, NULL, 'Avoir ' || v_credit.return_number,
    v_to_apply, v_credit.return_number
  );

  UPDATE sale_returns SET credit_used = COALESCE(credit_used, 0) + v_to_apply
  WHERE id = p_credit_id;

  UPDATE sales
  SET paid = COALESCE(paid, 0) + v_to_apply,
      status = CASE WHEN status = 'cancelled' THEN 'cancelled'
                    WHEN COALESCE(paid, 0) + v_to_apply >= total THEN 'paid'
                    ELSE 'partial' END
  WHERE id = p_sale_id;

  RETURN jsonb_build_object('applied', v_to_apply);
END;
$$;
