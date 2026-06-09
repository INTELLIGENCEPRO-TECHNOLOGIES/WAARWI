/*
  # Stock Lots and CMUP Tracking System

  1. New Tables
    - `stock_lots`
      - `id` (uuid, primary key)
      - `tenant_id` (uuid, FK to tenants)
      - `article_id` (uuid, FK to articles)
      - `site_id` (uuid, FK to sites)
      - `batch_number` (text) - Lot/batch identifier
      - `expiry_date` (date) - Expiration date
      - `initial_quantity` (numeric) - Quantity when lot was created
      - `remaining_quantity` (numeric) - Current remaining quantity
      - `purchase_price` (numeric) - Purchase price for this lot
      - `received_at` (timestamptz) - When the lot was received
      - `created_at` (timestamptz)

  2. New Functions
    - `adjust_stock_lot` - Creates a stock lot entry and updates stock levels
    - `deduct_stock_fefo` - Deducts from oldest expiry lots first
    - `recalculate_cmup` - Recalculates CMUP on stock entry

  3. Security
    - Enable RLS on `stock_lots` table
    - Policies for authenticated tenant members
*/

-- Stock lots table
CREATE TABLE IF NOT EXISTS stock_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  batch_number text NOT NULL DEFAULT '',
  expiry_date date,
  initial_quantity numeric NOT NULL DEFAULT 0,
  remaining_quantity numeric NOT NULL DEFAULT 0,
  purchase_price numeric NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_lots_tenant ON stock_lots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_stock_lots_article_site ON stock_lots(article_id, site_id);
CREATE INDEX IF NOT EXISTS idx_stock_lots_expiry ON stock_lots(tenant_id, expiry_date);

ALTER TABLE stock_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view their stock lots"
  ON stock_lots FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()));

CREATE POLICY "Tenant members can insert stock lots"
  ON stock_lots FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

CREATE POLICY "Tenant members can update their stock lots"
  ON stock_lots FOR UPDATE
  TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()))
  WITH CHECK (tenant_id = (SELECT current_tenant_id()));

CREATE POLICY "Tenant members can delete their stock lots"
  ON stock_lots FOR DELETE
  TO authenticated
  USING (tenant_id = (SELECT current_tenant_id()));

-- Function to add stock via lot (with lot tracking)
CREATE OR REPLACE FUNCTION adjust_stock_lot(
  p_article_id uuid,
  p_site_id uuid,
  p_quantity numeric,
  p_batch_number text DEFAULT '',
  p_expiry_date date DEFAULT NULL,
  p_purchase_price numeric DEFAULT 0,
  p_note text DEFAULT ''
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_previous numeric;
  v_new numeric;
  v_lot_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();

  -- Get current stock level
  SELECT quantity INTO v_previous FROM stock_levels
  WHERE article_id = p_article_id AND site_id = p_site_id;

  IF v_previous IS NULL THEN
    v_previous := 0;
    INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
    VALUES (v_tenant_id, p_article_id, p_site_id, 0);
  END IF;

  v_new := v_previous + p_quantity;

  -- Update stock levels
  UPDATE stock_levels SET quantity = v_new, updated_at = now()
  WHERE article_id = p_article_id AND site_id = p_site_id;

  -- Create the lot record
  INSERT INTO stock_lots (tenant_id, article_id, site_id, batch_number, expiry_date, initial_quantity, remaining_quantity, purchase_price)
  VALUES (v_tenant_id, p_article_id, p_site_id, p_batch_number, p_expiry_date, p_quantity, p_quantity, p_purchase_price)
  RETURNING id INTO v_lot_id;

  -- Record the movement
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, unit_cost, user_id, note)
  VALUES (v_tenant_id, p_article_id, p_site_id, 'adjustment_in', p_quantity, v_previous, v_new, p_purchase_price, auth.uid(),
    COALESCE(NULLIF(p_note, ''), 'Entrée lot ' || p_batch_number));

  RETURN v_lot_id;
END;
$$;

GRANT EXECUTE ON FUNCTION adjust_stock_lot TO authenticated;

-- Function to deduct stock using FEFO (First Expired First Out)
CREATE OR REPLACE FUNCTION deduct_stock_fefo(
  p_article_id uuid,
  p_site_id uuid,
  p_quantity numeric,
  p_reference_type text DEFAULT 'sale',
  p_reference_id uuid DEFAULT NULL,
  p_note text DEFAULT ''
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_remaining numeric;
  v_lot RECORD;
  v_deduct numeric;
  v_previous numeric;
  v_new numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  v_remaining := p_quantity;

  -- Get current stock
  SELECT quantity INTO v_previous FROM stock_levels
  WHERE article_id = p_article_id AND site_id = p_site_id;
  IF v_previous IS NULL THEN v_previous := 0; END IF;

  -- Deduct from lots ordered by expiry date (FEFO)
  FOR v_lot IN
    SELECT id, remaining_quantity
    FROM stock_lots
    WHERE article_id = p_article_id
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

  -- Update stock_levels
  v_new := v_previous - p_quantity;
  UPDATE stock_levels SET quantity = v_new, updated_at = now()
  WHERE article_id = p_article_id AND site_id = p_site_id;

  -- Record movement
  INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
  VALUES (v_tenant_id, p_article_id, p_site_id, 'sale', -p_quantity, v_previous, v_new, p_reference_type, p_reference_id, auth.uid(), p_note);
END;
$$;

GRANT EXECUTE ON FUNCTION deduct_stock_fefo TO authenticated;

-- Function to recalculate CMUP (Cout Moyen Unitaire Pondere)
-- Called after each stock entry: new CMUP = (old_qty * old_price + new_qty * new_price) / (old_qty + new_qty)
CREATE OR REPLACE FUNCTION recalculate_cmup(
  p_article_id uuid,
  p_site_id uuid,
  p_new_quantity numeric,
  p_new_purchase_price numeric
) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_qty numeric;
  v_current_price numeric;
  v_new_cmup numeric;
BEGIN
  -- Get current stock quantity and purchase price
  SELECT COALESCE(sl.quantity, 0), COALESCE(a.purchase_price, 0)
  INTO v_current_qty, v_current_price
  FROM articles a
  LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = p_site_id
  WHERE a.id = p_article_id;

  -- Calculate new CMUP
  IF (v_current_qty + p_new_quantity) > 0 THEN
    v_new_cmup := ((v_current_qty * v_current_price) + (p_new_quantity * p_new_purchase_price)) / (v_current_qty + p_new_quantity);
  ELSE
    v_new_cmup := p_new_purchase_price;
  END IF;

  -- Update article purchase_price with new CMUP
  UPDATE articles SET purchase_price = ROUND(v_new_cmup, 2) WHERE id = p_article_id;

  RETURN v_new_cmup;
END;
$$;

GRANT EXECUTE ON FUNCTION recalculate_cmup TO authenticated;

-- Updated create_pos_sale_v3 that supports lot-based deduction
-- This version checks tenant settings for stock_method
CREATE OR REPLACE FUNCTION create_pos_sale_lot(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_discount numeric,
  p_note text
) RETURNS uuid
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
  v_counter_val bigint;
BEGIN
  v_tenant_id := current_tenant_id();

  -- Get stock method from tenant settings
  SELECT COALESCE((settings->>'stock_method'), 'none')
  INTO v_stock_method
  FROM tenants WHERE id = v_tenant_id;

  -- Get next sale number via counter
  UPDATE document_counters
  SET current_value = current_value + 1
  WHERE tenant_id = v_tenant_id AND doc_type = 'sale'
  RETURNING current_value INTO v_counter_val;

  IF v_counter_val IS NULL THEN
    INSERT INTO document_counters (tenant_id, doc_type, prefix, current_value)
    VALUES (v_tenant_id, 'sale', 'VT', 1)
    ON CONFLICT (tenant_id, doc_type) DO UPDATE SET current_value = document_counters.current_value + 1
    RETURNING current_value INTO v_counter_val;
  END IF;

  v_sale_number := 'VT-' || LPAD(v_counter_val::text, 6, '0');

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

    -- If lot mode, deduct from lots (FEFO)
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

  -- Update cash session totals if applicable
  IF p_cash_session_id IS NOT NULL THEN
    UPDATE cash_sessions
    SET total_sales = total_sales + v_paid,
        theoretical_balance = theoretical_balance + v_paid
    WHERE id = p_cash_session_id;
  END IF;

  RETURN v_sale_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_pos_sale_lot TO authenticated;
