/*
# App Releases - Dynamic Update Notification System

1. New Tables
  - `app_releases`
    - `id` (uuid, primary key)
    - `version` (text, unique, not null) - semantic version string
    - `title` (text, not null) - release title
    - `release_date` (date, not null) - date of the release
    - `features` (jsonb, default []) - array of feature descriptions
    - `fixes` (jsonb, default []) - array of fix descriptions
    - `is_published` (boolean, default false) - only published releases are shown
    - `created_at` (timestamptz)
    - `published_at` (timestamptz) - when it was published

2. Security
  - RLS enabled
  - Authenticated users can SELECT published releases
  - Platform admins (role = 'super_admin') manage releases

3. Notes
  - The `features` and `fixes` columns store JSON arrays of strings
  - Only published releases appear to end users
*/

CREATE TABLE IF NOT EXISTS app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text UNIQUE NOT NULL,
  title text NOT NULL DEFAULT 'Mise à jour',
  release_date date NOT NULL DEFAULT CURRENT_DATE,
  features jsonb NOT NULL DEFAULT '[]'::jsonb,
  fixes jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);

ALTER TABLE app_releases ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read published releases
DROP POLICY IF EXISTS "select_published_releases" ON app_releases;
CREATE POLICY "select_published_releases" ON app_releases FOR SELECT
  TO authenticated
  USING (is_published = true);

-- Platform admins (role = 'super_admin') can do full CRUD
DROP POLICY IF EXISTS "admin_select_releases" ON app_releases;
CREATE POLICY "admin_select_releases" ON app_releases FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  );

DROP POLICY IF EXISTS "admin_insert_releases" ON app_releases;
CREATE POLICY "admin_insert_releases" ON app_releases FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  );

DROP POLICY IF EXISTS "admin_update_releases" ON app_releases;
CREATE POLICY "admin_update_releases" ON app_releases FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  );

DROP POLICY IF EXISTS "admin_delete_releases" ON app_releases;
CREATE POLICY "admin_delete_releases" ON app_releases FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'super_admin')
  );

-- Seed initial release
INSERT INTO app_releases (version, title, release_date, features, fixes, is_published, published_at)
VALUES (
  '2.4.0',
  'Mise à jour majeure',
  '2026-07-03',
  '["Module Transfert d''argent complet avec gestion des grossistes et points de service", "Crédit téléphonique intégré au module transfert", "Notification de mise à jour automatique"]'::jsonb,
  '["Correction de l''affichage des règlements factures dans les statistiques de session", "Correction du solde comptable client/fournisseur dans Gestion des Tiers", "Correction du X de caisse : total encaissé reflète maintenant les paiements réels", "Correction de la facturation plein écran : le solde client est mis à jour correctement"]'::jsonb,
  true,
  now()
) ON CONFLICT (version) DO NOTHING;
