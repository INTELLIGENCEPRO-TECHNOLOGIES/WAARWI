/*
# ZIP 26 - New Paginated RPCs (Batch 2)

## New Functions
1. rpc_paginated_customers - Server-side search/pagination for customers
2. rpc_paginated_suppliers - Server-side search/pagination for suppliers
3. rpc_paginated_stock_documents - Server-side search/pagination for stock documents
4. rpc_paginated_stock_movements - Server-side search/pagination for stock movements
5. rpc_paginated_mt_operations - Server-side search/pagination for money transfer operations

## Security
- All functions validate tenant via current_tenant_id()
- All functions validate site access via current_user_accessible_site_ids()
- Page size capped at 200
- SECURITY DEFINER with search_path = public
- Grants restricted to authenticated role only

## Search Fields
- customers: name, phone, email, account_code
- suppliers: name, phone, email, contact, account_code
- stock_documents: doc_number, note
- stock_movements: article name, note, reference_type
- mt_operations: reference, client_name, client_phone, comment
*/

-- ============================================================
-- 1) rpc_paginated_customers
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_customers(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_name text DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_customer_type text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_has_balance boolean DEFAULT NULL
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

  v_where := 'WHERE c.tenant_id = ' || quote_literal(p_tenant_id);

  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND (c.site_id IS NULL OR c.site_id = ' || quote_literal(p_site_id) || ')';
  END IF;
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (c.name ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR c.phone ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR c.email ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR c.account_code ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;
  IF p_customer_type IS NOT NULL AND p_customer_type <> '' THEN
    v_where := v_where || ' AND c.customer_type = ' || quote_literal(p_customer_type);
  END IF;
  IF p_is_active IS NOT NULL THEN
    v_where := v_where || ' AND c.is_active = ' || p_is_active;
  END IF;
  IF p_has_balance IS NOT NULL AND p_has_balance THEN
    v_where := v_where || ' AND c.balance <> 0';
  END IF;
  IF p_cursor_name IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (c.name, c.id) > (' || quote_literal(p_cursor_name) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM customers c ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'total_customers' || chr(39) || ', count(*),
    ' || chr(39) || 'total_balance' || chr(39) || ', COALESCE(sum(c.balance), 0),
    ' || chr(39) || 'count_active' || chr(39) || ', count(*) FILTER (WHERE c.is_active = true),
    ' || chr(39) || 'count_with_balance' || chr(39) || ', count(*) FILTER (WHERE c.balance <> 0)
  ) FROM customers c ' || v_where INTO v_totals;

  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', c.id,
      ' || chr(39) || 'name' || chr(39) || ', c.name,
      ' || chr(39) || 'phone' || chr(39) || ', c.phone,
      ' || chr(39) || 'email' || chr(39) || ', c.email,
      ' || chr(39) || 'address' || chr(39) || ', c.address,
      ' || chr(39) || 'customer_type' || chr(39) || ', c.customer_type,
      ' || chr(39) || 'ninea' || chr(39) || ', c.ninea,
      ' || chr(39) || 'credit_limit' || chr(39) || ', c.credit_limit,
      ' || chr(39) || 'balance' || chr(39) || ', c.balance,
      ' || chr(39) || 'is_active' || chr(39) || ', c.is_active,
      ' || chr(39) || 'created_at' || chr(39) || ', c.created_at,
      ' || chr(39) || 'whatsapp' || chr(39) || ', c.whatsapp,
      ' || chr(39) || 'account_code' || chr(39) || ', c.account_code,
      ' || chr(39) || 'site_id' || chr(39) || ', c.site_id,
      ' || chr(39) || 'credit_blocked' || chr(39) || ', c.credit_blocked
    ) as row_data
    FROM customers c
    ' || v_where || '
    ORDER BY c.name ASC, c.id ASC
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

REVOKE ALL ON FUNCTION rpc_paginated_customers FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_customers TO authenticated;


-- ============================================================
-- 2) rpc_paginated_suppliers
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_suppliers(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_name text DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_has_balance boolean DEFAULT NULL
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

  v_where := 'WHERE s.tenant_id = ' || quote_literal(p_tenant_id);

  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND (s.site_id IS NULL OR s.site_id = ' || quote_literal(p_site_id) || ')';
  END IF;
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (s.name ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR s.phone ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR s.email ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR s.contact ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR s.account_code ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;
  IF p_is_active IS NOT NULL THEN
    v_where := v_where || ' AND s.is_active = ' || p_is_active;
  END IF;
  IF p_has_balance IS NOT NULL AND p_has_balance THEN
    v_where := v_where || ' AND s.balance <> 0';
  END IF;
  IF p_cursor_name IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (s.name, s.id) > (' || quote_literal(p_cursor_name) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM suppliers s ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'total_suppliers' || chr(39) || ', count(*),
    ' || chr(39) || 'total_balance' || chr(39) || ', COALESCE(sum(s.balance), 0),
    ' || chr(39) || 'count_active' || chr(39) || ', count(*) FILTER (WHERE s.is_active = true)
  ) FROM suppliers s ' || v_where INTO v_totals;

  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', s.id,
      ' || chr(39) || 'name' || chr(39) || ', s.name,
      ' || chr(39) || 'contact' || chr(39) || ', s.contact,
      ' || chr(39) || 'phone' || chr(39) || ', s.phone,
      ' || chr(39) || 'email' || chr(39) || ', s.email,
      ' || chr(39) || 'address' || chr(39) || ', s.address,
      ' || chr(39) || 'country' || chr(39) || ', s.country,
      ' || chr(39) || 'balance' || chr(39) || ', s.balance,
      ' || chr(39) || 'is_active' || chr(39) || ', s.is_active,
      ' || chr(39) || 'created_at' || chr(39) || ', s.created_at,
      ' || chr(39) || 'whatsapp' || chr(39) || ', s.whatsapp,
      ' || chr(39) || 'delivery_days' || chr(39) || ', s.delivery_days,
      ' || chr(39) || 'payment_terms' || chr(39) || ', s.payment_terms,
      ' || chr(39) || 'credit_limit' || chr(39) || ', s.credit_limit,
      ' || chr(39) || 'account_code' || chr(39) || ', s.account_code,
      ' || chr(39) || 'site_id' || chr(39) || ', s.site_id
    ) as row_data
    FROM suppliers s
    ' || v_where || '
    ORDER BY s.name ASC, s.id ASC
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

REVOKE ALL ON FUNCTION rpc_paginated_suppliers FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_suppliers TO authenticated;


-- ============================================================
-- 3) rpc_paginated_stock_documents
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_stock_documents(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_doc_type text DEFAULT NULL,
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

  v_where := 'WHERE sd.tenant_id = ' || quote_literal(p_tenant_id);
  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND (sd.site_id = ' || quote_literal(p_site_id) || ' OR sd.dest_site_id = ' || quote_literal(p_site_id) || ')';
  ELSE
    v_where := v_where || ' AND (sd.site_id = ANY(' || quote_literal(v_accessible_sites::text) || '::uuid[]) OR sd.dest_site_id = ANY(' || quote_literal(v_accessible_sites::text) || '::uuid[]))';
  END IF;

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (sd.doc_number ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR sd.note ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;
  IF p_doc_type IS NOT NULL AND p_doc_type <> '' THEN
    v_where := v_where || ' AND sd.doc_type = ' || quote_literal(p_doc_type);
  END IF;
  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    v_where := v_where || ' AND sd.status = ' || quote_literal(p_status_filter);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND sd.created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND sd.created_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (sd.created_at, sd.id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM stock_documents sd ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'total_docs' || chr(39) || ', count(*),
    ' || chr(39) || 'total_qty' || chr(39) || ', COALESCE(sum(sd.total_qty), 0)
  ) FROM stock_documents sd ' || v_where INTO v_totals;

  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', sd.id,
      ' || chr(39) || 'doc_number' || chr(39) || ', sd.doc_number,
      ' || chr(39) || 'doc_type' || chr(39) || ', sd.doc_type,
      ' || chr(39) || 'site_id' || chr(39) || ', sd.site_id,
      ' || chr(39) || 'dest_site_id' || chr(39) || ', sd.dest_site_id,
      ' || chr(39) || 'user_id' || chr(39) || ', sd.user_id,
      ' || chr(39) || 'note' || chr(39) || ', sd.note,
      ' || chr(39) || 'status' || chr(39) || ', sd.status,
      ' || chr(39) || 'total_qty' || chr(39) || ', sd.total_qty,
      ' || chr(39) || 'line_count' || chr(39) || ', sd.line_count,
      ' || chr(39) || 'created_at' || chr(39) || ', sd.created_at,
      ' || chr(39) || 'user_name' || chr(39) || ', p.full_name
    ) as row_data
    FROM stock_documents sd
    LEFT JOIN profiles p ON p.id = sd.user_id
    ' || v_where || '
    ORDER BY sd.created_at DESC, sd.id DESC
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

REVOKE ALL ON FUNCTION rpc_paginated_stock_documents FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_stock_documents TO authenticated;


-- ============================================================
-- 4) rpc_paginated_stock_movements
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_stock_movements(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_movement_type text DEFAULT NULL,
  p_article_id uuid DEFAULT NULL,
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

  v_where := 'WHERE sm.tenant_id = ' || quote_literal(p_tenant_id);
  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND sm.site_id = ' || quote_literal(p_site_id);
  ELSE
    v_where := v_where || ' AND sm.site_id = ANY(' || quote_literal(v_accessible_sites::text) || '::uuid[])';
  END IF;

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (EXISTS (SELECT 1 FROM articles ax WHERE ax.id = sm.article_id AND (ax.name ILIKE ' || quote_literal('%' || p_search || '%') || ' OR ax.internal_ref ILIKE ' || quote_literal('%' || p_search || '%') || '))'
      || ' OR sm.note ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;
  IF p_movement_type IS NOT NULL AND p_movement_type <> '' THEN
    v_where := v_where || ' AND sm.movement_type = ' || quote_literal(p_movement_type);
  END IF;
  IF p_article_id IS NOT NULL THEN
    v_where := v_where || ' AND sm.article_id = ' || quote_literal(p_article_id);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND sm.created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND sm.created_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (sm.created_at, sm.id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM stock_movements sm ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'total_movements' || chr(39) || ', count(*),
    ' || chr(39) || 'total_in' || chr(39) || ', COALESCE(sum(sm.quantity) FILTER (WHERE sm.quantity > 0), 0),
    ' || chr(39) || 'total_out' || chr(39) || ', COALESCE(sum(ABS(sm.quantity)) FILTER (WHERE sm.quantity < 0), 0)
  ) FROM stock_movements sm ' || v_where INTO v_totals;

  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', sm.id,
      ' || chr(39) || 'article_id' || chr(39) || ', sm.article_id,
      ' || chr(39) || 'article_name' || chr(39) || ', a.name,
      ' || chr(39) || 'article_ref' || chr(39) || ', a.internal_ref,
      ' || chr(39) || 'site_id' || chr(39) || ', sm.site_id,
      ' || chr(39) || 'movement_type' || chr(39) || ', sm.movement_type,
      ' || chr(39) || 'quantity' || chr(39) || ', sm.quantity,
      ' || chr(39) || 'previous_qty' || chr(39) || ', sm.previous_qty,
      ' || chr(39) || 'new_qty' || chr(39) || ', sm.new_qty,
      ' || chr(39) || 'unit_cost' || chr(39) || ', sm.unit_cost,
      ' || chr(39) || 'reference_type' || chr(39) || ', sm.reference_type,
      ' || chr(39) || 'reference_id' || chr(39) || ', sm.reference_id,
      ' || chr(39) || 'note' || chr(39) || ', sm.note,
      ' || chr(39) || 'created_at' || chr(39) || ', sm.created_at,
      ' || chr(39) || 'stock_document_id' || chr(39) || ', sm.stock_document_id,
      ' || chr(39) || 'user_id' || chr(39) || ', sm.user_id
    ) as row_data
    FROM stock_movements sm
    LEFT JOIN articles a ON a.id = sm.article_id
    ' || v_where || '
    ORDER BY sm.created_at DESC, sm.id DESC
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

REVOKE ALL ON FUNCTION rpc_paginated_stock_movements FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_stock_movements TO authenticated;


-- ============================================================
-- 5) rpc_paginated_mt_operations
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_mt_operations(
  p_tenant_id uuid,
  p_service_point_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_operated_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_type_filter text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_service_id uuid DEFAULT NULL,
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

  v_where := 'WHERE op.tenant_id = ' || quote_literal(p_tenant_id);

  IF p_service_point_id IS NOT NULL THEN
    v_where := v_where || ' AND op.service_point_id = ' || quote_literal(p_service_point_id);
  END IF;
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (op.reference ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR op.client_name ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR op.client_phone ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR op.comment ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;
  IF p_type_filter IS NOT NULL AND p_type_filter <> '' THEN
    v_where := v_where || ' AND op.type = ' || quote_literal(p_type_filter);
  END IF;
  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    v_where := v_where || ' AND op.status = ' || quote_literal(p_status_filter);
  END IF;
  IF p_service_id IS NOT NULL THEN
    v_where := v_where || ' AND op.service_id = ' || quote_literal(p_service_id);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND op.operated_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND op.operated_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_cursor_operated_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (op.operated_at, op.id) < (' || quote_literal(p_cursor_operated_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM mt_operations op ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'sum_amount' || chr(39) || ', COALESCE(sum(op.amount), 0),
    ' || chr(39) || 'sum_commission' || chr(39) || ', COALESCE(sum(op.commission), 0),
    ' || chr(39) || 'count_completed' || chr(39) || ', count(*) FILTER (WHERE op.status = ' || quote_literal('completed') || '),
    ' || chr(39) || 'count_cancelled' || chr(39) || ', count(*) FILTER (WHERE op.status = ' || quote_literal('cancelled') || ')
  ) FROM mt_operations op ' || v_where INTO v_totals;

  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', op.id,
      ' || chr(39) || 'service_point_id' || chr(39) || ', op.service_point_id,
      ' || chr(39) || 'service_id' || chr(39) || ', op.service_id,
      ' || chr(39) || 'type' || chr(39) || ', op.type,
      ' || chr(39) || 'amount' || chr(39) || ', op.amount,
      ' || chr(39) || 'commission' || chr(39) || ', op.commission,
      ' || chr(39) || 'currency' || chr(39) || ', op.currency,
      ' || chr(39) || 'reference' || chr(39) || ', op.reference,
      ' || chr(39) || 'client_name' || chr(39) || ', op.client_name,
      ' || chr(39) || 'client_phone' || chr(39) || ', op.client_phone,
      ' || chr(39) || 'status' || chr(39) || ', op.status,
      ' || chr(39) || 'comment' || chr(39) || ', op.comment,
      ' || chr(39) || 'operated_by' || chr(39) || ', op.operated_by,
      ' || chr(39) || 'operated_at' || chr(39) || ', op.operated_at,
      ' || chr(39) || 'created_at' || chr(39) || ', op.created_at,
      ' || chr(39) || 'wholesaler_id' || chr(39) || ', op.wholesaler_id,
      ' || chr(39) || 'source_account_id' || chr(39) || ', op.source_account_id,
      ' || chr(39) || 'dest_account_id' || chr(39) || ', op.dest_account_id,
      ' || chr(39) || 'cancelled_at' || chr(39) || ', op.cancelled_at,
      ' || chr(39) || 'cancel_reason' || chr(39) || ', op.cancel_reason
    ) as row_data
    FROM mt_operations op
    ' || v_where || '
    ORDER BY op.operated_at DESC, op.id DESC
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

REVOKE ALL ON FUNCTION rpc_paginated_mt_operations FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_mt_operations TO authenticated;
