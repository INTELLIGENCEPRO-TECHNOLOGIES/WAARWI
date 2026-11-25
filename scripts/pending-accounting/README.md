# Lot comptable en attente de publication

Ne pas fusionner dans main, ni appliquer en production, sans demande explicite.
Les fichiers de ce dossier sont des candidats, hors du répertoire des migrations automatiques.

## Ordre de publication
1. Vérifier l'état du dépôt, les migrations déjà appliquées et les sauvegardes.
2. Appliquer 01-alphabetical-matching.sql puis 02-manual-entry-reversal.sql puis 04-bank-reconciliation.sql et 06-fiscal-year-close.sql dans un environnement autorisé ; enregistrer les versions réelles dans supabase/migrations.
3. Exécuter la recette transactionnelle 03-recipe.sql puis 05-bank-reconciliation-recipe.sql et 07-fiscal-year-recipe.sql puis contrôler la restauration (ancienne et nouvelle sauvegardes, groupes de lettrage, clôtures).
4. Vérifier les tests supplémentaires : groupes délettrés non réutilisés, groupes concurrents, refus des écritures commerciales, refus période clôturée, droits inter-tenant, affichage/exports.
5. Compiler l'interface, intégrer les commits à main en une seule publication Netlify après autorisation.

## Périmètre
- Les codes alphabétiques sont persistés par compte et par groupe ; les anciens groupes sont repris dans l'ordre chronologique.
- L'extourne concerne les écritures manuelles validées. Les documents commerciaux doivent être corrigés par leur workflow source.
- Les écritures manuelles extournées conservent leur statut validé ; une contrepassation distincte les compense.
- Pas d'exécution SQL de ce lot en production au stade de développement.
- Les écarts du registre des sauvegardes (accounting_month_closures, tenant_subscription_payments) étaient préexistants et restent à traiter avant la recette complète de restauration.

## Rapprochement bancaire
- Comptes 52, 53 et 55, relevé saisi manuellement, maximum 500 opérations, pointage un pour un sur montant signé identique.
- Premier relevé à une date dont le solde bancaire initial correspond déjà au solde comptable ; les écritures en circulation des relevés suivants sont reportées.
- La validation exige toutes les opérations bancaires pointées et un écart nul. Pas de création automatique d'écritures, pas de modification des relevés validés.
- Import CSV/Excel, pointage groupé, réouverture contrôlée et édition PDF restent à développer. Vérifier les procédures de restauration des nouvelles tables avant validation finale.

## Exercices et reports à nouveau
- Exercice civil, clôture chronologique après 12 clôtures mensuelles, contrôle des écritures, validation par jeton de révision.
- RAN certifiés en snapshot, sans mouvements artificiels ; classes 1 à 5 reportées, résultat de classes 6 à 8 repris sur le compte 131 ou 139 sélectionné. Le résultat n’est pas affecté automatiquement aux réserves ou dividendes.
- Interrogation par exercice : reprend le snapshot précédent lorsqu’il existe. Les anciennes éditions de mouvements restent distinctes ; les futurs états financiers doivent utiliser le même modèle d’ouverture.
- L’ancienne numérotation utilise l’année courante : son remplacement transversal par une numérotation datée doit être traité avant la gestion complète des saisies d’exercices antérieurs.
- L’intégrité des restaurations avec clôtures mensuelles/annuelles et les nouveaux rapprochements reste un prérequis de publication ; aucune restauration réelle n’a été exécutée.
