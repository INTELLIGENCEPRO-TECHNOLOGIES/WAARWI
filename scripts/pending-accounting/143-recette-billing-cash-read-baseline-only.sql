-- RECETTE UNIQUEMENT : interfaces facturation et caisse, fonctions de lecture manquantes.
SET LOCAL search_path TO public,extensions,pg_catalog;
CREATE OR REPLACE FUNCTION public.cash_pos_context(p_site_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_me public.profiles;
v_multi boolean;
v_elev boolean;
v_mine uuid;
v_site_sess uuid;
v_other jsonb;
v_regs jsonb;
BEGIN
v_me := public._cr_require_caller();
IF NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = p_site_id AND s.tenant_id = v_me.tenant_id) THEN
RAISE EXCEPTION 'Magasin introuvable' USING ERRCODE = '42501';
END IF;
v_multi := public._cs_multi_enabled(v_me.tenant_id);

IF NOT v_multi THEN
SELECT cs.id INTO v_site_sess FROM cash_sessions cs
WHERE cs.tenant_id = v_me.tenant_id AND cs.site_id = p_site_id AND cs.status = 'open'
ORDER BY cs.opened_at DESC LIMIT 1;
RETURN jsonb_build_object('multi_enabled', false,
'site_session', CASE WHEN v_site_sess IS NOT NULL THEN public._cs_session_payload(v_site_sess, true) END);
END IF;

IF NOT public._cr_profile_can_access_site(v_me.id, p_site_id) THEN
RAISE EXCEPTION 'Magasin non autorisé' USING ERRCODE = '42501';
END IF;
v_elev := public._cs_profile_is_elevated(v_me.id);

SELECT cs.id INTO v_mine FROM cash_sessions cs
WHERE cs.user_id = v_me.id AND cs.site_id = p_site_id AND cs.status = 'open'
ORDER BY cs.opened_at DESC LIMIT 1;

SELECT jsonb_build_object('site_id', cs.site_id, 'site_name', s.name, 'register_code', r.code, 'register_name', r.name)
INTO v_other
FROM cash_sessions cs JOIN sites s ON s.id = cs.site_id JOIN cash_registers r ON r.id = cs.cash_register_id
WHERE cs.user_id = v_me.id AND cs.status = 'open' AND cs.site_id <> p_site_id
ORDER BY cs.opened_at DESC LIMIT 1;

SELECT COALESCE(jsonb_agg(jsonb_build_object(
'id', r.id, 'code', r.code, 'name', r.name, 'is_default', r.is_default,
'status', CASE WHEN os.id IS NULL THEN 'free' WHEN os.user_id = v_me.id THEN 'mine' ELSE 'busy' END,
'operator_name', CASE WHEN os.id IS NOT NULL AND os.user_id <> v_me.id THEN op.full_name END,
'assigned_to', asg.names,
'locked', (asg.names IS NOT NULL AND os.user_id IS DISTINCT FROM v_me.id
AND NOT public._cs_profile_is_assigned_to_register(v_me.id, r.id))
) ORDER BY r.is_default DESC, lower(r.code)), '[]'::jsonb)
INTO v_regs
FROM cash_registers r
LEFT JOIN LATERAL (SELECT cs.id, cs.user_id FROM cash_sessions cs
WHERE cs.cash_register_id = r.id AND cs.status = 'open'
ORDER BY cs.opened_at DESC LIMIT 1) os ON true
LEFT JOIN profiles op ON op.id = os.user_id
LEFT JOIN LATERAL (SELECT public._cs_register_assignee_names(r.id) AS names) asg ON true
WHERE r.tenant_id = v_me.tenant_id AND r.site_id = p_site_id AND r.is_active
AND public._cs_profile_can_use_register(v_me.id, r.id);

RETURN jsonb_build_object(
'multi_enabled', true,
'is_elevated', v_elev,
'can_open', public._cr_profile_has_permission(v_me.id, 'access_pos') AND public._cr_profile_has_permission(v_me.id, 'pos_open_session'),
'registers', v_regs,
'my_session', CASE WHEN v_mine IS NOT NULL THEN public._cs_session_payload(v_mine, true) END,
'other_session', v_other);
END;
$function$;
REVOKE ALL ON FUNCTION public.cash_pos_context(p_site_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cash_pos_context(p_site_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_operational_cash_session(p_site_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_me public.profiles;
v_multi boolean;
v_sid uuid;
BEGIN
v_me := public._cr_require_caller();
v_multi := public._cs_multi_enabled(v_me.tenant_id);
IF NOT v_multi THEN
SELECT cs.id INTO v_sid FROM cash_sessions cs
WHERE cs.tenant_id = v_me.tenant_id AND cs.site_id = p_site_id AND cs.status = 'open'
ORDER BY cs.opened_at DESC LIMIT 1;
ELSE
SELECT cs.id INTO v_sid FROM cash_sessions cs
WHERE cs.tenant_id = v_me.tenant_id AND cs.site_id = p_site_id AND cs.status = 'open' AND cs.user_id = v_me.id
AND public._cs_profile_can_use_register(v_me.id, cs.cash_register_id)
ORDER BY cs.opened_at DESC LIMIT 1;
END IF;
RETURN jsonb_build_object('multi_enabled', v_multi,
'session', CASE WHEN v_sid IS NOT NULL THEN public._cs_session_payload(v_sid, true) END);
END;
$function$;
REVOKE ALL ON FUNCTION public.my_operational_cash_session(p_site_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.my_operational_cash_session(p_site_id uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_paginated_invoices(p_tenant_id uuid, p_site_id uuid DEFAULT NULL::uuid, p_page_size integer DEFAULT 50, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_status_filter text DEFAULT NULL::text, p_customer_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_min_amount numeric DEFAULT NULL::numeric, p_max_amount numeric DEFAULT NULL::numeric, p_payment_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
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
REVOKE ALL ON FUNCTION public.rpc_paginated_invoices(p_tenant_id uuid, p_site_id uuid, p_page_size integer, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_search text, p_status_filter text, p_customer_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_min_amount numeric, p_max_amount numeric, p_payment_method text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rpc_paginated_invoices(p_tenant_id uuid, p_site_id uuid, p_page_size integer, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_search text, p_status_filter text, p_customer_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_min_amount numeric, p_max_amount numeric, p_payment_method text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_paginated_quotes(p_tenant_id uuid, p_site_id uuid DEFAULT NULL::uuid, p_page_size integer DEFAULT 50, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_status_filter text DEFAULT NULL::text, p_customer_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_min_amount numeric DEFAULT NULL::numeric, p_max_amount numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
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
$function$;
REVOKE ALL ON FUNCTION public.rpc_paginated_quotes(p_tenant_id uuid, p_site_id uuid, p_page_size integer, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_search text, p_status_filter text, p_customer_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_min_amount numeric, p_max_amount numeric) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rpc_paginated_quotes(p_tenant_id uuid, p_site_id uuid, p_page_size integer, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_search text, p_status_filter text, p_customer_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_min_amount numeric, p_max_amount numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_paginated_returns(p_tenant_id uuid, p_site_id uuid DEFAULT NULL::uuid, p_page_size integer DEFAULT 50, p_cursor_created_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cursor_id uuid DEFAULT NULL::uuid, p_search text DEFAULT NULL::text, p_status_filter text DEFAULT NULL::text, p_customer_id uuid DEFAULT NULL::uuid, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_min_amount numeric DEFAULT NULL::numeric, p_max_amount numeric DEFAULT NULL::numeric, p_refund_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_where text;
v_sql text;
v_rows jsonb;
v_total_count bigint;
v_totals jsonb;
v_safe_size int;
v_accessible_sites uuid[];
v_cs_uid text;
v_cs_sup text;
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
v_where := v_where || ' AND r.site_id = ANY(' || _uuid_array_literal(v_accessible_sites) || ')';
END IF;
IF public._cs_multi_current() THEN
v_cs_uid := quote_literal(COALESCE(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid));
v_cs_sup := _uuid_array_literal(public._cs_supervised_site_ids());
v_where := v_where || ' AND ((r.cash_session_id IS NOT NULL AND r.cash_session_id IN (SELECT cs.id FROM cash_sessions cs WHERE cs.tenant_id = r.tenant_id AND (cs.user_id = ' || v_cs_uid || ' OR cs.site_id = ANY(' || v_cs_sup || '))))'
|| ' OR (r.refund_cash_session_id IS NOT NULL AND r.refund_cash_session_id IN (SELECT cs.id FROM cash_sessions cs WHERE cs.tenant_id = r.tenant_id AND (cs.user_id = ' || v_cs_uid || ' OR cs.site_id = ANY(' || v_cs_sup || '))))'
|| ' OR (r.cash_session_id IS NULL AND r.refund_cash_session_id IS NULL AND (r.user_id = ' || v_cs_uid || ' OR r.site_id = ANY(' || v_cs_sup || '))))';
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
$function$;
REVOKE ALL ON FUNCTION public.rpc_paginated_returns(p_tenant_id uuid, p_site_id uuid, p_page_size integer, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_search text, p_status_filter text, p_customer_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_min_amount numeric, p_max_amount numeric, p_refund_method text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rpc_paginated_returns(p_tenant_id uuid, p_site_id uuid, p_page_size integer, p_cursor_created_at timestamp with time zone, p_cursor_id uuid, p_search text, p_status_filter text, p_customer_id uuid, p_date_from timestamp with time zone, p_date_to timestamp with time zone, p_min_amount numeric, p_max_amount numeric, p_refund_method text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_pos_popularity_scores(p_tenant_id uuid, p_site_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  SELECT coalesce(jsonb_object_agg(r.article_id::text, r.score), '{}'::jsonb)
  FROM (
    SELECT si.article_id, sum(coalesce(si.quantity, 0)) AS score
    FROM public.sales s
    JOIN public.sale_items si ON si.sale_id = s.id AND si.tenant_id = s.tenant_id
    WHERE s.tenant_id = p_tenant_id
      AND p_tenant_id = (SELECT public.current_tenant_id())
      AND s.created_at >= now() - interval '2160 hours'
      AND s.status <> 'cancelled'
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
      AND si.article_id IS NOT NULL
    GROUP BY si.article_id
  ) r;
$function$;
REVOKE ALL ON FUNCTION public.rpc_pos_popularity_scores(p_tenant_id uuid, p_site_id uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.rpc_pos_popularity_scores(p_tenant_id uuid, p_site_id uuid) TO authenticated;
