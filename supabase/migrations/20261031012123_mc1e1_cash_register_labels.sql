/*
# MC1-E.1 — Libellés des caisses dans l'historique et les rapports

1. Nouvelle fonction
- `get_cash_register_labels(p_ids uuid[])` : renvoie (id, code, name) des caisses demandées,
  limitées au tenant courant. SECURITY DEFINER car `cash_registers` n'est pas lisible directement.
  Ne renvoie que des libellés (aucune donnée financière).
2. Fonction modifiée
- `rpc_paginated_cash_sessions` : même signature, mêmes filtres et contrôles ; chaque ligne
  contient en plus `cash_register_id`, `cash_register_code`, `cash_register_name`.
3. Sécurité
- EXECUTE révoqué de PUBLIC/anon, accordé à authenticated et service_role.
- Aucune modification de droits, d'affectations, de données ni d'activation tenant.
*/

CREATE OR REPLACE FUNCTION public.get_cash_register_labels(p_ids uuid[])
RETURNS TABLE(id uuid, code text, name text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
  SELECT r.id, COALESCE(r.code, ''), COALESCE(r.name, '')
  FROM cash_registers r
  WHERE r.id = ANY (COALESCE(p_ids, '{}'::uuid[]))
    AND auth.uid() IS NOT NULL
    AND r.tenant_id = public.current_tenant_id();
$f$;
REVOKE ALL ON FUNCTION public.get_cash_register_labels(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_register_labels(uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_paginated_cash_sessions(p_tenant_id uuid, p_site_id uuid DEFAULT NULL::uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_search text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cash_register_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
v_where text;
v_total_count int;
v_stats jsonb;
v_rows jsonb;
v_offset int;
BEGIN
IF p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'tenant mismatch';
END IF;

IF p_site_id IS NOT NULL AND NOT current_user_can_access_site(p_site_id) THEN
RAISE EXCEPTION 'site access denied';
END IF;

v_where := 'WHERE cs.tenant_id = ' || quote_literal(p_tenant_id);

IF p_site_id IS NOT NULL THEN
v_where := v_where || ' AND cs.site_id = ' || quote_literal(p_site_id);
END IF;

IF p_cash_register_id IS NOT NULL THEN
v_where := v_where || ' AND cs.cash_register_id = ' || quote_literal(p_cash_register_id);
END IF;

IF p_user_id IS NOT NULL THEN
v_where := v_where || ' AND cs.user_id = ' || quote_literal(p_user_id);
END IF;

IF p_date_from IS NOT NULL THEN
v_where := v_where || ' AND cs.opened_at >= ' || quote_literal(p_date_from);
END IF;

IF p_date_to IS NOT NULL THEN
v_where := v_where || ' AND cs.opened_at < ' || quote_literal(p_date_to);
END IF;

IF p_search IS NOT NULL AND p_search <> '' THEN
v_where := v_where || ' AND ('
|| 'cs.id::text ILIKE ' || quote_literal('%' || p_search || '%')
|| ' OR p.full_name ILIKE ' || quote_literal('%' || p_search || '%')
|| ' OR p.email ILIKE ' || quote_literal('%' || p_search || '%')
|| ' OR s.name ILIKE ' || quote_literal('%' || p_search || '%')
|| ')';
END IF;

EXECUTE 'SELECT count(*) FROM cash_sessions cs'
|| ' LEFT JOIN profiles p ON p.id = cs.user_id'
|| ' LEFT JOIN sites s ON s.id = cs.site_id '
|| v_where
INTO v_total_count;

EXECUTE 'SELECT jsonb_build_object('
|| '''open_count'', count(*) FILTER (WHERE cs.status = ''open''),'
|| '''closed_count'', count(*) FILTER (WHERE cs.status = ''closed''),'
|| '''variance_count'', count(*) FILTER (WHERE cs.variance IS NOT NULL AND cs.variance <> 0)'
|| ') FROM cash_sessions cs'
|| ' LEFT JOIN profiles p ON p.id = cs.user_id'
|| ' LEFT JOIN sites s ON s.id = cs.site_id '
|| v_where
INTO v_stats;

v_offset := GREATEST((COALESCE(p_page, 1) - 1), 0) * GREATEST(p_page_size, 1);

EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM ('
|| 'SELECT cs.id, cs.tenant_id, cs.site_id, cs.user_id,'
|| ' cs.opened_at, cs.closed_at, cs.opening_amount, cs.closing_amount,'
|| ' cs.counted_cash, cs.theoretical_amount, cs.variance, cs.status,'
|| ' cs.opening_note, cs.closing_note,'
|| ' COALESCE(p.full_name, p.email, '''') AS cashier_name,'
|| ' COALESCE(s.name, '''') AS site_name,'
|| ' cs.cash_register_id, rl.code AS cash_register_code, rl.name AS cash_register_name'
|| ' FROM cash_sessions cs'
|| ' LEFT JOIN profiles p ON p.id = cs.user_id'
|| ' LEFT JOIN sites s ON s.id = cs.site_id'
|| ' LEFT JOIN LATERAL public.get_cash_register_labels(ARRAY[cs.cash_register_id]) rl ON true '
|| v_where
|| ' ORDER BY cs.opened_at DESC, cs.id DESC'
|| ' LIMIT ' || GREATEST(p_page_size, 1)
|| ' OFFSET ' || v_offset
|| ') t'
INTO v_rows;

RETURN jsonb_build_object(
'rows', v_rows,
'total_count', v_total_count,
'stats', v_stats
);
END;
$function$;
REVOKE ALL ON FUNCTION public.rpc_paginated_cash_sessions(uuid, uuid, integer, integer, text, timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_paginated_cash_sessions(uuid, uuid, integer, integer, text, timestamptz, timestamptz, uuid, uuid) TO authenticated, service_role;
