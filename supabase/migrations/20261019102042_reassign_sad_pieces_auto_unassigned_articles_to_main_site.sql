/*
# Rattacher les articles sans magasin de SAD Pieces Auto au magasin SAD PIECES AUTO

1. Contexte
  - Le tenant SAD Pieces Auto est passé en catalogue indépendant (shared_articles = false)
    après l'ajout du magasin SALOUM BOUTIQUE.
  - 361 articles anciens avaient site_id NULL et devenaient invisibles partout.
2. Données modifiées
  - articles.site_id : NULL -> site SAD PIECES AUTO (597e7936-...), uniquement pour ce tenant.
  - 360 de ces articles ont leur stock sur ce site, 84 y ont des ventes, aucun lié à SALOUM BOUTIQUE.
3. Sécurité
  - Aucun changement de schéma ni de RLS. Aucune suppression.
  - Vérifié : aucun conflit de référence interne avec les articles déjà rattachés au site.
*/
UPDATE public.articles
SET site_id = '597e7936-3e33-4d50-b715-a3d75aa21690'
WHERE tenant_id = '66ce2dfd-96bb-4ab6-815e-1b583e064fbc'
  AND site_id IS NULL;