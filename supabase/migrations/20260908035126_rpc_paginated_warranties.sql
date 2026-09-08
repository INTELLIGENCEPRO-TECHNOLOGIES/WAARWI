/*
# Paginated warranties RPC

## Summary
Server-side paginated warranty/IMEI tracking from sales.doc_header.
Replaces the client-side .limit(500) + filter approach.

## New partial index
- `idx_sales_doc_header_warranty_imei` on `sales(tenant_id, created_at DESC, id DESC)`
  WHERE doc_header IS NOT NULL AND deleted_at IS NULL
  AND (doc_header->>'imei' IS NOT NULL OR doc_header->>'warranty' IS NOT NULL)

## New helper: `_parse_warranty_days(text)`
Reproduces the client-side parseWarrantyDuration logic in SQL.

## New function: `rpc_paginated_warranties`
- SECURITY INVOKER with current_tenant_id() guard
- Uses current_user_accessible_site_ids() for site restriction
- Computes warranty status server-side (active/expiring/expired/cancelled/none)
- Status filter, search, date range, site filter, offset pagination
- Returns rows + total_count + stats + site_options
*/

-- Partial index for warranty/IMEI sales
CREATE INDEX IF NOT EXISTS idx_sales_doc_header_warranty_imei
  ON sales (tenant_id, created_at DESC, id DESC)
  WHERE doc_header IS NOT NULL
    AND deleted_at IS NULL
    AND (doc_header->>'imei' IS NOT NULL OR doc_header->>'warranty' IS NOT NULL);

-- Helper: parse warranty duration text to days (mirrors client-side logic exactly)
CREATE OR REPLACE FUNCTION _parse_warranty_days(p_warranty text)
RETURNS int
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_lower text;
  v_num int;
  v_match text[];
BEGIN
  IF p_warranty IS NULL OR trim(p_warranty) = '' THEN RETURN NULL; END IF;
  v_lower := lower(trim(p_warranty));
  v_match := regexp_match(v_lower, '^(\d+)');
  IF v_match IS NULL THEN RETURN NULL; END IF;
  v_num := v_match[1]::int;
  IF v_lower ~ '(an|year)' THEN RETURN v_num * 365; END IF;
  IF v_lower ~ '(mois|month)' THEN RETURN v_num * 30; END IF;
  IF v_lower ~ '(jour|day)' THEN RETURN v_num; END IF;
  IF v_lower ~ '(semaine|week)' THEN RETURN v_num * 7; END IF;
  RETURN v_num * 30;
END;
$$;

-- Main RPC
CREATE OR REPLACE FUNCTION rpc_paginated_warranties(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 50,
  p_search text DEFAULT NULL,
  p_status_filter text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_accessible_sites uuid[];
  v_total_count int;
  v_stats jsonb;
  v_rows jsonb;
  v_sites jsonb;
  v_offset int;
BEGIN
  -- Tenant guard
  IF p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'tenant mismatch';
  END IF;

  -- Get accessible sites
  v_accessible_sites := current_user_accessible_site_ids();

  -- Site access guard
  IF p_site_id IS NOT NULL AND NOT (p_site_id = ANY(v_accessible_sites)) THEN
    RAISE EXCEPTION 'site access denied';
  END IF;

  -- Use a CTE for the base warranty rows
  -- We compute everything with static SQL and parameters
  WITH base AS (
    SELECT
      s.id,
      s.sale_number,
      s.created_at,
      s.total,
      s.status,
      s.site_id,
      s.user_id,
      s.doc_header,
      c.name AS customer_name,
      c.phone AS customer_phone,
      st.name AS site_name,
      p.full_name AS user_name,
      s.doc_header->>'imei' AS imei,
      s.doc_header->>'warranty' AS warranty,
      s.doc_header->>'delivery_date' AS delivery_date,
      s.doc_header->>'representative' AS representative,
      COALESCE((s.doc_header->>'warranty_cancelled')::boolean, false) AS warranty_cancelled,
      s.doc_header->>'warranty_cancelled_at' AS warranty_cancelled_at,
      s.doc_header->>'warranty_cancelled_reason' AS warranty_cancelled_reason,
      CASE
        WHEN COALESCE((s.doc_header->>'warranty_cancelled')::boolean, false) THEN 'cancelled'
        WHEN s.doc_header->>'warranty' IS NULL OR trim(s.doc_header->>'warranty') = '' THEN 'none'
        WHEN _parse_warranty_days(s.doc_header->>'warranty') IS NULL THEN 'active'
        WHEN s.created_at + (_parse_warranty_days(s.doc_header->>'warranty') || ' days')::interval < now() THEN 'expired'
        WHEN s.created_at + (_parse_warranty_days(s.doc_header->>'warranty') || ' days')::interval < now() + interval '30 days' THEN 'expiring'
        ELSE 'active'
      END AS warranty_status,
      CASE
        WHEN _parse_warranty_days(s.doc_header->>'warranty') IS NOT NULL
        THEN (s.created_at + (_parse_warranty_days(s.doc_header->>'warranty') || ' days')::interval)::date
        ELSE NULL
      END AS expiration_date
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sites st ON st.id = s.site_id
    LEFT JOIN profiles p ON p.id = s.user_id
    WHERE s.tenant_id = p_tenant_id
      AND s.deleted_at IS NULL
      AND s.doc_header IS NOT NULL
      AND (s.doc_header->>'imei' IS NOT NULL OR s.doc_header->>'warranty' IS NOT NULL)
      AND s.site_id = ANY(v_accessible_sites)
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
      AND (p_date_from IS NULL OR s.created_at >= p_date_from)
      AND (p_date_to IS NULL OR s.created_at < p_date_to)
  ),
  searched AS (
    SELECT * FROM base
    WHERE p_search IS NULL OR p_search = ''
      OR imei ILIKE '%' || p_search || '%'
      OR sale_number ILIKE '%' || p_search || '%'
      OR customer_name ILIKE '%' || p_search || '%'
      OR customer_phone ILIKE '%' || p_search || '%'
      OR warranty ILIKE '%' || p_search || '%'
      OR representative ILIKE '%' || p_search || '%'
  ),
  status_filtered AS (
    SELECT * FROM searched
    WHERE p_status_filter IS NULL OR p_status_filter = '' OR warranty_status = p_status_filter
  )
  SELECT
    count(*),
    jsonb_build_object(
      'active', count(*) FILTER (WHERE warranty_status = 'active'),
      'expiring', count(*) FILTER (WHERE warranty_status = 'expiring'),
      'expired', count(*) FILTER (WHERE warranty_status = 'expired'),
      'cancelled', count(*) FILTER (WHERE warranty_status = 'cancelled'),
      'none', count(*) FILTER (WHERE warranty_status = 'none')
    )
  INTO v_total_count, v_stats
  FROM status_filtered;

  -- Stats are computed over the searched set (before status filter) for the stat badges
  SELECT jsonb_build_object(
    'active', count(*) FILTER (WHERE warranty_status = 'active'),
    'expiring', count(*) FILTER (WHERE warranty_status = 'expiring'),
    'expired', count(*) FILTER (WHERE warranty_status = 'expired'),
    'cancelled', count(*) FILTER (WHERE warranty_status = 'cancelled'),
    'none', count(*) FILTER (WHERE warranty_status = 'none')
  ) INTO v_stats
  FROM (
    SELECT
      CASE
        WHEN COALESCE((s.doc_header->>'warranty_cancelled')::boolean, false) THEN 'cancelled'
        WHEN s.doc_header->>'warranty' IS NULL OR trim(s.doc_header->>'warranty') = '' THEN 'none'
        WHEN _parse_warranty_days(s.doc_header->>'warranty') IS NULL THEN 'active'
        WHEN s.created_at + (_parse_warranty_days(s.doc_header->>'warranty') || ' days')::interval < now() THEN 'expired'
        WHEN s.created_at + (_parse_warranty_days(s.doc_header->>'warranty') || ' days')::interval < now() + interval '30 days' THEN 'expiring'
        ELSE 'active'
      END AS warranty_status
    FROM sales s
    WHERE s.tenant_id = p_tenant_id
      AND s.deleted_at IS NULL
      AND s.doc_header IS NOT NULL
      AND (s.doc_header->>'imei' IS NOT NULL OR s.doc_header->>'warranty' IS NOT NULL)
      AND s.site_id = ANY(v_accessible_sites)
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
      AND (p_date_from IS NULL OR s.created_at >= p_date_from)
      AND (p_date_to IS NULL OR s.created_at < p_date_to)
      AND (p_search IS NULL OR p_search = ''
        OR s.doc_header->>'imei' ILIKE '%' || p_search || '%'
        OR s.sale_number ILIKE '%' || p_search || '%'
        OR EXISTS (SELECT 1 FROM customers c2 WHERE c2.id = s.customer_id AND (c2.name ILIKE '%' || p_search || '%' OR c2.phone ILIKE '%' || p_search || '%'))
        OR s.doc_header->>'warranty' ILIKE '%' || p_search || '%'
        OR s.doc_header->>'representative' ILIKE '%' || p_search || '%'
      )
  ) sub;

  -- Site options: accessible sites that have warranty/IMEI sales
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', sub.site_id, 'name', sub.site_name) ORDER BY sub.site_name), '[]'::jsonb)
  INTO v_sites
  FROM (
    SELECT DISTINCT st2.id AS site_id, st2.name AS site_name
    FROM sales s2
    JOIN sites st2 ON st2.id = s2.site_id
    WHERE s2.tenant_id = p_tenant_id
      AND s2.deleted_at IS NULL
      AND s2.doc_header IS NOT NULL
      AND (s2.doc_header->>'imei' IS NOT NULL OR s2.doc_header->>'warranty' IS NOT NULL)
      AND s2.site_id = ANY(v_accessible_sites)
  ) sub;

  -- Paginated rows
  v_offset := GREATEST((COALESCE(p_page, 1) - 1), 0) * GREATEST(p_page_size, 1);

  WITH base AS (
    SELECT
      s.id,
      s.sale_number,
      s.created_at,
      s.total,
      s.status,
      s.site_id,
      c.name AS customer_name,
      c.phone AS customer_phone,
      st.name AS site_name,
      p.full_name AS user_name,
      s.doc_header->>'imei' AS imei,
      s.doc_header->>'warranty' AS warranty,
      s.doc_header->>'delivery_date' AS delivery_date,
      s.doc_header->>'representative' AS representative,
      COALESCE((s.doc_header->>'warranty_cancelled')::boolean, false) AS warranty_cancelled,
      s.doc_header->>'warranty_cancelled_at' AS warranty_cancelled_at,
      s.doc_header->>'warranty_cancelled_reason' AS warranty_cancelled_reason,
      CASE
        WHEN COALESCE((s.doc_header->>'warranty_cancelled')::boolean, false) THEN 'cancelled'
        WHEN s.doc_header->>'warranty' IS NULL OR trim(s.doc_header->>'warranty') = '' THEN 'none'
        WHEN _parse_warranty_days(s.doc_header->>'warranty') IS NULL THEN 'active'
        WHEN s.created_at + (_parse_warranty_days(s.doc_header->>'warranty') || ' days')::interval < now() THEN 'expired'
        WHEN s.created_at + (_parse_warranty_days(s.doc_header->>'warranty') || ' days')::interval < now() + interval '30 days' THEN 'expiring'
        ELSE 'active'
      END AS warranty_status,
      CASE
        WHEN _parse_warranty_days(s.doc_header->>'warranty') IS NOT NULL
        THEN (s.created_at + (_parse_warranty_days(s.doc_header->>'warranty') || ' days')::interval)::date
        ELSE NULL
      END AS expiration_date
    FROM sales s
    LEFT JOIN customers c ON c.id = s.customer_id
    LEFT JOIN sites st ON st.id = s.site_id
    LEFT JOIN profiles p ON p.id = s.user_id
    WHERE s.tenant_id = p_tenant_id
      AND s.deleted_at IS NULL
      AND s.doc_header IS NOT NULL
      AND (s.doc_header->>'imei' IS NOT NULL OR s.doc_header->>'warranty' IS NOT NULL)
      AND s.site_id = ANY(v_accessible_sites)
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
      AND (p_date_from IS NULL OR s.created_at >= p_date_from)
      AND (p_date_to IS NULL OR s.created_at < p_date_to)
  ),
  searched AS (
    SELECT * FROM base
    WHERE p_search IS NULL OR p_search = ''
      OR imei ILIKE '%' || p_search || '%'
      OR sale_number ILIKE '%' || p_search || '%'
      OR customer_name ILIKE '%' || p_search || '%'
      OR customer_phone ILIKE '%' || p_search || '%'
      OR warranty ILIKE '%' || p_search || '%'
      OR representative ILIKE '%' || p_search || '%'
  ),
  status_filtered AS (
    SELECT * FROM searched
    WHERE p_status_filter IS NULL OR p_status_filter = '' OR warranty_status = p_status_filter
  )
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT id, sale_number, created_at, total, status, site_id,
      customer_name, customer_phone, site_name, user_name,
      imei, warranty, delivery_date, representative,
      warranty_cancelled, warranty_cancelled_at, warranty_cancelled_reason,
      warranty_status, expiration_date
    FROM status_filtered
    ORDER BY created_at DESC, id DESC
    LIMIT GREATEST(p_page_size, 1) OFFSET v_offset
  ) t;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total_count', v_total_count,
    'stats', v_stats,
    'site_options', v_sites
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION _parse_warranty_days FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION _parse_warranty_days TO authenticated;

REVOKE EXECUTE ON FUNCTION rpc_paginated_warranties FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_warranties TO authenticated;
