/*
# Landing page configuration and public stats

1. New Tables
- `landing_config` — single-row config table (id = 'default') storing all editable
  content for the public Waarwi marketing landing page (hero text, CTA, image,
  stats labels, features JSONB, footer tagline).
  Columns:
  - id (text PK, always 'default')
  - hero_headline (text) — first line of hero title
  - hero_accent (text) — accented (teal) part of hero title
  - hero_subtitle (text) — hero subtitle
  - hero_cta_label (text) — primary CTA button label
  - hero_cta_url (text) — primary CTA target URL
  - hero_image_url (text) — hero product mockup image URL
  - stats_label_tenants (text) — label under tenants counter
  - stats_label_sectors (text) — label under sectors counter
  - stats_label_uptime (text) — label under uptime counter
  - pricing_visible (boolean, default true) — show pricing section
  - features (jsonb) — array of {icon, title, desc}
  - footer_tagline (text) — footer tagline line
  - updated_at (timestamptz)
  - updated_by (uuid, nullable)

2. New Functions
- `get_landing_stats()` — SECURITY DEFINER, public. Returns live aggregate counts:
  active_tenants (approved + is_active), active_sectors (distinct
  business_activity_type_id used by approved+active tenants), uptime_percent
  (hardcoded 99.9 for now, sourced from landing_config in future).

3. Security
- Enable RLS on `landing_config`.
- SELECT policy: public read (anon + authenticated) — the landing page is public.
- INSERT/UPDATE/DELETE policy: super_admin only (via JWT raw_app_meta_data.role).
- `get_landing_stats` is SECURITY DEFINER so anon can read aggregated counts
  without needing direct table access to tenants.

4. Seed
- Insert default row with content migrated from platform_login_config headline
  and the 9 default app features.
*/

CREATE TABLE IF NOT EXISTS landing_config (
  id text PRIMARY KEY DEFAULT 'default',
  hero_headline text NOT NULL DEFAULT '',
  hero_accent text NOT NULL DEFAULT '',
  hero_subtitle text NOT NULL DEFAULT '',
  hero_cta_label text NOT NULL DEFAULT 'Démarrer gratuitement',
  hero_cta_url text NOT NULL DEFAULT '/login',
  hero_image_url text NOT NULL DEFAULT '',
  stats_label_tenants text NOT NULL DEFAULT 'Businesss accompagnés',
  stats_label_sectors text NOT NULL DEFAULT 'Secteurs couverts',
  stats_label_uptime text NOT NULL DEFAULT 'Disponibilité',
  pricing_visible boolean NOT NULL DEFAULT true,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  footer_tagline text NOT NULL DEFAULT 'Conçu au Sénégal, propulsé par INTELLIGENCEPRO TECHNOLOGIES',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE landing_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Lecture publique de la config landing" ON landing_config;
CREATE POLICY "Lecture publique de la config landing"
ON landing_config FOR SELECT
TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Super admin peut gérer la config landing" ON landing_config;
CREATE POLICY "Super admin peut gérer la config landing"
ON landing_config FOR ALL
TO authenticated
USING ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'super_admin')
WITH CHECK ((auth.jwt() -> 'raw_app_meta_data' ->> 'role') = 'super_admin');

-- Public aggregated stats for the landing page (no sensitive data exposed)
CREATE OR REPLACE FUNCTION get_landing_stats()
RETURNS TABLE (
  active_tenants bigint,
  active_sectors bigint,
  uptime_percent numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM tenants
       WHERE approval_status = 'approved' AND is_active = true) AS active_tenants,
    (SELECT count(DISTINCT business_activity_type_id) FROM tenants
       WHERE approval_status = 'approved' AND is_active = true
         AND business_activity_type_id IS NOT NULL) AS active_sectors,
    99.9::numeric AS uptime_percent;
END;
$$;

GRANT EXECUTE ON FUNCTION get_landing_stats() TO anon, authenticated;

-- Seed default row (idempotent: only insert if table is empty)
INSERT INTO landing_config (id, hero_headline, hero_accent, hero_subtitle, hero_image_url, features)
SELECT
  'default',
  'La plateforme qui simplifie, connecte et propulse',
  'votre business.',
  'Gestion commerciale tout-en-un : caisse, stock, facturation, comptabilité et boutique en ligne. Conçu pour les commerçants sénégalais.',
  '/desktop.png',
  '[
    {"icon":"ShoppingCart","title":"Point de vente","desc":"Caisse rapide et intuitive, encaissement multi-moyens, sessions de caisse sécurisées."},
    {"icon":"Package","title":"Stock & inventaire","desc":"Suivi en temps réel, alertes de rupture, gestion par lot et par site."},
    {"icon":"FileText","title":"Facturation","desc":"Devis, factures, avoirs et retours conformes, conversion en vente en un clic."},
    {"icon":"Users","title":"Clients & tiers","desc":"CRM complet, suivi des créances, plafonds de crédit et historique d''achat."},
    {"icon":"Truck","title":"Fournisseurs","desc":"Commandes d''achat, réception, suivi des dettes et règlements."},
    {"icon":"Globe","title":"Boutique en ligne","desc":"Vitrine web personnalisée, commandes en ligne, paiement à la livraison."},
    {"icon":"BarChart3","title":"Comptabilité","desc":"Plan comptable SYSCOHADA, journal, balance, grand livre et clôture."},
    {"icon":"TrendingUp","title":"Rapports","desc":"Tableaux de bord, analyses de ventes, marges et performance par produit."},
    {"icon":"Shield","title":"Sécurité & rôles","desc":"Permissions granulaires par utilisateur, journaux d''activité, sauvegardes."}
  ]'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM landing_config);
