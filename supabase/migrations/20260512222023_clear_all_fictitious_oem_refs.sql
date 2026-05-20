/*
  # Suppression de toutes les références OEM fictives

  1. Contexte
    Les références constructeur stockées dans le seed initial (articles et catalogue
    maître) ont été générées artificiellement. Elles ne correspondent pas aux vraies
    références OEM (exemple confirmé : Aile avant droite BMW X5 G05 2019+ stockée
    comme 41007483000 alors que la vraie OEM est 41007492364).
    Pour ne pas induire les clients en erreur, on vide tout le champ.

  2. Modifications
    - `articles.oem_ref` : mis à '' pour toutes les lignes.
    - `master_catalog_items.manufacturer_ref` : mis à '' pour toutes les lignes.

  3. Sécurité / Données
    - Aucun DROP, aucune suppression de ligne.
    - Les utilisateurs pourront re-saisir manuellement les vraies références OEM
      via l'écran Articles ou via une ré-importation Excel/CSV vérifiée.
*/

UPDATE public.articles
SET oem_ref = ''
WHERE oem_ref IS NOT NULL AND oem_ref <> '';

UPDATE public.master_catalog_items
SET manufacturer_ref = ''
WHERE manufacturer_ref IS NOT NULL AND manufacturer_ref <> '';
