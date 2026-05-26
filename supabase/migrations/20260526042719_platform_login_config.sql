/*
  # Configuration personnalisable de l'écran de connexion

  1. Nouvelle table
    - `platform_login_config`
      - `id` (text, primary key) — toujours 'default' (singleton)
      - `headline` (text) — titre principal de la page de connexion
      - `headline_accent` (text) — partie accentuée du titre (en gradient)
      - `subtitle` (text) — sous-titre descriptif
      - `modules` (jsonb) — liste des modules métier affichés (icône, label, description)
      - `updated_at` (timestamptz) — date de dernière modification
      - `updated_by` (uuid) — qui a modifié

  2. Sécurité
    - RLS activé
    - Lecture publique (anon + authenticated) — nécessaire pour l'écran de connexion
    - Écriture réservée aux super_admin via edge function (service role)

  3. Données par défaut
    - Insert d'une ligne 'default' avec la config initiale WAARWI
*/

CREATE TABLE IF NOT EXISTS platform_login_config (
  id text PRIMARY KEY DEFAULT 'default',
  headline text NOT NULL DEFAULT 'Gérez votre business,',
  headline_accent text NOT NULL DEFAULT 'tout-en-un.',
  subtitle text NOT NULL DEFAULT 'POS, stocks, facturation, comptabilité et boutique en ligne — une seule plateforme pour piloter votre activité.',
  modules jsonb NOT NULL DEFAULT '[
    {"icon": "Zap", "label": "Point de vente", "desc": "Caisse rapide et intuitive"},
    {"icon": "Package", "label": "Gestion de stock", "desc": "Mouvements et inventaire"},
    {"icon": "Receipt", "label": "Facturation", "desc": "Devis et factures pro"},
    {"icon": "Globe", "label": "Boutique en ligne", "desc": "Vitrine et commandes"},
    {"icon": "BarChart3", "label": "Comptabilité", "desc": "Suivi financier complet"},
    {"icon": "Shield", "label": "Sécurité avancée", "desc": "Rôles et permissions"}
  ]'::jsonb,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

ALTER TABLE platform_login_config ENABLE ROW LEVEL SECURITY;

-- Lecture publique nécessaire : la page de connexion est vue par des utilisateurs non connectés
CREATE POLICY "Lecture publique de la config login"
  ON platform_login_config
  FOR SELECT
  TO anon, authenticated
  USING (id = 'default');

-- Insertion de la config par défaut
INSERT INTO platform_login_config (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;
