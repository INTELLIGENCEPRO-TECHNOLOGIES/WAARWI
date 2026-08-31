DROP FUNCTION IF EXISTS get_sale_returned_quantities(UUID);

CREATE FUNCTION get_sale_returned_quantities(p_sale_id UUID)
RETURNS TABLE(article_id UUID, total_returned BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT sri.article_id, SUM(sri.quantity) AS total_returned
  FROM sale_return_items sri
  JOIN sale_returns sr ON sr.id = sri.return_id
  WHERE sr.sale_id = p_sale_id
    AND sr.status = 'approved'
  GROUP BY sri.article_id;
$$;