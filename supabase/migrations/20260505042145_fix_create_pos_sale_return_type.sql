/*
  # Fix create_pos_sale: add cash_session_id to payments, return sale_number

  ## Summary
  - Drops and recreates `create_pos_sale` to change return type from uuid to jsonb
  - The new return value is `{sale_id, sale_number}` so the frontend can show the ticket number
  - Adds `cash_session_id` to each `sale_payments` insert so cash control totals are accurate

  ## Also
  - Adds `cash_session_id` column to `sale_payments` if not already present
*/

-- Add cash_session_id to sale_payments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sale_payments' AND column_name = 'cash_session_id'
  ) THEN
    ALTER TABLE sale_payments ADD COLUMN cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Drop old function (return type uuid) then recreate as jsonb
DROP FUNCTION IF EXISTS create_pos_sale(uuid,uuid,uuid,jsonb,jsonb,numeric,text);

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
BEGIN
  v_user_id := auth.uid();
  v_tenant_id := current_tenant_id();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Tenant introuvable';
  END IF;

  v_sale_number := 'V-' || to_char(now(), 'YYYYMMDD') || '-' || substr(gen_random_uuid()::text, 1, 6);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric
                  - COALESCE((v_item->>'discount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;

  v_total := v_subtotal - COALESCE(p_discount, 0);

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    v_paid := v_paid + (v_payment->>'amount')::numeric;
  END LOOP;

  INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, user_id, sale_number,
                     subtotal, discount, total, paid, status, note)
  VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_user_id, v_sale_number,
          v_subtotal, COALESCE(p_discount, 0), v_total, v_paid,
          CASE WHEN v_paid >= v_total THEN 'paid' ELSE 'partial' END,
          COALESCE(p_note, ''))
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric
                  - COALESCE((v_item->>'discount')::numeric, 0);

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

    INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity,
                                 previous_qty, new_qty, reference_type, reference_id, user_id, note)
    VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 'sale',
            -(v_item->>'quantity')::numeric, v_previous, v_new,
            'sale', v_sale_id, v_user_id, 'Vente ' || v_sale_number);
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
    INSERT INTO sale_payments (tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference)
    VALUES (v_tenant_id, v_sale_id, p_cash_session_id,
            NULLIF(v_payment->>'payment_method_id', '')::uuid,
            v_payment->>'method_name',
            (v_payment->>'amount')::numeric,
            COALESCE(v_payment->>'reference', ''));
  END LOOP;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number);
END;
$$;
