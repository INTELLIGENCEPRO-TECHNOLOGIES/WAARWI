# Recette de publication — Waarwi Comptabilité

**Statut : NON VALIDÉ — ne pas fusionner vers main tant que les contrôles bloquants ne sont pas satisfaits.**

Périmètre : branche codex/waarwi-comptabilite-suite, Waarwi principal exclusivement. Pas de publication Netlify ni migration de production pendant la recette.

## Matrice des contrôles
| Contrôle | Attendu | Preuve à conserver |
|---|---|---|
| Build / TypeScript | Compilation Vite et contrôle de types, erreurs nouvelles corrigées | Logs CI, commit exact |
| Migrations | Installation ordonnée des scripts de développement sur une base isolée fidèle à la production | Logs, schéma et versions |
| Recettes SQL | Toutes les recettes 15,18,20,22,24,26,28 et les anciennes recettes applicables réussissent, sans fuite ni mutation résiduelle | Résultats par script |
| Intégrité comptable | Total débit = total crédit ; écritures équilibrées, aucun doublon de source, liens orphelins nuls | Mesures avant/après |
| Clôtures et RAN | Périodes fermées inaltérables ; concordance balance, grand livre, interrogation, états et ouverture | Cas sur deux exercices |
| Saisie / lettrage | Contrôles serveur, échec atomique, concurrence, extourne, échéances et doublons | Recette multi-session |
| Banque / immobilisations | Import réel, pointage, sorties, dotations ; rapprochement sans ajustement arbitraire | Scénarios et pièces |
| Analytique | Exactitude centimes, axes indépendants, budgets révisés, écarts, non ventilé, général inchangé | Recette 28 et cas utilisateur |
| RLS / droits | Test lecture/écriture croisés entre tenants et profils, compte anon, rôles autorisés, RPC | Matrice d'accès |
| Sauvegarde / restauration | Toutes les nouvelles tables inscrites au registre ; sauvegarde/restauration réelle en environnement isolé, reset et compatibilité anciennes sauvegardes | Inventaire avant/après |
| Performance | Plans EXPLAIN ANALYZE sur données synthétiques volumineuses ; pagination ; absence de N+1 et de lectures excessives | Mesures reproductibles |
| Desktop et mobile | 1366×768, 1440×900, 390×844 et 360×800 : fenêtres, mosaïque, focus, menus, formulaires, aucune modale de consultation générique | Captures et tests |
| Non-régression | Ventes, achats, caisse, stock, tiers, facturation, permissions et synchronisation | Parcours validés |
| SYSCOHADA | Revue des imputations, fiscalité, états normalisés, annexes, immobilisations et hypothèses de calcul par un professionnel | Validation métier documentée |

## Limites connues à traiter / faire valider
- RAN virtuels et états historiques : vérifier tous les états, exports et soldes tiers/banque, y compris exercices intermédiaires.
- Échéances réelles et tiers non affectés : aucune date supposée ; balance âgée historique non figée.
- Immobilisations : linéaire au jour, une ligne d'acquisition par bien, pas de reprise d'amortissements anciens ni dépréciations ; correction dédiée des opérations liées non disponible.
- Analytique : ventilation manuelle par ligne et axe, budgets mensuels classes 6/7 ; pas de règles automatiques ni import budgétaire. Les contrepassations doivent être ventilées et rapprochées explicitement.
- Révision : références textuelles, pas de pièces jointes ; documents de travail non certifiés.
- Formats bancaires spécialisés non pris en charge.
- Vérifier les effets des contraintes FK et de l'ordre de restauration sur toutes les nouvelles tables.
- Les scripts préparés ne constituent pas des migrations installées. Les tests de requêtes isolées ne sont pas une recette transactionnelle.

## Procédure de passage
1. Relever le SHA de main et le SHA de la branche. Aucun déploiement depuis la branche.
2. Compiler et résoudre les erreurs. Créer un environnement de test isolé, sans données de clients accessibles publiquement.
3. Appliquer les migrations dans l'ordre de dépendance, exécuter les recettes et mesurer la non-régression.
4. Valider la restauration et les permissions, puis la recette visuelle et métier.
5. Revue réglementaire, bilan des anomalies bloquantes et feu vert explicite.
6. Seulement après accord : sauvegarde vérifiée, migration versionnée, publication unique, contrôle post-publication et plan de retour arrière.

Aucune étape n'est réputée réussie sans preuve issue du commit et de l'environnement réellement testés.

## Phase 10 — protection des saisies manuelles
- Script 39 / migration 20261126041824 exécuté exclusivement sur la branche Supabase de recette. Les appels publics passent par la nouvelle RPC avec UUID obligatoire ; anciennes recettes adaptées.
- 12 contrôles SQL réussis : réessai identique, saisie volontaire distincte, collision de contenu, échec atomique, reprise après rejet, clé absente, ancienne RPC, anon, isolation et comptage exact. Fixtures annulées.
- Restent bloquants : concurrence réelle à deux sessions, compilation et scénario navigateur après coupure, contrôle de la restauration des nouvelles colonnes, fidélité de la branche SQL (migrations en échec), autres recettes et non-régressions.

### Rejeu après le correctif (26/11/2026)
- Recettes transactionnelles 03,05,07,10,15,18,20,22,24,26,28,36,38 et 40 exécutées sans exception sur la branche de recette. 05,07,10 adaptées au deuxième tenant fictif par sélection indépendante du nom ; aucune mutation conservée.
- Audits 30,32,34 exécutés sans exception. Les audits commerciaux/retours sont diagnostiques, non une recette de création réelle des documents commerciaux ; le benchmark volumétrique reste à faire.
- État du jeu d'essai après rejeu : 2 tenants, 2 profils, 61 pièces, 122 lignes, 0 pièce portant une clé de demande (rollbacks).
- CI du commit c021245 : Vite et tests unitaires réussis, TypeScript échoué (299 diagnostics dont 20 dans le périmètre comptable). Corrections des deux familles comptables Navigation/Accounting en cours de vérification. CI : https://github.com/INTELLIGENCEPRO-TECHNOLOGIES/WAARWI/actions/runs/45754498498
- Publication toujours interdite : fidélité du schéma, parcours commerciaux réels, concurrence multisession, restauration et validation navigateur non terminés.

### Phase 10.11 — intégration commerciale
Recettes synthétiques des RPC : 8 pièces équilibrées (325900 FCFA par côté), facture d'achat TVA partiellement récupérable, avoir et remboursement atomiques, refus des incohérences et des doublons. Correctif 41 / migration 20261126042544 rejoué avec succès sur exercice antérieur ouvert et période clôturée. Voir PHASE-10-11-COMMERCIAL-RECIPE.md pour les résultats et limites. Les parcours POS/stock ne sont pas encore validés.

### Phase 10.12 — reprise et concurrence
Reprise transactionnelle, compteur, répétition intersession et jeton de clôture obsolète vérifiés. Correction préventive de l'ordre de verrouillage mois/journal (migration 20261126045014), cinq recettes rejouées avec succès. Les appels du connecteur ne se chevauchent pas : concurrence réelle non validée ; voir PHASE-10-12-CONCURRENCY-RECIPE.md. Aucun déploiement.

### Verrouillage collaboratif — premier lot
Socle et saisie comptable intégrés ; aucune publication tant que les recettes multi-utilisateurs et réseau, les parcours commerciaux, le reste des écrans et la compatibilité des anciennes recettes ne sont pas validés.

### Factures : verrouillage collaboratif
Recette SQL 44 à rejouer ; vérifier les parcours réels (dont sortie de stock et cas spécifiques), droits RLS et accès direct, compatibilité des factures historiques, navigateur desktop/mobile et concurrence avant publication.

### Devis — phase 10.12 bis (suite)
Recettes 45 et 46 exécutées avec succès sur données synthétiques : édition et statut verrouillés, création atomique et idempotente, refus des écritures directes. Conversion : verrou et version obligatoires, sérialisation par le devis, ancienne RPC non publique, vérification du statut et des droits, test de création d’une facture et rejet de la seconde conversion. Les dépendances manquantes de la branche de recette ont été reconstituées en lecture de main (script 47, exclusivement recette). BLOCAGE PUBLICATION : stock, lots, commissions et IPM encore traités par appels séparés après conversion, triggers commerciaux/TVA absents de l’environnement isolé, droits de restauration des devis à recetter, tests simultanés et navigateur non exécutés. Aucune publication.

### Conversion transactionnelle des devis — actualisation
Les appels séparés sont remplacés par convert_quote_atomic. Recettes 48 et 50 exécutées ; voir PHASE-10-12-BIS-QUOTE-CONVERSION.md pour les validations et blocages. Conversion IPM et parcours ultérieurs à harmoniser, tests simultanés/navigateur et recette commerciale de bout en bout encore obligatoires. Aucune publication.

### Autorisation du stock négatif
Recettes 51 et 52 : six scénarios de conversion et modification facture, plus recette 44 rejouée. Alignement sur la règle de production : magasin parent prioritaire pour un dépôt, ancien paramètre tenant non prioritaire. Stock par lots strict, pas de lot fictif. Aucun changement de règle de production. Recette navigateur et concurrence restent ouvertes.

### Cycle inverse des factures converties
Recette 53 : restitution des lots et stock agrégé au dépôt réel, remboursement IPM, idempotence, verrou actif, refus fiscal sans mouvement résiduel. Le nouveau registre privé quote_conversion_stock_trace doit être intégré aux procédures de sauvegarde, restauration et purge avant publication. Les anciennes conversions sans trace conservent leur traitement historique (audit restant), les avoirs TVA, désimputation des crédits, autres cas de remboursement et suppression à compléter. Aucun déploiement.

Recette 54 : suppression logique d’une facture non fiscale non réglée avec lots, restitution unique, crédit patient conservé et refus des historiques incohérents. La protection fiscale existante est maintenue ; ne pas assimiler ces tests à une certification de facturation électronique.

### Avoir fiscal des factures converties
Recette 57 : historique TVA, retour au dépôt d’origine, imputation partielle puis totale, réessai identique, refus du payload modifié et du dépassement, blocage sur verrou actif. Les retours partiels sur une ligne multi-lots requièrent une sélection explicite (bloqués en attendant). Les remboursements caisse, retours non fiscaux, cas anciens sans trace, écritures comptables et concurrence réelle restent à recetter. Aucun déploiement.

Recette 58 : comptabilisation de la facture convertie, du règlement réel par API de masse et des deux avoirs approuvés. Quatre pièces équilibrées, ventes et TVA neutralisées, caisse +1 200 et client créditeur 1 200 FCFA. Réessai de comptabilisation idempotent. Tests de remboursement, lots et concurrence restent ouverts.


### Règle de recette métier — aucun parcours normal laissé bloqué
Un blocage défensif ne constitue pas une fonctionnalité terminée lorsqu'il empêche un cas métier légitime. Toute restriction introduite doit être recensée, accompagnée de sa solution et testée avant publication. Ne pas remplacer silencieusement un parcours de production par un refus. Vérifier aussi les documents historiques et les opérations inverses, avec les mêmes droits et paramètres métier.

**Bloquant : retour partiel multi-lots (factures converties et autres ventes concernées).**
- Afficher les lots réellement débités par ligne, le dépôt d'origine et les quantités encore retournables, en déduisant les retours précédents.
- Affecter automatiquement le lot unique ou l'intégralité des lots restants si l'affectation est sans ambiguïté ; sinon permettre la saisie explicite des quantités par lot.
- Valider exactement la quantité sélectionnée, sans lot étranger à la vente, dépassement, réintégration fictive ou double restitution. Conserver la traçabilité des retours sans réintégration pour ne pas réutiliser leur quantité retournable.
- Enregistrer affectation, avoir/retour, stock, valorisation et audit dans une transaction ; intégrer la traçabilité aux sauvegardes et restaurations.
- Recetter : 6 unités A + 4 unités B, retour 2 A + 1 B ; retour ultérieur du solde ; lot unique ; retour total ; retour financier sans stock ; lot erroné ; dépassement cumulé ; requête répétée ou modifiée ; deux sessions concurrentes ; perte réseau ; TVA historique et comptabilisation. Vérifier les parcours facturation desktop/mobile et POS applicables, y compris les ventes historiques sans trace exploitable (ne jamais inventer un lot).
- État : solution approuvée, implémentation et recette non terminées. La publication reste interdite tant que le parcours normal n'est pas fonctionnel et vérifié.

### Affectation multi-lots — avancement
Recettes 59 et 60 : vente fiscale convertie 6 A + 4 B, retour 2 A + 1 B, avoir sans stock sur B, retour automatique du solde, plafonds et réessai, TVA historique. Coût des lots mémorisé à la conversion et utilisé au retour même après changement du prix d’achat. Recettes 57 et 58 rejouées. Sélecteur partagé facturation desktop/mobile et retour caisse ; parcours caisse de bout en bout, ventes historiques hors registre et retours non fiscaux à recetter/compléter, sauvegarde/restauration du registre et des affectations, simultanéité et navigateur encore ouverts. Aucune publication.

Recette 62 : retour fiscal multi-lots via API normale du POS, remboursement partiel et total en caisse, réessai sans doublon, restitution exacte. Supervision multi-caisse et navigateur restent à vérifier ; script 61 exclusivement recette.


### 26/11/2026 — compatibilité historique, supervision et sauvegarde des affectations
- Branche isolée Supabase `waarwi-comptabilite-recette` (`zmbtbahififajyfvfasn`), distincte de main, ACTIVE_HEALTHY mais MIGRATIONS_FAILED. Aucun changement sur production.
- Recette 62 : remboursement 3 540 + 8 260 FCFA, TVA cumulée 1 800, lots A/B 6/4 restitués, réessai sans doublon. Exécution SQL réelle confirmée ; CI précédente : build/typecheck/tests réussis au commit 7bd33f5.
- Recette 63 reproduite en échec : vente historique sans TVA, remboursement 3 000 et caisse corrects mais 3 articles dans le magasin (102 au lieu de 99), dépôt et lots inchangés. Candidat 64 : utiliser sorties historiques vérifiables, exposer les lots hors registre des conversions ; succès des recettes fiscale nouvelle, fiscale historique (72) et non fiscale (63). Pas de reconstitution fictive des lots ; historiques incomplets, retours anciens non affectés et origines multiples restent à traiter.
- Recettes 65/66 : deux caisses, admin et caissier, refus d'accès direct à la caisse d'un collègue, refus de lecture/retour d'une vente de collègue et de supervision non autorisée, remboursement dans la caisse supervisée, audit et réessai. 65 réussie ; 66 reproduite en échec sans garde explicite puis réussie avec le candidat 67. RPC de supervision absente de la base isolée : définition existante reprise de 20261104154232 uniquement dans la transaction de recette. Fidélité du schéma et RLS complet toujours à vérifier.
- Registre : cash_register_assignments déjà présent (structure, préservé), quote_conversion_stock_trace et sale_return_lot_allocations absents. Candidat 68 inscrit les deux nouvelles tables après leurs parents et protège le préflight v2 contre une archive ancienne qui omet des données de traçabilité existantes. Recette 69 : préflight sur archives synthétiques, refus anti-perte, lecture ancienne sans données correspondantes, aller-retour JSON des trois tables, caisse et stock inchangés. Ce n'est pas une sauvegarde/restauration complète ; br_create_backup/br_restore_backup absents de la branche isolée. Ne pas désactiver les protections BR020.
- Recette 70 : clé de retour historique réutilisée avec contenu différent acceptée à tort. Candidat 71 : empreinte du contenu pour nouvelles demandes et verrou transactionnel, préservation des anciens appels sans clé ; recette réussie (réessai exact, collision refusée, restitution automatique du solde). Les anciennes demandes sans empreinte et la concurrence réelle nécessitent des contrôles dédiés.
- Les recettes 62,66,69,70 ont été rejouées avec l'ensemble des candidats 64/67/68/71, chacune dans une transaction indépendante avec rollback : succès ; 0 tenant de recette résiduel. Deux essais de concaténation dans une seule transaction ont échoué à cause du contexte JWT puis du mode des contraintes persistants entre fixtures ; rejeu séparé utilisé comme protocole correct. Les correctifs sont des scripts candidats versionnés, testés puis annulés avec les fixtures : ni migrations finales, ni installation persistante.
- BLOQUANTS : transformer les candidats en migrations contrôlées sur un schéma complet, recetter les historiques incomplets et cas non fiscaux sans lots/retours sans remise en stock, concurrence multisession/coupure, RLS complète, sauvegarde/restauration/reset via moteur réel (v2/v3 selon chemin actif), tests navigateur desktop/mobile, compilation et non-régression du commit final. Publication interdite.


### 26/11/2026 — historiques incomplets et retour financier
- Recettes 74 et 75 : reproduites en échec avant correction (stock sans lot remis au magasin au lieu du dépôt ; sorties historiques sans sale_item_id non visibles). Candidat 73 : origine de ligne ou mouvement de stock unique, repli historique sur site de la vente en absence de preuve ; rattachement virtuel des sorties orphelines uniquement si une seule ligne de cet article existe et site compatible. Aucune réécriture de l'historique. Les deux recettes réussies.
- Recette 76 : même article sur deux lignes, sorties sans rattachement certain : aucune affectation fictive ; retour physique refusé atomiquement, remboursement explicite sans stock réussi. Un parcours de rapprochement manuel contrôlé pour restitution physique reste obligatoire.
- Recettes 78/79 : sortie de lot partiellement manquante, vente sans TVA et facture fiscale historique. Candidat 77 permet un retour financier explicitement sans stock et sans affectation dans ce cas, tout en refusant le retour physique incertain ; réussite avec remboursement 3000 FCFA sans TVA et 3540 TTC dont TVA 540 FCFA pour le cas fiscal ; stock intact. Aucun retour physique ambigu n'est considéré résolu.
- Rejeu des recettes 62,70,72 avec candidats 64/67/68/71/73/77 : réussi dans des transactions indépendantes. Un lancement global a dépassé la limite du connecteur ; ne pas considérer toute la suite rejouée. Les nouveaux candidats sont versionnés, non installés durablement.
- Interface POS actuelle : remise en stock imposée (p_restock=true), y compris supervision ; prévoir un parcours explicite et autorisé, pas de conversion silencieuse en retour financier. UI et procédure de rapprochement manuel des anciens retours sans affectation, lots répartis sur plusieurs dépôts, historiques sans aucune preuve, tests de concurrence restent bloquants.
- Inventaire du moteur de sauvegarde isolé : 6 fonctions br/_br disponibles seulement, br_create_backup et br_restore_backup absentes ; nombreuses tables v3 présentes mais fonctions de capture/export/restauration absentes. Reconstitution fidèle requise avant validation intégrale ; ne pas contourner les verrous ni reconstruire une version obsolète sur production.
- Aucune publication. Préserver le feu rouge jusqu'à la recette complète des dépendances, migrations, navigateur et sécurité.


### 26/11/2026 — rapprochement manuel des lots et retours historiques
- Candidats 80/81 : nouvelle table privée historical_sale_lot_matches (RLS, aucun droit direct API, inscription au registre de sauvegarde après les sorties), RPC administrateur avec justificatif et quantités exactes ; affectation virtuelle des sorties orphelines sans réécriture de vente. Recette réelle : deux lignes de cinq, lots A6/B4, ventilation A5 puis A1+B4 ; refus de rapprochement incomplet, réessai identique, un audit ; retour 3 puis 7, stock et caisse exacts.
- Candidats 82/83 : RPC de supervision v2 conservant le mode physique par défaut à l'interface, accepte le mode financier explicite avec motif, empreinte du contenu de la demande, refus d'une réutilisation de clé avec mode différent, contrôle de session/droits, audit unique. Recette fiscale réelle réussie sans mouvement de stock.
- Candidats 84/85 : rapprochement d'un retour approuvé déjà traité, justificatif + confirmation des mouvements physiques préalablement vérifiés. Aucune restitution ni remboursement lors du rapprochement ; métadonnées de rapprochement inscrites sur les allocations. Recette réussie (refus sans confirmation, réessai, ancien retour 3 + retour solde 7).
- Candidats 86/87 : ordre vente puis anciens retours, autorise la résolution d'une vente ayant des retours approuvés, rejette des affectations anciennes incompatibles ; anciens retours physiques ou financiers non affectés sur historiques multi-lots doivent être rapprochés avant nouvelle restitution. Recette combinée réussie : 2 articles déjà remboursés sans stock, 8 restitués physiquement, caisse revenue au fond initial, stocks exacts.
- Recette 88 : anon sans EXECUTE, authenticated sans accès direct à la table et RLS active, caissier et administrateur d'un autre tenant refusés en lecture/écriture, administrateur du tenant autorisé. Succès.
- Recette 89 : préflight sur archives synthétiques avec/ sans rapprochements ; refus de perte de rapprochement, aller-retour JSON identique des deux tables, soldes inchangés. Succès. Ne constitue pas une sauvegarde/restauration réelle via le moteur.
- UI versionnée : src/components/cash/HistoricalLotMatchPanel.tsx et SaleReturnModal.tsx (choix explicite stock/financier, motif, nouveau RPC supervision, accès admin au rapprochement des sorties et anciens retours, confirmation avant opération, réessai même demande si résultat inconnu dans le formulaire). Pas de validation navigateur ; fermeture/rechargement et concurrence réelle restent à recetter. CI de 73f01c6 : installation et build réussis, typecheck annulé, tests sautés (job 140190325176), non assimilé à une erreur TypeScript constatée. Contrôler le commit final.
- Les six recettes 81,83,85,87,88,89 ont produit un résultat positif sur zmbtbahififajyfvfasn, chacune avec les dépendances requises dans une transaction annulée. Les candidats 80/82/84/86 ne sont pas installés durablement ni finalisés en migrations.
- BLOQUANTS : ventes sans preuve du lot ou source physique, lignes réparties sur plusieurs dépôts, anciens retours dont le stock physique n'a pas été régularisé (inventaire/ajustement contrôlé nécessaire), rapprochement/correction d'affectations déjà enregistrées, prise en compte de la traçabilité dans édition/annulation/purge de ventes, accès aux historiques hors session POS, tests facturation et POS dans navigateur, restauration réelle et réinitialisation via le moteur actif, concurrence multi-session et intégration des migrations. Les RPC du moteur v2 utilisées par BackupTab (br_create_backup, br_restore_backup, br_reset_operations, br_download_backup, br_import_payload) ne sont pas présentes dans la branche isolée ; ne pas neutraliser BR020.
- Publication interdite. Aucune écriture en production, aucune fusion main.


### 26/11/2026 — multi-dépôts, annulation/suppression, moteur D réel
- CI du commit 8eb9ff2 (interfaces précédentes) : installation, build, contrôle TypeScript et tests tous réussis (https://github.com/INTELLIGENCEPRO-TECHNOLOGIES/WAARWI/actions/runs/45902531160).
- 90/91/92 : restitutions historiques avec sorties de lots prouvées sur deux dépôts (vente sans TVA et historique fiscal synthétique). Retour 3 dont A2/B1 puis 7, dépôts 6/4, magasin inchangé, TVA cumulée 1800 pour la vente fiscale. Réussite. Rapprochements manuels multi-dépôts permis si site de ligne non contradictoire ; recette spécifique des sorties orphelines multi-dépôts encore requise.
- 93/94/95 : régression historique reproduite avant correction : annulation dépôt 4 au lieu de 10, suppression 6 au lieu de 10, lots corrects. Candidat 93 groupe les stocks par article/dépôt, contrôle sorties historiques, verrous et quantités, conserve le moteur de conversion tracée ; annulation/suppression et rejeux réussis. Protection des lignes/sorties rapprochées contre les réécritures. Recettes 96 (4 mutations refusées, annulation légitime préservant 3 rapprochements) et 97 (article lot + article sans lot) réussies. Verrou logique commun retour sans TVA/annulation/suppression/édition ; concurrence réelle non exécutée.
- Restauration Lot D : installation transactionnelle du fichier review 20261112090000_lot_d_safe_restore_reset_inactive.sql réussie avec config false, BR020 conservé. Fonctions préexistantes absentes du schéma isolé : br_check_schema_drift() et _br_capture_order(regclass,text), reprises EXACTEMENT depuis 20260904214940_backup_restore_v2_functions.sql et 20261110231312_lot_b_durable_capture_engine_inactive.sql.
- 98/99 : document_edit_audit inscrit au registre, document_edit_leases exclu des archives (temporaire, doit être invalidé sous verrou de maintenance lors du swap/reset), gate et notification protégés. Table indirecte mt_wholesaler_services : parent_table manquant, corrigé vers mt_wholesalers (FK vérifiée). Refus de restaurer une archive ancienne qui ferait perdre la traçabilité historique existante. Installation réelle des hooks réussie, drift=false et hooks_status.ok=true ; BR020 maintenu.
- 100 : vraie restauration via request/claim/load_v2/verify/request_execute/maintenance/swap/release avec archive synthétique de toutes les tables du registre. Échec initial faute de _br_capture_order, puis réussite LOT_D_RESTORE_V2_OK après chargement de la définition existante. Ancienne archive sans table de rapprochement refusée BRR-020. Stock, caisse, rapprochements et suppression des données ajoutées après archive vérifiés. Activation du moteur UNIQUEMENT dans transaction annulée de recette ; aucun déploiement.
- 101 : reset réel LOT_D_RESET_OK, opérations et soldes remis à zéro, caisses, affectations, articles, profils préservés, verrous invalidés, autre entreprise inchangée.
- 102/103 : échec de swap plus complet reproduit (FK cash_movements.sale_return_id). Audit des FK : 11 ordres à corriger ; cycle IPM traité en deux passages par colonne nullable ipm_bordereaux.facture_ipm_id (ON DELETE SET NULL vérifié). Candidat 102 fixe les ordres et refuse toute FK encore mal ordonnée. Rejeu réel LOT_D_RESTORE_AFFECTATIONS_OK : retour partiel, allocations lots, caisse 7100, stock dépôt 3, affectation caisse rétablie, verrous temporaires invalidés et entreprise témoin inchangée. Recette IPM avec véritables bordereaux/factures reste nécessaire. Les recettes D utilisent un archive v2 synthétique complète, non une capture v3 chiffrée/HTTP et pas de validation de bout en bout entre transactions séparées.
- BLOQUANTS : reconstitution ordonnée de toutes les migrations (branche toujours MIGRATIONS_FAILED), regroupement des candidats 64 à 102 et rejeu de non-régression intégral, V3 chiffrée capture/export/chargement et lot E, vérification de contenu v2 après swap (moteur vérifie les empreintes à la préparation ; swap compare actuellement nombre de lignes pour v2, contenu pour v3), restauration des métadonnées de rapprochement des anciens retours avec 84/86, recette IPM et autres dépendances, exercices et navigateur, résolution des historiques sans preuve et rapprochements multi-dépôts orphelins, concurrence/réseau. Aucun assouplissement de BR020 ni activation production. 
- Les recettes 91/92/94/95/96/97/99/100/101/103 sont réussies séparément sur zmbtbahififajyfvfasn. Les candidats testés par sous-ensembles dans des transactions annulées ne sont pas encore des migrations de production. Publication interdite.
