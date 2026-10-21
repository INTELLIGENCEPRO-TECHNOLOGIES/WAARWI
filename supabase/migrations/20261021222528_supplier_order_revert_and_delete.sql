/*
# Supplier orders: revert a reception and delete an order

1. New functions
  - `revert_supplier_order_reception(p_order_id uuid)`
    Undoes every reception of a supplier order so it can be corrected:
    removes the received quantities from stock (with a traceable outgoing
    stock movement), reduces the matching stock lots in lot mode, removes the
    purchase accounting entry, resets received quantities to 0 and puts the
    order back to "confirmed". Requires document setting `allow_edit` for
    `supplier_order` and permission `edit_supplier_orders`.
  - `delete_supplier_order(p_order_id uuid)`
    Same stock / accounting reversal, then deletes the order (lines and
    receptions cascade). Refused if supplier payments are linked to the order.
    Requires document setting `allow_delete` and permission `delete_supplier_orders`.
  - `_reverse_supplier_order_effects(uuid, uuid)` internal helper, not callable by clients.

2. Security
  - All functions are SECURITY DEFINER, scoped to `current_tenant_id()`.
  - Admin / super_admin roles or an explicit permission are required.
  - Negative stock guard still applies: if received goods were already sold
    and the store forbids negative stock, the operation is refused.
*/

CREATE OR REPLACE FUNCTION public._reverse_supplier_order_effects(p_order_id uuid, p_tenant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_order supplier_orders%ROWTYPE;
  v_stock_method text;
  r record;
  v_prev numeric;
  v_new numeric;
  v_left numeric;
  l record;
  v_take numeric;
BEGIN
  SELECT * INTO v_order FROM supplier_orders WHERE id = p_order_id AND tenant_id = p_tenant;
  SELECT COALESCE(settings->>'stock_method', 'none') INTO v_stock_method FROM tenants WHERE id = p_tenant;

  FOR r IN
    SELECT article_id, site_id, SUM(quantity) AS net_qty,
           MIN(created_at) AS first_at,
           MAX(unit_cost) FILTER (WHERE movement_type = 'purchase') AS unit_cost
    FROM stock_movements
    WHERE tenant_id = p_tenant AND reference_type = 'supplier_order' AND reference_id = p_order_id
    GROUP BY article_id, site_id
    HAVING SUM(quantity) > 0
  LOOP
    SELECT quantity INTO v_prev FROM stock_levels
    WHERE article_id = r.article_id AND site_id = r.site_id FOR UPDATE;
    v_prev := COALESCE(v_prev, 0);
    v_new := v_prev - r.net_qty;
    UPDATE stock_levels SET quantity = v_new, updated_at = now()
    WHERE article_id = r.article_id AND site_id = r.site_id;

    INSERT INTO stock_movements (
      tenant_id, article_id, site_id, movement_type, quantity,
      previous_qty, new_qty, unit_cost, reference_type, reference_id, user_id, note
    ) VALUES (
      p_tenant, r.article_id, r.site_id, 'adjustment_out', -r.net_qty,
      v_prev, v_new, COALESCE(r.unit_cost, 0), 'supplier_order', p_order_id, auth.uid(),
      'Annulation réception commande ' || COALESCE(v_order.order_number, '')
    );

    IF v_stock_method = 'lot' THEN
      v_left := r.net_qty;
      FOR l IN
        SELECT id, initial_quantity, remaining_quantity FROM stock_lots
        WHERE tenant_id = p_tenant AND article_id = r.article_id AND site_id = r.site_id
          AND remaining_quantity > 0
          AND created_at >= r.first_at - interval '1 minute'
          AND COALESCE(purchase_price, 0) = COALESCE(r.unit_cost, 0)
        ORDER BY created_at DESC
        FOR UPDATE
      LOOP
        EXIT WHEN v_left <= 0;
        v_take := LEAST(v_left, l.remaining_quantity);
        IF v_take = l.remaining_quantity AND l.remaining_quantity = l.initial_quantity THEN
          DELETE FROM stock_lots WHERE id = l.id;
        ELSE
          UPDATE stock_lots SET remaining_quantity = remaining_quantity - v_take WHERE id = l.id;
        END IF;
        v_left := v_left - v_take;
      END LOOP;
    END IF;
  END LOOP;

  DELETE FROM journal_entries
  WHERE tenant_id = p_tenant
    AND (id = v_order.accounting_entry_id OR (source_type = 'purchase' AND source_id = p_order_id));

  UPDATE supplier_orders
  SET accounting_status = 'not_accounted', accounting_entry_id = NULL
  WHERE id = p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public._reverse_supplier_order_effects(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._supplier_order_action_allowed(p_tenant uuid, p_perm text, p_setting text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    COALESCE((
      SELECT CASE p_setting WHEN 'allow_edit' THEN ds.allow_edit WHEN 'allow_delete' THEN ds.allow_delete ELSE false END
      FROM document_settings ds WHERE ds.tenant_id = p_tenant AND ds.doc_type = 'supplier_order'
    ), false)
    AND (
      EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = auth.uid() AND pr.role IN ('admin', 'super_admin'))
      OR public.vault_has_permission(p_perm)
    );
$$;

REVOKE ALL ON FUNCTION public._supplier_order_action_allowed(uuid, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.revert_supplier_order_reception(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_order supplier_orders%ROWTYPE;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Aucun tenant courant'; END IF;
  IF NOT public._supplier_order_action_allowed(v_tenant, 'edit_supplier_orders', 'allow_edit') THEN
    RAISE EXCEPTION 'Modification des commandes fournisseur non autorisée';
  END IF;

  SELECT * INTO v_order FROM supplier_orders WHERE id = p_order_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
  IF v_order.status NOT IN ('received', 'partial') THEN
    RETURN jsonb_build_object('order_id', p_order_id, 'status', v_order.status, 'reverted', false);
  END IF;

  PERFORM public._reverse_supplier_order_effects(p_order_id, v_tenant);

  UPDATE supplier_order_items SET quantity_received = 0
  WHERE order_id = p_order_id AND tenant_id = v_tenant;
  DELETE FROM supplier_order_receptions WHERE order_id = p_order_id AND tenant_id = v_tenant;
  UPDATE supplier_orders SET status = 'confirmed', received_date = NULL WHERE id = p_order_id;

  RETURN jsonb_build_object('order_id', p_order_id, 'status', 'confirmed', 'reverted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.revert_supplier_order_reception(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_supplier_order_reception(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_supplier_order(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tenant uuid;
  v_order supplier_orders%ROWTYPE;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Aucun tenant courant'; END IF;
  IF NOT public._supplier_order_action_allowed(v_tenant, 'delete_supplier_orders', 'allow_delete') THEN
    RAISE EXCEPTION 'Suppression des commandes fournisseur non autorisée';
  END IF;

  SELECT * INTO v_order FROM supplier_orders WHERE id = p_order_id AND tenant_id = v_tenant FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION 'Commande introuvable'; END IF;

  IF EXISTS (SELECT 1 FROM supplier_payments WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION '[ORDER_HAS_PAYMENTS] Des paiements sont liés à cette commande';
  END IF;

  PERFORM public._reverse_supplier_order_effects(p_order_id, v_tenant);

  DELETE FROM supplier_orders WHERE id = p_order_id AND tenant_id = v_tenant;

  RETURN jsonb_build_object('order_id', p_order_id, 'deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_supplier_order(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_supplier_order(uuid) TO authenticated;
