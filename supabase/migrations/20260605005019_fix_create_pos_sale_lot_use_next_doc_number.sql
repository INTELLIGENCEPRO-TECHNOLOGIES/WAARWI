/*
  # Fix create_pos_sale_lot: use next_doc_number instead of document_counters

  The function was referencing a non-existent table `document_counters`.
  The correct approach is to use the `next_doc_number()` function which uses
  `tenant_doc_counters` table.
*/

DROP FUNCTION IF EXISTS create_pos_sale_lot(uuid, uuid, uuid, jsonb, jsonb, numeric, text);

CREATE OR REPLACE FUNCTION create_pos_sale_lot(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric,
  p_note text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale_id uuid;
  v_sale_number text;
  v_item jsonb;
  v_pay jsonb;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_previous numeric;
  v_new numeric;
  v_user_id uuid := auth.uid();
  v_stock_method text;
  v_lot RECORD;
  v_remaining numeric;
  v_deduct numeric;
BEGIN
  v_tenant_id := current_tenant_id();

  -- Get stock method from tenant settings
  SELECT COALESCE((settings->>'stock_method'), 'none')
  INTO v_stock_method
  FROM tenants WHERE id = v_tenant_id;

  -- Generate sale number using the correct function
  v_sale_number := next_doc_number(v_tenant_id, 'sale', 'V');

  -- Calculate total
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_total := v_total + ((v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric) - COALESCE((v_item->>'discount')::numeric, 0);
  END LOOP;
  v_total := v_total - COALESCE(p_discount, 0);

  -- Create sale
  INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, sale_number, total, discount, note, user_id)
  VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_sale_number, v_total, p_discount, p_note, v_user_id)
  RETURNING id INTO v_sale_id;

  -- Process items and deduct stock
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    INSERT INTO sale_items (sale_id, tenant_id, article_id, article_name, quantity, unit_price, discount, purchase_cost)
    VALUES (v_sale_id, v_tenant_id, (v_item->>'article_id')::uuid, v_item->>'name',
      (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'discount')::numeric, 0), COALESCE((v_item->>'purchase_cost')::numeric, 0));

    -- Get current stock
    SELECT quantity INTO v_previous FROM stock_levels
    WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;
    IF v_previous IS NULL THEN
      v_previous := 0;
      INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
      VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 0);
    END IF;

    v_new := v_previous - (v_item->>'quantity')::numeric;

    -- If lot mode, deduct from lots (FEFO - First Expired First Out)
    IF v_stock_method = 'lot' THEN
      v_remaining := (v_item->>'quantity')::numeric;
      FOR v_lot IN
        SELECT id, remaining_quantity
        FROM stock_lots
        WHERE article_id = (v_item->>'article_id')::uuid
          AND site_id = p_site_id
          AND tenant_id = v_tenant_id
          AND remaining_quantity > 0
        ORDER BY expiry_date ASC NULLS LAST, received_at ASC
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_deduct := LEAST(v_lot.remaining_quantity, v_remaining);
        UPDATE stock_lots SET remaining_quantity = remaining_quantity - v_deduct WHERE id = v_lot.id;
        v_remaining := v_remaining - v_deduct;
      END LOOP;
    END IF;

    -- Update stock_levels
    UPDATE stock_levels SET quantity = v_new, updated_at = now()
    WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;

    -- Record movement
    INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
    VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 'sale', -(v_item->>'quantity')::numeric,
      v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente ' || v_sale_number);
  END LOOP;

  -- Process payments
  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    DECLARE
      v_pay_type text := 'cash';
    BEGIN
      SELECT payment_type INTO v_pay_type FROM payment_methods WHERE id = (v_pay->>'payment_method_id')::uuid;
      IF v_pay_type IS NULL THEN v_pay_type := 'cash'; END IF;

      IF v_pay_type <> 'credit' THEN
        v_paid := v_paid + (v_pay->>'amount')::numeric;
      END IF;

      INSERT INTO sale_payments (sale_id, tenant_id, payment_method_id, method_name, amount, reference, cash_session_id)
      VALUES (v_sale_id, v_tenant_id, (v_pay->>'payment_method_id')::uuid, v_pay->>'method_name',
        (v_pay->>'amount')::numeric, COALESCE(v_pay->>'reference', ''),
        CASE WHEN v_pay_type = 'cash' THEN p_cash_session_id ELSE NULL END);
    END;
  END LOOP;

  -- Update sale paid amount and status
  UPDATE sales SET paid = v_paid, status = CASE WHEN v_paid >= v_total THEN 'paid' ELSE 'partial' END
  WHERE id = v_sale_id;

  -- Update cash session totals
  IF p_cash_session_id IS NOT NULL THEN
    UPDATE cash_sessions
    SET total_sales = total_sales + v_paid,
        theoretical_balance = theoretical_balance + v_paid
    WHERE id = p_cash_session_id;
  END IF;

  RETURN jsonb_build_object('sale_number', v_sale_number, 'sale_id', v_sale_id);
END;
$$;

GRANT EXECUTE ON FUNCTION create_pos_sale_lot TO authenticated;
