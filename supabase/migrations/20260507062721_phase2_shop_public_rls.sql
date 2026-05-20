
/*
  # Phase 2 — RLS Lecture publique boutique en ligne

  ## Résumé
  Policies anon pour que la boutique publique (/shop/:tenantSlug)
  puisse lire les données nécessaires à l'affichage du catalogue,
  uniquement pour les tenants avec boutique active.

  ## Tables concernées
  - articles (actifs uniquement)
  - stock_levels (quantity)
  - part_categories (actives)
  - vehicle_brands (actives)
  - vehicle_models
  - article_compatibilities
  - tenants (nom, logo, public_slug uniquement — pas de données sensibles)

  ## Règle pivot
  Toutes les policies anon sont conditionnées par :
    tenant_id IN (SELECT tenant_id FROM shop_settings WHERE is_active = true)
  Ce qui garantit qu'un tenant sans boutique activée n'expose rien.
*/

-- articles : lecture publique articles actifs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'articles' AND policyname = 'articles public read active shop'
  ) THEN
    CREATE POLICY "articles public read active shop"
      ON articles FOR SELECT TO anon
      USING (
        is_active = true
        AND tenant_id IN (
          SELECT tenant_id FROM shop_settings WHERE is_active = true
        )
      );
  END IF;
END $$;

-- stock_levels : lecture publique
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'stock_levels' AND policyname = 'stock_levels public read shop'
  ) THEN
    CREATE POLICY "stock_levels public read shop"
      ON stock_levels FOR SELECT TO anon
      USING (
        tenant_id IN (
          SELECT tenant_id FROM shop_settings WHERE is_active = true
        )
      );
  END IF;
END $$;

-- part_categories : lecture publique
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'part_categories' AND policyname = 'part_categories public read shop'
  ) THEN
    CREATE POLICY "part_categories public read shop"
      ON part_categories FOR SELECT TO anon
      USING (
        is_active = true
        AND tenant_id IN (
          SELECT tenant_id FROM shop_settings WHERE is_active = true
        )
      );
  END IF;
END $$;

-- vehicle_brands : lecture publique
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vehicle_brands' AND policyname = 'vehicle_brands public read shop'
  ) THEN
    CREATE POLICY "vehicle_brands public read shop"
      ON vehicle_brands FOR SELECT TO anon
      USING (
        is_active = true
        AND tenant_id IN (
          SELECT tenant_id FROM shop_settings WHERE is_active = true
        )
      );
  END IF;
END $$;

-- vehicle_models : lecture publique
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'vehicle_models' AND policyname = 'vehicle_models public read shop'
  ) THEN
    CREATE POLICY "vehicle_models public read shop"
      ON vehicle_models FOR SELECT TO anon
      USING (
        tenant_id IN (
          SELECT tenant_id FROM shop_settings WHERE is_active = true
        )
      );
  END IF;
END $$;

-- article_compatibilities : lecture publique
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'article_compatibilities' AND policyname = 'article_compatibilities public read shop'
  ) THEN
    CREATE POLICY "article_compatibilities public read shop"
      ON article_compatibilities FOR SELECT TO anon
      USING (
        tenant_id IN (
          SELECT tenant_id FROM shop_settings WHERE is_active = true
        )
      );
  END IF;
END $$;

-- tenants : lecture publique nom/logo pour la boutique
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'tenants' AND policyname = 'tenants public read shop slug'
  ) THEN
    CREATE POLICY "tenants public read shop slug"
      ON tenants FOR SELECT TO anon
      USING (
        public_slug IS NOT NULL
        AND id IN (
          SELECT tenant_id FROM shop_settings WHERE is_active = true
        )
      );
  END IF;
END $$;
