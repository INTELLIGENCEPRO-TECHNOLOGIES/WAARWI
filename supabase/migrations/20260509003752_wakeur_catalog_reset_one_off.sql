/*
  # One-off catalog reset for non-auto tenants with leftover auto data

  This data migration purges the auto-parts catalog that was seeded for
  tenants whose business_type is NOT auto_parts. It only runs for tenants
  that have zero sale history (to protect real data).
*/

DO $$
DECLARE
  t record;
  v_sales int;
BEGIN
  FOR t IN SELECT id FROM tenants WHERE business_type IS DISTINCT FROM 'auto_parts' LOOP
    SELECT count(*) INTO v_sales
    FROM sale_items si
    JOIN articles a ON a.id = si.article_id
    WHERE a.tenant_id = t.id;

    IF v_sales = 0 THEN
      DELETE FROM quote_items WHERE tenant_id = t.id;
      DELETE FROM supplier_order_items WHERE tenant_id = t.id;
      DELETE FROM article_compatibilities WHERE tenant_id = t.id;
      DELETE FROM stock_movements WHERE tenant_id = t.id;
      DELETE FROM stock_levels WHERE tenant_id = t.id;
      DELETE FROM articles WHERE tenant_id = t.id;
      DELETE FROM vehicle_models WHERE tenant_id = t.id;
      DELETE FROM vehicle_brands WHERE tenant_id = t.id;
      DELETE FROM part_categories WHERE tenant_id = t.id;
    END IF;
  END LOOP;
END $$;