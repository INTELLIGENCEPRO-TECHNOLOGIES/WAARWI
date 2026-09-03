-- Reparation historique des couts d'achat manquants sur les ventes du magasin INTELLIGENCEPRO.
-- Contexte : d'anciennes lignes de vente ont ete enregistrees avec un cout d'achat a zero,
-- ce qui gonflait artificiellement la marge dans les rapports. On corrige uniquement ces lignes
-- passees, en reprenant le cout depuis deux sources fiables, sans jamais ecraser un cout deja renseigne.
--
-- Etendue : STRICTEMENT limitee au tenant INTELLIGENCEPRO, ventes non annulees, lignes a cout nul/absent.
-- Non destructif : on ne remplit que des couts manquants (aucune suppression, aucun ecrasement de valeur existante).
--
-- Note de securite : simple UPDATE de donnees (DML) filtre par tenant_id. Aucune modification de schema,
-- de RLS ni de droits. Les lignes sans aucune source de cout (ni fiche article, ni lot) restent inchangees.

DO $$
DECLARE
  v_tenant uuid := '31f9910a-5e94-4dc1-8ab5-c204bbcdb7db';
  v_fiche int;
  v_lot int;
BEGIN
  -- Source 1 : prix d'achat de la fiche article
  UPDATE sale_items si
  SET purchase_cost = a.purchase_price
  FROM sales s, articles a
  WHERE si.sale_id = s.id
    AND si.article_id = a.id
    AND si.tenant_id = v_tenant
    AND s.status <> 'cancelled'
    AND COALESCE(si.purchase_cost, 0) <= 0
    AND COALESCE(a.purchase_price, 0) > 0;
  GET DIAGNOSTICS v_fiche = ROW_COUNT;

  -- Source 2 : cout moyen des lots de stock (pour les articles sans prix de fiche)
  UPDATE sale_items si
  SET purchase_cost = lot_cost.avg_cost
  FROM sales s,
    (
      SELECT article_id, AVG(purchase_price) AS avg_cost
      FROM stock_lots
      WHERE tenant_id = v_tenant AND COALESCE(purchase_price, 0) > 0
      GROUP BY article_id
    ) lot_cost
  WHERE si.sale_id = s.id
    AND si.article_id = lot_cost.article_id
    AND si.tenant_id = v_tenant
    AND s.status <> 'cancelled'
    AND COALESCE(si.purchase_cost, 0) <= 0;
  GET DIAGNOSTICS v_lot = ROW_COUNT;

  RAISE NOTICE 'INTELLIGENCEPRO reparation couts: % via fiche, % via lots', v_fiche, v_lot;
END $$;