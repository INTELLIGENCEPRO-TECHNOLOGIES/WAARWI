/*
  # Add slogan field to tenants table

  Adds a `slogan` column to the tenants table so each business can define
  their own tagline/slogan displayed in the login animation and app header.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'slogan'
  ) THEN
    ALTER TABLE tenants ADD COLUMN slogan text DEFAULT '';
  END IF;
END $$;
