/*
# Add cross-site entry guard to adjust_stock_with_doc

## Problem
A frontend bug allowed documents to be created with articles belonging to a different site.
This adds a server-side guard that raises an exception if the article's site_id doesn't match p_site_id.

## Changes
- Recreates `adjust_stock_with_doc` function with an additional validation check
- If article.site_id IS NOT NULL and doesn't match p_site_id, the operation is rejected
- Transfer movements (transfer_in, transfer_out) are exempt since they intentionally cross sites

## Safety
- Articles with site_id = NULL (shared/global articles) are allowed on any site
- Transfer movements are exempt from the check
- All other logic remains unchanged
*/

CREATE OR REPLACE FUNCTION adjust_stock_with_doc(
  p_article_id uuid,
  p_site_id uuid,
  p_quantity numeric,
  p_movement_type text,
  p_note text,
  p_stock_document_id uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_previous numeric;
  v_new numeric;
  v_movement_id uuid;
  v_article_site_id uuid;
  v_article_name text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifie'; END IF;

  -- Cross-site guard: block entries where article belongs to a different site
  -- Exempt transfer movements (transfer_in/transfer_out) which intentionally cross sites
  IF p_movement_type NOT IN ('transfer_in', 'transfer_out') THEN
    SELECT site_id, name INTO v_article_site_id, v_article_name
    FROM articles WHERE id = p_article_id AND tenant_id = v_tenant_id;

    IF v_article_site_id IS NOT NULL AND v_article_site_id != p_site_id THEN
      RAISE EXCEPTION 'Article "%" n''appartient pas a ce magasin (article.site=%, cible=%)',
        v_article_name, v_article_site_id, p_site_id;
    END IF;
  END IF;

  SELECT quantity INTO v_previous FROM stock_levels
  WHERE article_id = p_article_id AND site_id = p_site_id;
  IF v_previous IS NULL THEN
    v_previous := 0;
    INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
    VALUES (v_tenant_id, p_article_id, p_site_id, 0);
  END IF;

  v_new := v_previous + p_quantity;
  UPDATE stock_levels SET quantity = v_new, updated_at = now()
  WHERE article_id = p_article_id AND site_id = p_site_id;

  INSERT INTO stock_movements (
    tenant_id, article_id, site_id, movement_type, quantity,
    previous_qty, new_qty, user_id, note, stock_document_id
  ) VALUES (
    v_tenant_id, p_article_id, p_site_id, p_movement_type, p_quantity,
    v_previous, v_new, auth.uid(), COALESCE(p_note,''), p_stock_document_id
  )
  RETURNING id INTO v_movement_id;

  RETURN v_movement_id;
END;
$$;
