/*
# Shop Appearance Configuration

## Summary
Adds per-tenant appearance customization columns to the existing `shop_settings` table.
This enables three distinct shop themes, a configurable cover image with focal point,
display toggles, card density, section ordering, and a JSONB extension field —
all WITHOUT breaking existing tenants (every new column has a safe default so
current shops continue rendering identically until the tenant explicitly changes settings).

## New columns on `shop_settings` (all additive, all have defaults)

1. **theme** (text, default 'premium_minimal')
   - Controls which visual theme the public shop uses.
   - Allowed values: 'premium_minimal', 'marketplace', 'immersive'.
   - Default 'premium_minimal' preserves the current look.

2. **secondary_color** (text, default '#0f172a')
   - Secondary/accent color for the shop, complements the existing `primary_color`.

3. **cover_image_url** (text, default '')
   - URL of the cover/hero image for immersive themes.

4. **cover_image_alt** (text, default '')
   - Alt text for the cover image (accessibility).

5. **cover_focal_x** (int, default 50, range 0–100)
   - Horizontal focal point for responsive cropping via object-position.

6. **cover_focal_y** (int, default 50, range 0–100)
   - Vertical focal point for responsive cropping via object-position.

7. **cover_overlay** (text, default 'dark')
   - Overlay type over cover image: 'light', 'dark', or 'none'.

8. **cover_overlay_intensity** (int, default 40, range 0–100)
   - Opacity percentage of the cover overlay.

9. **show_references** (boolean, default true)
   - Whether product cards display internal references and OEM refs.

10. **show_stock** (boolean, default true)
    - Whether product cards display stock badges.

11. **low_stock_threshold** (int, default 3)
    - Quantity at which a product shows "low stock" instead of "available".

12. **show_perks** (boolean, default true)
    - Whether the perks/reassurance row is displayed in the shop.

13. **card_density** (text, default 'comfortable')
    - Card spacing: 'compact', 'comfortable', or 'spacious'.

14. **section_order** (jsonb, default '["hero","categories","products","perks","footer"]')
    - Ordered list of shop sections, allowing tenants to rearrange the layout.

15. **appearance_config** (jsonb, default '{}')
    - Reserved JSONB field for future appearance extensions without new migrations.

## Trigger
- Adds an `updated_at` auto-refresh trigger on `shop_settings` (none existed before).

## Security
- No new tables created. No RLS policy changes needed — existing policies on
  `shop_settings` already scope by `tenant_id` via `profiles` for authenticated users
  and allow public (anon) read only when `is_active = true`. The new columns inherit
  these same policies automatically.
- No data is lost: all changes are additive (ALTER TABLE ADD COLUMN with defaults).
*/

-- 1. Add appearance columns (idempotent via DO $$ blocks)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'theme') THEN
    ALTER TABLE shop_settings ADD COLUMN theme text NOT NULL DEFAULT 'premium_minimal';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'secondary_color') THEN
    ALTER TABLE shop_settings ADD COLUMN secondary_color text NOT NULL DEFAULT '#0f172a';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'cover_image_url') THEN
    ALTER TABLE shop_settings ADD COLUMN cover_image_url text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'cover_image_alt') THEN
    ALTER TABLE shop_settings ADD COLUMN cover_image_alt text NOT NULL DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'cover_focal_x') THEN
    ALTER TABLE shop_settings ADD COLUMN cover_focal_x int NOT NULL DEFAULT 50;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'cover_focal_y') THEN
    ALTER TABLE shop_settings ADD COLUMN cover_focal_y int NOT NULL DEFAULT 50;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'cover_overlay') THEN
    ALTER TABLE shop_settings ADD COLUMN cover_overlay text NOT NULL DEFAULT 'dark';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'cover_overlay_intensity') THEN
    ALTER TABLE shop_settings ADD COLUMN cover_overlay_intensity int NOT NULL DEFAULT 40;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'show_references') THEN
    ALTER TABLE shop_settings ADD COLUMN show_references boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'show_stock') THEN
    ALTER TABLE shop_settings ADD COLUMN show_stock boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'low_stock_threshold') THEN
    ALTER TABLE shop_settings ADD COLUMN low_stock_threshold int NOT NULL DEFAULT 3;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'show_perks') THEN
    ALTER TABLE shop_settings ADD COLUMN show_perks boolean NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'card_density') THEN
    ALTER TABLE shop_settings ADD COLUMN card_density text NOT NULL DEFAULT 'comfortable';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'section_order') THEN
    ALTER TABLE shop_settings ADD COLUMN section_order jsonb NOT NULL DEFAULT '["hero","categories","products","perks","footer"]'::jsonb;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'appearance_config') THEN
    ALTER TABLE shop_settings ADD COLUMN appearance_config jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- 2. Add updated_at trigger (none existed before)
DROP TRIGGER IF EXISTS trg_shop_settings_updated_at ON shop_settings;
DROP FUNCTION IF EXISTS fn_shop_settings_updated_at();

CREATE OR REPLACE FUNCTION fn_shop_settings_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_shop_settings_updated_at
  BEFORE UPDATE ON shop_settings
  FOR EACH ROW
  EXECUTE FUNCTION fn_shop_settings_updated_at();
