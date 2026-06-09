/*
  1. Fix FK constraints: change all references to journal_entries to ON DELETE SET NULL
     This permanently fixes the reset/restore FK violation issue.
  
  2. Fix create_pos_sale_lot: add "total" column to sale_items INSERT
*/

-- Fix FK: sales.accounting_entry_id -> journal_entries ON DELETE SET NULL
ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS sales_accounting_entry_id_fkey;
ALTER TABLE public.sales ADD CONSTRAINT sales_accounting_entry_id_fkey
  FOREIGN KEY (accounting_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;

-- Fix FK: sale_payments.accounting_entry_id -> journal_entries ON DELETE SET NULL
ALTER TABLE public.sale_payments DROP CONSTRAINT IF EXISTS sale_payments_accounting_entry_id_fkey;
ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_accounting_entry_id_fkey
  FOREIGN KEY (accounting_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;

-- Fix FK: supplier_orders.accounting_entry_id -> journal_entries ON DELETE SET NULL
ALTER TABLE public.supplier_orders DROP CONSTRAINT IF EXISTS supplier_orders_accounting_entry_id_fkey;
ALTER TABLE public.supplier_orders ADD CONSTRAINT supplier_orders_accounting_entry_id_fkey
  FOREIGN KEY (accounting_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;

-- Fix FK: supplier_payments.accounting_entry_id -> journal_entries ON DELETE SET NULL
ALTER TABLE public.supplier_payments DROP CONSTRAINT IF EXISTS supplier_payments_accounting_entry_id_fkey;
ALTER TABLE public.supplier_payments ADD CONSTRAINT supplier_payments_accounting_entry_id_fkey
  FOREIGN KEY (accounting_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;

-- Fix FK: cash_movements.accounting_entry_id -> journal_entries ON DELETE SET NULL
ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cash_movements_accounting_entry_id_fkey;
ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_accounting_entry_id_fkey
  FOREIGN KEY (accounting_entry_id) REFERENCES public.journal_entries(id) ON DELETE SET NULL;

-- Fix create_pos_sale_lot: add total column to sale_items INSERT
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
BEGIN
  v_tenant_id := current_tenant_id();

  SELECT COALESCE((settings->>'stock_method'), 'none')
    INTO v_stock_method FROM tenants WHERE id = v_tenant_id;

  v_sale_number := next_doc_number(v_tenant_id, 'sale', 'V');

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_total := v_total + ((v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric) - COALESCE((v_item->>'discount')::numeric, 0);
  END LOOP;
  v_total := v_total - COALESCE(p_discount, 0);

  INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, sale_number, total, discount, note, user_id)
  VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_sale_number, v_total, p_discount, p_note, v_user_id)
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);

    INSERT INTO sale_items (sale_id, tenant_id, article_id, name, quantity, unit_price, discount, total, purchase_cost)
    VALUES (v_sale_id, v_tenant_id, (v_item->>'article_id')::uuid, v_item->>'name',
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
  END LOOP;

  FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    DECLARE v_pay_type text := 'cash';
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

  UPDATE sales SET paid = v_paid, status = CASE WHEN v_paid >= v_total THEN 'paid' ELSE 'partial' END
    WHERE id = v_sale_id;

  IF p_cash_session_id IS NOT NULL THEN
    UPDATE cash_sessions SET total_sales = total_sales + v_paid,
      theoretical_balance = theoretical_balance + v_paid
    WHERE id = p_cash_session_id;
  END IF;

  RETURN jsonb_build_object('sale_number', v_sale_number, 'sale_id', v_sale_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pos_sale_lot(uuid, uuid, uuid, jsonb, jsonb, numeric, text, jsonb) TO authenticated;
