# Phase 10.11 — Recette commerciale — 26/11/2026

Base de recette isolée uniquement. Les sources commerciales ont été insérées comme fixtures par le rôle SQL administrateur, puis les RPC de comptabilisation exécutées sous authenticated (dépense : fonction interne, avec claims de test). Les fixtures sont intégralement annulées. Pas de preuve de création des documents via le POS, ni de non-régression du stock.

## Scénario 1
| Source | Pièce | Débit = crédit | Lignes (compte, D, C) |
|---|---|---:|---|
| Vente | VE2600001 | 118000 | 4110001 118000/0; 7010000 0/100000; 4431000 0/18000 |
| Achat | AC2600001 | 80000 | 6010000 80000/0; 4010001 0/80000 |
| Paiement facture | CA2600001 | 50000 | 5710000 50000/0; 4110001 0/50000 |
| Paiement solde | CA2600002 | 10000 | 5710000 10000/0; 4110001 0/10000 |
| Paiement fournisseur | CA2600003 | 30000 | 4010001 30000/0; 5710000 0/30000 |
| Dépense | CA2600004 | 2500 | 6580000 2500/0; 5710000 0/2500 |
| Avoir 1 | VE2600002 | 23600 | 7010000 20000/0; 4431000 3600/0; 4110001 0/23600 |
| Avoir 2 | VE2600003 | 11800 | 7010000 10000/0; 4431000 1800/0; 4110001 0/11800 |

Réessais vente/achat/paiements/avoir/dépense sans nouvelle pièce ; vente incohérente, période clôturée, vente inter-tenant, cumul avoirs excessif refusés. Aucun lien comptable créé pour les sources rejetées. 8 pièces équilibrées, total 325900 FCFA par côté. Rollback vérifié.

## Scénario 2
Facture fournisseur TTC 118000, HT 100000, TVA 18000 dont 50% déductible : débit 6010000 109000, débit 4452000 9000, crédit 4010001 118000. Réessai retourne même pièce.
Avoir avec remboursement 23600 : VE2600002 et CA2600001 ; lien du mouvement de caisse correct ; réessai retourne même avoir. Absence de mouvement correspondant : exception et zéro pièce résiduelle pour l'avoir. Facture exercice antérieur ouvert initialement refusée par ancienne restriction.

## Correctif 20261126042544
Suppression du verrou obsolète d'année courante pour facture d'achat ; la numérotation datée et le verrou mensuel/annuel restent en place. Message explicite pour remboursement absent/ambigu. Rejeu : AC2500001 créée, réessai identique, novembre 2025 clôturé refusé, remboursement absent rejeté avec message français, zéro pièce pour sources rejetées ; rollback vérifié.
CI précédent 897ed40 : Vite et tests unitaires réussis ; TypeScript 279 diagnostics globaux, zéro diagnostic dans pages/Accounting, composants Accounting et lib/accounting (contrôle de log). Ne pas assimiler à validation globale.

Restant : parcours de création commerciale réels (POS, achats, mouvements de stock, validation de retour), API publique de caisse, tests coffre et rapprochement des encaissements, concurrence multisession, restauration et volumétrie, fidélité du schéma, navigateur, revue métier et correction/triage TypeScript global. Aucune publication.
