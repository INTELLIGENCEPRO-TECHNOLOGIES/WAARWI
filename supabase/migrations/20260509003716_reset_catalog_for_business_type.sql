/*
  # Catalog reset RPC for non-auto business types

  1. Purpose
    - Provide a safe function to wipe the auto-parts seeded catalog (articles,
      stock movements, stock levels, part categories, vehicle brands & models,
      article compatibilities) for a tenant whose business type is NOT
      auto_parts, so fashion / grocery / electronics / services / generic
      tenants start with a truly empty catalog.
    - The function will refuse to run if the tenant has recorded any sale lines
      or purchase order lines that reference existing articles — we never
      destroy real business history.

  2. New objects
    - `reset_tenant_catalog(p_tenant_id uuid)` SECURITY DEFINER RPC, callable
      by the super_admin only.

  3. Security
    - Verifies the caller is a super_admin via profiles table.
    - Blocks destructive action if sale_items or purchase_order_items exist.
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
  v_po_items int;
  v_bt text;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT business_type INTO v_bt FROM tenants WHERE id = p_tenant_id;
  IF v_bt IS NULL THEN
    RAISE EXCEPTION 'Tenant introuvable';
  END IF;

  SELECT count(*) INTO v_sale_items
  FROM sale_items si
  JOIN articles a ON a.id = si.article_id
  WHERE a.tenant_id = p_tenant_id;

  SELECT count(*) INTO v_po_items
  FROM purchase_order_items poi
  JOIN articles a ON a.id = poi.article_id
  WHERE a.tenant_id = p_tenant_id;

  IF v_sale_items > 0 OR v_po_items > 0 THEN
    RAISE EXCEPTION 'Impossible de purger: % ventes et % lignes d''achat existent pour ce tenant', v_sale_items, v_po_items;
  END IF;

  DELETE FROM article_compatibilities WHERE tenant_id = p_tenant_id;
  DELETE FROM stock_movements WHERE tenant_id = p_tenant_id;
  DELETE FROM stock_levels WHERE tenant_id = p_tenant_id;
  DELETE FROM articles WHERE tenant_id = p_tenant_id;
  DELETE FROM vehicle_models WHERE tenant_id = p_tenant_id;
  DELETE FROM vehicle_brands WHERE tenant_id = p_tenant_id;
  DELETE FROM part_categories WHERE tenant_id = p_tenant_id;

  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.reset_tenant_catalog(uuid) TO authenticated;