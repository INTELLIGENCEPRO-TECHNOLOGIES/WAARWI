/*
# Fix: Prepayments auto-reduce customer balance + offset loans

## Problem
1. `apply_customer_prepayments` marks sales as paid but NEVER decreases
   `customers.balance`. Credit sales increase `balance`, prepayments pay the sale
   but balance stays inflated.
2. Unused prepayments do not offset balance from customer loans or legacy
   carry-forwards (balance not tied to any unpaid sale).
3. `create_credit_sale` always increases `customers.balance` even when the
   customer has enough unused prepayment to instantly cover it.

## Changes

### 1. `apply_customer_prepayments` — now reduces balance
After applying prepayment credit to each sale, the function decreases
`customers.balance` by the applied amount.
A **second pass** offsets any remaining positive balance (from loans, legacy
reports) using leftover unused prepayments — consuming them FIFO.

### 2. `create_credit_sale` — smart balance increase
After inserting the credit sale, the function calls `apply_customer_prepayments`.
If the prepayment fully covers the sale (status becomes 'paid'), the balance
is NOT increased at all. If partially covered, only the uncovered portion
increases the balance.

### 3. `reconcile_customer_balances` — admin utility
New RPC that recalculates all customer balances for a given tenant by
iterating every customer with positive balance + unused prepayments and
applying the correction. Returns a summary of corrected customers.

## Security
- All functions remain SECURITY DEFINER (existing pattern).
- `reconcile_customer_balances` is restricted TO authenticated.
*/

-- ============================================================
-- 1. Fix apply_customer_prepayments
-- ============================================================
CREATE OR REPLACE FUNCTION apply_customer_prepayments(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_prepay record;
  v_sale record;
  v_available numeric;
  v_due numeric;
  v_take numeric;
  v_new_paid numeric;
  v_new_status text;
  v_applied numeric := 0;
  v_method text;
  v_balance numeric;
  v_balance_reduction numeric := 0;
  v_remaining_prepay numeric;
  v_balance_offset numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('applied', 0, 'balance_reduced', 0); END IF;
  IF p_customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0, 'balance_reduced', 0); END IF;

  -- Pass 1: Apply prepayments to unpaid sales (existing logic + balance reduction)
  FOR v_prepay IN
    SELECT * FROM customer_prepayments
     WHERE tenant_id = v_tenant_id
       AND customer_id = p_customer_id
       AND amount_used < amount
     ORDER BY created_at ASC
     FOR UPDATE
  LOOP
    v_available := v_prepay.amount - v_prepay.amount_used;
    EXIT WHEN v_available <= 0;

    FOR v_sale IN
      SELECT * FROM sales
       WHERE tenant_id = v_tenant_id
         AND customer_id = p_customer_id
         AND status <> 'cancelled'
         AND COALESCE(paid,0) < COALESCE(total,0)
       ORDER BY created_at ASC
       FOR UPDATE
    LOOP
      v_due := GREATEST(0, COALESCE(v_sale.total,0) - COALESCE(v_sale.paid,0));
      v_take := LEAST(v_available, v_due);
      IF v_take <= 0 THEN CONTINUE; END IF;

      v_method := COALESCE(NULLIF(v_prepay.method_name,''), 'Acompte client');

      INSERT INTO sale_payments (
        tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference
      ) VALUES (
        v_tenant_id, v_sale.id, NULL, v_prepay.payment_method_id,
        'Acompte · ' || v_method, v_take,
        COALESCE(NULLIF(v_prepay.reference,''), 'Acompte client du ' || to_char(v_prepay.created_at, 'DD/MM/YYYY'))
      );

      v_new_paid := COALESCE(v_sale.paid, 0) + v_take;
      v_new_status := CASE
        WHEN v_new_paid >= v_sale.total THEN 'paid'
        WHEN v_new_paid > 0 THEN 'partial'
        ELSE v_sale.status
      END;

      UPDATE sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

      UPDATE customer_prepayments
         SET amount_used = amount_used + v_take
       WHERE id = v_prepay.id;

      v_available := v_available - v_take;
      v_applied := v_applied + v_take;
      EXIT WHEN v_available <= 0;
    END LOOP;
  END LOOP;

  -- Reduce balance by the amount applied to sales
  IF v_applied > 0 THEN
    UPDATE customers
       SET balance = GREATEST(0, COALESCE(balance, 0) - v_applied)
     WHERE id = p_customer_id AND tenant_id = v_tenant_id;
    v_balance_reduction := v_applied;
  END IF;

  -- Pass 2: Offset remaining positive balance (loans, legacy) with unused prepayments
  SELECT COALESCE(balance, 0) INTO v_balance
    FROM customers
   WHERE id = p_customer_id AND tenant_id = v_tenant_id;

  IF v_balance > 0 THEN
    -- Calculate total remaining unused prepayment
    SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_remaining_prepay
      FROM customer_prepayments
     WHERE tenant_id = v_tenant_id
       AND customer_id = p_customer_id
       AND amount_used < amount;

    IF v_remaining_prepay > 0 THEN
      v_balance_offset := LEAST(v_balance, v_remaining_prepay);

      IF v_balance_offset > 0 THEN
        -- Consume prepayments FIFO for the offset
        FOR v_prepay IN
          SELECT * FROM customer_prepayments
           WHERE tenant_id = v_tenant_id
             AND customer_id = p_customer_id
             AND amount_used < amount
           ORDER BY created_at ASC
           FOR UPDATE
        LOOP
          EXIT WHEN v_balance_offset <= 0;
          v_available := v_prepay.amount - v_prepay.amount_used;
          v_take := LEAST(v_available, v_balance_offset);
          IF v_take <= 0 THEN CONTINUE; END IF;

          UPDATE customer_prepayments
             SET amount_used = amount_used + v_take
           WHERE id = v_prepay.id;

          v_balance_offset := v_balance_offset - v_take;
        END LOOP;

        -- The actual offset applied
        v_balance_offset := LEAST(v_balance, v_remaining_prepay);

        UPDATE customers
           SET balance = GREATEST(0, COALESCE(balance, 0) - v_balance_offset)
         WHERE id = p_customer_id AND tenant_id = v_tenant_id;

        v_balance_reduction := v_balance_reduction + v_balance_offset;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('applied', v_applied, 'balance_reduced', v_balance_reduction);
END;
$$;


-- ============================================================
-- 2. Fix create_credit_sale — smart balance increase
-- ============================================================
CREATE OR REPLACE FUNCTION create_credit_sale(
  p_customer_id uuid,
  p_items jsonb,
  p_discount numeric DEFAULT 0,
  p_site_id uuid DEFAULT NULL,
  p_cash_session_id uuid DEFAULT NULL,
  p_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale_id uuid;
  v_sale_number text;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_line_total numeric;
  v_article_id uuid;
  v_qty numeric;
  v_previous numeric;
  v_new numeric;
  v_user_id uuid;
  v_stock_method text;
  v_lot RECORD;
  v_remaining numeric;
  v_deduct numeric;
  v_track_stock boolean;
  v_unused_prepay numeric;
  v_balance_increase numeric;
  v_applied jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire pour une vente à crédit'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Panier vide'; END IF;

  v_user_id := auth.uid();

  SELECT COALESCE((settings->>'stock_method'), 'none')
  INTO v_stock_method
  FROM tenants WHERE id = v_tenant_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (COALESCE((v_item->>'quantity')::numeric, 0) * COALESCE((v_item->>'unit_price')::numeric, 0)) - COALESCE((v_item->>'discount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;
  v_total := GREATEST(0, v_subtotal - COALESCE(p_discount, 0));

  v_sale_number := public.next_doc_number(v_tenant_id, 'sale', 'V');

  INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, sale_number, subtotal, discount, total, paid, status, source, note)
  VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_sale_number, v_subtotal, COALESCE(p_discount, 0), v_total, 0, 'validated', 'pos', COALESCE(p_note, ''))
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (COALESCE((v_item->>'quantity')::numeric, 0) * COALESCE((v_item->>'unit_price')::numeric, 0)) - COALESCE((v_item->>'discount')::numeric, 0);
    v_article_id := NULLIF(v_item->>'article_id','')::uuid;
    v_qty := COALESCE((v_item->>'quantity')::numeric, 0);

    INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost)
    VALUES (v_tenant_id, v_sale_id, v_article_id, COALESCE(v_item->>'name',''), v_qty,
      COALESCE((v_item->>'unit_price')::numeric, 0), COALESCE((v_item->>'discount')::numeric, 0),
      v_line_total, COALESCE((v_item->>'purchase_cost')::numeric, 0));

    IF v_article_id IS NOT NULL THEN
      SELECT COALESCE(track_stock, true) INTO v_track_stock FROM articles WHERE id = v_article_id;

      IF COALESCE(v_track_stock, true) THEN
        SELECT quantity INTO v_previous FROM stock_levels
        WHERE article_id = v_article_id AND site_id = p_site_id;

        IF v_previous IS NULL THEN
          v_previous := 0;
          INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
          VALUES (v_tenant_id, v_article_id, p_site_id, 0);
        END IF;

        v_new := v_previous - v_qty;

        IF v_stock_method = 'lot' THEN
          v_remaining := v_qty;
          FOR v_lot IN
            SELECT id, remaining_quantity FROM stock_lots
            WHERE article_id = v_article_id AND site_id = p_site_id
            AND tenant_id = v_tenant_id AND remaining_quantity > 0
            ORDER BY expiry_date ASC NULLS LAST, received_at ASC
          LOOP
            EXIT WHEN v_remaining <= 0;
            v_deduct := LEAST(v_lot.remaining_quantity, v_remaining);
            UPDATE stock_lots SET remaining_quantity = remaining_quantity - v_deduct WHERE id = v_lot.id;
            v_remaining := v_remaining - v_deduct;
          END LOOP;
        END IF;

        UPDATE stock_levels SET quantity = v_new, updated_at = now()
        WHERE article_id = v_article_id AND site_id = p_site_id;

        INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
        VALUES (v_tenant_id, v_article_id, p_site_id, 'sale', -v_qty, v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente à crédit ' || v_sale_number);
      END IF;
    END IF;
  END LOOP;

  -- Check if customer has unused prepayments that can cover this sale
  SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_unused_prepay
    FROM customer_prepayments
   WHERE tenant_id = v_tenant_id
     AND customer_id = p_customer_id
     AND amount_used < amount;

  IF v_unused_prepay >= v_total THEN
    -- Prepayment fully covers the sale: do NOT increase balance at all.
    -- apply_customer_prepayments will mark the sale as paid and consume prepayment.
    v_balance_increase := 0;
  ELSE
    -- Only increase balance by the uncovered portion
    v_balance_increase := v_total - v_unused_prepay;
    UPDATE customers SET balance = COALESCE(balance, 0) + v_balance_increase
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;
  END IF;

  -- Auto-apply prepayments to this (and any other) unpaid sale
  v_applied := apply_customer_prepayments(p_customer_id);

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'total', v_total,
    'prepay_applied', COALESCE((v_applied->>'applied')::numeric, 0),
    'balance_increased', v_balance_increase
  );
END;
$$;


-- ============================================================
-- 3. reconcile_customer_balances — admin correction utility
-- ============================================================
CREATE OR REPLACE FUNCTION reconcile_customer_balances(p_tenant_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_cust record;
  v_unused_prepay numeric;
  v_offset numeric;
  v_take numeric;
  v_available numeric;
  v_prepay record;
  v_corrected int := 0;
  v_total_reduced numeric := 0;
  v_details jsonb := '[]'::jsonb;
BEGIN
  v_tenant_id := COALESCE(p_tenant_id, current_tenant_id());
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('error', 'No tenant'); END IF;

  FOR v_cust IN
    SELECT id, name, COALESCE(balance, 0) AS balance
      FROM customers
     WHERE tenant_id = v_tenant_id
       AND COALESCE(balance, 0) > 0
     ORDER BY name
  LOOP
    -- Check unused prepayments for this customer
    SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_unused_prepay
      FROM customer_prepayments
     WHERE tenant_id = v_tenant_id
       AND customer_id = v_cust.id
       AND amount_used < amount;

    IF v_unused_prepay > 0 THEN
      v_offset := LEAST(v_cust.balance, v_unused_prepay);

      IF v_offset > 0 THEN
        -- Consume prepayments FIFO
        FOR v_prepay IN
          SELECT * FROM customer_prepayments
           WHERE tenant_id = v_tenant_id
             AND customer_id = v_cust.id
             AND amount_used < amount
           ORDER BY created_at ASC
           FOR UPDATE
        LOOP
          EXIT WHEN v_offset <= 0;
          v_available := v_prepay.amount - v_prepay.amount_used;
          v_take := LEAST(v_available, v_offset);
          IF v_take <= 0 THEN CONTINUE; END IF;

          UPDATE customer_prepayments
             SET amount_used = amount_used + v_take
           WHERE id = v_prepay.id;

          v_offset := v_offset - v_take;
        END LOOP;

        -- Calculate actual reduction
        v_offset := LEAST(v_cust.balance, v_unused_prepay);

        UPDATE customers
           SET balance = GREATEST(0, balance - v_offset)
         WHERE id = v_cust.id AND tenant_id = v_tenant_id;

        v_corrected := v_corrected + 1;
        v_total_reduced := v_total_reduced + v_offset;
        v_details := v_details || jsonb_build_object(
          'customer_id', v_cust.id,
          'name', v_cust.name,
          'previous_balance', v_cust.balance,
          'reduced_by', v_offset,
          'new_balance', GREATEST(0, v_cust.balance - v_offset)
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'corrected_count', v_corrected,
    'total_reduced', v_total_reduced,
    'details', v_details
  );
END;
$$;

-- Restrict to authenticated users
REVOKE ALL ON FUNCTION reconcile_customer_balances(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reconcile_customer_balances(uuid) TO authenticated;
