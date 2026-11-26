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
