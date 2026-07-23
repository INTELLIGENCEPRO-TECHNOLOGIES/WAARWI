/*
# Delete orphaned stock document BE-00066

## Problem
Document BE-00066 (id: 94c3623e-a98c-465e-8e5d-95c3b37cb75f) was created on site SE-BATTERIE
but contains articles belonging to PARCELLE due to a site-switching bug.
The user has already re-entered the data on the correct site.

## Changes
1. Reverse stock_levels adjustments for the 3 movements (ECRAN A10, ECRAN J4+, ECRAN ITEL A70)
2. Delete stock_movements linked to this document
3. Delete the stock_document itself

## Safety
- Only targets this specific document by UUID
- Reverses stock levels before deleting movements to maintain consistency
*/

DO $$
DECLARE
  v_doc_id uuid := '94c3623e-a98c-465e-8e5d-95c3b37cb75f';
  v_site_id uuid := '240ff222-1a15-4d1f-bd21-0a4f21a7844e'; -- SE-BATTERIE
  rec RECORD;
BEGIN
  -- Reverse stock levels for each movement in this document
  FOR rec IN
    SELECT article_id, quantity
    FROM stock_movements
    WHERE stock_document_id = v_doc_id
  LOOP
    UPDATE stock_levels
    SET quantity = quantity - rec.quantity,
        updated_at = now()
    WHERE article_id = rec.article_id
      AND site_id = v_site_id;
  END LOOP;

  -- Delete stock movements
  DELETE FROM stock_movements WHERE stock_document_id = v_doc_id;

  -- Delete the document itself
  DELETE FROM stock_documents WHERE id = v_doc_id;
END $$;
