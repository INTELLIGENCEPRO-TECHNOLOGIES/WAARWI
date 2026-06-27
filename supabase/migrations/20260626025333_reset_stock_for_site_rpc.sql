-- =====================================================================
-- reset_stock_for_site: Resets ALL stock to zero for a given site.
-- Produces a single stock exit document (no individual movements).
-- Must be called by admin/owner role. Password validation is done client-side.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.reset_stock_for_site(
  p_site_id uuid,
  p_note text DEFAULT 'Remise à zéro du stock'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_user_id uuid;
  v_user_role text;
  v_doc_number text;
  v_doc_id uuid;
  v_total_qty numeric := 0;
  v_line_count int := 0;
BEGIN
  v_tenant_id := current_tenant_id();
  v_user_id := auth.uid();
  
  IF v_tenant_id IS NULL OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié';
  END IF;

  -- Only admin or owner can reset stock
  SELECT role INTO v_user_role
    FROM profiles
   WHERE id = v_user_id AND tenant_id = v_tenant_id;

  IF v_user_role IS NULL OR v_user_role NOT IN ('admin', 'owner') THEN
    RAISE EXCEPTION 'Seuls les administrateurs peuvent effectuer une remise à zéro du stock';
  END IF;

  -- Verify site belongs to tenant
  IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Point de vente introuvable';
  END IF;

  -- Count articles and total quantity to be zeroed
  SELECT COUNT(*), COALESCE(SUM(quantity), 0)
    INTO v_line_count, v_total_qty
    FROM stock_levels
   WHERE site_id = p_site_id AND tenant_id = v_tenant_id AND quantity > 0;

  IF v_line_count = 0 THEN
    RAISE EXCEPTION 'Aucun stock à remettre à zéro sur ce point de vente';
  END IF;

  -- Generate document number
  SELECT next_doc_number INTO v_doc_number
    FROM next_doc_number(v_tenant_id, 'stock_exit', 'BS');

  -- Create the stock exit document
  INSERT INTO stock_documents (
    tenant_id, doc_number, doc_type, site_id, user_id,
    note, status, total_qty, line_count
  ) VALUES (
    v_tenant_id, v_doc_number, 'exit', p_site_id, v_user_id,
    COALESCE(p_note, 'Remise à zéro du stock'), 'active', v_total_qty, v_line_count
  )
  RETURNING id INTO v_doc_id;

  -- Reset all stock levels to 0 for this site (no individual movements)
  UPDATE stock_levels
     SET quantity = 0, updated_at = now()
   WHERE site_id = p_site_id AND tenant_id = v_tenant_id AND quantity != 0;

  -- Also zero out any lot remaining quantities for this site
  UPDATE stock_lots
     SET remaining_quantity = 0, updated_at = now()
   WHERE site_id = p_site_id AND tenant_id = v_tenant_id AND remaining_quantity > 0;

  RETURN jsonb_build_object(
    'success', true,
    'doc_id', v_doc_id,
    'doc_number', v_doc_number,
    'total_qty', v_total_qty,
    'line_count', v_line_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_stock_for_site(uuid, text) TO authenticated;
