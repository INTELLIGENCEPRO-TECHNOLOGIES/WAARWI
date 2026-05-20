/*
  # Reset catalog — correct table names

  Fixes the previous reset_tenant_catalog RPC by using the correct
  item tables: `supplier_order_items` and `quote_items` instead of the
  non-existent `purchase_order_items`.

  Also cleans up related doc items (quotes, invoices, supplier orders
  items) when we purge articles. We still refuse to delete articles that
  are referenced by sale_items (a real sale history).
*/

CREATE OR REPLACE FUNCTION public.reset_tenant_catalog(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_sale_items int;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant introuvable';
  END IF;

  SELECT count(*) INTO v_sale_items
  FROM sale_items si
  JOIN articles a ON a.id = si.article_id
  WHERE a.tenant_id = p_tenant_id;

  IF v_sale_items > 0 THEN
    RAISE EXCEPTION 'Impossible de purger: % ventes existent pour ce tenant', v_sale_items;
  END IF;

  DELETE FROM quote_items WHERE tenant_id = p_tenant_id;
  DELETE FROM supplier_order_items WHERE tenant_id = p_tenant_id;
  DELETE FROM article_compatibilities WHERE tenant_id = p_tenant_id;
  DELETE FROM stock_movements WHERE tenant_id = p_tenant_id;
  DELETE FROM stock_levels WHERE tenant_id = p_tenant_id;
  DELETE FROM articles WHERE tenant_id = p_tenant_id;
  DELETE FROM vehicle_models WHERE tenant_id = p_tenant_id;
  DELETE FROM vehicle_brands WHERE tenant_id = p_tenant_id;
  DELETE FROM part_categories WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object('ok', true);
END $$;