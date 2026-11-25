# Lot comptable en attente de publication

Ne pas fusionner dans main, ni appliquer en production, sans demande explicite.
Les fichiers de ce dossier sont des candidats, hors du répertoire des migrations automatiques.

## Ordre de publication
1. Vérifier l'état du dépôt, les migrations déjà appliquées et les sauvegardes.
2. Appliquer 01-alphabetical-matching.sql puis 02-manual-entry-reversal.sql puis 04-bank-reconciliation.sql puis 06-fiscal-year-close.sql puis 08-financial-cash-flow-working.sql et 09-financial-workpapers.sql dans un environnement autorisé ; enregistrer les versions réelles dans supabase/migrations.
3. Exécuter la recette transactionnelle 03-recipe.sql puis 05-bank-reconciliation-recipe.sql puis 07-fiscal-year-recipe.sql et 10-financial-workpapers-recipe.sql puis contrôler la restauration (ancienne et nouvelle sauvegardes, groupes de lettrage, clôtures).
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

## États financiers de travail
- Bilan agrégé, compte de résultat en cascade (XA à XI), comparatifs N/N-1, export XLSX et impression de l'onglet courant. Six scénarios de calcul exécutés sur le code GitHub via un harnais d’assertions JS ; requêtes de vérification sur les écritures existantes effectuées en lecture seule.
- La ventilation directe de trésorerie isole les écritures ambiguës ; elle n'est pas le tableau réglementaire SYSCOHADA par méthode indirecte. Les correspondances détaillées du bilan (brut, amortissements/dépréciations, net), le tableau réglementaire des flux, les notes annexes et la validation de l'inventaire restent nécessaires avant de qualifier une liasse de conforme.
- Aucun état ne doit être présenté comme certifié. Tester les RPC, l'export XLSX, l'impression PDF, les comparatifs et l'isolation après migrations autorisées. Exécuter node --test tests/accountingFinancialStatements.test.mjs.

## Dossier détaillé
- Ventilation de l’actif brut, corrections de valeur, net N/N-1 ; correspondances par préfixes à vérifier selon le plan détaillé.
- Tableau de travail indirect ZA à ZH avec propositions limitées, saisies justifiées, contrôle de trésorerie et valeurs manquantes explicites. La référence de trésorerie reste indicative (retraitements du référentiel à vérifier).
- Trame qualitative des notes annexes, sauvegarde versionnée par tenant/exercice et export XLSX dédié. Pas de certification, ni de liasse officielle exhaustive. Les tableaux annexes normalisés et retraitements complexes doivent être vérifiés ou complétés.
- Exécuter node --test tests/accountingStatutoryWorking.test.mjs, puis recette SQL 10 après autorisation. Les six assertions JS ont réussi sur le code enregistré ; les balances actuelles des deux tenants ont été vérifiées en lecture seule.
