# Prépublication — contrôle du 27 novembre 2026

## Décision : NO-GO production (recette historique locale validée)
Périmètre exclusif : Waarwi principal, projet bomiqqqfjpeyvvnwphgi. Lecture seule en production. Aucun merge, aucune migration distante, aucun déploiement.

## Preuves
- main : 326430d69688dcaf794b9de16de7f7b79409e6f8 ; candidat testé : 7da726c43be38d8ce5609091ec4f58c050aca288 ; 343 commits d'avance, 0 de retard ; comparaison GitHub retourne 275 fichiers.
- https://github.com/INTELLIGENCEPRO-TECHNOLOGIES/WAARWI/actions/runs/45914746871 : 516/516 migrations historiques, 54/54 candidats, fixture 110 lignes, 33/33 recettes, 0 échec. Les recettes 50,51,52,142 passent.
- https://github.com/INTELLIGENCEPRO-TECHNOLOGIES/WAARWI/actions/runs/45914746939 : Vite, tsc --noEmit -p tsconfig.app.json, 27/27 tests unitaires, 0 échec ni ignoré.
- Inventaire Supabase principal : ACTIVE_HEALTHY, PostgreSQL 17.6.1.113 ; 516 versions identiques dans le même ordre au manifeste. La parité de toutes les définitions et ACL n'est pas démontrée par le seul inventaire.
- Contrôle agrégé production : 375 pièces validées, 761 lignes, 0 pièce validée sans lignes ou avec écart débit/crédit/total supérieur à 0,005, 0 ligne orpheline (jointure tenant+pièce), 0 groupe source non nulle dupliqué (tenant/type/id). Référence avant déploiement, à reprendre sous gel des écritures.
- 98 enregistrements de sauvegarde applicative au statut verified ; max(verified_at) = 2026-11-11 04:54:24 UTC. Ceci ne confirme ni la fraîcheur d'une sauvegarde de base complète, ni sa restaurabilité, ni les sauvegardes gérées Supabase.

## Bloquants vérifiés et ordre de traitement
1. IPM/vente directe : Billing.tsx vers 1400–1467, création facture puis solde client, stock et insertion IPM dans des appels séparés, erreurs secondaires ignorées. Les retours non TVA vers 1876–1965 et 2741–2805 recalculent au prorata global et détachent le bordereau, sans transaction commune. Ne pas utiliser le prorata global si l'éligibilité diffère par ligne. Ne pas détacher un dossier transmis ou modifier silencieusement les créances déjà réglées.
2. Implémenter une transaction serveur idempotente pour la création directe et le cycle inverse IPM ; conserver parts par ligne, montants historiques, preuves et documents organisme. Cas à tester : article éligible/non éligible, TVA, acompte, facture émise ou réglée, rejet/écart, remboursement patient plafonné, stock et lots, erreur intermédiaire, réessai et concurrence. Pour les historiques indéterminés, rapprochement justifié plutôt que montant inventé. Vérifier POS et facturation desktop/mobile. Les tests 124/137 sont diagnostic et plafond, pas preuve du cycle complet.
3. Transformer les 54 candidats testés en migrations finales ordonnées, versionnées, avec empreintes ; exclure scripts réservés aux fixtures, à la reconstruction de la branche et doublons. Le manifeste integrated-replay-plan.json interdit son exécution directe en production. Ne pas rejouer les 516 migrations déjà appliquées. Refaire la recette sur l'ordre final et vérifier parité des objets de production, dépendances et droits.
4. Concurrence réelle à sessions distinctes, navigateur desktop/mobile, Realtime, V3 Edge/Storage, performance et revue métier SYSCOHADA restent à valider conformément à RELEASE-GATE.md. La réussite des 33 scripts ne clôt pas cette liste.
5. Avant accord de publication : confirmer sauvegarde complète récente et récupérable (base + composants nécessaires, Storage selon périmètre), définir fenêtre d'arrêt des écritures, contrôler version de main et SHA, préparer retour arrière coordonné base/interface (un rollback Netlify seul ne restaure pas le schéma), recontrôler agrégats et prendre un point de restauration. Tester procédure en environnement isolé ; aucun écrasement de production automatique. Une restauration après reprise des écritures impose traitement des écritures nouvelles.
6. Autorisation explicite avant toute migration de production et fusion Netlify. Après accord : contrôles de santé, droits et parcours représentatifs, surveillance et critères d'arrêt.

## Requête de référence (lecture seule)
```sql
WITH sums AS (
 SELECT entry_id,tenant_id,count(*) AS n,sum(debit) AS d,sum(credit) AS c
 FROM public.journal_lines GROUP BY entry_id,tenant_id
), checks AS (
 SELECT e.id,e.tenant_id,e.status,e.total_debit,e.total_credit,s.n,s.d,s.c
 FROM public.journal_entries e LEFT JOIN sums s ON s.entry_id=e.id AND s.tenant_id=e.tenant_id
), dup AS (
 SELECT tenant_id,source_type,source_id,count(*) n FROM public.journal_entries
 WHERE source_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1
)
SELECT (SELECT count(*) FROM checks) AS entries,
 (SELECT count(*) FROM public.journal_lines) AS lines,
 (SELECT count(*) FROM checks WHERE status='posted') AS posted_entries,
 (SELECT count(*) FROM checks WHERE status='posted' AND
 (n IS NULL OR abs(coalesce(d,0)-coalesce(c,0))>0.005
 OR abs(coalesce(d,0)-coalesce(total_debit,0))>0.005
 OR abs(coalesce(c,0)-coalesce(total_credit,0))>0.005)) AS posted_anomalies,
 (SELECT count(*) FROM public.journal_lines l WHERE NOT EXISTS
 (SELECT 1 FROM public.journal_entries e WHERE e.id=l.entry_id AND e.tenant_id=l.tenant_id)) AS orphan_lines,
 (SELECT count(*) FROM dup) AS duplicate_source_groups,
 (SELECT count(*) FROM public.tenant_backups WHERE status::text='verified') AS verified_backup_records,
 (SELECT max(verified_at) FROM public.tenant_backups WHERE status::text='verified') AS latest_verified_backup;
```
