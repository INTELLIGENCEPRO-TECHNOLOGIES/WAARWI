/*
# Allow depot-affiliated articles in cross-site guard

## Problem
The cross-site guard in `adjust_stock_with_doc` rejects stock movements when
the article's `site_id` doesn't match the target site. But depots affiliated
to a store share that store's articles -- the article's `site_id` is the
parent store, and the target is the depot. This incorrectly blocked legit
depot stock movements with the error:
  Article "ABATTANT 2003" n'appartient pas a ce magasin (article.site=..., cible=...)

## Fix
When the target site (`p_site_id`) is a depot (warehouse) whose
`parent_site_id` matches the article's `site_id`, the movement is allowed.
This means: an article belonging to store X can have stock movements on
depot Y, as long as Y's parent is X.

## Security
No RLS or policy changes. Only the guard logic inside the function is relaxed
for the depot-parent relationship. All other cross-site restrictions remain.
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
  v_target_parent_site_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifie'; END IF;

  -- Cross-site guard: block entries where article belongs to a different site
  -- Exempt transfer movements (transfer_in/transfer_out) which intentionally cross sites
  -- Allow when target is a depot whose parent store owns the article
  IF p_movement_type NOT IN ('transfer_in', 'transfer_out') THEN
    SELECT site_id, name INTO v_article_site_id, v_article_name
    FROM articles WHERE id = p_article_id AND tenant_id = v_tenant_id;

    IF v_article_site_id IS NOT NULL AND v_article_site_id != p_site_id THEN
      SELECT parent_site_id INTO v_target_parent_site_id
      FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id;

      IF v_target_parent_site_id IS NULL OR v_target_parent_site_id != v_article_site_id THEN
        RAISE EXCEPTION 'Article "%" n''appartient pas a ce magasin (article.site=%, cible=%)',
          v_article_name, v_article_site_id, p_site_id;
      END IF;
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
