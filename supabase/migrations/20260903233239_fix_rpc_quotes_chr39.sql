-- Fix: avoid nested quoting by building the totals query with chr(39) for single quotes

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
AS $func$
DECLARE
  v_where text := '';
  v_cursor_clause text := '';
  v_total_count int;
  v_totals jsonb;
  v_rows jsonb;
  v_site_filter text := '';
  q text := chr(39); -- single quote
BEGIN
  IF p_site_id IS NOT NULL THEN
    v_site_filter := ' AND site_id = ' || quote_literal(p_site_id);
  END IF;

  v_where := ' WHERE tenant_id = ' || quote_literal(p_tenant_id) || v_site_filter;

  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    CASE p_status_filter
      WHEN 'paid' THEN
        v_where := v_where || ' AND status <> ' || q || 'cancelled' || q || ' AND paid >= total';
      WHEN 'partial' THEN
        v_where := v_where || ' AND status <> ' || q || 'cancelled' || q || ' AND paid > 0 AND paid < total';
      WHEN 'validated' THEN
        v_where := v_where || ' AND status <> ' || q || 'cancelled' || q || ' AND paid = 0';
      WHEN 'cancelled' THEN
        v_where := v_where || ' AND status = ' || q || 'cancelled' || q;
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
    ' || q || 'sum_total' || q || ', COALESCE(sum(total), 0),
    ' || q || 'sum_paid' || q || ', COALESCE(sum(CASE WHEN status <> ' || q || 'cancelled' || q || ' THEN paid ELSE 0 END), 0),
    ' || q || 'count_paid' || q || ', count(*) FILTER (WHERE status <> ' || q || 'cancelled' || q || ' AND paid >= total),
    ' || q || 'count_credit' || q || ', count(*) FILTER (WHERE status <> ' || q || 'cancelled' || q || ' AND paid = 0),
    ' || q || 'count_cancelled' || q || ', count(*) FILTER (WHERE status = ' || q || 'cancelled' || q || ')
  ) FROM sales ' || v_where INTO v_totals;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
    SELECT id, sale_number, total, paid, status, customer_id, user_id, representative_id, rep_commission, created_at, public_code, accounting_status,
      (SELECT name FROM customers WHERE customers.id = sales.customer_id) AS customer_name
    FROM sales ' || v_where || v_cursor_clause ||
    ' ORDER BY created_at DESC, id DESC LIMIT ' || GREATEST(p_page_size, 1) || ') t' INTO v_rows;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total_count', v_total_count, 'totals', v_totals);
END;
$func$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_invoices FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_invoices TO authenticated;


-- Same fix for rpc_paginated_quotes
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
AS $func$
DECLARE
  v_where text := '';
  v_cursor_clause text := '';
  v_total_count int;
  v_totals jsonb;
  v_rows jsonb;
  v_site_filter text := '';
  q text := chr(39);
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
    ' || q || 'sum_total' || q || ', COALESCE(sum(total), 0),
    ' || q || 'count_draft' || q || ', count(*) FILTER (WHERE status = ' || q || 'draft' || q || '),
    ' || q || 'count_accepted' || q || ', count(*) FILTER (WHERE status = ' || q || 'accepted' || q || '),
    ' || q || 'count_converted' || q || ', count(*) FILTER (WHERE status = ' || q || 'converted' || q || ')
  ) FROM quotes ' || v_where INTO v_totals;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
    SELECT id, quote_number, total, status, customer_id, user_id, representative_id, created_at, valid_until, converted_sale_id,
      (SELECT name FROM customers WHERE customers.id = quotes.customer_id) AS customer_name,
      doc_header
    FROM quotes ' || v_where || v_cursor_clause ||
    ' ORDER BY created_at DESC, id DESC LIMIT ' || GREATEST(p_page_size, 1) || ') t' INTO v_rows;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total_count', v_total_count, 'totals', v_totals);
END;
$func$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_quotes FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_quotes TO authenticated;


-- Same fix for rpc_paginated_returns
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
AS $func$
DECLARE
  v_where text := '';
  v_cursor_clause text := '';
  v_total_count int;
  v_totals jsonb;
  v_rows jsonb;
  v_site_filter text := '';
  q text := chr(39);
BEGIN
  IF p_site_id IS NOT NULL THEN
    v_site_filter := ' AND site_id = ' || quote_literal(p_site_id);
  END IF;

  v_where := ' WHERE tenant_id = ' || quote_literal(p_tenant_id) || v_site_filter;

  IF p_refund_method IS NOT NULL AND p_refund_method <> '' THEN
    IF p_refund_method = 'avoir' THEN
      v_where := v_where || ' AND refund_method = ' || q || 'avoir' || q;
    ELSE
      v_where := v_where || ' AND refund_method <> ' || q || 'avoir' || q;
    END IF;
  END IF;

  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    CASE p_status_filter
      WHEN 'available' THEN
        v_where := v_where || ' AND status = ' || q || 'approved' || q || ' AND credit_used = 0';
      WHEN 'partial' THEN
        v_where := v_where || ' AND status = ' || q || 'approved' || q || ' AND credit_used > 0 AND credit_used < total';
      WHEN 'used' THEN
        v_where := v_where || ' AND status = ' || q || 'approved' || q || ' AND credit_used >= total';
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
    ' || q || 'sum_total' || q || ', COALESCE(sum(total), 0),
    ' || q || 'count_pending' || q || ', count(*) FILTER (WHERE status = ' || q || 'pending' || q || '),
    ' || q || 'count_approved' || q || ', count(*) FILTER (WHERE status = ' || q || 'approved' || q || ')
  ) FROM sale_returns ' || v_where INTO v_totals;

  EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
    SELECT id, return_number, total, status, refund_method, reason, restock, credit_used, customer_id, sale_id, created_at, refunded_at,
      (SELECT name FROM customers WHERE customers.id = sale_returns.customer_id) AS customer_name,
      (SELECT sale_number FROM sales WHERE sales.id = sale_returns.sale_id) AS sale_number
    FROM sale_returns ' || v_where || v_cursor_clause ||
    ' ORDER BY created_at DESC, id DESC LIMIT ' || GREATEST(p_page_size, 1) || ') t' INTO v_rows;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total_count', v_total_count, 'totals', v_totals);
END;
$func$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_returns FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_returns TO authenticated;
