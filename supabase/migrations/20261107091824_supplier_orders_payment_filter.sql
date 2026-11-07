/*
# Filtre de règlement sur la liste paginée des commandes fournisseurs

1. Objet
- Ajoute un filtre « règlement » (Non payées / Partiellement payées / Payées) appliqué côté serveur
  avant la pagination, et des compteurs globaux par état de règlement.

2. Fonctions modifiées
- `rpc_paginated_supplier_orders` : nouveau paramètre optionnel `p_payment_filter text DEFAULT NULL`
  (valeurs admises : NULL/'' = tous, 'unpaid', 'partial', 'paid').
  - Réponse inchangée + nouvelle clé `payment_counts` {unpaid, partial, paid} calculée sur la base
    (tenant + magasin), comme `status_counts`, pour distinguer compteurs globaux et résultats filtrés.
  - Règles : commandes annulées et commandes à total nul exclues des trois états ;
    unpaid = paid <= 0 ; partial = 0 < paid < total ; paid = paid >= total. Montants lus sur
    `supplier_orders.total` / `supplier_orders.paid`, tenus à jour par les RPC de règlement.

3. Compatibilité
- L'ancienne signature à 6 paramètres est supprimée puis recréée avec 7 paramètres (le dernier
  par défaut), pour éviter toute surcharge ambiguë. Les appels nommés existants restent valides.
- Aucune table ni donnée modifiée.

4. Sécurité
- SECURITY INVOKER conservé, contrôles tenant (`current_tenant_id()`) et magasin
  (`current_user_can_access_site`) conservés, RLS toujours appliquée.
- EXECUTE accordé à authenticated et service_role uniquement.
*/

DROP FUNCTION IF EXISTS public.rpc_paginated_supplier_orders(uuid, uuid, integer, integer, text, text);

CREATE OR REPLACE FUNCTION public.rpc_paginated_supplier_orders(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL::uuid,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_search text DEFAULT NULL::text,
  p_status_filter text DEFAULT NULL::text,
  p_payment_filter text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_base text;
  v_where text;
  v_filtered_count int;
  v_all_count int;
  v_status_counts jsonb;
  v_payment_counts jsonb;
  v_pending jsonb;
  v_rows jsonb;
  v_offset int;
  c_unpaid constant text := '(so.status <> ''cancelled'' AND so.total > 0 AND COALESCE(so.paid, 0) <= 0)';
  c_partial constant text := '(so.status <> ''cancelled'' AND so.total > 0 AND COALESCE(so.paid, 0) > 0 AND COALESCE(so.paid, 0) < so.total)';
  c_paid constant text := '(so.status <> ''cancelled'' AND so.total > 0 AND COALESCE(so.paid, 0) >= so.total)';
BEGIN
  IF p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'tenant mismatch';
  END IF;

  IF p_site_id IS NOT NULL AND NOT current_user_can_access_site(p_site_id) THEN
    RAISE EXCEPTION 'site access denied';
  END IF;

  IF p_payment_filter IS NOT NULL AND p_payment_filter NOT IN ('', 'unpaid', 'partial', 'paid') THEN
    RAISE EXCEPTION 'invalid payment filter';
  END IF;

  v_base := 'WHERE so.tenant_id = ' || quote_literal(p_tenant_id);
  IF p_site_id IS NOT NULL THEN
    v_base := v_base || ' AND so.site_id = ' || quote_literal(p_site_id);
  END IF;

  v_where := v_base;

  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    v_where := v_where || ' AND so.status = ' || quote_literal(p_status_filter);
  END IF;

  IF p_payment_filter = 'unpaid' THEN
    v_where := v_where || ' AND ' || c_unpaid;
  ELSIF p_payment_filter = 'partial' THEN
    v_where := v_where || ' AND ' || c_partial;
  ELSIF p_payment_filter = 'paid' THEN
    v_where := v_where || ' AND ' || c_paid;
  END IF;

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND ('
      || 'so.order_number ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR sup.name ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM supplier_orders so'
    || ' LEFT JOIN suppliers sup ON sup.id = so.supplier_id '
    || v_base
  INTO v_all_count;

  EXECUTE 'SELECT count(*) FROM supplier_orders so'
    || ' LEFT JOIN suppliers sup ON sup.id = so.supplier_id '
    || v_where
  INTO v_filtered_count;

  EXECUTE 'SELECT jsonb_build_object('
    || '''draft'', count(*) FILTER (WHERE so.status = ''draft''),'
    || '''sent'', count(*) FILTER (WHERE so.status = ''sent''),'
    || '''confirmed'', count(*) FILTER (WHERE so.status = ''confirmed''),'
    || '''partial'', count(*) FILTER (WHERE so.status = ''partial''),'
    || '''received'', count(*) FILTER (WHERE so.status = ''received''),'
    || '''cancelled'', count(*) FILTER (WHERE so.status = ''cancelled'')'
    || ') FROM supplier_orders so'
    || ' LEFT JOIN suppliers sup ON sup.id = so.supplier_id '
    || v_base
  INTO v_status_counts;

  EXECUTE 'SELECT jsonb_build_object('
    || '''unpaid'', count(*) FILTER (WHERE ' || c_unpaid || '),'
    || '''partial'', count(*) FILTER (WHERE ' || c_partial || '),'
    || '''paid'', count(*) FILTER (WHERE ' || c_paid || ')'
    || ') FROM supplier_orders so'
    || ' LEFT JOIN suppliers sup ON sup.id = so.supplier_id '
    || v_base
  INTO v_payment_counts;

  EXECUTE 'SELECT jsonb_build_object('
    || '''pending_count'', count(*),'
    || '''pending_total'', COALESCE(sum(so.total), 0)'
    || ') FROM supplier_orders so'
    || ' LEFT JOIN suppliers sup ON sup.id = so.supplier_id '
    || v_base
    || ' AND so.status IN (''sent'', ''confirmed'', ''partial'')'
  INTO v_pending;

  v_offset := GREATEST((COALESCE(p_page, 1) - 1), 0) * GREATEST(p_page_size, 1);

  EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM ('
    || 'SELECT so.id, so.order_number, so.total, so.status, so.created_at,'
    || ' so.expected_date, so.public_token, so.public_code,'
    || ' so.supplier_id, so.note, so.user_id, so.doc_header,'
    || ' so.subtotal, so.discount, so.paid, so.received_date,'
    || ' sup.name AS supplier_name,'
    || ' sup.phone AS supplier_phone,'
    || ' sup.whatsapp AS supplier_whatsapp,'
    || ' sup.email AS supplier_email,'
    || ' sup.address AS supplier_address'
    || ' FROM supplier_orders so'
    || ' LEFT JOIN suppliers sup ON sup.id = so.supplier_id '
    || v_where
    || ' ORDER BY so.created_at DESC, so.id DESC'
    || ' LIMIT ' || GREATEST(p_page_size, 1)
    || ' OFFSET ' || v_offset
    || ') t'
  INTO v_rows;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'filtered_count', v_filtered_count,
    'all_count', v_all_count,
    'status_counts', v_status_counts,
    'payment_counts', v_payment_counts,
    'pending', v_pending
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_paginated_supplier_orders(uuid, uuid, integer, integer, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_paginated_supplier_orders(uuid, uuid, integer, integer, text, text, text) TO authenticated, service_role;
