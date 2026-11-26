# Phase 10.12 — reprise transactionnelle et concurrence — 26/11/2026

## Exécuté sur la branche de recette uniquement
Deux utilisateurs fictifs, quatre connexions SQL : PID 9877 et 9879, même demande, même pièce OD2600001 ; PID 9901 et 9903, deux demandes distinctes, OD2600002 et OD2600003. Les horodatages prouvent que le connecteur a sérialisé les appels (même avec une attente de 12 secondes). Il ne s'agit PAS d'une validation de concurrence réelle.
- Première tentative : A obtient la pièce à 04:47:59.275895, termine à 04:48:03.280407 ; B démarre à 04:48:05.778114.
- Deuxième tentative : C obtient sa pièce à 04:48:25.976173, termine à 04:48:37.987653 ; D démarre à 04:48:39.670870.
- Connexion dblink ordinaire refusée pour absence d'identifiants SQL autorisés. Extension de test installée dans un schéma privé puis retirée. Aucun nouveau rôle créé.

## Reprise et clôture
- Annulation simulée avant commit : OD2600004 créée puis rollback ; 3 pièces demeurent, compteur 3 inchangé.
- Réessai même clé : OD2600004 créée sans trou de numérotation. Réessai après validation retourne la même pièce. Un autre utilisateur avec la même clé est refusé.
- Clôture octobre 2026 : jeton de contrôle obsolète rejeté après une écriture de 350 FCFA ; nouveau jeton accepté, clôture effective ; nouvelle écriture dans la période fermée refusée. Sous-transaction de clôture annulée.
- Nettoyage vérifié : 2 tenants, 2 profils, 61 pièces, 122 lignes, 0 utilisateur fictif restant.

## Correction préventive
Analyse du code : l'ordre journal puis mois de la saisie manuelle était inverse de celui d'une facture fournisseur, pouvant causer un interblocage notamment au premier mouvement d'un mois. Migration 20261126045014 : ordre mois puis journal, puis comptes et compteur. Tests 40,15,36,07,26 rejoués sans exception. Pas de preuve de suppression de tous les interblocages : reste à vérifier avec deux transactions réellement chevauchantes.

## Protocole à exécuter via deux sessions psql autorisées
Sur une base isolée fidèle, avec deux utilisateurs fictifs et aucun client réel, ouvrir deux connexions SQL indépendantes. Vérifier les PID et le chevauchement des timestamps (heure de début B antérieure au commit A). Dans A, ouvrir transaction, définir claims test, SET LOCAL ROLE authenticated, exécuter RPC de saisie avec une clé stable, garder transaction ouverte. Dans B, même opération avec même clé : doit attendre A ; après commit de A, B doit retourner la même pièce. Refaire avec rollback de A : B doit créer une seule pièce avec compteur cohérent. Refaire avec clés distinctes et deux utilisateurs, même journal : deux numéros uniques. Tester facture achat vs saisie AC au premier jour d'un mois sans ligne de période, clôture vs saisie (jeton obsolète ou refus écriture après clôture), avoir/remboursement vs autres opérations, règlement source identique. Contrôler pg_locks / pg_stat_activity sur le banc de test, les SQLSTATE, les compteurs, les écritures et les liens. En cas de deadlock ou de lock_timeout, vérifier rollback intégral et reprise. Nettoyer les seules fixtures. Tester aussi la coupure de connexion réelle (pas seulement exception SQL), le comportement navigateur et l'absence de double opération après rechargement.

Publication toujours bloquée par concurrence simultanée non démontrée, non-régressions POS/stock, restauration, volumétrie, fidélité de la branche et validation finale.
