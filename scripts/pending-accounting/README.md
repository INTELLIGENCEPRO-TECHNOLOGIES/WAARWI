# Lot comptable en attente de publication

Ne pas fusionner dans main, ni appliquer en production, sans demande explicite.
Les fichiers de ce dossier sont des candidats, hors du répertoire des migrations automatiques.

## Ordre de publication
1. Vérifier l'état du dépôt, les migrations déjà appliquées et les sauvegardes.
2. Appliquer 01-alphabetical-matching.sql puis 02-manual-entry-reversal.sql dans un environnement autorisé ; enregistrer les versions réelles dans supabase/migrations.
3. Exécuter la recette transactionnelle 03-recipe.sql et contrôler la restauration (ancienne et nouvelle sauvegardes, groupes de lettrage, clôtures).
4. Vérifier les tests supplémentaires : groupes délettrés non réutilisés, groupes concurrents, refus des écritures commerciales, refus période clôturée, droits inter-tenant, affichage/exports.
5. Compiler l'interface, intégrer les commits à main en une seule publication Netlify après autorisation.

## Périmètre
- Les codes alphabétiques sont persistés par compte et par groupe ; les anciens groupes sont repris dans l'ordre chronologique.
- L'extourne concerne les écritures manuelles validées. Les documents commerciaux doivent être corrigés par leur workflow source.
- Les écritures manuelles extournées conservent leur statut validé ; une contrepassation distincte les compense.
- Pas d'exécution SQL de ce lot en production au stade de développement.
- Les écarts du registre des sauvegardes (accounting_month_closures, tenant_subscription_payments) étaient préexistants et restent à traiter avant la recette complète de restauration.
