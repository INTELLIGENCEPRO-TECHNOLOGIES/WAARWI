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

## Audit intégrations commerciales — 26 novembre, reprise après interruption
- État initial 137 commits, aucun retard sur main.
- Lecture seule : 374 pièces commerciales (189 ventes, 154 règlements de ventes, 17 achats, 7 règlements fournisseurs, 3 règlements de solde clients, 3 retours, 1 mouvement de caisse). 0 source manquante, 0 écart de montant, 0 lien retour incohérent pour les 6 sources portant un champ de liaison, 0 groupe de doublons, 0 numéro dont le millésime diffère de la date. Les retours n'ont pas de champ accounting_entry_id ; rapprochement par source_id.
- Anomalie historique : une vente supprimée le 04/09/2026, comptabilisée le même jour pour 80 000 FCFA, sans règlement ni retour et avec un journal de suppression. Aucun changement de données ; analyser la pièce, le solde client et les stocks avec un comptable avant régularisation.
- Script 31 : index unique partiel par tenant/source commerciale, protections des ventes et règlements (liens, classes actives, montants, date et mois ouverts), isolation des exceptions en masse, refus d'annulation/suppression malgré un statut obsolète. Limite : en attendant un numéroteur par date d'écriture, les nouvelles écritures de ces fonctions hors exercice courant sont refusées ; pas de changement du millésime historique. Les flux de caisse, achats et avoirs nécessitent encore leur recette dédiée. SQL non installé, compilation et concurrence non testées.
- Interface BalanceTab : compte rendu détaillé des lots et inclusion des règlements de solde dans les compteurs.
- Script 32 : audit de concordance et vérifications de l'index/permissions, à exécuter après installation sur staging. Aucun déploiement ni modification de production.

## Audit des retours, avoirs et trésorerie
- Lecture seule : 276 retours (270 approuvés, 6 en attente), toutes entreprises confondues. 21 retours approuvés liés à une facture comptabilisée ; 18 sans lien vat_entry_id (16 historiques sans ventilation fiscale, 2 avec ventilation), total 2 159 600 FCFA à examiner, sans présumer qu'une écriture de régularisation de ce montant est due. Les 3 liens existants concordent avec source, statut et montant.
- 193 remboursements approuvés avec mouvement de caisse retrouvé : montant cumulé égal au retour. 61 autres retours approuvés en espèces sans mouvement retrouvé par sale_return_id : vérifier les anciens parcours et références, aucune reconstruction automatique.
- 78 transferts caisse/coffre : contreparties concordantes selon le lien, le site, la session, le sens et le montant ; 8 dans les entreprises où la comptabilité est activée, aucun lié à une pièce. Aucun doublon de source coffre (aucune pièce de ce type existante).
- 229 règlements sans effet sur le solde : aucun lien ni statut comptabilisé. Cela ne prouve pas que tous les acomptes et crédits ont été traités correctement.
- Script 33 : index unique coffre ; contrôles de l'avoir fiscal (HT/TVA/TTC, cumul, imputation d'origine non ambiguë, lien idempotent vérifié, caisse active famille 57), refus des contreparties génériques hors classe, précision, restriction RPC anonyme. 7 tests isolés de conditions monétaires réussis. Pas de changement de la fiscalité historique, ni de reconstitution automatique des 18 avoirs, ni de correction des comptes de trésorerie historiques.
- Script 34 : diagnostics et assertions de privilèges/index à exécuter après installation. Recette transactionnelle complète toujours requise (remboursement atomique, concurrence, clôtures, retour non fiscal).
- Numérotation historique encore limitée à l'exercice courant ; revoir globalement avant publication. Aucun déploiement ni mutation de production.

## Audit numérotation et périodes
- Lecture seule : 375 pièces au format attendu, 0 millésime incohérent, 12 groupes de compteurs utilisés concordants (0 absent, 0 en retard, 0 en avance), 13 compteurs au total. 5 lignes de périodes, dont 1 mois clôturé ; aucun exercice annuel clôturé. Les tests historiques inter-exercices nécessitent donc une fixture.
- Ancien numéroteur fondé sur CURRENT_DATE ; LPAD à cinq chiffres sans garde de capacité. Script 35 : date explicite, millésime de la pièce et verrou de période avant compteur, reprise du maximum émis, compteur par journal/tenant/année, refus au-delà de 99 999, plage 2000–2099 pour compatibilité YY. Recherche bornée sur l'index unique tenant/numéro. Ancienne signature refusée. Les huit appels directs installés sont repris depuis les derniers scripts préparés ou la définition actuelle.
- Préservation du verrou mensuel existant et contrôle de validité du mois civil. Les restrictions spécifiques aux sorties et reprises d'immobilisations anciennes restent maintenues. Aucun numéro historique modifié.
- 8 scénarios SQL isolés réussis (changement d'année, compteur absent/obsolète/en avance, journal trois lettres, limite et dépassement). Script 36 : recette rollback préparée, non exécutée. Concurrence sur deux sessions, compilation SQL/TypeScript et clôture annuelle complète non attestées. Documentation Supabase Markdown inaccessible lors de cette session ; aucun changement dépendant d'une nouvelle API.
- Aucun déploiement, aucune mutation de production.
