/*
# Réparation ciblée du coût d'achat des lignes de facturation à coût nul (tous tenants)

## Contexte
Avant le correctif du chemin de création de facture, les lignes insérées depuis la
Facturation n'enregistraient pas le coût d'achat (`sale_items.purchase_cost` = 0), ce qui
faisait afficher une marge de 100 % dans les rapports. Le code est désormais corrigé, mais
les factures déjà créées gardent un coût nul.

## Changement effectué
Met à jour `sale_items.purchase_cost` avec le prix d'achat courant de l'article
(`articles.purchase_price`) UNIQUEMENT pour :
  - les lignes issues de ventes de source `billing`,
  - dont le coût actuel est nul (`purchase_cost = 0`),
  - et dont l'article a un prix d'achat strictement positif.

## Sécurité des données
1. Aucune suppression, aucun changement de type, aucune opération destructive.
2. Le filtre `purchase_cost = 0` garantit qu'aucun coût historique existant n'est écrasé.
3. Les articles de service (prix d'achat 0) restent volontairement à 0.
4. Opération idempotente : une seconde exécution ne modifie plus rien.
*/

UPDATE sale_items si
SET purchase_cost = a.purchase_price
FROM sales s, articles a
WHERE si.sale_id = s.id
  AND si.article_id = a.id
  AND s.source = 'billing'
  AND COALESCE(si.purchase_cost, 0) = 0
  AND COALESCE(a.purchase_price, 0) > 0;
