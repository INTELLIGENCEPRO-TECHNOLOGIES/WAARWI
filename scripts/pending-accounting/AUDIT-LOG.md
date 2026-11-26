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
