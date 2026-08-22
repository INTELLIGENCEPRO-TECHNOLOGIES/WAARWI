/*
# Extend platform_login_config with editorial fields for premium login page

1. Modified Tables
  - `platform_login_config`
    - `eyebrow` (text) — small text above the main headline
    - `text_accents` (jsonb) — array of accent segments: [{text, effect, color}]
    - `carousel_interval_ms` (integer) — auto-rotation timing in ms
    - `login_title` (text) — title shown in the login zone
    - `login_subtitle` (text) — subtitle shown in the login zone
    - `footer_links` (jsonb) — array of footer link objects
    - `footer_copyright` (text) — copyright text

2. Important Notes
  - All new columns have defaults so existing rows are unaffected
  - text_accents supports effects: underline, paint, splash, brush, highlight
  - Each accent has: text (string to match), effect (string), color (string)
*/

ALTER TABLE platform_login_config
  ADD COLUMN IF NOT EXISTS eyebrow text DEFAULT 'LA PLATEFORME QUI AVANCE AVEC VOUS',
  ADD COLUMN IF NOT EXISTS text_accents jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS carousel_interval_ms integer DEFAULT 4000,
  ADD COLUMN IF NOT EXISTS login_title text DEFAULT 'Accédez à votre espace',
  ADD COLUMN IF NOT EXISTS login_subtitle text DEFAULT 'Connectez-vous pour gérer votre activité.',
  ADD COLUMN IF NOT EXISTS footer_links jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS footer_copyright text DEFAULT '';
