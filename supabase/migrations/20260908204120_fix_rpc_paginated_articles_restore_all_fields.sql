/*
# Fix rpc_paginated_articles – restore all returned fields

## Problem
Migration 20260908200414 added critical security guards (tenant check, site access check)
and the missing site_id filter, but it also reduced the returned columns from 26 to ~14
and renamed `stock_quantity` to `quantity`, breaking the frontend which expects all original
fields including `image_url`, `description`, `brand`, `supplier_id`, `condition`, `unit`,
`min_price`, `wholesale_price`, `vat_rate`, `stock_max`, `location`, `ipm_eligible`,
`tenant_id`, `site_id`, and `stock_quantity` (not `quantity`).

## Fix
Recreate the function merging:
1. The COMPLETE field list from the original (20260903232326).
2. The security guards from the fix (20260908200414): tenant_id check, site access checks.
3. The site_id filter from the fix.
4. The original `row_to_json(t)` approach with aliased `stock_quantity`.
5. The original stock join pattern using `v_stock_site = COALESCE(p_stock_site_id, p_site_id)`.
6. When `p_include_stock = false`, the ELSE branch does NOT reference `sl` at all.

## Signature
Unchanged – same parameter list, same return type (jsonb).

## Security
- SECURITY DEFINER with `search_path = public`.
- `current_tenant_id()` guard.
- `current_user_accessible_site_ids()` guard for p_site_id and p_stock_site_id.
- REVOKE from anon, GRANT to authenticated only.
- Page size clamped to [1, 200].
*/

CREATE OR REPLACE FUNCTION public.rpc_paginated_articles(
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
  v_safe_size int;
  v_accessible_sites uuid[];
BEGIN
  -- Security: tenant isolation
  IF p_tenant_id <> current_tenant_id() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Security: site access checks
  v_accessible_sites := current_user_accessible_site_ids();
  IF p_site_id IS NOT NULL AND NOT (p_site_id = ANY(v_accessible_sites)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  IF p_stock_site_id IS NOT NULL AND NOT (p_stock_site_id = ANY(v_accessible_sites)) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  -- Clamp page size
  v_safe_size := LEAST(GREATEST(COALESCE(p_page_size, 50), 1), 200);

  -- Site filter (the critical fix from 20260908200414)
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
    WHEN 'internal_ref' THEN v_sort_col_sql := 'a.internal_ref';
    WHEN 'oem_ref' THEN v_sort_col_sql := 'COALESCE(a.oem_ref, '''')';
    WHEN 'category' THEN v_sort_col_sql := 'COALESCE(a.category_id::text, '''')';
    WHEN 'price' THEN v_sort_col_sql := 'COALESCE(a.sale_price, 0)';
    WHEN 'sale_price' THEN v_sort_col_sql := 'COALESCE(a.sale_price, 0)';
    WHEN 'purchase_price' THEN v_sort_col_sql := 'COALESCE(a.purchase_price, 0)';
    WHEN 'stock' THEN v_sort_col_sql := 'COALESCE(sl.quantity, 0)';
    ELSE v_sort_col_sql := 'a.name';
  END CASE;

  -- Stock filter (requires stock join, only when p_include_stock)
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
    -- Branch WITH stock join
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
      ' LIMIT ' || v_safe_size || ') t' INTO v_rows;
  ELSE
    -- Branch WITHOUT stock join – no sl alias referenced
    EXECUTE 'SELECT count(*) FROM articles a ' || v_where INTO v_total_count;
    EXECUTE 'SELECT jsonb_build_object(''total_articles'', count(*)) FROM articles a ' || v_where INTO v_totals;
    EXECUTE 'SELECT jsonb_agg(row_to_json(t)) FROM (
      SELECT a.id, a.tenant_id, a.internal_ref, a.name, a.description, a.category_id, a.brand, a.oem_ref, a.supplier_ref, a.barcode, a.supplier_id,
        a.condition, a.unit, a.purchase_price, a.sale_price, a.min_price, a.wholesale_price, a.vat_rate, a.stock_min, a.stock_max, a.location, a.image_url, a.is_active, a.ipm_eligible, a.track_stock, a.site_id
      FROM articles a ' || v_where || v_cursor_clause ||
      ' ORDER BY ' || v_sort_col_sql || ' ' || upper(p_sort_dir) || ', a.id ' || upper(p_sort_dir) ||
      ' LIMIT ' || v_safe_size || ') t' INTO v_rows;
  END IF;

  RETURN jsonb_build_object('rows', COALESCE(v_rows, '[]'::jsonb), 'total_count', v_total_count, 'totals', COALESCE(v_totals, '{}'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_articles FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_articles TO authenticated;
