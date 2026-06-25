-- Add a database-level validation function for stock transfers
-- This prevents bypassing UI restrictions via direct API calls
-- In independent catalog mode: only allow transfers within the same store's ecosystem

CREATE OR REPLACE FUNCTION public.validate_stock_transfer(
  p_source_site_id uuid,
  p_dest_site_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_shared_articles boolean;
  v_source_parent uuid;
  v_dest_parent uuid;
  v_source_is_warehouse boolean;
  v_dest_is_warehouse boolean;
  v_source_store_id uuid;
  v_dest_store_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN false;
  END IF;

  -- Get catalog mode
  SELECT COALESCE((settings->>'shared_articles')::boolean, true)
  INTO v_shared_articles
  FROM tenants WHERE id = v_tenant_id;

  -- In shared catalog mode, all transfers within the same tenant are allowed
  IF v_shared_articles THEN
    RETURN true;
  END IF;

  -- In independent catalog mode, validate the transfer is within the same store's ecosystem
  SELECT is_warehouse, parent_site_id
  INTO v_source_is_warehouse, v_source_parent
  FROM sites WHERE id = p_source_site_id AND tenant_id = v_tenant_id;

  SELECT is_warehouse, parent_site_id
  INTO v_dest_is_warehouse, v_dest_parent
  FROM sites WHERE id = p_dest_site_id AND tenant_id = v_tenant_id;

  -- Determine the "owning store" for source
  IF v_source_is_warehouse THEN
    v_source_store_id := v_source_parent;
  ELSE
    v_source_store_id := p_source_site_id;
  END IF;

  -- Determine the "owning store" for destination
  IF v_dest_is_warehouse THEN
    v_dest_store_id := v_dest_parent;
  ELSE
    v_dest_store_id := p_dest_site_id;
  END IF;

  -- In independent mode, source and destination must belong to the same store
  RETURN v_source_store_id = v_dest_store_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_stock_transfer(uuid, uuid) TO authenticated;

-- Also update adjust_stock to validate transfers
-- We add a wrapper that checks transfer validity
CREATE OR REPLACE FUNCTION public.validate_and_adjust_stock_transfer(
  p_article_id uuid,
  p_source_site_id uuid,
  p_dest_site_id uuid,
  p_quantity numeric,
  p_note text DEFAULT ''
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Validate transfer is allowed
  IF NOT validate_stock_transfer(p_source_site_id, p_dest_site_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Transfert non autorisé: en mode catalogue indépendant, les transferts ne sont autorisés qu''entre un magasin et ses propres dépôts');
  END IF;

  -- Execute the transfer
  PERFORM adjust_stock(p_article_id, p_source_site_id, -p_quantity, 'transfer_out', p_note);
  PERFORM adjust_stock(p_article_id, p_dest_site_id, p_quantity, 'transfer_in', p_note);

  RETURN jsonb_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_and_adjust_stock_transfer(uuid, uuid, uuid, numeric, text) TO authenticated;
