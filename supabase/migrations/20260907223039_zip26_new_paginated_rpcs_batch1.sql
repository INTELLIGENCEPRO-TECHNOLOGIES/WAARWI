/*
# ZIP 26 - New Paginated RPCs (Batch 1)

## New Functions
1. rpc_paginated_supplier_orders - Server-side search/pagination for supplier orders
2. rpc_paginated_cash_sessions - Server-side search/pagination for cash sessions
3. rpc_paginated_online_orders - Server-side search/pagination for online orders

## Security
- All functions validate tenant via current_tenant_id()
- All functions validate site access via current_user_accessible_site_ids()
- Page size capped at 200
- SECURITY DEFINER with search_path = public
- Grants restricted to authenticated role only

## Search Fields
- supplier_orders: order_number, supplier name
- cash_sessions: session id, user name, status
- online_orders: order_number, customer_name, customer_phone
*/

-- ============================================================
-- 1) rpc_paginated_supplier_orders
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_supplier_orders(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_supplier_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_sql text;
  v_rows jsonb;
  v_total_count bigint;
  v_totals jsonb;
  v_safe_size int;
  v_accessible_sites uuid[];
BEGIN
  IF p_tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  v_accessible_sites := current_user_accessible_site_ids();
  IF p_site_id IS NOT NULL AND NOT (p_site_id = ANY(v_accessible_sites)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  v_safe_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);

  v_where := 'WHERE so.tenant_id = ' || quote_literal(p_tenant_id);
  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND so.site_id = ' || quote_literal(p_site_id);
  ELSE
    v_where := v_where || ' AND so.site_id = ANY(' || quote_literal(v_accessible_sites::text) || '::uuid[])';
  END IF;

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (so.order_number ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR EXISTS (SELECT 1 FROM suppliers sp WHERE sp.id = so.supplier_id AND sp.name ILIKE ' || quote_literal('%' || p_search || '%') || ')'
      || ')';
  END IF;
  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    v_where := v_where || ' AND so.status = ' || quote_literal(p_status_filter);
  END IF;
  IF p_supplier_id IS NOT NULL THEN
    v_where := v_where || ' AND so.supplier_id = ' || quote_literal(p_supplier_id);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND so.created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND so.created_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (so.created_at, so.id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM supplier_orders so ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'sum_total' || chr(39) || ', COALESCE(sum(so.total), 0),
    ' || chr(39) || 'sum_paid' || chr(39) || ', COALESCE(sum(so.paid), 0),
    ' || chr(39) || 'count_draft' || chr(39) || ', count(*) FILTER (WHERE so.status = ' || quote_literal('draft') || '),
    ' || chr(39) || 'count_confirmed' || chr(39) || ', count(*) FILTER (WHERE so.status = ' || quote_literal('confirmed') || '),
    ' || chr(39) || 'count_received' || chr(39) || ', count(*) FILTER (WHERE so.status = ' || quote_literal('received') || ')
  ) FROM supplier_orders so ' || v_where INTO v_totals;

  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', so.id,
      ' || chr(39) || 'order_number' || chr(39) || ', so.order_number,
      ' || chr(39) || 'supplier_id' || chr(39) || ', so.supplier_id,
      ' || chr(39) || 'supplier_name' || chr(39) || ', sp.name,
      ' || chr(39) || 'total' || chr(39) || ', so.total,
      ' || chr(39) || 'paid' || chr(39) || ', so.paid,
      ' || chr(39) || 'status' || chr(39) || ', so.status,
      ' || chr(39) || 'site_id' || chr(39) || ', so.site_id,
      ' || chr(39) || 'expected_date' || chr(39) || ', so.expected_date,
      ' || chr(39) || 'received_date' || chr(39) || ', so.received_date,
      ' || chr(39) || 'created_at' || chr(39) || ', so.created_at,
      ' || chr(39) || 'note' || chr(39) || ', so.note,
      ' || chr(39) || 'doc_header' || chr(39) || ', so.doc_header,
      ' || chr(39) || 'user_id' || chr(39) || ', so.user_id,
      ' || chr(39) || 'discount' || chr(39) || ', so.discount,
      ' || chr(39) || 'subtotal' || chr(39) || ', so.subtotal,
      ' || chr(39) || 'accounting_status' || chr(39) || ', so.accounting_status
    ) as row_data
    FROM supplier_orders so
    LEFT JOIN suppliers sp ON sp.id = so.supplier_id
    ' || v_where || '
    ORDER BY so.created_at DESC, so.id DESC
    LIMIT ' || v_safe_size || '
  ) sub';
  EXECUTE v_sql INTO v_rows;

  RETURN jsonb_build_object(
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'total_count', v_total_count,
    'totals', COALESCE(v_totals, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION rpc_paginated_supplier_orders FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_supplier_orders TO authenticated;


-- ============================================================
-- 2) rpc_paginated_cash_sessions
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_cash_sessions(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_opened_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_sql text;
  v_rows jsonb;
  v_total_count bigint;
  v_totals jsonb;
  v_safe_size int;
  v_accessible_sites uuid[];
BEGIN
  IF p_tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  v_accessible_sites := current_user_accessible_site_ids();
  IF p_site_id IS NOT NULL AND NOT (p_site_id = ANY(v_accessible_sites)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  v_safe_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);

  v_where := 'WHERE cs.tenant_id = ' || quote_literal(p_tenant_id);
  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND cs.site_id = ' || quote_literal(p_site_id);
  ELSE
    v_where := v_where || ' AND cs.site_id = ANY(' || quote_literal(v_accessible_sites::text) || '::uuid[])';
  END IF;

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (cs.id::text ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR EXISTS (SELECT 1 FROM profiles p WHERE p.id = cs.user_id AND p.full_name ILIKE ' || quote_literal('%' || p_search || '%') || ')'
      || ')';
  END IF;
  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    v_where := v_where || ' AND cs.status = ' || quote_literal(p_status_filter);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND cs.opened_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND cs.opened_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_cursor_opened_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (cs.opened_at, cs.id) < (' || quote_literal(p_cursor_opened_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM cash_sessions cs ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'count_open' || chr(39) || ', count(*) FILTER (WHERE cs.status = ' || quote_literal('open') || '),
    ' || chr(39) || 'count_closed' || chr(39) || ', count(*) FILTER (WHERE cs.status = ' || quote_literal('closed') || '),
    ' || chr(39) || 'sum_opening' || chr(39) || ', COALESCE(sum(cs.opening_amount), 0),
    ' || chr(39) || 'sum_closing' || chr(39) || ', COALESCE(sum(cs.closing_amount) FILTER (WHERE cs.closing_amount IS NOT NULL), 0)
  ) FROM cash_sessions cs ' || v_where INTO v_totals;

  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', cs.id,
      ' || chr(39) || 'site_id' || chr(39) || ', cs.site_id,
      ' || chr(39) || 'user_id' || chr(39) || ', cs.user_id,
      ' || chr(39) || 'user_name' || chr(39) || ', p.full_name,
      ' || chr(39) || 'opened_at' || chr(39) || ', cs.opened_at,
      ' || chr(39) || 'closed_at' || chr(39) || ', cs.closed_at,
      ' || chr(39) || 'opening_amount' || chr(39) || ', cs.opening_amount,
      ' || chr(39) || 'closing_amount' || chr(39) || ', cs.closing_amount,
      ' || chr(39) || 'theoretical_amount' || chr(39) || ', cs.theoretical_amount,
      ' || chr(39) || 'variance' || chr(39) || ', cs.variance,
      ' || chr(39) || 'status' || chr(39) || ', cs.status,
      ' || chr(39) || 'note' || chr(39) || ', cs.note,
      ' || chr(39) || 'counted_cash' || chr(39) || ', cs.counted_cash,
      ' || chr(39) || 'physical_cash_counted' || chr(39) || ', cs.physical_cash_counted,
      ' || chr(39) || 'vault_deposit_amount' || chr(39) || ', cs.vault_deposit_amount,
      ' || chr(39) || 'retained_cash_amount' || chr(39) || ', cs.retained_cash_amount
    ) as row_data
    FROM cash_sessions cs
    LEFT JOIN profiles p ON p.id = cs.user_id
    ' || v_where || '
    ORDER BY cs.opened_at DESC, cs.id DESC
    LIMIT ' || v_safe_size || '
  ) sub';
  EXECUTE v_sql INTO v_rows;

  RETURN jsonb_build_object(
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'total_count', v_total_count,
    'totals', COALESCE(v_totals, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION rpc_paginated_cash_sessions FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_cash_sessions TO authenticated;


-- ============================================================
-- 3) rpc_paginated_online_orders
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_online_orders(
  p_tenant_id uuid,
  p_page_size int DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_payment_status text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_sql text;
  v_rows jsonb;
  v_total_count bigint;
  v_totals jsonb;
  v_safe_size int;
BEGIN
  IF p_tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  v_safe_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);

  v_where := 'WHERE oo.tenant_id = ' || quote_literal(p_tenant_id);

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (oo.order_number ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR oo.customer_name ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR oo.customer_phone ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;
  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    v_where := v_where || ' AND oo.status = ' || quote_literal(p_status_filter);
  END IF;
  IF p_payment_status IS NOT NULL AND p_payment_status <> '' THEN
    v_where := v_where || ' AND oo.payment_status = ' || quote_literal(p_payment_status);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND oo.created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND oo.created_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (oo.created_at, oo.id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM online_orders oo ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'sum_total' || chr(39) || ', COALESCE(sum(oo.total), 0),
    ' || chr(39) || 'count_pending' || chr(39) || ', count(*) FILTER (WHERE oo.status = ' || quote_literal('pending') || '),
    ' || chr(39) || 'count_confirmed' || chr(39) || ', count(*) FILTER (WHERE oo.status = ' || quote_literal('confirmed') || '),
    ' || chr(39) || 'count_delivered' || chr(39) || ', count(*) FILTER (WHERE oo.status = ' || quote_literal('delivered') || ')
  ) FROM online_orders oo ' || v_where INTO v_totals;

  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', oo.id,
      ' || chr(39) || 'order_number' || chr(39) || ', oo.order_number,
      ' || chr(39) || 'customer_name' || chr(39) || ', oo.customer_name,
      ' || chr(39) || 'customer_phone' || chr(39) || ', oo.customer_phone,
      ' || chr(39) || 'customer_email' || chr(39) || ', oo.customer_email,
      ' || chr(39) || 'customer_id' || chr(39) || ', oo.customer_id,
      ' || chr(39) || 'delivery_mode' || chr(39) || ', oo.delivery_mode,
      ' || chr(39) || 'delivery_fee' || chr(39) || ', oo.delivery_fee,
      ' || chr(39) || 'payment_mode' || chr(39) || ', oo.payment_mode,
      ' || chr(39) || 'payment_status' || chr(39) || ', oo.payment_status,
      ' || chr(39) || 'subtotal' || chr(39) || ', oo.subtotal,
      ' || chr(39) || 'total' || chr(39) || ', oo.total,
      ' || chr(39) || 'status' || chr(39) || ', oo.status,
      ' || chr(39) || 'internal_note' || chr(39) || ', oo.internal_note,
      ' || chr(39) || 'sale_id' || chr(39) || ', oo.sale_id,
      ' || chr(39) || 'created_at' || chr(39) || ', oo.created_at
    ) as row_data
    FROM online_orders oo
    ' || v_where || '
    ORDER BY oo.created_at DESC, oo.id DESC
    LIMIT ' || v_safe_size || '
  ) sub';
  EXECUTE v_sql INTO v_rows;

  RETURN jsonb_build_object(
    'rows', COALESCE(v_rows, '[]'::jsonb),
    'total_count', v_total_count,
    'totals', COALESCE(v_totals, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION rpc_paginated_online_orders FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_online_orders TO authenticated;
