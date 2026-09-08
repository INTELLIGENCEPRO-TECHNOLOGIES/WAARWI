/*
# Improve search in rpc_paginated_invoices and rpc_paginated_quotes

## Changes
- Both RPCs: search now covers document number, customer name, and numeric amount
- Both RPCs: changed from SECURITY DEFINER to SECURITY INVOKER
- Both RPCs: added tenant_id and site_id authorization guards
- Amount search: only triggered when the trimmed input looks numeric (digits, spaces, dots, commas)

## Security
- SECURITY INVOKER: runs as the calling user, respecting RLS
- Validates p_tenant_id = current_tenant_id()
- Validates current_user_can_access_site(p_site_id) when a site is provided
- EXECUTE restricted to authenticated role

## Notes
- Signatures, parameters, return shapes, pagination, status logic, and totals are unchanged
- Only the search clause and security posture are modified
*/

-- ── rpc_paginated_invoices ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_paginated_invoices(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL::uuid,
  p_page_size integer DEFAULT 50,
  p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_cursor_id uuid DEFAULT NULL::uuid,
  p_search text DEFAULT NULL::text,
  p_status_filter text DEFAULT NULL::text,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_min_amount numeric DEFAULT NULL::numeric,
  p_max_amount numeric DEFAULT NULL::numeric,
  p_payment_method text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  v_where text := '';
  v_cursor_clause text := '';
  v_total_count int;
  v_totals jsonb;
  v_rows jsonb;
  v_site_filter text := '';
  q text := chr(39);
  v_search_trimmed text;
  v_search_numeric numeric;
BEGIN
  -- Authorization guards
  IF p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'tenant mismatch';
  END IF;
  IF p_site_id IS NOT NULL AND NOT current_user_can_access_site(p_site_id) THEN
    RAISE EXCEPTION 'site access denied';
  END IF;

  IF p_site_id IS NOT NULL THEN
    v_site_filter := ' AND site_id = ' || quote_literal(p_site_id);
  END IF;

  v_where := ' WHERE tenant_id = ' || quote_literal(p_tenant_id) || v_site_filter;

  IF p_status_filter IS DISTINCT FROM 'deleted' THEN
    v_where := v_where || ' AND status <> ' || q || 'deleted' || q;
  END IF;

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
      WHEN 'deleted' THEN
        v_where := v_where || ' AND status = ' || q || 'deleted' || q;
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
    v_search_trimmed := regexp_replace(trim(p_search), '[\s,.]', '', 'g');
    v_where := v_where || ' AND (sale_number ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR EXISTS (SELECT 1 FROM customers c WHERE c.id = sales.customer_id AND c.name ILIKE ' || quote_literal('%' || p_search || '%') || ')';
    IF v_search_trimmed ~ '^\d+$' THEN
      BEGIN
        v_search_numeric := v_search_trimmed::numeric;
        v_where := v_where || ' OR total = ' || v_search_numeric::text;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    v_where := v_where || ')';
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
$function$;

REVOKE ALL ON FUNCTION rpc_paginated_invoices(uuid, uuid, integer, timestamptz, uuid, text, text, uuid, timestamptz, timestamptz, numeric, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION rpc_paginated_invoices(uuid, uuid, integer, timestamptz, uuid, text, text, uuid, timestamptz, timestamptz, numeric, numeric, text) TO authenticated;


-- ── rpc_paginated_quotes ────────────────────────────────────────
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
SECURITY INVOKER
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
  v_search_trimmed text;
  v_search_numeric numeric;
BEGIN
  -- Authorization guards
  IF p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'tenant mismatch';
  END IF;
  IF p_site_id IS NOT NULL AND NOT current_user_can_access_site(p_site_id) THEN
    RAISE EXCEPTION 'site access denied';
  END IF;

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
    v_search_trimmed := regexp_replace(trim(p_search), '[\s,.]', '', 'g');
    v_where := v_where || ' AND (quote_number ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR EXISTS (SELECT 1 FROM customers c WHERE c.id = quotes.customer_id AND c.name ILIKE ' || quote_literal('%' || p_search || '%') || ')';
    IF v_search_trimmed ~ '^\d+$' THEN
      BEGIN
        v_search_numeric := v_search_trimmed::numeric;
        v_where := v_where || ' OR total = ' || v_search_numeric::text;
      EXCEPTION WHEN OTHERS THEN NULL;
      END;
    END IF;
    v_where := v_where || ')';
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

REVOKE ALL ON FUNCTION rpc_paginated_quotes(uuid, uuid, int, timestamptz, uuid, text, text, uuid, timestamptz, timestamptz, numeric, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION rpc_paginated_quotes(uuid, uuid, int, timestamptz, uuid, text, text, uuid, timestamptz, timestamptz, numeric, numeric) TO authenticated;
