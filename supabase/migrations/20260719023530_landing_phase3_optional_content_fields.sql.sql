/*
# Landing page Phase 3 — add optional content fields to landing_config

1. Purpose
- Add optional, configurable fields to the landing_config table so the public
  landing page can display contact details and real trust elements
  (testimonials, client logos) when they are provided.
- All fields default to empty / empty array, so the landing page hides the
  corresponding sections until real content is supplied. No fake content is
  seeded.

2. Columns added to landing_config (all additive, all have safe defaults)
- contact_email text NOT NULL DEFAULT '' — professional contact email. The
  email link is rendered only when this is non-empty.
- contact_hours text NOT NULL DEFAULT '' — optional support hours / response
  time hint. Rendered only when non-empty.
- testimonials jsonb NOT NULL DEFAULT '[]' — array of
  { quote, author, role?, company? }. The testimonials section renders only
  when this array is non-empty.
- client_logos jsonb NOT NULL DEFAULT '[]' — array of
  { name, logo_url? }. The client-logos strip renders only when non-empty.

3. Security
- No RLS or policy changes. The existing public SELECT policy on
  landing_config covers these new columns automatically (row-level, not
  column-level). Writes remain super_admin only.

4. Idempotence
- Uses ADD COLUMN IF NOT EXISTS, safe to re-run.

5. Notes
- No DROP, no DELETE, no type changes, no renames. Existing rows get the
  default values automatically.
*/

ALTER TABLE landing_config
  ADD COLUMN IF NOT EXISTS contact_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_hours text NOT NULL DEFAULT '[]'::text,
  ADD COLUMN IF NOT EXISTS testimonials jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS client_logos jsonb NOT NULL DEFAULT '[]'::jsonb;
