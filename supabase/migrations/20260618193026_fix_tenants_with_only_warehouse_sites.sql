-- Some tenants have all their active sites flagged is_warehouse=true,
-- which leaves storeList empty in the app and blocks every site-scoped page.
-- For each such tenant, demote their oldest active site to a regular store
-- so the app can resolve a currentSite.
UPDATE sites s
SET is_warehouse = false
WHERE s.id IN (
  SELECT DISTINCT ON (t.id) s2.id
  FROM tenants t
  JOIN sites s2 ON s2.tenant_id = t.id AND s2.is_active = true
  WHERE NOT EXISTS (
    SELECT 1 FROM sites s3
    WHERE s3.tenant_id = t.id
      AND s3.is_active = true
      AND s3.is_warehouse = false
  )
  ORDER BY t.id, s2.created_at ASC
);
