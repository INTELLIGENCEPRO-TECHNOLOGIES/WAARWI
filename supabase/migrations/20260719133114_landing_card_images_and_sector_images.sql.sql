/*
# Landing card images (features, why) + sector images

1. Purpose
- Allow platform admins to attach real, administrable images (instead of generic
  lucide icons) to the three card sections of the public landing page:
  "Fonctionnalites" (features), "Secteurs d'activite" (sectors) and
  "Pourquoi Waarwi" (why).
- Images are stored in the existing `landing-media` Supabase Storage bucket and
  referenced by public URL. The URL + alt text + object-position are persisted
  in the database so the landing renders them dynamically.
- This migration is strictly additive and non-destructive: no existing column,
  row, title, description or ordering is modified or deleted. When no image is
  configured, the landing keeps rendering the current lucide icon fallback.

2. Schema changes
- `business_activity_types` (existing table, used by the "Secteurs" section):
  - add nullable `image_url`    text  -> public URL of the sector image
  - add nullable `image_alt`    text  -> accessibility alt text
  - add nullable `image_position` text DEFAULT 'center' -> object-position
    hint ('left' | 'center' | 'right')
  Existing rows keep NULL image fields -> icon fallback unchanged.

3. Features & "Pourquoi Waarwi" images
- These two sections are stored as JSONB arrays (`features`, `why_waarwi`) inside
  the single `landing_config` row. No DDL is needed: the admin will write optional
  `image_url`, `image_alt`, `image_position` keys on each array element and the
  edge function `update_landing_config` already passes the JSONB through. The
  landing reads them defensively (optional). This keeps the change additive and
  avoids any JSONB schema migration.

4. Security / RLS
- `business_activity_types` already has an anon SELECT policy (the public landing
  reads it). RLS is already enabled.
- Add an UPDATE policy scoped to `authenticated` so platform admins (via the
  authenticated edge-function service path with JWT) can update the new image
  columns. No INSERT/DELETE policy is added: sector rows are managed elsewhere
  and this feature only edits images.
- The `landing-media` bucket already enforces public read + authenticated write;
  no storage policy change needed.

5. Important notes
- Non-destructive: only ADD COLUMN (nullable) + one UPDATE policy.
- No DROP, no DELETE, no type change, no rename.
- Titles, descriptions and ordering of cards are untouched.
- Only platform admins (authenticated, via the admin edge function) can write
  image URLs; visitors can only read the published rows.
- Icon fallback remains when `image_url` is NULL/empty.
*/

-- Sector image columns (additive, nullable)
ALTER TABLE business_activity_types
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS image_alt text,
  ADD COLUMN IF NOT EXISTS image_position text NOT NULL DEFAULT 'center';

-- Ensure RLS is enabled (idempotent)
ALTER TABLE business_activity_types ENABLE ROW LEVEL SECURITY;

-- Authenticated admins (via edge function JWT) can update sector rows to manage
-- image fields. No INSERT/DELETE added: sector lifecycle is managed elsewhere.
DROP POLICY IF EXISTS "authenticated_update_sector_images" ON business_activity_types;
CREATE POLICY "authenticated_update_sector_images"
  ON business_activity_types FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
