/*
# Landing hero: editable mobile overlay image + visibility toggle

## Context
The public landing page (waarwi.com) hero section displays two superimposed
images: a large desktop screenshot (already stored in `landing_config.hero_image_url`)
and a small floating mobile overlay that is currently HARDCODED to `/mobile.png`
in the marketing frontend — not editable, not toggleable.

This migration makes the mobile overlay fully configurable from Platform Admin,
matching how the desktop hero image is already managed.

## Changes
1. New columns on `landing_config` (additive, idempotent):
   - `hero_mobile_image_url` (text, NOT NULL DEFAULT '') — URL of the small
     mobile screenshot overlay shown at the bottom-left of the hero. Empty
     string means "use the frontend default `/mobile.png`".
   - `hero_mobile_visible` (boolean, NOT NULL DEFAULT true) — when false, the
     mobile overlay is hidden entirely on the landing page (only the desktop
     hero image is shown).

## Security
- No new tables. No RLS policy changes — the existing policies on
  `landing_config` already cover all columns:
  - public SELECT (anon + authenticated) for reading the published config
  - super_admin FOR ALL for managing it
- The `landing-media` storage bucket already enforces public read +
  authenticated write; the new image is uploaded there like all other
  landing images.

## Important notes
1. Non-destructive: only ADD COLUMN IF NOT EXISTS. No DROP, no DELETE, no
   type change, no rename.
2. Defaults preserve current behavior: `hero_mobile_visible` defaults to
   true so existing deployments keep showing the overlay, and an empty
   `hero_mobile_image_url` falls back to `/mobile.png` in the frontend.
3. The read path (`get_landing_config` edge-function action uses
   `SELECT *`) needs no change — new columns flow through automatically.
   Only the write path (`update_landing_config`) is extended to accept the
   two new fields.
*/

ALTER TABLE landing_config
  ADD COLUMN IF NOT EXISTS hero_mobile_image_url text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS hero_mobile_visible boolean NOT NULL DEFAULT true;
