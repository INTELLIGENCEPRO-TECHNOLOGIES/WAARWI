/*
# Paginated supplier orders RPC

## Dropped function
- Old cursor-based `rpc_paginated_supplier_orders` overload.

## New index
- `idx_supplier_orders_tenant_site_created_id` on `(tenant_id, site_id, created_at DESC, id DESC)`

## New function: `rpc_paginated_supplier_orders`
- SECURITY INVOKER with current_tenant_id() and current_user_can_access_site() guards
- Joins suppliers for name/phone/whatsapp/email/address
- Server-side search on order_number and suppliers.name (ILIKE)
- Status filter, offset pagination (50/page), deterministic sort
- Returns rows (all display columns + supplier fields), filtered_count, all_count,
  per-status counts, pending_count, pending_total — all over full filtered/unfiltered sets
- GRANT to authenticated only
*/

-- Drop old cursor-based overload
DROP FUNCTION IF EXISTS rpc_paginated_supplier_orders(uuid, uuid, integer, timestamptz, uuid, text, text, uuid, timestamptz, timestamptz);

-- Index for the ORDER BY + tenant/site filter
CREATE INDEX IF NOT EXISTS idx_supplier_orders_tenant_site_created_id
  ON supplier_orders (tenant_id, site_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION rpc_paginated_supplier_orders(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 50,
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_base text;
  v_where text;
  v_filtered_count int;
  v_all_count int;
  v_status_counts jsonb;
  v_pending jsonb;
  v_rows jsonb;
  v_offset int;
BEGIN
  -- Tenant guard
  IF p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'tenant mismatch';
  END IF;

  -- Site access guard
  IF p_site_id IS NOT NULL AND NOT current_user_can_access_site(p_site_id) THEN
    RAISE EXCEPTION 'site access denied';
  END IF;

  -- Base WHERE (always applied, including for all_count)
  v_base := 'WHERE so.tenant_id = ' || quote_literal(p_tenant_id);
  IF p_site_id IS NOT NULL THEN
    v_base := v_base || ' AND so.site_id = ' || quote_literal(p_site_id);
  END IF;

  -- Filtered WHERE adds search + status on top of base
  v_where := v_base;

  IF p_status_filter IS NOT NULL AND p_status_filter <> '' THEN
    v_where := v_where || ' AND so.status = ' || quote_literal(p_status_filter);
  END IF;

  IF p_search IS NOT NULL AND p_search <> '' THEN
    v_where := v_where || ' AND ('
      || 'so.order_number ILIKE ' || quote_literal('%' || p_search || '%')
      || ' OR sup.name ILIKE ' || quote_literal('%' || p_search || '%')
      || ')';
  END IF;

  -- all_count: total orders for this tenant+site (no search/status filter)
  EXECUTE 'SELECT count(*) FROM supplier_orders so'
    || ' LEFT JOIN suppliers sup ON sup.id = so.supplier_id '
    || v_base
  INTO v_all_count;

  -- filtered_count
  EXECUTE 'SELECT count(*) FROM supplier_orders so'
    || ' LEFT JOIN suppliers sup ON sup.id = so.supplier_id '
    || v_where
  INTO v_filtered_count;

  -- Per-status counts (over base, not filtered — so UI tabs show global counts)
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

  -- Pending stats (sent+confirmed+partial, over base)
  EXECUTE 'SELECT jsonb_build_object('
    || '''pending_count'', count(*),'
    || '''pending_total'', COALESCE(sum(so.total), 0)'
    || ') FROM supplier_orders so'
    || ' LEFT JOIN suppliers sup ON sup.id = so.supplier_id '
    || v_base
    || ' AND so.status IN (''sent'', ''confirmed'', ''partial'')'
  INTO v_pending;

  -- Paginated rows
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
    'pending', v_pending
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_supplier_orders FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_supplier_orders TO authenticated;
