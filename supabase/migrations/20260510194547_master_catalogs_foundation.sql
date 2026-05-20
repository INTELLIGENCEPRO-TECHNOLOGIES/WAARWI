/*
  # Catalogues maîtres - Fondations

  1. Nouvelles tables
    - `business_activity_types` : Types d'activités (Électroménager, Pièces auto, etc.)
      - id, name, slug, description, is_active, created_at
    - `master_catalogs` : Un catalogue maître par type d'activité
      - id, business_activity_type_id, name, description, is_active, created_at
    - `master_catalog_categories` : Arborescence de catégories (parent_id pour sous-cat)
      - id, master_catalog_id, name, slug, parent_id, sort_order, is_active
    - `master_catalog_items` : Articles du catalogue maître
      - id, master_catalog_id, category_id, subcategory_id, manufacturer_ref,
        designation, brand, model, unit, purchase_price, sale_price, vat_rate,
        barcode, description, image_url, source_url, source_name,
        reliability_level, is_active, created_at
      - UNIQUE(master_catalog_id, brand, manufacturer_ref) pour empêcher doublons

  2. Colonnes ajoutées à `articles`
    - `master_catalog_item_id` (uuid nullable, lien de traçabilité)
    - `manufacturer_ref` (text nullable)
    - `model` (text nullable)
    - `business_activity_type_id` (uuid nullable)
    Note : `brand` existe déjà, `oem_ref` existe (sera aussi rempli), on réutilise.

  3. Colonne ajoutée à `tenants`
    - `business_activity_type_id` (uuid nullable, FK vers business_activity_types)
    Le champ `business_type` texte existant reste en place.

  4. Sécurité
    - RLS activé sur toutes les nouvelles tables
    - Lecture ouverte aux tenants (authentifiés) pour browsing des catalogues
    - Écriture réservée aux super admins (is_super_admin)

  5. Seed
    - Création de types d'activités de base
    - Mapping automatique entre business_type texte et business_activity_type_id
*/

-- ─── 1. Types d'activités ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.business_activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text DEFAULT '',
  legacy_business_type text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_activity_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Activity types readable by authenticated" ON public.business_activity_types;
CREATE POLICY "Activity types readable by authenticated"
  ON public.business_activity_types FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Activity types insert super admin" ON public.business_activity_types;
CREATE POLICY "Activity types insert super admin"
  ON public.business_activity_types FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Activity types update super admin" ON public.business_activity_types;
CREATE POLICY "Activity types update super admin"
  ON public.business_activity_types FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Activity types delete super admin" ON public.business_activity_types;
CREATE POLICY "Activity types delete super admin"
  ON public.business_activity_types FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- Seed
INSERT INTO public.business_activity_types (name, slug, description, legacy_business_type) VALUES
  ('Pièces détachées automobiles', 'auto_parts', 'Vente de pièces auto, accessoires, lubrifiants', 'auto_parts'),
  ('Électroménager', 'electromenager', 'Gros et petit électroménager, audio, vidéo', 'electronics'),
  ('Quincaillerie', 'quincaillerie', 'Outils, visserie, plomberie, électricité', 'generic'),
  ('Mercerie', 'mercerie', 'Fils, tissus, boutons, accessoires couture', 'generic'),
  ('Alimentaire', 'alimentaire', 'Épicerie, boissons, produits frais', 'grocery'),
  ('Textile / Prêt-à-porter', 'textile', 'Vêtements, chaussures, accessoires', 'fashion'),
  ('Cosmétique / Beauté', 'cosmetique', 'Soins, maquillage, parfumerie', 'generic'),
  ('Librairie / Papeterie', 'librairie', 'Livres, fournitures scolaires, bureau', 'generic'),
  ('Services', 'services', 'Prestations de services', 'services')
ON CONFLICT (slug) DO NOTHING;

-- ─── 2. Colonne business_activity_type_id sur tenants ──────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'business_activity_type_id'
  ) THEN
    ALTER TABLE public.tenants ADD COLUMN business_activity_type_id uuid
      REFERENCES public.business_activity_types(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill automatique basé sur business_type existant
UPDATE public.tenants t
SET business_activity_type_id = bat.id
FROM public.business_activity_types bat
WHERE t.business_activity_type_id IS NULL
  AND bat.legacy_business_type = t.business_type;

-- ─── 3. Catalogues maîtres ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.master_catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_activity_type_id uuid NOT NULL REFERENCES public.business_activity_types(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_master_catalogs_type ON public.master_catalogs(business_activity_type_id);
ALTER TABLE public.master_catalogs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Master catalogs readable" ON public.master_catalogs;
CREATE POLICY "Master catalogs readable"
  ON public.master_catalogs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Master catalogs insert super admin" ON public.master_catalogs;
CREATE POLICY "Master catalogs insert super admin"
  ON public.master_catalogs FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Master catalogs update super admin" ON public.master_catalogs;
CREATE POLICY "Master catalogs update super admin"
  ON public.master_catalogs FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Master catalogs delete super admin" ON public.master_catalogs;
CREATE POLICY "Master catalogs delete super admin"
  ON public.master_catalogs FOR DELETE TO authenticated USING (public.is_super_admin());

-- Seed : un catalogue par type d'activité
INSERT INTO public.master_catalogs (business_activity_type_id, name, description)
SELECT id, 'Catalogue ' || name, 'Catalogue maître par défaut pour ' || name
FROM public.business_activity_types
WHERE NOT EXISTS (
  SELECT 1 FROM public.master_catalogs mc WHERE mc.business_activity_type_id = business_activity_types.id
);

-- ─── 4. Catégories / Sous-catégories ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.master_catalog_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_catalog_id uuid NOT NULL REFERENCES public.master_catalogs(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  parent_id uuid REFERENCES public.master_catalog_categories(id) ON DELETE CASCADE,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_catalog_id, parent_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_master_cat_cat_catalog ON public.master_catalog_categories(master_catalog_id);
CREATE INDEX IF NOT EXISTS idx_master_cat_cat_parent ON public.master_catalog_categories(parent_id);

ALTER TABLE public.master_catalog_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Master categories readable" ON public.master_catalog_categories;
CREATE POLICY "Master categories readable"
  ON public.master_catalog_categories FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Master categories insert super admin" ON public.master_catalog_categories;
CREATE POLICY "Master categories insert super admin"
  ON public.master_catalog_categories FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Master categories update super admin" ON public.master_catalog_categories;
CREATE POLICY "Master categories update super admin"
  ON public.master_catalog_categories FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Master categories delete super admin" ON public.master_catalog_categories;
CREATE POLICY "Master categories delete super admin"
  ON public.master_catalog_categories FOR DELETE TO authenticated USING (public.is_super_admin());

-- ─── 5. Articles du catalogue maître ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.master_catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_catalog_id uuid NOT NULL REFERENCES public.master_catalogs(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.master_catalog_categories(id) ON DELETE SET NULL,
  subcategory_id uuid REFERENCES public.master_catalog_categories(id) ON DELETE SET NULL,
  manufacturer_ref text NOT NULL DEFAULT '',
  designation text NOT NULL,
  brand text NOT NULL DEFAULT '',
  model text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'pièce',
  purchase_price numeric NOT NULL DEFAULT 0,
  sale_price numeric NOT NULL DEFAULT 0,
  vat_rate numeric NOT NULL DEFAULT 0,
  barcode text DEFAULT '',
  description text DEFAULT '',
  image_url text DEFAULT '',
  source_url text DEFAULT '',
  source_name text DEFAULT '',
  reliability_level text DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_master_items_ref
  ON public.master_catalog_items(master_catalog_id, lower(brand), lower(manufacturer_ref))
  WHERE manufacturer_ref <> '';

CREATE INDEX IF NOT EXISTS idx_master_items_catalog ON public.master_catalog_items(master_catalog_id);
CREATE INDEX IF NOT EXISTS idx_master_items_category ON public.master_catalog_items(category_id);
CREATE INDEX IF NOT EXISTS idx_master_items_subcategory ON public.master_catalog_items(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_master_items_brand ON public.master_catalog_items(brand);

ALTER TABLE public.master_catalog_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Master items readable" ON public.master_catalog_items;
CREATE POLICY "Master items readable"
  ON public.master_catalog_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Master items insert super admin" ON public.master_catalog_items;
CREATE POLICY "Master items insert super admin"
  ON public.master_catalog_items FOR INSERT TO authenticated WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Master items update super admin" ON public.master_catalog_items;
CREATE POLICY "Master items update super admin"
  ON public.master_catalog_items FOR UPDATE TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Master items delete super admin" ON public.master_catalog_items;
CREATE POLICY "Master items delete super admin"
  ON public.master_catalog_items FOR DELETE TO authenticated USING (public.is_super_admin());

-- ─── 6. Colonnes ajoutées à articles ───────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='articles' AND column_name='master_catalog_item_id') THEN
    ALTER TABLE public.articles ADD COLUMN master_catalog_item_id uuid REFERENCES public.master_catalog_items(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='articles' AND column_name='manufacturer_ref') THEN
    ALTER TABLE public.articles ADD COLUMN manufacturer_ref text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='articles' AND column_name='model') THEN
    ALTER TABLE public.articles ADD COLUMN model text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='articles' AND column_name='business_activity_type_id') THEN
    ALTER TABLE public.articles ADD COLUMN business_activity_type_id uuid REFERENCES public.business_activity_types(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_articles_master_item ON public.articles(master_catalog_item_id);
