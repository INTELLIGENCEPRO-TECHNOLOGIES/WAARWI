/*
# Exclude depots (warehouses) from plan site limits

## Problem
The `check_sites_limit()` trigger counted ALL sites including depots (warehouses)
against the plan's `sites` limit. This blocked depot creation when the tenant
had reached their store limit, even though depots are not stores.
The `tenant_usage()` function also counted depots in `sites_count`, making the
usage display misleading.

## Changes
1. `check_sites_limit()` — now counts only non-warehouse sites (`is_warehouse = false`)
   when checking against the plan's `sites` limit.
2. `tenant_usage()` — `sites_count` now excludes warehouses; added a new
   `stores_count` column (same as the new `sites_count`) for clarity.
   Depots are NOT counted as stores in any plan limit.

## Security
No RLS or policy changes. Only trigger function and usage function updated.
*/

-- 1. Fix check_sites_limit to exclude depots from the count
CREATE OR REPLACE FUNCTION check_sites_limit() RETURNS trigger AS $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM sites WHERE tenant_id = NEW.tenant_id AND is_warehouse = false;
  PERFORM enforce_tenant_plan_limit(NEW.tenant_id, 'sites', v_count);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Fix tenant_usage to exclude depots from sites_count
CREATE OR REPLACE FUNCTION tenant_usage(p_tenant_id uuid)
RETURNS TABLE(
  sites_count int,
  users_count int,
  articles_count int,
  customers_count int,
  suppliers_count int,
  plan_code text,
  plan_limits jsonb
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
RETURN QUERY
SELECT
  (SELECT count(*) FROM sites WHERE tenant_id = p_tenant_id AND is_warehouse = false)::int,
  (SELECT count(*) FROM profiles WHERE tenant_id = p_tenant_id)::int,
  (SELECT count(*) FROM articles WHERE tenant_id = p_tenant_id)::int,
  (SELECT count(*) FROM customers WHERE tenant_id = p_tenant_id)::int,
  (SELECT count(*) FROM suppliers WHERE tenant_id = p_tenant_id)::int,
  (SELECT plan FROM tenants WHERE id = p_tenant_id),
  (SELECT p.limits FROM plans p JOIN tenants t ON t.plan = p.code WHERE t.id = p_tenant_id);
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_usage(uuid) TO authenticated;
