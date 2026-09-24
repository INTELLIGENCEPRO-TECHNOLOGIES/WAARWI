/*
  # Online orders tracking + status history

  ## Changes
  1. SECURITY DEFINER RPC `track_online_order(p_tenant_id, p_order_number, p_phone)`
     lets anonymous shoppers fetch their order + items + status history by order
     number and phone, without exposing other orders.
  2. Trigger `online_orders_log_status` automatically writes to
     online_order_status_history whenever status changes.
  3. Allow authenticated back-office users to insert status history for their tenant
     (already present) and ensure updated_at is bumped on row update via trigger.
*/

-- updated_at trigger
CREATE OR REPLACE FUNCTION touch_online_orders_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_online_orders_touch ON online_orders;
CREATE TRIGGER trg_online_orders_touch
  BEFORE UPDATE ON online_orders
  FOR EACH ROW EXECUTE FUNCTION touch_online_orders_updated_at();

-- status history auto-log
CREATE OR REPLACE FUNCTION log_online_order_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO online_order_status_history (tenant_id, order_id, old_status, new_status, changed_by, note)
    VALUES (NEW.tenant_id, NEW.id, '', NEW.status, auth.uid(), 'Création');
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO online_order_status_history (tenant_id, order_id, old_status, new_status, changed_by, note)
    VALUES (NEW.tenant_id, NEW.id, OLD.status, NEW.status, auth.uid(), '');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_online_orders_log_status ON online_orders;
CREATE TRIGGER trg_online_orders_log_status
  AFTER INSERT OR UPDATE OF status ON online_orders
  FOR EACH ROW EXECUTE FUNCTION log_online_order_status();

-- Tracking RPC for anon
CREATE OR REPLACE FUNCTION track_online_order(
  p_tenant_id uuid,
  p_order_number text,
  p_phone text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_order online_orders%ROWTYPE;
  v_items jsonb;
  v_history jsonb;
  v_clean_phone text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM shop_settings WHERE tenant_id = p_tenant_id AND is_active = true) THEN
    RETURN NULL;
  END IF;

  v_clean_phone := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  IF length(v_clean_phone) < 6 THEN RETURN NULL; END IF;

  SELECT * INTO v_order
  FROM online_orders
  WHERE tenant_id = p_tenant_id
    AND order_number = p_order_number
    AND (
      regexp_replace(customer_phone, '[^0-9]', '', 'g') LIKE '%' || v_clean_phone
      OR regexp_replace(customer_whatsapp, '[^0-9]', '', 'g') LIKE '%' || v_clean_phone
    )
  LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'article_name', article_name,
    'internal_ref', internal_ref,
    'quantity', quantity,
    'unit_price', unit_price,
    'line_total', line_total
  ) ORDER BY created_at), '[]'::jsonb)
  INTO v_items
  FROM online_order_items
  WHERE order_id = v_order.id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'old_status', old_status,
    'new_status', new_status,
    'note', note,
    'created_at', created_at
  ) ORDER BY created_at), '[]'::jsonb)
  INTO v_history
  FROM online_order_status_history
  WHERE order_id = v_order.id;

  RETURN jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'delivery_mode', v_order.delivery_mode,
    'delivery_address', v_order.delivery_address,
    'payment_mode', v_order.payment_mode,
    'customer_name', v_order.customer_name,
    'customer_phone', v_order.customer_phone,
    'customer_note', v_order.customer_note,
    'subtotal', v_order.subtotal,
    'total', v_order.total,
    'delivery_fee', v_order.delivery_fee,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'items', v_items,
    'history', v_history
  );
END;
$$;

GRANT EXECUTE ON FUNCTION track_online_order(uuid, text, text) TO anon, authenticated;
