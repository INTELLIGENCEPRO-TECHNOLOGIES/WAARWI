-- Update create_pos_sale_lot: skip stock_levels/stock_movements/lot deductions for articles with track_stock = false
CREATE OR REPLACE FUNCTION public.create_pos_sale_lot(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid DEFAULT NULL,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_payments jsonb DEFAULT '[]'::jsonb,
  p_discount numeric DEFAULT 0,
  p_note text DEFAULT '',
  p_lot_assignments jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale_id uuid;
  v_sale_number text;
  v_item jsonb;
  v_pay jsonb;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_paid numeric := 0;
  v_previous numeric;
  v_new numeric;
  v_user_id uuid := auth.uid();
  v_stock_method text;
  v_lot RECORD;
  v_remaining numeric;
  v_deduct numeric;
  v_article_lots jsonb;
  v_lot_assign jsonb;
  v_line_total numeric;
  v_cash_in_session numeric := 0;
  v_pm_type text;
  v_pm_id uuid;
  v_amount numeric;
  v_session uuid;
  v_status text;
  v_track_stock boolean;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT COALESCE((settings->>'stock_method'), 'none')
    INTO v_stock_method FROM tenants WHERE id = v_tenant_id;

  v_sale_number := next_doc_number(v_tenant_id, 'sale', 'V');

  -- Calculate subtotal
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;
  v_total := v_subtotal - COALESCE(p_discount, 0);

  -- Calculate paid (excluding credit)
  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_pm_id := NULLIF(v_pay->>'payment_method_id','')::uuid;
    v_amount := (v_pay->>'amount')::numeric;
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

  -- Insert sale
  INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, user_id, sale_number, subtotal, discount, total, paid, status, note)
  VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_user_id, v_sale_number, v_subtotal, COALESCE(p_discount,0), v_total, v_paid, v_status, COALESCE(p_note,''))
  RETURNING id INTO v_sale_id;

  -- Insert items, deduct stock + lots (only for tracked articles)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);

    INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost)
    VALUES (v_tenant_id, v_sale_id, (v_item->>'article_id')::uuid, v_item->>'name',
      (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'discount')::numeric, 0), v_line_total,
      COALESCE((v_item->>'purchase_cost')::numeric, 0));

    -- Check article track_stock flag
    SELECT COALESCE(track_stock, true) INTO v_track_stock
      FROM articles WHERE id = (v_item->>'article_id')::uuid;

    -- Skip all stock operations for non-tracked articles
    IF COALESCE(v_track_stock, true) THEN
      SELECT quantity INTO v_previous FROM stock_levels
        WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;
      IF v_previous IS NULL THEN
        v_previous := 0;
        INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
        VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 0);
      END IF;

      v_new := v_previous - (v_item->>'quantity')::numeric;

      -- Lot deduction
      IF v_stock_method = 'lot' THEN
        v_article_lots := NULL;
        IF p_lot_assignments IS NOT NULL THEN
          v_article_lots := p_lot_assignments->(v_item->>'article_id');
        END IF;

        IF v_article_lots IS NOT NULL AND jsonb_array_length(v_article_lots) > 0 THEN
          FOR v_lot_assign IN SELECT * FROM jsonb_array_elements(v_article_lots) LOOP
            v_deduct := (v_lot_assign->>'quantity')::numeric;
            IF v_deduct > 0 THEN
              UPDATE stock_lots SET remaining_quantity = remaining_quantity - v_deduct
                WHERE id = (v_lot_assign->>'lot_id')::uuid AND tenant_id = v_tenant_id;
            END IF;
          END LOOP;
        ELSE
          -- Auto FEFO
          v_remaining := (v_item->>'quantity')::numeric;
          FOR v_lot IN
            SELECT id, remaining_quantity FROM stock_lots
            WHERE article_id = (v_item->>'article_id')::uuid
              AND site_id = p_site_id AND tenant_id = v_tenant_id
              AND remaining_quantity > 0
            ORDER BY expiry_date ASC NULLS LAST, received_at ASC
          LOOP
            EXIT WHEN v_remaining <= 0;
            v_deduct := LEAST(v_lot.remaining_quantity, v_remaining);
            UPDATE stock_lots SET remaining_quantity = remaining_quantity - v_deduct WHERE id = v_lot.id;
            v_remaining := v_remaining - v_deduct;
          END LOOP;
        END IF;
      END IF;

      UPDATE stock_levels SET quantity = v_new, updated_at = now()
        WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;

      INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
      VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 'sale', -(v_item->>'quantity')::numeric,
        v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente ' || v_sale_number);
    END IF;
  END LOOP;

  -- Insert payments
  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_pm_id := NULLIF(v_pay->>'payment_method_id','')::uuid;
    v_pm_type := NULL;
    IF v_pm_id IS NOT NULL THEN
      SELECT payment_type INTO v_pm_type FROM payment_methods WHERE id = v_pm_id;
    END IF;
    v_session := CASE WHEN COALESCE(v_pm_type,'') = 'credit' THEN NULL ELSE p_cash_session_id END;
    v_amount := (v_pay->>'amount')::numeric;

    INSERT INTO sale_payments (tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference)
    VALUES (v_tenant_id, v_sale_id, v_session, v_pm_id, v_pay->>'method_name', v_amount, COALESCE(v_pay->>'reference', ''));

    IF v_session IS NOT NULL THEN
      v_cash_in_session := v_cash_in_session + v_amount;
    END IF;
  END LOOP;

  -- Update cash session theoretical_amount
  IF p_cash_session_id IS NOT NULL AND v_cash_in_session > 0 THEN
    UPDATE cash_sessions
    SET theoretical_amount = COALESCE(theoretical_amount, 0) + v_cash_in_session
    WHERE id = p_cash_session_id;
  END IF;

  -- Update customer balance if not fully paid
  IF p_customer_id IS NOT NULL AND v_paid < v_total THEN
    UPDATE customers SET balance = COALESCE(balance, 0) + (v_total - v_paid)
    WHERE id = p_customer_id;
  END IF;

  RETURN jsonb_build_object('sale_number', v_sale_number, 'sale_id', v_sale_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pos_sale_lot(uuid, uuid, uuid, jsonb, jsonb, numeric, text, jsonb) TO authenticated;
