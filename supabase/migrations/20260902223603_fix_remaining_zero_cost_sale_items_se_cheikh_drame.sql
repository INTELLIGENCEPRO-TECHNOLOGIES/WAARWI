
UPDATE sale_items si
SET purchase_cost = a.purchase_price
FROM sales s, articles a
WHERE si.sale_id = s.id
  AND si.article_id = a.id
  AND s.site_id = 'd2420b39-d210-4c94-8777-74859c41205e'
  AND s.status IN ('paid', 'partial', 'validated')
  AND COALESCE(si.purchase_cost, 0) = 0
  AND a.purchase_price > 0;
