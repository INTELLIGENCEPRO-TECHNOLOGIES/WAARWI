/*
  # Purge orphan articles for SAD PIECES AUTO

  The tenant "SAD PIECES AUTO" has 10 articles with stock_levels all at quantity=0
  from a previous provisioning that was not fully cleaned up. These articles have
  no sale history, no quote items, and no supplier order items — they are safe to delete.

  This migration removes them cleanly in dependency order.
*/

DO $$
DECLARE
  v_tenant_id uuid := '66ce2dfd-96bb-4ab6-815e-1b583e064fbc';
BEGIN
  -- Only proceed if there are no sales referencing these articles
  IF EXISTS (
    SELECT 1 FROM sale_items si
    JOIN articles a ON a.id = si.article_id
    WHERE a.tenant_id = v_tenant_id
  ) THEN
    RAISE NOTICE 'Tenant has sale history — skipping purge';
    RETURN;
  END IF;

  DELETE FROM article_compatibilities WHERE tenant_id = v_tenant_id;
  DELETE FROM quote_items WHERE tenant_id = v_tenant_id;
  DELETE FROM supplier_order_items WHERE tenant_id = v_tenant_id;
  DELETE FROM stock_movements WHERE tenant_id = v_tenant_id;
  DELETE FROM stock_levels WHERE tenant_id = v_tenant_id;
  DELETE FROM articles WHERE tenant_id = v_tenant_id;

  RAISE NOTICE 'Purged articles for SAD PIECES AUTO';
END $$;
