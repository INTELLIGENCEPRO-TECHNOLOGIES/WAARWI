/*
# Fix rpc_paginated_articles missing site_id filter

## Problem
The `rpc_paginated_articles` function accepts a `p_site_id` parameter but never applies it
in the WHERE clause. For tenants with `shared_articles = false` (independent catalogs per site),
this causes ALL articles from ALL sites to be shown regardless of which site the user is viewing.

## Affected tenants
Any tenant with `settings.shared_articles = false` and multiple sites:
- GROUPE KAOLACK BAT, SALOUM ELECTRONIQUE, Connectendo Business Services, etc.

## Fix
Add the missing `p_site_id` filter to the WHERE clause, matching the pattern already used
by `rpc_paginated_stock` (which works correctly):
- When `p_site_id` is provided, only return articles with that site_id.
- When `p_site_id` is NULL (shared catalog mode), return all articles for the tenant.

## No data changes
This is a read-only function fix. No data is modified.
*/

CREATE OR REPLACE FUNCTION public.rpc_paginated_articles(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_stock_site_id uuid DEFAULT NULL,
  p_page_size integer DEFAULT 50,
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
  v_sort_column text;
  v_sort_direction text;
  v_cursor_cmp text;
  v_stock_join text := '';
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

  v_sort_direction := CASE WHEN upper(COALESCE(p_sort_dir, 'asc')) = 'DESC' THEN 'DESC' ELSE 'ASC' END;
  v_cursor_cmp := CASE WHEN v_sort_direction = 'ASC' THEN '>' ELSE '<' END;

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
  ELSIF p_include_stock THEN
    v_stock_join := ' LEFT JOIN LATERAL (SELECT SUM(quantity) as quantity FROM stock_levels WHERE article_id = a.id) sl ON true';
  END IF;

  v_where := 'WHERE a.tenant_id = ' || quote_literal(p_tenant_id);

  -- *** THE FIX: filter by site_id when provided ***
  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND a.site_id = ' || quote_literal(p_site_id);
  END IF;

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
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(a.stock_min, 0)';
      WHEN 'in' THEN
        v_where := v_where || ' AND COALESCE(sl.quantity, 0) > COALESCE(a.stock_min, 0)';
      ELSE NULL;
    END CASE;
  END IF;

  IF p_cursor_val IS NOT NULL AND p_cursor_id IS NOT NULL THEN
    v_where := v_where || ' AND (' || v_sort_column || ', a.id) ' || v_cursor_cmp || ' (' || quote_literal(p_cursor_val) || ', ' || quote_literal(p_cursor_id) || ')';
  END IF;

  EXECUTE 'SELECT count(*) FROM articles a' || v_stock_join || ' ' || v_where INTO v_total_count;

  EXECUTE 'SELECT jsonb_build_object(
' || chr(39) || 'total_articles' || chr(39) || ', count(*),
' || chr(39) || 'in_stock' || chr(39) || ', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > COALESCE(a.stock_min, 0)),
' || chr(39) || 'low_stock' || chr(39) || ', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) > 0 AND COALESCE(sl.quantity, 0) <= COALESCE(a.stock_min, 0)),
' || chr(39) || 'out_stock' || chr(39) || ', count(*) FILTER (WHERE COALESCE(sl.quantity, 0) = 0)
) FROM articles a' || v_stock_join || ' ' || v_where INTO v_totals;

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
' || chr(39) || 'stock_min' || chr(39) || ', COALESCE(a.stock_min, 0)
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
$function$;
