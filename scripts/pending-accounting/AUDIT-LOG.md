# Journal de recette technique — 26 novembre 2026

Statut de publication : BLOQUÉ, aucune fusion ni migration de production autorisée par cette recette.

## Preuves
- Inventaire initial : 129 commits et 50 fichiers de différence selon la comparaison GitHub (branche à jour de main).
- CI : workflow `.github/workflows/accounting-audit.yml`, commit a32d8dea47f31a3f20950174a01215a7a610de0f. Compilation Vite, TypeScript, tests Node. Aucun déploiement. Les résultats des exécutions push ne sont pas disponibles dans les réponses du connecteur : **compilation non attestée**.
- Accès git local : échec DNS github.com ; impossible de cloner ou compiler dans le conteneur actuel.
- Audit SQL en lecture seule sur Waarwi principal : 375 écritures validées, 761 lignes, total débit/crédit 234406030.00 chacun. 0 incohérence entre entête et lignes, 0 source dupliquée, 0 ligne orpheline. Cela vérifie l'existant, pas les nouvelles migrations.
- Correctifs : 313b846498e1713fa3024e86fd1ca73472c6c2fe (pagination intégrale des lignes de pièce) et 695fccee8ea6a7e49c17ff83635132576de7ae71 (préfixes CSV). Relecture statique ; tests intégrés requis.

## Bloquants encore ouverts
1. Récupérer les résultats réels du build/typecheck/tests et corriger toute erreur.
2. Installer les scripts SQL dans un environnement isolé, exécuter les recettes transactionnelles et mesurer les effets de restauration.
3. Tester les parcours de consultation, saisie, permissions, fenêtres et intégrations, puis effectuer la revue réglementaire.
4. Conserver les preuves avant toute autorisation de publication.

Ne pas interpréter un inventaire de fichiers, une compilation déclenchée sans résultat ou un contrôle de la base de production en lecture seule comme une validation de la branche.

## Audit sécurité et restauration — suite
- Comparaison reprise à 133 commits d'avance, 0 en retard. Aucun changement de main.
- Base en lecture seule : 13 tables historiques comptables inspectées (RLS activée). Journal, lignes et plan principal sans droits directs de modification pour authenticated. Droits historiques excessifs constatés sur accounting_sequences et accounting_accounts (tenant RLS seule) ; export_accounting_entries exécutable par anon malgré son contrôle interne.
- Registre des scripts 12–28 : 11 nouvelles tables déclarées, 14 dépendances FK extraites, toutes dans l'ordre parent avant enfant. Vérification statique, pas une restauration exécutée.
- Correctifs : script 29 (commits b0acc2e733cd285daffe957733a5ed5ecfcfeaa5 et d8617df0a567e3d80afc65d51349fcb0069cc4eb) : préflight bloquant si une sauvegarde omet une nouvelle table comptable non vide, révocation de l'export anon, suppression des écritures directes sur accounting_sequences. Le compteur interne next_accounting_piece_number est SECURITY DEFINER, non accessible aux clients. Recherche du dépôt par nom de table : aucune écriture frontend sur les compteurs trouvée ; vérification exhaustive du build requise.
- Six cas de la condition de préflight vérifiés en SQL isolé en lecture seule. Aucun test de restauration réel. Le verrou existant BR-020 reste actif : ne pas le lever. Le futur moteur de restauration V3 devra être audité indépendamment.
- Script 30 (3aaa0ce36fc96c5842750a7817d7c044f3d91eac) : assertions des privilèges, RLS, registre et FK après installation en environnement de test. Non exécuté.
- Droits de l'ancienne table accounting_accounts à analyser avant restriction afin d'éviter une régression du provisionnement et des paramètres. Aucune modification de cette table.
- Le statut combiné CI ne retourne aucune vérification. Build toujours non attesté. Aucune migration de production ni publication Netlify.
