/*
  # User-to-site assignment

  Adds an `assigned_site_ids` column to profiles:
  - NULL or empty array means "all sites" (backward compatible for existing users)
  - Non-empty array restricts the user to only those site IDs
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS assigned_site_ids uuid[] DEFAULT NULL;

COMMENT ON COLUMN profiles.assigned_site_ids IS 
  'Array of site IDs this user can access. NULL = all sites (unrestricted).';
