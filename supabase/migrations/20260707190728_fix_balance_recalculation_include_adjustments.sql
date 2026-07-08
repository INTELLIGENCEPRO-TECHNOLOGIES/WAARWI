-- Fix: balance recalculation must include balance_adjustments
-- Previously, delete_sale_and_recalculate, update_sale_items_and_totals, 
-- and recompute_supplier_balance SET balance = SUM(unpaid_transactions)
-- ignoring any manually positioned balance from balance_adjustments.

-- 1. Fix delete_sale_and_recalculate
CREATE OR REPLACE FUNCTION delete_sale_and_recalculate(
  p_sale_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_customer_id uuid;
  v_paid numeric;
  v_total numeric;
  v_new_balance numeric;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = p_tenant_id;
  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
  END IF;

  IF v_sale.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée, suppression impossible');
  END IF;

  v_customer_id := v_sale.customer_id;
  v_total := v_sale.total;
  v_paid := v_sale.paid;

  -- Restore stock for each item
  FOR v_sale IN
    SELECT si.article_id, si.quantity, sl.id as stock_level_id, sl.quantity as current_stock
    FROM sale_items si
    LEFT JOIN stock_levels sl ON sl.article_id = si.article_id AND sl.tenant_id = p_tenant_id
    WHERE si.sale_id = p_sale_id
  LOOP
    IF v_sale.stock_level_id IS NOT NULL THEN
      UPDATE stock_levels SET quantity = quantity + v_sale.quantity
      WHERE id = v_sale.stock_level_id;

      INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, note)
      SELECT p_tenant_id, v_sale.article_id, sl.site_id, 'adjustment',
             v_sale.quantity, sl.quantity - v_sale.quantity, sl.quantity,
             'Restauration stock - suppression vente'
      FROM stock_levels sl WHERE sl.id = v_sale.stock_level_id;
    END IF;
  END LOOP;

  -- Delete sale items, payments, then sale
  DELETE FROM sale_items WHERE sale_id = p_sale_id;
  DELETE FROM sale_payments WHERE sale_id = p_sale_id;
  DELETE FROM sales WHERE id = p_sale_id;

  -- Recalculate customer balance: unpaid invoices + net balance adjustments
  IF v_customer_id IS NOT NULL THEN
    v_new_balance := COALESCE((
      SELECT SUM(total - paid) FROM sales
      WHERE customer_id = v_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
    ), 0) + COALESCE((
      SELECT SUM(amount) FROM balance_adjustments
      WHERE entity_id = v_customer_id AND entity_type = 'customer' AND tenant_id = p_tenant_id
    ), 0);

    UPDATE customers SET balance = v_new_balance
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'restored_total', v_total);
END;
$$;

-- 2. Fix update_sale_items_and_totals (preserving exact signature with p_doc_header)
CREATE OR REPLACE FUNCTION update_sale_items_and_totals(
  p_sale_id uuid,
  p_tenant_id uuid,
  p_items jsonb,
  p_customer_id uuid DEFAULT NULL,
  p_doc_header jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_new_total numeric := 0;
  v_item record;
  v_old_customer_id uuid;
  v_new_balance numeric;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = p_tenant_id;
  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
  END IF;

  IF v_sale.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente comptabilisée, modification impossible');
  END IF;

  v_old_customer_id := v_sale.customer_id;

  -- Restore stock from old items
  FOR v_item IN
    SELECT si.article_id, si.quantity
    FROM sale_items si WHERE si.sale_id = p_sale_id
  LOOP
    UPDATE stock_levels SET quantity = quantity + v_item.quantity
    WHERE article_id = v_item.article_id AND tenant_id = p_tenant_id;
  END LOOP;

  -- Delete old items
  DELETE FROM sale_items WHERE sale_id = p_sale_id;

  -- Insert new items and deduct stock
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (
    article_id uuid, name text, quantity numeric, unit_price numeric, discount numeric, vat_rate numeric, imei text
  )
  LOOP
    INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, vat_rate, total, imei)
    VALUES (
      p_tenant_id, p_sale_id, v_item.article_id, v_item.name,
      v_item.quantity, v_item.unit_price, COALESCE(v_item.discount, 0),
      COALESCE(v_item.vat_rate, 0),
      (v_item.quantity * v_item.unit_price) - COALESCE(v_item.discount, 0),
      v_item.imei
    );
    v_new_total := v_new_total + (v_item.quantity * v_item.unit_price) - COALESCE(v_item.discount, 0);

    UPDATE stock_levels SET quantity = quantity - v_item.quantity
    WHERE article_id = v_item.article_id AND tenant_id = p_tenant_id;
  END LOOP;

  -- Update sale totals
  UPDATE sales SET
    total = v_new_total,
    subtotal = v_new_total,
    customer_id = COALESCE(p_customer_id, customer_id),
    doc_header = COALESCE(p_doc_header, doc_header),
    status = CASE
      WHEN paid >= v_new_total THEN 'paid'
      WHEN paid > 0 THEN 'partial'
      ELSE status
    END
  WHERE id = p_sale_id;

  -- Recalculate balance for old and new customer (include balance adjustments)
  IF v_old_customer_id IS NOT NULL THEN
    v_new_balance := COALESCE((
      SELECT SUM(total - paid) FROM sales
      WHERE customer_id = v_old_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
    ), 0) + COALESCE((
      SELECT SUM(amount) FROM balance_adjustments
      WHERE entity_id = v_old_customer_id AND entity_type = 'customer' AND tenant_id = p_tenant_id
    ), 0);

    UPDATE customers SET balance = v_new_balance WHERE id = v_old_customer_id;
  END IF;

  IF p_customer_id IS NOT NULL AND p_customer_id != v_old_customer_id THEN
    v_new_balance := COALESCE((
      SELECT SUM(total - paid) FROM sales
      WHERE customer_id = p_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
    ), 0) + COALESCE((
      SELECT SUM(amount) FROM balance_adjustments
      WHERE entity_id = p_customer_id AND entity_type = 'customer' AND tenant_id = p_tenant_id
    ), 0);

    UPDATE customers SET balance = v_new_balance WHERE id = p_customer_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'new_total', v_new_total);
END;
$$;

-- 3. Fix recompute_supplier_balance to include balance adjustments
CREATE OR REPLACE FUNCTION recompute_supplier_balance(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_new_balance numeric;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM suppliers WHERE id = p_supplier_id;

  v_new_balance := COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = p_supplier_id
      AND o.tenant_id = v_tenant_id
      AND o.status != 'cancelled'
  ), 0) + COALESCE((
    SELECT SUM(amount) FROM balance_adjustments
    WHERE entity_id = p_supplier_id AND entity_type = 'supplier' AND tenant_id = v_tenant_id
  ), 0);

  UPDATE suppliers
  SET balance = GREATEST(0, v_new_balance)
  WHERE id = p_supplier_id;
END;
$$;

-- 4. Fix existing data: recalculate all customers that have balance_adjustments
UPDATE customers c
SET balance = COALESCE((
  SELECT SUM(s.total - s.paid) FROM sales s
  WHERE s.customer_id = c.id AND s.tenant_id = c.tenant_id AND s.status != 'cancelled'
), 0) + COALESCE((
  SELECT SUM(ba.amount) FROM balance_adjustments ba
  WHERE ba.entity_id = c.id AND ba.entity_type = 'customer' AND ba.tenant_id = c.tenant_id
), 0)
WHERE c.id IN (
  SELECT DISTINCT entity_id FROM balance_adjustments WHERE entity_type = 'customer'
);

-- 5. Fix existing data: recalculate all suppliers that have balance_adjustments
UPDATE suppliers s
SET balance = GREATEST(0,
  COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = s.id AND o.tenant_id = s.tenant_id AND o.status != 'cancelled'
  ), 0) + COALESCE((
    SELECT SUM(ba.amount) FROM balance_adjustments ba
    WHERE ba.entity_id = s.id AND ba.entity_type = 'supplier' AND ba.tenant_id = s.tenant_id
  ), 0)
)
WHERE s.id IN (
  SELECT DISTINCT entity_id FROM balance_adjustments WHERE entity_type = 'supplier'
);