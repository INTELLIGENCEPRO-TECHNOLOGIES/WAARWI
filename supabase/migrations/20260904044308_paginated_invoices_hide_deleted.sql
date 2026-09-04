/*
# rpc_paginated_invoices : masquer les factures supprimées du journal des ventes

Les factures supprimées logiquement (`status='deleted'`) sont exclues de toutes les
vues actives et des totaux. Un filtre explicite `deleted` permet de les consulter dans
l'historique. Aucune donnée n'est modifiée.
*/
CREATE OR REPLACE FUNCTION public.rpc_paginated_invoices(p_tenant_id uuid, p_site_id uuid DEFAULT NULL::uuid, p_page_size integer DEFAULT 50, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_status_filter text DEFAULT NULL::text, p_customer_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_min_amount numeric DEFAULT NULL::numeric, p_max_amount numeric DEFAULT NULL::numeric, p_payment_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

-- Masquer les factures supprimées sauf demande explicite de l'historique
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
$function$;
