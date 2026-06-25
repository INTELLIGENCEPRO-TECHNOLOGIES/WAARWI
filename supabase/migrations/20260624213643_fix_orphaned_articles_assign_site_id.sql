-- Fix orphaned articles: assign site_id to articles that have NULL site_id
-- but belong to tenants with independent catalog mode (shared_articles = false)
-- Strategy: assign them to the site that has the most stock for that article,
-- or to the tenant's first (oldest) site if no stock exists.

DO $$
DECLARE
  v_tenant RECORD;
  v_article RECORD;
  v_best_site uuid;
BEGIN
  -- Loop through tenants with independent catalog mode
  FOR v_tenant IN
    SELECT id FROM tenants
    WHERE COALESCE((settings->>'shared_articles')::boolean, true) = false
  LOOP
    -- For each orphaned article in this tenant
    FOR v_article IN
      SELECT a.id
      FROM articles a
      WHERE a.tenant_id = v_tenant.id
        AND a.site_id IS NULL
        AND a.is_active = true
    LOOP
      -- Find the site with the most stock for this article
      SELECT sl.site_id INTO v_best_site
      FROM stock_levels sl
      JOIN sites s ON s.id = sl.site_id AND s.tenant_id = v_tenant.id
      WHERE sl.article_id = v_article.id
        AND sl.quantity > 0
      ORDER BY sl.quantity DESC
      LIMIT 1;

      -- If no stock found, assign to the first non-warehouse site of the tenant
      IF v_best_site IS NULL THEN
        SELECT id INTO v_best_site
        FROM sites
        WHERE tenant_id = v_tenant.id
          AND is_warehouse = false
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;

      -- Assign the article to the determined site
      IF v_best_site IS NOT NULL THEN
        UPDATE articles SET site_id = v_best_site WHERE id = v_article.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
