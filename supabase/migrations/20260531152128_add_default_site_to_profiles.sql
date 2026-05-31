/*
  # Add default_site_id to profiles

  ## Changes
  - Adds `default_site_id` column to `profiles` table
    - nullable uuid referencing sites(id)
    - allows per-user persistent default site across devices

  ## Notes
  - Existing rows get NULL (will fall back to first site or localStorage)
  - RLS: users can update their own profile's default_site_id via existing policy
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'default_site_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN default_site_id uuid REFERENCES sites(id) ON DELETE SET NULL;
  END IF;
END $$;
