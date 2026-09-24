/*
# Add old_price to articles + commercial content columns to shop_settings

1. Modified Tables
   - `articles`: added `old_price` (numeric, nullable) for displaying crossed-out original prices and discount badges
   - `shop_settings`: added commercial content columns for the new immersive shop experience

2. New Columns on `shop_settings`
   - `hero_title` (text) — short commercial title for the cover
   - `hero_subtitle` (text) — optional subtitle
   - `hero_cta_label` (text, default 'Découvrir les produits') — CTA button text
   - `promo_banner_text` (text) — promotional banner text
   - `promo_banner_color` (text, default '#dc2626') — banner background color
   - `promo_banner_active` (boolean, default false) — toggle promo banner
   - `social_links` (jsonb, default '{}') — social media links (facebook, instagram, tiktok)
   - `show_waarwi_badge` (boolean, default true) — show/hide "Powered by Waarwi" block

3. Security
   - No RLS changes needed — new columns inherit existing table policies

4. Notes
   - `old_price` is nullable: when NULL or 0, no discount is shown
   - When `old_price > sale_price`, the shop displays the old price crossed out with a % badge
   - All new shop_settings columns have safe defaults so existing shops render identically
*/

-- Add old_price to articles
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'articles' AND column_name = 'old_price'
  ) THEN
    ALTER TABLE articles ADD COLUMN old_price numeric DEFAULT NULL;
  END IF;
END $$;

-- Add commercial content columns to shop_settings
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'hero_title'
  ) THEN
    ALTER TABLE shop_settings ADD COLUMN hero_title text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'hero_subtitle'
  ) THEN
    ALTER TABLE shop_settings ADD COLUMN hero_subtitle text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'hero_cta_label'
  ) THEN
    ALTER TABLE shop_settings ADD COLUMN hero_cta_label text DEFAULT 'Découvrir les produits';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'promo_banner_text'
  ) THEN
    ALTER TABLE shop_settings ADD COLUMN promo_banner_text text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'promo_banner_color'
  ) THEN
    ALTER TABLE shop_settings ADD COLUMN promo_banner_color text DEFAULT '#dc2626';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'promo_banner_active'
  ) THEN
    ALTER TABLE shop_settings ADD COLUMN promo_banner_active boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'social_links'
  ) THEN
    ALTER TABLE shop_settings ADD COLUMN social_links jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shop_settings' AND column_name = 'show_waarwi_badge'
  ) THEN
    ALTER TABLE shop_settings ADD COLUMN show_waarwi_badge boolean DEFAULT true;
  END IF;
END $$;
