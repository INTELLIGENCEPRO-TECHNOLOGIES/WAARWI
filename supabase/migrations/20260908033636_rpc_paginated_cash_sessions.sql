/*
# Paginated cash sessions RPC (replace old cursor-based version)

## Summary
Server-side paginated, filtered, and searched cash sessions list.
Replaces the previous client-side `.limit(200)` approach that truncated
results before search/date filtering could run. Also replaces the old
cursor-based RPC with an offset-based version that includes missing fields.

## Dropped function
- `rpc_paginated_cash_sessions(uuid, uuid, integer, timestamptz, uuid, text, text, timestamptz, timestamptz)`
  Old cursor-based signature, replaced by new offset-based version.

## New index
- `idx_cash_sessions_tenant_site_opened_id` on `(tenant_id, site_id, opened_at DESC, id DESC)`
  Supports the ORDER BY used by the RPC. Non-destructive, additive only.

## New function: `rpc_paginated_cash_sessions`
- **Security**: SECURITY INVOKER — runs as the calling user.
  Validates `p_tenant_id = current_tenant_id()` and
  `current_user_can_access_site(p_site_id)` when a site is provided.
- **Joins**: `profiles` (full_name, email) on `user_id`, `sites` (name) on `site_id`.
- **Search**: case-insensitive on session UUID text, profiles.full_name,
  profiles.email, sites.name.
- **Dates**: `p_date_from` inclusive (>=), `p_date_to` exclusive (<).
- **Pagination**: offset-based, 50 rows per page default.
- **Returns** JSON with `rows` (including cashier_name, site_name,
  opening_note, closing_note), `total_count`, and `stats`
  (open_count, closed_count, variance_count) computed over the
  full filtered set, not just the current page.
- **Grant**: EXECUTE to `authenticated` only.

## Important notes
1. Does NOT modify any existing table, column, or RLS policy.
2. The function is idempotent (CREATE OR REPLACE + DROP IF EXISTS for old signature).
3. The index uses IF NOT EXISTS.
*/

-- Drop old cursor-based overload
DROP FUNCTION IF EXISTS rpc_paginated_cash_sessions(uuid, uuid, integer, timestamptz, uuid, text, text, timestamptz, timestamptz);

-- Index for ORDER BY opened_at DESC, id DESC with tenant+site leading columns
CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_site_opened_id
  ON cash_sessions (tenant_id, site_id, opened_at DESC, id DESC);

-- RPC function
CREATE OR REPLACE FUNCTION rpc_paginated_cash_sessions(
  p_tenant_id uuid,
  p_site_id uuid DEFAULT NULL,
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 50,
  p_search text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_where text;
  v_total_count int;
  v_stats jsonb;
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

  v_where := 'WHERE cs.tenant_id = ' || quote_literal(p_tenant_id);

  IF p_site_id IS NOT NULL THEN
    v_where := v_where || ' AND cs.site_id = ' || quote_literal(p_site_id);
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

  -- Total count over filtered set
  EXECUTE 'SELECT count(*) FROM cash_sessions cs'
    || ' LEFT JOIN profiles p ON p.id = cs.user_id'
    || ' LEFT JOIN sites s ON s.id = cs.site_id '
    || v_where
  INTO v_total_count;

  -- Stats over filtered set
  EXECUTE 'SELECT jsonb_build_object('
    || '''open_count'', count(*) FILTER (WHERE cs.status = ''open''),'
    || '''closed_count'', count(*) FILTER (WHERE cs.status = ''closed''),'
    || '''variance_count'', count(*) FILTER (WHERE cs.variance IS NOT NULL AND cs.variance <> 0)'
    || ') FROM cash_sessions cs'
    || ' LEFT JOIN profiles p ON p.id = cs.user_id'
    || ' LEFT JOIN sites s ON s.id = cs.site_id '
    || v_where
  INTO v_stats;

  -- Paginated rows
  v_offset := GREATEST((COALESCE(p_page, 1) - 1), 0) * GREATEST(p_page_size, 1);

  EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM ('
    || 'SELECT cs.id, cs.tenant_id, cs.site_id, cs.user_id,'
    || ' cs.opened_at, cs.closed_at, cs.opening_amount, cs.closing_amount,'
    || ' cs.counted_cash, cs.theoretical_amount, cs.variance, cs.status,'
    || ' cs.opening_note, cs.closing_note,'
    || ' COALESCE(p.full_name, p.email, '''') AS cashier_name,'
    || ' COALESCE(s.name, '''') AS site_name'
    || ' FROM cash_sessions cs'
    || ' LEFT JOIN profiles p ON p.id = cs.user_id'
    || ' LEFT JOIN sites s ON s.id = cs.site_id '
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
$$;

REVOKE EXECUTE ON FUNCTION rpc_paginated_cash_sessions FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION rpc_paginated_cash_sessions TO authenticated;
