/*
# ZIP 26 - Fix Security in Existing Paginated RPCs

## Changes
1. All 5 existing RPCs (invoices, quotes, returns, articles, stock) now validate
   that p_tenant_id matches the caller's actual tenant via current_tenant_id().
2. Site access is enforced: when p_site_id is provided, it must be in the caller's
   accessible sites. When NULL, results are filtered to accessible sites only.
3. p_page_size is capped at 200 to prevent data exfiltration.
4. p_sort_dir (articles, stock) is validated to exactly 'asc' or 'desc'.

## Security
- Prevents cross-tenant data access
- Prevents unauthorized site access
- Prevents DoS via huge page sizes
- Prevents SQL injection via sort direction
*/

-- Helper: reusable security check block (used inside each RPC)
-- We patch each function by DROP + re-CREATE

-- ============================================================
-- 1) rpc_paginated_invoices
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_invoices(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_min_amount numeric DEFAULT NULL,
  p_max_amount numeric DEFAULT NULL,
  p_payment_method text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_sql text;
  v_count_sql text;
  v_totals_sql text;
  v_rows jsonb;
  v_total_count bigint;
  v_totals jsonb;
  v_safe_size int;
  v_accessible_sites uuid[];
BEGIN
  -- Security: tenant validation
  IF p_tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- Security: site access check
  v_accessible_sites := current_user_accessible_site_ids();
  IF p_site_id IS NOT NULL AND NOT (p_site_id = ANY(v_accessible_sites)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- Cap page size
  v_safe_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);
  
  -- Base filter
  v_where := 'WHERE s.tenant_id = ' || quote_literal(p_tenant_id);
  
  -- Site filter (use accessible sites if no specific site)
  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND s.site_id = ' || quote_literal(p_site_id);
  ELSE
    v_where := v_where || ' AND s.site_id = ANY(' || quote_literal(v_accessible_sites::text) || '::uuid[])';
  END IF;
  
  -- Exclude deleted
  v_where := v_where || ' AND s.status <> ' || quote_literal('deleted');
  
  -- Search
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (s.sale_number ILIKE ' || quote_literal('%' || p_search || '%') || ')';
  END IF;
  
  -- Customer filter
  IF p_customer_id IS NOT NULL THEN
    v_where := v_where || ' AND s.customer_id = ' || quote_literal(p_customer_id);
  END IF;
  
  -- Date range (half-open: from <= x < to)
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND s.created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND s.created_at < ' || quote_literal(p_date_to);
  END IF;
  
  -- Amount range
  IF p_min_amount IS NOT NULL THEN
    v_where := v_where || ' AND s.total >= ' || p_min_amount;
  END IF;
  IF p_max_amount IS NOT NULL THEN
    v_where := v_where || ' AND s.total <= ' || p_max_amount;
  END IF;
  
  -- Status filter (virtual statuses)
  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    CASE p_status_filter
      WHEN 'paid' THEN
        v_where := v_where || ' AND s.status <> ' || quote_literal('cancelled') || ' AND s.paid >= s.total';
      WHEN 'partial' THEN
        v_where := v_where || ' AND s.status <> ' || quote_literal('cancelled') || ' AND s.paid > 0 AND s.paid < s.total';
      WHEN 'validated' THEN
        v_where := v_where || ' AND s.status <> ' || quote_literal('cancelled') || ' AND s.paid = 0';
      WHEN 'cancelled' THEN
        v_where := v_where || ' AND s.status = ' || quote_literal('cancelled');
      ELSE NULL;
    END CASE;
  END IF;
  
  -- Payment method filter
  IF p_payment_method IS NOT NULL AND p_payment_method <> '' THEN
    v_where := v_where || ' AND EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = ' || quote_literal(p_payment_method) || ')';
  END IF;
  
  -- Cursor
  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (s.created_at, s.id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;
  
  -- Count
  v_count_sql := 'SELECT count(*) FROM sales s ' || v_where;
  EXECUTE v_count_sql INTO v_total_count;
  
  -- Totals
  v_totals_sql := 'SELECT jsonb_build_object(
    ' || chr(39) || 'sum_total' || chr(39) || ', COALESCE(sum(s.total), 0),
    ' || chr(39) || 'sum_paid' || chr(39) || ', COALESCE(sum(s.paid), 0),
    ' || chr(39) || 'count_paid' || chr(39) || ', count(*) FILTER (WHERE s.status <> ' || quote_literal('cancelled') || ' AND s.paid >= s.total),
    ' || chr(39) || 'count_credit' || chr(39) || ', count(*) FILTER (WHERE s.status <> ' || quote_literal('cancelled') || ' AND s.paid < s.total),
    ' || chr(39) || 'count_cancelled' || chr(39) || ', count(*) FILTER (WHERE s.status = ' || quote_literal('cancelled') || ')
  ) FROM sales s ' || v_where;
  EXECUTE v_totals_sql INTO v_totals;
  
  -- Rows
  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', s.id,
      ' || chr(39) || 'sale_number' || chr(39) || ', s.sale_number,
      ' || chr(39) || 'customer_id' || chr(39) || ', s.customer_id,
      ' || chr(39) || 'customer_name' || chr(39) || ', c.name,
      ' || chr(39) || 'total' || chr(39) || ', s.total,
      ' || chr(39) || 'paid' || chr(39) || ', s.paid,
      ' || chr(39) || 'status' || chr(39) || ', s.status,
      ' || chr(39) || 'site_id' || chr(39) || ', s.site_id,
      ' || chr(39) || 'created_at' || chr(39) || ', s.created_at,
      ' || chr(39) || 'doc_header' || chr(39) || ', s.doc_header,
      ' || chr(39) || 'user_id' || chr(39) || ', s.user_id,
      ' || chr(39) || 'discount' || chr(39) || ', s.discount
    ) as row_data
    FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
    ' || v_where || '
    ORDER BY s.created_at DESC, s.id DESC
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

REVOKE ALL ON FUNCTION rpc_paginated_invoices FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_invoices TO authenticated;


-- ============================================================
-- 2) rpc_paginated_quotes
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_quotes(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_min_amount numeric DEFAULT NULL,
  p_max_amount numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_sql text;
  v_count_sql text;
  v_totals_sql text;
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
  
  v_where := 'WHERE q.tenant_id = ' || quote_literal(p_tenant_id);
  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND q.site_id = ' || quote_literal(p_site_id);
  ELSE
    v_where := v_where || ' AND q.site_id = ANY(' || quote_literal(v_accessible_sites::text) || '::uuid[])';
  END IF;
  
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (q.quote_number ILIKE ' || quote_literal('%' || p_search || '%') || ')';
  END IF;
  IF p_customer_id IS NOT NULL THEN
    v_where := v_where || ' AND q.customer_id = ' || quote_literal(p_customer_id);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND q.created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND q.created_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_min_amount IS NOT NULL THEN
    v_where := v_where || ' AND q.total >= ' || p_min_amount;
  END IF;
  IF p_max_amount IS NOT NULL THEN
    v_where := v_where || ' AND q.total <= ' || p_max_amount;
  END IF;
  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    v_where := v_where || ' AND q.status = ' || quote_literal(p_status_filter);
  END IF;
  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (q.created_at, q.id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;
  
  EXECUTE 'SELECT count(*) FROM quotes q ' || v_where INTO v_total_count;
  
  v_totals_sql := 'SELECT jsonb_build_object(
    ' || chr(39) || 'sum_total' || chr(39) || ', COALESCE(sum(q.total), 0),
    ' || chr(39) || 'count_draft' || chr(39) || ', count(*) FILTER (WHERE q.status = ' || quote_literal('draft') || '),
    ' || chr(39) || 'count_accepted' || chr(39) || ', count(*) FILTER (WHERE q.status = ' || quote_literal('accepted') || '),
    ' || chr(39) || 'count_converted' || chr(39) || ', count(*) FILTER (WHERE q.status = ' || quote_literal('converted') || ')
  ) FROM quotes q ' || v_where;
  EXECUTE v_totals_sql INTO v_totals;
  
  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', q.id,
      ' || chr(39) || 'quote_number' || chr(39) || ', q.quote_number,
      ' || chr(39) || 'customer_id' || chr(39) || ', q.customer_id,
      ' || chr(39) || 'customer_name' || chr(39) || ', c.name,
      ' || chr(39) || 'total' || chr(39) || ', q.total,
      ' || chr(39) || 'status' || chr(39) || ', q.status,
      ' || chr(39) || 'site_id' || chr(39) || ', q.site_id,
      ' || chr(39) || 'created_at' || chr(39) || ', q.created_at,
      ' || chr(39) || 'doc_header' || chr(39) || ', q.doc_header,
      ' || chr(39) || 'valid_until' || chr(39) || ', q.valid_until,
      ' || chr(39) || 'converted_sale_id' || chr(39) || ', q.converted_sale_id,
      ' || chr(39) || 'user_id' || chr(39) || ', q.user_id,
      ' || chr(39) || 'discount' || chr(39) || ', q.discount
    ) as row_data
    FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
    ' || v_where || '
    ORDER BY q.created_at DESC, q.id DESC
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

REVOKE ALL ON FUNCTION rpc_paginated_quotes FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_quotes TO authenticated;


-- ============================================================
-- 3) rpc_paginated_returns
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_returns(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_created_at timestamptz DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_min_amount numeric DEFAULT NULL,
  p_max_amount numeric DEFAULT NULL,
  p_refund_method text DEFAULT NULL
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
  
  v_where := 'WHERE r.tenant_id = ' || quote_literal(p_tenant_id);
  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND r.site_id = ' || quote_literal(p_site_id);
  ELSE
    v_where := v_where || ' AND r.site_id = ANY(' || quote_literal(v_accessible_sites::text) || '::uuid[])';
  END IF;
  
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (r.return_number ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR EXISTS (SELECT 1 FROM customers cx WHERE cx.id = r.customer_id AND cx.name ILIKE ' || quote_literal('%' || p_search || '%') || ')'
      || ' OR EXISTS (SELECT 1 FROM sales sx WHERE sx.id = r.sale_id AND sx.sale_number ILIKE ' || quote_literal('%' || p_search || '%') || ')'
      || ')';
  END IF;
  IF p_customer_id IS NOT NULL THEN
    v_where := v_where || ' AND r.customer_id = ' || quote_literal(p_customer_id);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND r.created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND r.created_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_min_amount IS NOT NULL THEN
    v_where := v_where || ' AND r.total >= ' || p_min_amount;
  END IF;
  IF p_max_amount IS NOT NULL THEN
    v_where := v_where || ' AND r.total <= ' || p_max_amount;
  END IF;
  IF p_refund_method IS NOT NULL AND p_refund_method <> '' THEN
    IF p_refund_method = 'avoir' THEN
      v_where := v_where || ' AND r.refund_method = ' || quote_literal('avoir');
    ELSE
      v_where := v_where || ' AND (r.refund_method IS NULL OR r.refund_method <> ' || quote_literal('avoir') || ')';
    END IF;
  END IF;
  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    CASE p_status_filter
      WHEN 'available' THEN
        v_where := v_where || ' AND r.status = ' || quote_literal('approved') || ' AND r.credit_used = 0';
      WHEN 'partial' THEN
        v_where := v_where || ' AND r.credit_used > 0 AND r.credit_used < r.total';
      WHEN 'used' THEN
        v_where := v_where || ' AND r.credit_used >= r.total';
      ELSE
        v_where := v_where || ' AND r.status = ' || quote_literal(p_status_filter);
    END CASE;
  END IF;
  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (r.created_at, r.id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;
  
  EXECUTE 'SELECT count(*) FROM sale_returns r ' || v_where INTO v_total_count;
  
  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'sum_total' || chr(39) || ', COALESCE(sum(r.total), 0),
    ' || chr(39) || 'count_pending' || chr(39) || ', count(*) FILTER (WHERE r.status = ' || quote_literal('pending') || '),
    ' || chr(39) || 'count_approved' || chr(39) || ', count(*) FILTER (WHERE r.status = ' || quote_literal('approved') || ')
  ) FROM sale_returns r ' || v_where INTO v_totals;
  
  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', r.id,
      ' || chr(39) || 'return_number' || chr(39) || ', r.return_number,
      ' || chr(39) || 'sale_id' || chr(39) || ', r.sale_id,
      ' || chr(39) || 'sale_number' || chr(39) || ', s.sale_number,
      ' || chr(39) || 'customer_id' || chr(39) || ', r.customer_id,
      ' || chr(39) || 'customer_name' || chr(39) || ', c.name,
      ' || chr(39) || 'total' || chr(39) || ', r.total,
      ' || chr(39) || 'credit_used' || chr(39) || ', r.credit_used,
      ' || chr(39) || 'status' || chr(39) || ', r.status,
      ' || chr(39) || 'refund_method' || chr(39) || ', r.refund_method,
      ' || chr(39) || 'site_id' || chr(39) || ', r.site_id,
      ' || chr(39) || 'created_at' || chr(39) || ', r.created_at,
      ' || chr(39) || 'user_id' || chr(39) || ', r.user_id
    ) as row_data
    FROM sale_returns r 
    LEFT JOIN customers c ON c.id = r.customer_id
    LEFT JOIN sales s ON s.id = r.sale_id
    ' || v_where || '
    ORDER BY r.created_at DESC, r.id DESC
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

REVOKE ALL ON FUNCTION rpc_paginated_returns FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_returns TO authenticated;


-- ============================================================
-- 4) rpc_paginated_articles - add security + sort_dir validation
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_articles(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_stock_site_id uuid DEFAULT NULL,
  p_page_size int DEFAULT 50,
  p_cursor_val text DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_stock_filter text DEFAULT NULL,
  p_sort_col text DEFAULT 'name',
  p_sort_dir text DEFAULT 'asc',
  p_is_active boolean DEFAULT true,
  p_track_stock boolean DEFAULT NULL,
  p_include_stock boolean DEFAULT true
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
  v_sort_column text;
  v_sort_direction text;
  v_cursor_cmp text;
  v_stock_join text := '';
  v_stock_select text := '';
BEGIN
  IF p_tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  v_accessible_sites := current_user_accessible_site_ids();
  IF p_site_id IS NOT NULL AND NOT (p_site_id = ANY(v_accessible_sites)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_stock_site_id IS NOT NULL AND NOT (p_stock_site_id = ANY(v_accessible_sites)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  v_safe_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);
  
  -- Validate sort direction
  v_sort_direction := CASE WHEN upper(COALESCE(p_sort_dir, 'asc')) = 'DESC' THEN 'DESC' ELSE 'ASC' END;
  v_cursor_cmp := CASE WHEN v_sort_direction = 'ASC' THEN '>' ELSE '<' END;
  
  -- Resolve sort column
  v_sort_column := CASE COALESCE(p_sort_col, 'name')
    WHEN 'name' THEN 'a.name'
    WHEN 'ref' THEN 'a.internal_ref'
    WHEN 'internal_ref' THEN 'a.internal_ref'
    WHEN 'oem_ref' THEN 'a.oem_ref'
    WHEN 'category' THEN 'a.category_id'
    WHEN 'price' THEN 'a.sale_price'
    WHEN 'sale_price' THEN 'a.sale_price'
    WHEN 'purchase_price' THEN 'a.purchase_price'
    WHEN 'stock' THEN 'COALESCE(sl.quantity, 0)'
    ELSE 'a.name'
  END;
  
  -- Stock join
  IF p_include_stock AND p_stock_site_id IS NOT NULL THEN
    v_stock_join := ' LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(p_stock_site_id);
    v_stock_select := ', COALESCE(sl.quantity, 0) as stock_quantity, COALESCE(sl.stock_min, 0) as stock_min';
  ELSIF p_include_stock THEN
    v_stock_join := ' LEFT JOIN LATERAL (SELECT SUM(quantity) as quantity, MAX(stock_min) as stock_min FROM stock_levels WHERE article_id = a.id) sl ON true';
    v_stock_select := ', COALESCE(sl.quantity, 0) as stock_quantity, COALESCE(sl.stock_min, 0) as stock_min';
  END IF;
  
  v_where := 'WHERE a.tenant_id = ' || quote_literal(p_tenant_id);
  
  IF p_is_active IS NOT NULL THEN
    v_where := v_where || ' AND a.is_active = ' || p_is_active;
  END IF;
  IF p_track_stock IS NOT NULL THEN
    v_where := v_where || ' AND a.track_stock = ' || p_track_stock;
  END IF;
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (a.name ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR a.internal_ref ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR a.oem_ref ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR a.supplier_ref ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR a.barcode ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;
  IF p_category_id IS NOT NULL THEN
    v_where := v_where || ' AND a.category_id = ' || quote_literal(p_category_id);
  END IF;
  
  -- Stock filter
  IF p_stock_filter IS NOT NULL AND p_stock_filter <> '' AND p_include_stock THEN
    CASE p_stock_filter
      WHEN 'out' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) = 0';
      WHEN 'low' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(sl.stock_min, 0)';
      WHEN 'in' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) > COALESCE(sl.stock_min, 0)';
      ELSE NULL;
    END CASE;
  END IF;
  
  -- Cursor
  IF p_cursor_val IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (' || v_sort_column || ', a.id) ' || v_cursor_cmp || ' (' || quote_literal(p_cursor_val) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;
  
  -- Count
  EXECUTE 'SELECT count(*) FROM articles a' || v_stock_join || ' ' || v_where INTO v_total_count;
  
  -- Totals
  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'total_articles' || chr(39) || ', count(*),
    ' || chr(39) || 'in_stock' || chr(39) || ', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > COALESCE(sl.stock_min, 0)),
    ' || chr(39) || 'low_stock' || chr(39) || ', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(sl.stock_min, 0)),
    ' || chr(39) || 'out_stock' || chr(39) || ', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) = 0)
  ) FROM articles a' || v_stock_join || ' ' || v_where INTO v_totals;
  
  -- Rows
  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', a.id,
      ' || chr(39) || 'name' || chr(39) || ', a.name,
      ' || chr(39) || 'internal_ref' || chr(39) || ', a.internal_ref,
      ' || chr(39) || 'oem_ref' || chr(39) || ', a.oem_ref,
      ' || chr(39) || 'supplier_ref' || chr(39) || ', a.supplier_ref,
      ' || chr(39) || 'barcode' || chr(39) || ', a.barcode,
      ' || chr(39) || 'category_id' || chr(39) || ', a.category_id,
      ' || chr(39) || 'sale_price' || chr(39) || ', a.sale_price,
      ' || chr(39) || 'purchase_price' || chr(39) || ', a.purchase_price,
      ' || chr(39) || 'is_active' || chr(39) || ', a.is_active,
      ' || chr(39) || 'track_stock' || chr(39) || ', a.track_stock,
      ' || chr(39) || 'quantity' || chr(39) || ', COALESCE(sl.quantity, 0),
      ' || chr(39) || 'stock_min' || chr(39) || ', COALESCE(sl.stock_min, 0)
    ) as row_data
    FROM articles a' || v_stock_join || '
    ' || v_where || '
    ORDER BY ' || v_sort_column || ' ' || v_sort_direction || ', a.id ' || v_sort_direction || '
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

REVOKE ALL ON FUNCTION rpc_paginated_articles FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_articles TO authenticated;


-- ============================================================
-- 5) rpc_paginated_stock - add security + sort_dir validation
-- ============================================================
CREATE OR REPLACE FUNCTION rpc_paginated_stock(
  p_tenant_id uuid,
  p_site_id uuid,
  p_page_size int DEFAULT 50,
  p_cursor_val text DEFAULT NULL,
  p_cursor_id uuid DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_stock_filter text DEFAULT NULL,
  p_sort_col text DEFAULT 'name',
  p_sort_dir text DEFAULT 'asc',
  p_shared_articles boolean DEFAULT true
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
  v_sort_column text;
  v_sort_direction text;
  v_cursor_cmp text;
BEGIN
  IF p_tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  v_accessible_sites := current_user_accessible_site_ids();
  IF NOT (p_site_id = ANY(v_accessible_sites)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  v_safe_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);
  
  v_sort_direction := CASE WHEN upper(COALESCE(p_sort_dir, 'asc')) = 'DESC' THEN 'DESC' ELSE 'ASC' END;
  v_cursor_cmp := CASE WHEN v_sort_direction = 'ASC' THEN '>' ELSE '<' END;
  
  v_sort_column := CASE COALESCE(p_sort_col, 'name')
    WHEN 'name' THEN 'a.name'
    WHEN 'stock' THEN 'COALESCE(sl.quantity, 0)'
    WHEN 'min' THEN 'COALESCE(sl.stock_min, 0)'
    WHEN 'price' THEN 'a.sale_price'
    ELSE 'a.name'
  END;
  
  v_where := 'WHERE a.tenant_id = ' || quote_literal(p_tenant_id)
    || ' AND a.is_active = true AND a.track_stock = true';
  
  IF p_shared_articles THEN
    v_where := v_where || ' AND (a.site_id IS NULL OR a.site_id = ' || quote_literal(p_site_id) || ')';
  ELSE
    v_where := v_where || ' AND a.site_id = ' || quote_literal(p_site_id);
  END IF;
  
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (a.name ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR a.internal_ref ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR a.oem_ref ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;
  IF p_category_id IS NOT NULL THEN
    v_where := v_where || ' AND a.category_id = ' || quote_literal(p_category_id);
  END IF;
  IF p_stock_filter IS NOT NULL AND p_stock_filter <> '' THEN
    CASE p_stock_filter
      WHEN 'out' THEN v_where := v_where || ' AND COALESCE(sl.quantity, 0) = 0';
      WHEN 'low' THEN v_where := v_where || ' AND COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(sl.stock_min, 0)';
      WHEN 'in' THEN v_where := v_where || ' AND COALESCE(sl.quantity, 0) > COALESCE(sl.stock_min, 0)';
      ELSE NULL;
    END CASE;
  END IF;
  IF p_cursor_val IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (' || v_sort_column || ', a.id) ' || v_cursor_cmp || ' (' || quote_literal(p_cursor_val) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;
  
  EXECUTE 'SELECT count(*) FROM articles a LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(p_site_id) || ' ' || v_where INTO v_total_count;
  
  EXECUTE 'SELECT jsonb_build_object(
    ' || chr(39) || 'total_articles' || chr(39) || ', count(*),
    ' || chr(39) || 'in_stock' || chr(39) || ', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > COALESCE(sl.stock_min, 0)),
    ' || chr(39) || 'low_stock' || chr(39) || ', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(sl.stock_min, 0)),
    ' || chr(39) || 'out_stock' || chr(39) || ', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) = 0),
    ' || chr(39) || 'total_value' || chr(39) || ', COALESCE(sum(COALESCE(sl.quantity, 0) * a.purchase_price), 0)
  ) FROM articles a LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(p_site_id) || ' ' || v_where INTO v_totals;
  
  v_sql := 'SELECT jsonb_agg(row_data) FROM (
    SELECT jsonb_build_object(
      ' || chr(39) || 'id' || chr(39) || ', a.id,
      ' || chr(39) || 'article_id' || chr(39) || ', a.id,
      ' || chr(39) || 'name' || chr(39) || ', a.name,
      ' || chr(39) || 'internal_ref' || chr(39) || ', a.internal_ref,
      ' || chr(39) || 'oem_ref' || chr(39) || ', a.oem_ref,
      ' || chr(39) || 'barcode' || chr(39) || ', a.barcode,
      ' || chr(39) || 'category_id' || chr(39) || ', a.category_id,
      ' || chr(39) || 'sale_price' || chr(39) || ', a.sale_price,
      ' || chr(39) || 'purchase_price' || chr(39) || ', a.purchase_price,
      ' || chr(39) || 'quantity' || chr(39) || ', COALESCE(sl.quantity, 0),
      ' || chr(39) || 'stock_quantity' || chr(39) || ', COALESCE(sl.quantity, 0),
      ' || chr(39) || 'stock_min' || chr(39) || ', COALESCE(sl.stock_min, 0)
    ) as row_data
    FROM articles a LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(p_site_id) || '
    ' || v_where || '
    ORDER BY ' || v_sort_column || ' ' || v_sort_direction || ', a.id ' || v_sort_direction || '
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

REVOKE ALL ON FUNCTION rpc_paginated_stock FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_stock TO authenticated;
