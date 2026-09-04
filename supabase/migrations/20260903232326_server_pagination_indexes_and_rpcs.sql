-- ============================================================================
-- Server pagination: missing indexes + paginated RPCs
-- Idempotent, no data modifications
-- ============================================================================

-- pg_trgm for fast ILIKE text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── Missing indexes for filter combinations ──────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sales_tenant_site_status_created
  ON sales (tenant_id, site_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_tenant_site_customer_created
  ON sales (tenant_id, site_id, customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_sale_number_trgm
  ON sales USING gin (sale_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_quotes_tenant_site_created
  ON quotes (tenant_id, site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotes_tenant_site_status_created
  ON quotes (tenant_id, site_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quotes_quote_number_trgm
  ON quotes USING gin (quote_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_sale_returns_tenant_site_created
  ON sale_returns (tenant_id, site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_returns_tenant_site_status_created
  ON sale_returns (tenant_id, site_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_returns_tenant_site_refund_created
  ON sale_returns (tenant_id, site_id, refund_method, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sale_returns_return_number_trgm
  ON sale_returns USING gin (return_number gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articles_name_trgm
  ON articles USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articles_internal_ref_trgm
  ON articles USING gin (internal_ref gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articles_oem_ref_trgm
  ON articles USING gin (oem_ref gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_articles_tenant_active_category
  ON articles (tenant_id, is_active, category_id);

CREATE INDEX IF NOT EXISTS idx_articles_tenant_active_track_stock
  ON articles (tenant_id, is_active, track_stock);

CREATE INDEX IF NOT EXISTS idx_stock_levels_tenant_site_article
  ON stock_levels (tenant_id, site_id, article_id);

CREATE INDEX IF NOT EXISTS idx_stmov_tenant_site_created
  ON stock_movements (tenant_id, site_id, created_at DESC);


-- ============================================================================
-- RPC: paginated invoices (sales) list
-- ============================================================================
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
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_cursor_clause text := '';
  v_total_count int;
  v_totals jsonb;
  v_rows jsonb;
  v_site_filter text := '';
BEGIN
  IF p_site_id IS NOT NULL THEN
    v_site_filter := ' AND site_id = ' || quote_literal(p_site_id);
  END IF;

  v_where := ' WHERE tenant_id = ' || quote_literal(p_tenant_id) || v_site_filter;

  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    CASE p_status_filter
      WHEN 'paid' THEN
        v_where := v_where || ' AND status <> ''cancelled'' AND paid >= total';
      WHEN 'partial' THEN
        v_where := v_where || ' AND status <> ''cancelled'' AND paid > 0 AND paid < total';
      WHEN 'validated' THEN
        v_where := v_where || ' AND status <> ''cancelled'' AND paid = 0';
      WHEN 'cancelled' THEN
        v_where := v_where || ' AND status = ''cancelled''';
      ELSE
        v_where := v_where || ' AND status = ' || quote_literal(p_status_filter);
    END CASE;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    v_where := v_where || ' AND customer_id = ' || quote_literal(p_customer_id);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND created_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_min_amount IS NOT NULL THEN
    v_where := v_where || ' AND total >= ' || p_min_amount::text;
  END IF;
  IF p_max_amount IS NOT NULL THEN
    v_where := v_where || ' AND total <= ' || p_max_amount::text;
  END IF;
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND sale_number ILIKE ' || quote_literal('%' || p_search || '%');
  END IF;
  IF p_payment_method IS NOT NULL AND p_payment_method <> '' THEN
    v_where := v_where || ' AND EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = sales.id AND sp.method_name ILIKE ' || quote_literal('%' || p_payment_method || '%') || ')';
  END IF;

  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_cursor_clause := ' AND (created_at, id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM sales ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ''sum_total'', COALESCE(sum(total), 0),
    ''sum_paid'', COALESCE(sum(CASE WHEN status <> ''''cancelled'''' THEN paid ELSE 0 END), 0),
    ''count_paid'', count(*) FILTER (WHERE status <> ''''cancelled'''' AND paid >= total),
    ''count_credit'', count(*) FILTER (WHERE status <> ''''cancelled'''' AND paid = 0),
    ''count_cancelled'', count(*) FILTER (WHERE status = ''''cancelled'''')
  ) FROM sales ' || v_where INTO v_totals;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
    SELECT id, sale_number, total, paid, status, customer_id, user_id, representative_id, rep_commission, created_at, public_code, accounting_status,
      (SELECT name FROM customers WHERE customers.id = sales.customer_id) AS customer_name
    FROM sales ' || v_where || v_cursor_clause ||
    ' ORDER BY created_at DESC, id DESC LIMIT ' || GREATEST(p_page_size, 1) || ') t' INTO v_rows;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total_count', v_total_count, 'totals', v_totals);
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_invoices FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_invoices TO authenticated;


-- ============================================================================
-- RPC: paginated quotes list
-- ============================================================================
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
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_cursor_clause text := '';
  v_total_count int;
  v_totals jsonb;
  v_rows jsonb;
  v_site_filter text := '';
BEGIN
  IF p_site_id IS NOT NULL THEN
    v_site_filter := ' AND site_id = ' || quote_literal(p_site_id);
  END IF;

  v_where := ' WHERE tenant_id = ' || quote_literal(p_tenant_id) || v_site_filter;

  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    v_where := v_where || ' AND status = ' || quote_literal(p_status_filter);
  END IF;
  IF p_customer_id IS NOT NULL THEN
    v_where := v_where || ' AND customer_id = ' || quote_literal(p_customer_id);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND created_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_min_amount IS NOT NULL THEN
    v_where := v_where || ' AND total >= ' || p_min_amount::text;
  END IF;
  IF p_max_amount IS NOT NULL THEN
    v_where := v_where || ' AND total <= ' || p_max_amount::text;
  END IF;
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND quote_number ILIKE ' || quote_literal('%' || p_search || '%');
  END IF;

  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_cursor_clause := ' AND (created_at, id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM quotes ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ''sum_total'', COALESCE(sum(total), 0),
    ''count_draft'', count(*) FILTER (WHERE status = ''''draft''''),
    ''count_accepted'', count(*) FILTER (WHERE status = ''''accepted''''),
    ''count_converted'', count(*) FILTER (WHERE status = ''''converted'''')
  ) FROM quotes ' || v_where INTO v_totals;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
    SELECT id, quote_number, total, status, customer_id, user_id, representative_id, created_at, valid_until, converted_sale_id,
      (SELECT name FROM customers WHERE customers.id = quotes.customer_id) AS customer_name,
      doc_header
    FROM quotes ' || v_where || v_cursor_clause ||
    ' ORDER BY created_at DESC, id DESC LIMIT ' || GREATEST(p_page_size, 1) || ') t' INTO v_rows;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total_count', v_total_count, 'totals', v_totals);
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_quotes FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_quotes TO authenticated;


-- ============================================================================
-- RPC: paginated sale_returns list (returns + credits)
-- ============================================================================
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
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_cursor_clause text := '';
  v_total_count int;
  v_totals jsonb;
  v_rows jsonb;
  v_site_filter text := '';
BEGIN
  IF p_site_id IS NOT NULL THEN
    v_site_filter := ' AND site_id = ' || quote_literal(p_site_id);
  END IF;

  v_where := ' WHERE tenant_id = ' || quote_literal(p_tenant_id) || v_site_filter;

  IF p_refund_method IS NOT NULL AND p_refund_method <> '' THEN
    IF p_refund_method = 'avoir' THEN
      v_where := v_where || ' AND refund_method = ''avoir''';
    ELSE
      v_where := v_where || ' AND refund_method <> ''avoir''';
    END IF;
  END IF;

  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    CASE p_status_filter
      WHEN 'available' THEN
        v_where := v_where || ' AND status = ''approved'' AND credit_used = 0';
      WHEN 'partial' THEN
        v_where := v_where || ' AND status = ''approved'' AND credit_used > 0 AND credit_used < total';
      WHEN 'used' THEN
        v_where := v_where || ' AND status = ''approved'' AND credit_used >= total';
      ELSE
        v_where := v_where || ' AND status = ' || quote_literal(p_status_filter);
    END CASE;
  END IF;

  IF p_customer_id IS NOT NULL THEN
    v_where := v_where || ' AND customer_id = ' || quote_literal(p_customer_id);
  END IF;
  IF p_date_from IS NOT NULL THEN
    v_where := v_where || ' AND created_at >= ' || quote_literal(p_date_from);
  END IF;
  IF p_date_to IS NOT NULL THEN
    v_where := v_where || ' AND created_at < ' || quote_literal(p_date_to);
  END IF;
  IF p_min_amount IS NOT NULL THEN
    v_where := v_where || ' AND total >= ' || p_min_amount::text;
  END IF;
  IF p_max_amount IS NOT NULL THEN
    v_where := v_where || ' AND total <= ' || p_max_amount::text;
  END IF;
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (return_number ILIKE ' || quote_literal('%' || p_search || '%') ||
      ' OR EXISTS (SELECT 1 FROM customers c WHERE c.id = sale_returns.customer_id AND c.name ILIKE ' || quote_literal('%' || p_search || '%') || ')' ||
      ' OR EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_returns.sale_id AND s.sale_number ILIKE ' || quote_literal('%' || p_search || '%') || '))';
  END IF;

  IF p_cursor_created_at IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_cursor_clause := ' AND (created_at, id) < (' || quote_literal(p_cursor_created_at) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM sale_returns ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ''sum_total'', COALESCE(sum(total), 0),
    ''count_pending'', count(*) FILTER (WHERE status = ''''pending''''),
    ''count_approved'', count(*) FILTER (WHERE status = ''''approved'''')
  ) FROM sale_returns ' || v_where INTO v_totals;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
    SELECT id, return_number, total, status, refund_method, reason, restock, credit_used, customer_id, sale_id, created_at, refunded_at,
      (SELECT name FROM customers WHERE customers.id = sale_returns.customer_id) AS customer_name,
      (SELECT sale_number FROM sales WHERE sales.id = sale_returns.sale_id) AS sale_number
    FROM sale_returns ' || v_where || v_cursor_clause ||
    ' ORDER BY created_at DESC, id DESC LIMIT ' || GREATEST(p_page_size, 1) || ') t' INTO v_rows;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total_count', v_total_count, 'totals', v_totals);
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_returns FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_returns TO authenticated;


-- ============================================================================
-- RPC: paginated articles list (with optional stock for a site)
-- ============================================================================
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
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_having text := '';
  v_cursor_clause text := '';
  v_sort_col_sql text := 'a.name';
  v_total_count int;
  v_totals jsonb;
  v_rows jsonb;
  v_site_filter text := '';
  v_stock_site uuid;
  v_op text := '>';
BEGIN
  IF p_site_id IS NOT NULL THEN
    v_site_filter := ' AND a.site_id = ' || quote_literal(p_site_id);
  END IF;

  v_where := ' WHERE a.tenant_id = ' || quote_literal(p_tenant_id) || v_site_filter;

  IF p_is_active IS NOT NULL THEN
    v_where := v_where || ' AND a.is_active = ' || p_is_active::text;
  END IF;
  IF p_track_stock IS NOT NULL THEN
    v_where := v_where || ' AND a.track_stock = ' || p_track_stock::text;
  END IF;
  IF p_category_id IS NOT NULL THEN
    v_where := v_where || ' AND a.category_id = ' || quote_literal(p_category_id);
  END IF;
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (a.name ILIKE ' || quote_literal('%' || p_search || '%') ||
      ' OR a.internal_ref ILIKE ' || quote_literal('%' || p_search || '%') ||
      ' OR COALESCE(a.oem_ref, '''') ILIKE ' || quote_literal('%' || p_search || '%') ||
      ' OR COALESCE(a.supplier_ref, '''') ILIKE ' || quote_literal('%' || p_search || '%') ||
      ' OR COALESCE(a.barcode, '''') ILIKE ' || quote_literal('%' || p_search || '%') || ')';
  END IF;

  v_stock_site := COALESCE(p_stock_site_id, p_site_id);

  -- Determine sort column SQL
  CASE p_sort_col
    WHEN 'name' THEN v_sort_col_sql := 'a.name';
    WHEN 'ref' THEN v_sort_col_sql := 'a.internal_ref';
    WHEN 'oem_ref' THEN v_sort_col_sql := 'COALESCE(a.oem_ref, '''')';
    WHEN 'category' THEN v_sort_col_sql := 'COALESCE(a.category_id::text, '''')';
    WHEN 'price' THEN v_sort_col_sql := 'COALESCE(a.sale_price, 0)';
    WHEN 'purchase_price' THEN v_sort_col_sql := 'COALESCE(a.purchase_price, 0)';
    WHEN 'stock' THEN v_sort_col_sql := 'COALESCE(sl.quantity, 0)';
    ELSE v_sort_col_sql := 'a.name';
  END CASE;

  -- Stock filter
  IF p_stock_filter IS NOT NULL AND p_stock_filter <> '' AND p_stock_filter <> 'all' THEN
    CASE p_stock_filter
      WHEN 'out' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) = 0';
      WHEN 'low' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(a.stock_min, 0)';
      WHEN 'in' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) > COALESCE(a.stock_min, 0)';
    END CASE;
  END IF;

  -- Cursor operator
  IF p_sort_dir = 'desc' THEN
    v_op := '<';
  END IF;

  -- Cursor clause
  IF p_cursor_val IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_cursor_clause := ' AND (' || v_sort_col_sql || ', a.id) ' || v_op || ' (' || quote_literal(p_cursor_val) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  IF p_include_stock AND v_stock_site IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM articles a LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(v_stock_site) || ' ' || v_where INTO v_total_count;

    EXECUTE 'SELECT jsonb_build_object(
      ''total_articles'', count(*),
      ''in_stock'', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > COALESCE(a.stock_min, 0)),
      ''low_stock'', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(a.stock_min, 0)),
      ''out_stock'', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) = 0)
    ) FROM articles a LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(v_stock_site) || ' ' || v_where INTO v_totals;

    EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
      SELECT a.id, a.tenant_id, a.internal_ref, a.name, a.description, a.category_id, a.brand, a.oem_ref, a.supplier_ref, a.barcode, a.supplier_id,
        a.condition, a.unit, a.purchase_price, a.sale_price, a.min_price, a.wholesale_price, a.vat_rate, a.stock_min, a.stock_max, a.location, a.image_url, a.is_active, a.ipm_eligible, a.track_stock, a.site_id,
        COALESCE(sl.quantity, 0)::numeric AS stock_quantity
      FROM articles a
      LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(v_stock_site) ||
      ' ' || v_where || v_cursor_clause ||
      ' ORDER BY ' || v_sort_col_sql || ' ' || upper(p_sort_dir) || ', a.id ' || upper(p_sort_dir) ||
      ' LIMIT ' || GREATEST(p_page_size, 1) || ') t' INTO v_rows;
  ELSE
    EXECUTE 'SELECT count(*) FROM articles a ' || v_where INTO v_total_count;
    EXECUTE 'SELECT jsonb_build_object(''total_articles'', count(*)) FROM articles a ' || v_where INTO v_totals;
    EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
      SELECT a.id, a.tenant_id, a.internal_ref, a.name, a.description, a.category_id, a.brand, a.oem_ref, a.supplier_ref, a.barcode, a.supplier_id,
        a.condition, a.unit, a.purchase_price, a.sale_price, a.min_price, a.wholesale_price, a.vat_rate, a.stock_min, a.stock_max, a.location, a.image_url, a.is_active, a.ipm_eligible, a.track_stock, a.site_id
      FROM articles a ' || v_where || v_cursor_clause ||
      ' ORDER BY ' || v_sort_col_sql || ' ' || upper(p_sort_dir) || ', a.id ' || upper(p_sort_dir) ||
      ' LIMIT ' || GREATEST(p_page_size, 1) || ') t' INTO v_rows;
  END IF;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total_count', v_total_count, 'totals', v_totals);
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_articles FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_articles TO authenticated;


-- ============================================================================
-- RPC: paginated stock list (articles + stock for a specific site)
-- ============================================================================
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
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_where text := '';
  v_cursor_clause text := '';
  v_sort_col_sql text := 'a.name';
  v_op text := '>';
  v_total_count int;
  v_totals jsonb;
  v_rows jsonb;
  v_site_filter text := '';
BEGIN
  IF NOT p_shared_articles THEN
    v_site_filter := ' AND a.site_id = ' || quote_literal(p_site_id);
  END IF;

  v_where := ' WHERE a.tenant_id = ' || quote_literal(p_tenant_id) || v_site_filter ||
    ' AND a.is_active = true AND a.track_stock = true';

  IF p_category_id IS NOT NULL THEN
    v_where := v_where || ' AND a.category_id = ' || quote_literal(p_category_id);
  END IF;
  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND (a.name ILIKE ' || quote_literal('%' || p_search || '%') ||
      ' OR a.internal_ref ILIKE ' || quote_literal('%' || p_search || '%') ||
      ' OR COALESCE(a.oem_ref, '''') ILIKE ' || quote_literal('%' || p_search || '%') || ')';
  END IF;

  IF p_stock_filter IS NOT NULL AND p_stock_filter <> '' AND p_stock_filter <> 'all' THEN
    CASE p_stock_filter
      WHEN 'out' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) = 0';
      WHEN 'low' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(a.stock_min, 0)';
      WHEN 'instock' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) > COALESCE(a.stock_min, 0)';
    END CASE;
  END IF;

  CASE p_sort_col
    WHEN 'name' THEN v_sort_col_sql := 'a.name';
    WHEN 'stock' THEN v_sort_col_sql := 'COALESCE(sl.quantity, 0)';
    WHEN 'min' THEN v_sort_col_sql := 'COALESCE(a.stock_min, 0)';
    WHEN 'price' THEN v_sort_col_sql := 'COALESCE(a.purchase_price, 0)';
    ELSE v_sort_col_sql := 'a.name';
  END CASE;

  IF p_sort_dir = 'desc' THEN
    v_op := '<';
  END IF;

  IF p_cursor_val IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_cursor_clause := ' AND (' || v_sort_col_sql || ', a.id) ' || v_op || ' (' || quote_literal(p_cursor_val) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM articles a LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(p_site_id) || ' ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
    ''total_articles'', count(*),
    ''in_stock'', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > COALESCE(a.stock_min, 0)),
    ''low_stock'', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(a.stock_min, 0)),
    ''out_stock'', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) = 0),
    ''total_value'', COALESCE(sum(COALESCE(sl.quantity, 0) * COALESCE(a.purchase_price, 0)), 0)
  ) FROM articles a LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(p_site_id) || ' ' || v_where INTO v_totals;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
    SELECT a.id AS article_id, a.name, a.internal_ref, a.purchase_price, a.stock_min, a.stock_max, a.location, a.category_id,
      COALESCE(sl.quantity, 0)::numeric AS quantity
    FROM articles a
    LEFT JOIN stock_levels sl ON sl.article_id = a.id AND sl.site_id = ' || quote_literal(p_site_id) ||
    ' ' || v_where || v_cursor_clause ||
    ' ORDER BY ' || v_sort_col_sql || ' ' || upper(p_sort_dir) || ', a.id ' || upper(p_sort_dir) ||
    ' LIMIT ' || GREATEST(p_page_size, 1) || ') t' INTO v_rows;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total_count', v_total_count, 'totals', v_totals);
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_stock FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_stock TO authenticated;
