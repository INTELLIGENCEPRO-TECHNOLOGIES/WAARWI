/*
# Fix orphan customers/suppliers with NULL site_id

## Problem
When the `site_id` column was added to `customers` and `suppliers`, existing rows
were left with `site_id = NULL`. For tenants that have `shared_customers = false`
in their settings, the application filters by `site_id = currentSite.id`, which
excludes all rows with NULL site_id. This makes historical customers invisible.

## Fix
For each tenant that has at least one site, assign the primary (non-warehouse)
site to any customer or supplier that has `site_id IS NULL`.

The primary site is determined by: the first non-warehouse active site, ordered
by name.

## Affected tenants (by data)
- INTELLIGENCEPRO: 76 orphan customers, 10 orphan suppliers
- SALOUM ELECTRONIQUE: 1 orphan customer
- WAKEUR SERIGNE MANSOUR SY: 6 orphan customers

## Security
- No RLS or policy changes.
- No new tables or columns.
*/

-- Assign orphan customers to the tenant's first active non-warehouse site
UPDATE customers c
SET site_id = sub.primary_site_id
FROM (
  SELECT DISTINCT ON (s.tenant_id) s.tenant_id, s.id AS primary_site_id
  FROM sites s
  WHERE s.is_warehouse = false AND s.is_active = true
  ORDER BY s.tenant_id, s.name
) sub
WHERE c.tenant_id = sub.tenant_id
  AND c.site_id IS NULL;

-- Assign orphan suppliers to the tenant's first active non-warehouse site
UPDATE suppliers s
SET site_id = sub.primary_site_id
FROM (
  SELECT DISTINCT ON (si.tenant_id) si.tenant_id, si.id AS primary_site_id
  FROM sites si
  WHERE si.is_warehouse = false AND si.is_active = true
  ORDER BY si.tenant_id, si.name
) sub
WHERE s.tenant_id = sub.tenant_id
  AND s.site_id IS NULL;
