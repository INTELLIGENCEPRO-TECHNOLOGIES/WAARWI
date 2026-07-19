/*
# Landing page Phase 4 — demo captures, proofs, why & FAQ, contact channels

1. Purpose
- Extend landing_config so the entire marketing landing page is configurable
  from the platform admin: demo captures (desktop + mobile), client logos,
  testimonials, "Pourquoi Waarwi" cards, FAQ items, section titles, and
  contact channels (WhatsApp, phone display, phone tel link).
- Create a public storage bucket "landing-media" for PNG/JPEG/WebP demo
  captures and client logos (5 MB max, no SVG — raster images only).

2. Columns added to landing_config (all additive, all have safe defaults)
- demo_desktop jsonb NOT NULL DEFAULT '[]' — array of
  { src, alt, label }. Desktop screenshots shown in the horizontal carousel.
- demo_mobile jsonb NOT NULL DEFAULT '[]' — array of
  { src, alt, label }. Mobile screenshots shown in the stacked-cards column.
- why_waarwi jsonb NOT NULL DEFAULT '[]' — array of
  { icon, title, desc }. "Pourquoi Waarwi" cards.
- faq_items jsonb NOT NULL DEFAULT '[]' — array of
  { q, a }. FAQ accordion entries.
- section_titles jsonb NOT NULL DEFAULT '{}' — object of optional section
  heading overrides.
- whatsapp_url text NOT NULL DEFAULT 'https://wa.me/221775254101' — WhatsApp link.
- phone_display text NOT NULL DEFAULT '77 525 41 01' — human-readable phone.
- phone_tel text NOT NULL DEFAULT '+221775254101' — tel: link target.

3. New Storage Bucket
- "landing-media": public, 5 MB max, PNG/JPEG/WebP only.
- SELECT policy: public (anon + authenticated) — landing page is public.
- INSERT/UPDATE/DELETE: authenticated only (admin uploads).

4. Idempotence
- ADD COLUMN IF NOT EXISTS + ON CONFLICT DO NOTHING for the bucket.
- Policies are dropped first then recreated (DROP POLICY has no FOR clause).

5. Notes
- No DROP, no DELETE, no type changes, no renames. Existing rows get defaults.
*/

ALTER TABLE landing_config
  ADD COLUMN IF NOT EXISTS demo_desktop jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS demo_mobile jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS why_waarwi jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS faq_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS section_titles jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_url text NOT NULL DEFAULT 'https://wa.me/221775254101',
  ADD COLUMN IF NOT EXISTS phone_display text NOT NULL DEFAULT '77 525 41 01',
  ADD COLUMN IF NOT EXISTS phone_tel text NOT NULL DEFAULT '+221775254101';

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('landing-media', 'landing-media', true, 5242880, ARRAY['image/png', 'image/jpeg', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "landing_media_select" ON storage.objects;
CREATE POLICY "landing_media_select" ON storage.objects FOR SELECT
  TO anon, authenticated USING (bucket_id = 'landing-media');

DROP POLICY IF EXISTS "landing_media_insert" ON storage.objects;
CREATE POLICY "landing_media_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (bucket_id = 'landing-media');

DROP POLICY IF EXISTS "landing_media_update" ON storage.objects;
CREATE POLICY "landing_media_update" ON storage.objects FOR UPDATE
  TO authenticated USING (bucket_id = 'landing-media') WITH CHECK (bucket_id = 'landing-media');

DROP POLICY IF EXISTS "landing_media_delete" ON storage.objects;
CREATE POLICY "landing_media_delete" ON storage.objects FOR DELETE
  TO authenticated USING (bucket_id = 'landing-media');
