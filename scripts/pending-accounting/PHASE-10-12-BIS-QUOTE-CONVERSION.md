# Phase 10.12 bis — Conversion transactionnelle des devis
26/11/2026. Branche recette zmbtbahififajyfvfasn uniquement. Production inchangée.

- Migrations 20261126204924 et 20261126205053 : nouvelle RPC convert_quote_atomic ; facture, règlement, caisse, stock/dépôt, lots par ligne/coûts, commission serveur, IPM, solde cache, statut et audit dans une transaction. Les deux anciennes RPC sont internes uniquement.
- Script 49 : restauration ciblée de dix déclencheurs commerciaux/TVA de production (branche recette seulement, pas de replay en production). Pas de copie de données clients.
- Recette 48 adaptée à la nouvelle RPC : devis non accepté, mauvais verrou/version, conversion unique, ancien endpoint refusé.
- Recette 50 : trois entreprises synthétiques. TVA 4 000 HT + 720 TVA = 4 720 TTC ; paiement 1 200, caisse 100→1 300, solde 3 520, commission marge 230 ; stock insuffisant rollback intégral puis F-00001. Lots 5 unités réparties sur 2 lignes, coût total 2 400, mauvais dépôt, quantité, expiration et disponibilité bloqués. IPM 2 500 dont 1 600 organisme et 900 patient, contrôle documents et surpaiement, aucun encaissement fictif. Rollback complet.
- GitHub Actions commit f02492a : build et TypeScript OK, 27/27 tests unitaires.

## Blocages de mise en production
La recette n'est pas une preuve de concurrence strictement simultanée ni de coupure réseau réelle. La branche isolée reste partielle (RLS, triggers de synchronisation et autres fonctions métier). Les annulations/avoirs/restauration de lots et les acomptes doivent être recettés de bout en bout. Les conventions IPM avec TVA, plafonds complexes ou remise globale sont refusées explicitement, de même que les lignes avec IMEI : parcours dédiés à valider. Le champ sales.paid reste le montant réellement réglé/imputé : adapter et tester les écrans et RPC de règlement/avoir pour distinguer solde patient et créance organisme, ainsi que la comptabilisation et le relevé client avant toute publication. Contrôler les droits de sauvegarde/restauration, le déploiement coordonné des migrations et du client. Ne pas passer aux commandes fournisseurs tant que ces contrôles ne sont pas soldés.
