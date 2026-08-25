/*
# Landing page: global visual effects config

## Context
The public landing page (waarwi.com) currently has no way to apply
visual effects (brightness, contrast, saturation, blur, grayscale, sepia,
hue-rotate) across the entire page or per-section. This migration adds a
single JSONB column to store effect configuration that the marketing
frontend reads and applies via CSS filters.

## Changes
1. New column on `landing_config` (additive, idempotent):
   - `global_effects` (jsonb, nullable, default null) — stores an object
     like:
       {
         "brightness": 100,   // percentage, 100 = normal
         "contrast": 100,
         "saturate": 100,
         "blur": 0,           // px
         "grayscale": 0,       // percentage 0-100
         "sepia": 0,           // percentage 0-100
         "hueRotate": 0,      // degrees 0-360
         "enabled": true
       }
   When null or `enabled: false`, no effects are applied.

## Security
- No new tables. No RLS policy changes — existing policies on
  `landing_config` already cover all columns (public SELECT, super_admin
  write). The new column flows through `SELECT *` automatically.

## Important notes
1. Non-destructive: only ADD COLUMN IF NOT EXISTS. No DROP, no type change.
2. Default null preserves current behavior — no effects until configured.
3. The read path (`get_landing_config` uses `SELECT *`) needs no change.
   Only the write path (`update_landing_config`) is extended.
*/

ALTER TABLE landing_config
  ADD COLUMN IF NOT EXISTS global_effects jsonb DEFAULT null;
