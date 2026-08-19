/*
# Phase 8b: Atomic process_sale_return RPC

## Summary
Creates a single transactional RPC that replaces the 5-step frontend return
workflow. All operations (validation, return creation, stock reintegration,
optional refund) execute in one database transaction. If any step fails,
everything rolls back automatically.

## New Function: process_sale_return

### Parameters
  - p_sale_id (uuid) — the original sale
  - p_site_id (uuid) — site processing the return
  - p_cash_session_id (uuid) — current open cash session
  - p_items (jsonb) — array of {sale_item_id, quantity}
  - p_reason (text) — free-text reason
  - p_refund_now (boolean) — whether to create immediate cash refund
  - p_restock (boolean) — whether to reintegrate stock (default true)
  - p_request_id (text) — client idempotency key

### Behavior
  1. Authenticates via current_tenant_id()
  2. Checks idempotency (returns existing result if request_id already used)
  3. Validates sale ownership, status, site, session
  4. For each item: locks sale_item row, validates quantity with FOR UPDATE
  5. Creates sale_returns + sale_return_items with purchase_cost from sale_items
  6. Restocks via stock_levels + stock_movements (respects track_stock)
  7. If refund requested: creates cash_movements with kind='refund' and sale_return_id
  8. Returns JSON with return_id, return_number, total, refunded

### Security
  - SECURITY DEFINER with search_path = public
  - GRANT EXECUTE TO authenticated only
  - Tenant isolation via current_tenant_id()
  - Row-level locking via FOR UPDATE on sale_items

### Concurrency
  - SELECT ... FOR UPDATE on sale_items prevents two users from over-returning
  - Idempotency via unique (tenant_id, request_id) constraint

### Error Messages (human-readable French)
  - 'Non authentifié'
  - 'Vente introuvable ou accès refusé'
  - 'Impossible de retourner une vente annulée'
  - 'Session de caisse invalide ou fermée'
  - 'Article (sale_item_id) ne fait pas partie de cette vente'
  - 'Quantité retournée (X) dépasse le disponible (Y) pour article Z'
  - 'Aucun article à retourner'
*/

CREATE OR REPLACE FUNCTION process_sale_return(
  p_sale_id uuid,
  p_site_id uuid,
  p_cash_session_id uuid,
  p_items jsonb,
  p_reason text DEFAULT 'Retour au POS',
  p_refund_now boolean DEFAULT true,
  p_restock boolean DEFAULT true,
  p_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale record;
  v_session record;
  v_site record;
  v_item jsonb;
  v_si record;
  v_already_returned numeric;
  v_remaining numeric;
  v_req_qty numeric;
  v_return_total numeric := 0;
  v_return_id uuid;
  v_return_number text;
  v_article_names text[] := '{}';
  v_prev_stock numeric;
  v_new_stock numeric;
  v_track boolean;
  v_existing_return_id uuid;
BEGIN
  -- 0. Auth
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  -- 1. Idempotency check
  IF p_request_id IS NOT NULL THEN
    SELECT id INTO v_existing_return_id
    FROM sale_returns
    WHERE tenant_id = v_tenant_id AND request_id = p_request_id;

    IF v_existing_return_id IS NOT NULL THEN
      RETURN (
        SELECT jsonb_build_object(
          'success', true,
          'return_id', sr.id,
          'return_number', sr.return_number,
          'total', sr.total,
          'refunded', sr.refunded_at IS NOT NULL,
          'idempotent', true
        )
        FROM sale_returns sr WHERE sr.id = v_existing_return_id
      );
    END IF;
  END IF;

  -- 2. Validate sale
  SELECT * INTO v_sale FROM sales
  WHERE id = p_sale_id AND tenant_id = v_tenant_id;
  IF v_sale.id IS NULL THEN
    RAISE EXCEPTION 'Vente introuvable ou accès refusé';
  END IF;
  IF v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'Impossible de retourner une vente annulée';
  END IF;

  -- 3. Validate site
  SELECT * INTO v_site FROM sites
  WHERE id = p_site_id AND tenant_id = v_tenant_id;
  IF v_site.id IS NULL THEN
    RAISE EXCEPTION 'Site introuvable ou accès refusé';
  END IF;

  -- 4. Validate cash session
  SELECT * INTO v_session FROM cash_sessions
  WHERE id = p_cash_session_id AND tenant_id = v_tenant_id AND site_id = p_site_id AND status = 'open';
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session de caisse invalide ou fermée';
  END IF;

  -- 5. Validate items array
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Aucun article à retourner';
  END IF;

  -- 6. Generate return number
  v_return_number := next_doc_number(v_tenant_id, 'return', 'RET');

  -- 7. Create sale_returns header
  INSERT INTO sale_returns (
    id, tenant_id, site_id, sale_id, customer_id, user_id,
    cash_session_id, return_number, total, refund_method,
    status, reason, restock, request_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, p_site_id, p_sale_id, v_sale.customer_id, auth.uid(),
    p_cash_session_id, v_return_number, 0,
    CASE WHEN p_refund_now THEN 'cash' ELSE 'none' END,
    'approved', COALESCE(p_reason, 'Retour au POS'), p_restock, p_request_id
  ) RETURNING id INTO v_return_id;

  -- 8. Process each item
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    -- 8a. Lock the sale_item row and fetch it
    SELECT * INTO v_si FROM sale_items
    WHERE id = (v_item->>'sale_item_id')::uuid
      AND sale_id = p_sale_id
      AND tenant_id = v_tenant_id
    FOR UPDATE;

    IF v_si.id IS NULL THEN
      RAISE EXCEPTION 'Article (sale_item_id %) ne fait pas partie de cette vente', v_item->>'sale_item_id';
    END IF;

    v_req_qty := (v_item->>'quantity')::numeric;
    IF v_req_qty <= 0 THEN CONTINUE; END IF;

    -- 8b. Calculate already-returned for this sale_item_id
    SELECT COALESCE(SUM(sri.quantity), 0) INTO v_already_returned
    FROM sale_return_items sri
    JOIN sale_returns sr ON sr.id = sri.return_id
    WHERE sri.sale_item_id = v_si.id
      AND sr.status IN ('approved', 'pending');

    v_remaining := v_si.quantity - v_already_returned;

    IF v_req_qty > v_remaining THEN
      RAISE EXCEPTION 'Quantité retournée (%) dépasse le disponible (%) pour article %',
        v_req_qty, v_remaining, v_si.name;
    END IF;

    -- 8c. Insert sale_return_item
    INSERT INTO sale_return_items (
      id, tenant_id, return_id, article_id, sale_item_id,
      name, quantity, unit_price, purchase_cost, total
    ) VALUES (
      gen_random_uuid(), v_tenant_id, v_return_id, v_si.article_id, v_si.id,
      v_si.name, v_req_qty, v_si.unit_price, COALESCE(v_si.purchase_cost, 0),
      v_req_qty * v_si.unit_price
    );

    v_return_total := v_return_total + (v_req_qty * v_si.unit_price);
    v_article_names := v_article_names || (v_si.name || CASE WHEN v_req_qty > 1 THEN ' x' || v_req_qty ELSE '' END);

    -- 8d. Restock if requested and article tracks stock
    IF p_restock AND v_si.article_id IS NOT NULL THEN
      SELECT COALESCE(a.track_stock, true) INTO v_track
      FROM articles a WHERE a.id = v_si.article_id;

      IF v_track THEN
        SELECT COALESCE(sl.quantity, 0) INTO v_prev_stock
        FROM stock_levels sl
        WHERE sl.article_id = v_si.article_id AND sl.site_id = p_site_id;

        IF v_prev_stock IS NULL THEN
          v_prev_stock := 0;
          INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
          VALUES (v_tenant_id, v_si.article_id, p_site_id, 0);
        END IF;

        v_new_stock := v_prev_stock + v_req_qty;

        UPDATE stock_levels
        SET quantity = v_new_stock, updated_at = now()
        WHERE article_id = v_si.article_id AND site_id = p_site_id;

        INSERT INTO stock_movements (
          tenant_id, article_id, site_id, movement_type, quantity,
          previous_qty, new_qty, user_id, note
        ) VALUES (
          v_tenant_id, v_si.article_id, p_site_id, 'return_customer', v_req_qty,
          v_prev_stock, v_new_stock, auth.uid(),
          'Retour ' || v_return_number
        );
      END IF;
    END IF;
  END LOOP;

  -- 9. Update return total
  UPDATE sale_returns SET total = v_return_total WHERE id = v_return_id;

  -- 10. Refund if requested
  IF p_refund_now AND v_return_total > 0 THEN
    INSERT INTO cash_movements (
      tenant_id, site_id, cash_session_id, user_id,
      kind, amount, reason, reference, sale_return_id
    ) VALUES (
      v_tenant_id, p_site_id, p_cash_session_id, auth.uid(),
      'refund', v_return_total,
      'Retour ' || v_return_number || ': ' || array_to_string(v_article_names, ', '),
      v_return_number, v_return_id
    );

    UPDATE cash_sessions
    SET theoretical_amount = GREATEST(0, COALESCE(theoretical_amount, 0) - v_return_total)
    WHERE id = p_cash_session_id;

    UPDATE sale_returns
    SET refunded_at = now(),
        refund_cash_session_id = p_cash_session_id,
        approved_by = auth.uid()
    WHERE id = v_return_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'total', v_return_total,
    'refunded', p_refund_now,
    'items_count', jsonb_array_length(p_items),
    'article_names', array_to_string(v_article_names, ', '),
    'idempotent', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION process_sale_return TO authenticated;
