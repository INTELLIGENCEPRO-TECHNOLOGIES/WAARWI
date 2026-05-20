/*
  # Exclude customer-credit payments from paid total

  ## Summary
  The POS method "Crédit client" (payment_type='credit') represents an amount
  owed by the customer, not a cash receipt. The previous create_pos_sale
  function counted it as paid, causing invoices to be marked "paid" and the
  customer balance to stay at 0 for what should have been a receivable.

  ## Changes
  - `create_pos_sale`: looks up payment_methods.payment_type for each
    payment; excludes payment_type='credit' from v_paid so the sale status
    becomes 'partial' (or 'validated' when nothing cash was paid).
  - Credit lines are still inserted into sale_payments for traceability,
    but with cash_session_id = NULL so they don't distort cash control.
  - Sale status now distinguishes:
      v_paid = 0                  -> 'validated' (pure credit sale)
      0 < v_paid < v_total        -> 'partial'
      v_paid >= v_total           -> 'paid'

  ## Security
  No RLS changes. Function remains SECURITY DEFINER and tenant-scoped via
  current_tenant_id().
*/

CREATE OR REPLACE FUNCTION create_pos_sale(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric DEFAULT 0,
  p_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_sale_id uuid;
  v_sale_number text;
  v_item jsonb;
  v_payment jsonb;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_previous numeric;
  v_new numeric;
  v_line_total numeric;
  v_status text;
  v_pm_type text;
  v_pm_id uuid;
  v_amount numeric;
  v_session uuid;
BEGIN
  v_user_id := auth.uid();
  v_tenant_id := current_tenant_id();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant introuvable';
  END IF;

  v_sale_number := 'V-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := v_subtotal - COALESCE(p_discount, 0);

  -- Paid total excludes credit-type lines (promise to pay, not cash)
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_pm_id := NULLIF(v_payment->>'payment_method_id','')::uuid;
    v_amount := (v_payment->>'amount')::numeric;
    v_pm_type := NULL;
    IF v_pm_id IS NOT NULL THEN
      SELECT payment_type INTO v_pm_type FROM payment_methods WHERE id = v_pm_id;
    END IF;
    IF COALESCE(v_pm_type,'') <> 'credit' THEN
      v_paid := v_paid + v_amount;
    END IF;
  END LOOP;

  v_status := CASE
    WHEN v_paid >= v_total AND v_total > 0 THEN 'paid'
    WHEN v_paid > 0 THEN 'partial'
    ELSE 'validated'
  END;

  INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, user_id, sale_number, subtotal, discount, total, paid, status, note)
  VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_user_id, v_sale_number, v_subtotal, COALESCE(p_discount,0), v_total, v_paid,
    v_status, COALESCE(p_note, ''))
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);

    INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost)
    VALUES (v_tenant_id, v_sale_id, (v_item->>'article_id')::uuid, v_item->>'name',
      (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'discount')::numeric, 0), v_line_total,
      COALESCE((v_item->>'purchase_cost')::numeric, 0));

    SELECT quantity INTO v_previous FROM stock_levels
    WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;

    IF v_previous IS NULL THEN
      v_previous := 0;
      INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
      VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 0);
    END IF;

    v_new := v_previous - (v_item->>'quantity')::numeric;

    UPDATE stock_levels SET quantity = v_new, updated_at = now()
    WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;

    INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
    VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 'sale',
      -(v_item->>'quantity')::numeric, v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente ' || v_sale_number);
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_pm_id := NULLIF(v_payment->>'payment_method_id','')::uuid;
    v_pm_type := NULL;
    IF v_pm_id IS NOT NULL THEN
      SELECT payment_type INTO v_pm_type FROM payment_methods WHERE id = v_pm_id;
    END IF;
    -- Credit lines: detach from cash session (not a real cash inflow)
    v_session := CASE WHEN COALESCE(v_pm_type,'') = 'credit' THEN NULL ELSE p_cash_session_id END;

    INSERT INTO sale_payments (tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference)
    VALUES (v_tenant_id, v_sale_id, v_session, v_pm_id,
      v_payment->>'method_name',
      (v_payment->>'amount')::numeric,
      COALESCE(v_payment->>'reference', ''));
  END LOOP;

  RETURN jsonb_build_object('sale_number', v_sale_number, 'sale_id', v_sale_id);
END;
$$;