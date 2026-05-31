/*
  # Move login background to platform_login_config

  1. Modified Tables
    - `platform_login_config`
      - `login_bg_url` (text, nullable) - Background image URL for login page

  2. Notes
    - Background image is a global platform setting, not per-tenant
    - Managed from the "Ecran d'accueil" admin section
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'platform_login_config' AND column_name = 'login_bg_url'
  ) THEN
    ALTER TABLE platform_login_config ADD COLUMN login_bg_url text;
  END IF;
END $$;
