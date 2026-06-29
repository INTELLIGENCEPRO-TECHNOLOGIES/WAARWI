-- Add track_stock to articles (default true = tracked)
ALTER TABLE articles ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;

-- Add track_stock default to categories (when assigning a category, this becomes the default for new articles)
ALTER TABLE categories ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;

-- Also add to part_categories (legacy table used in Settings)
ALTER TABLE part_categories ADD COLUMN IF NOT EXISTS track_stock boolean NOT NULL DEFAULT true;
