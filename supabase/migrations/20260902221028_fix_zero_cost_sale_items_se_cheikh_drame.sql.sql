/*
  # Correction des lignes de vente à coût d'achat nul — SE-CHEIKH DRAME

  Une vente du 2026-09-02 (site SE-CHEIKH DRAME) a été enregistrée avec un
  purchase_cost = 0 sur toutes ses lignes, alors que les articles concernés
  ont un prix d'achat renseigné. Cela gonflait artificiellement la marge du jour.

  Cette migration réaligne purchase_cost sur le prix d'achat de la fiche article,
  uniquement pour les lignes à coût nul dont l'article a un prix d'achat > 0,
  sur ce site précis. Aucune donnée n'est supprimée.
*/

UPDATE sale_items si
SET purchase_cost = a.purchase_price
FROM sales s, articles a
WHERE si.sale_id = s.id
  AND si.article_id = a.id
  AND s.site_id = 'd2420b39-d210-4c94-8777-74859c41205e'
  AND s.status IN ('paid', 'partial', 'validated')
  AND COALESCE(si.purchase_cost, 0) = 0
  AND a.purchase_price > 0;
