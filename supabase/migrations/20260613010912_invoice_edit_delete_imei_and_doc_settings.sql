-- Add IMEI/phone field support to document_settings and sale_items
-- Add allow_edit and allow_delete toggles to document_settings

-- 1. Add new columns to document_settings
ALTER TABLE document_settings
  ADD COLUMN IF NOT EXISTS show_imei boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_edit boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS allow_delete boolean NOT NULL DEFAULT false;

-- 2. Add imei field to sale_items
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS imei text DEFAULT NULL;

-- 3. Add imei to quote items if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='quote_items') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='quote_items' AND column_name='imei') THEN
      ALTER TABLE quote_items ADD COLUMN imei text DEFAULT NULL;
    END IF;
  END IF;
END $$;

-- 4. Create function to delete a sale and recalculate customer balance
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
BEGIN
  -- Get sale details
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = p_tenant_id;
  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
  END IF;

  -- Block if accounted
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

  -- Recalculate customer balance if customer exists
  IF v_customer_id IS NOT NULL THEN
    UPDATE customers SET
      balance = COALESCE((
        SELECT SUM(total - paid) FROM sales
        WHERE customer_id = v_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
      ), 0)
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'restored_total', v_total);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_sale_and_recalculate(uuid, uuid) TO authenticated;

-- 5. Create function to update sale items and recalculate
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

  -- Recalculate balance for old and new customer
  IF v_old_customer_id IS NOT NULL THEN
    UPDATE customers SET balance = COALESCE((
      SELECT SUM(total - paid) FROM sales WHERE customer_id = v_old_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
    ), 0) WHERE id = v_old_customer_id;
  END IF;

  IF p_customer_id IS NOT NULL AND p_customer_id != v_old_customer_id THEN
    UPDATE customers SET balance = COALESCE((
      SELECT SUM(total - paid) FROM sales WHERE customer_id = p_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
    ), 0) WHERE id = p_customer_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'new_total', v_new_total);
END;
$$;

GRANT EXECUTE ON FUNCTION update_sale_items_and_totals(uuid, uuid, jsonb, uuid, jsonb) TO authenticated;
