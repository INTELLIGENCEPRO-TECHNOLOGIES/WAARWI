-- Add site_id to articles for independent catalog mode
ALTER TABLE articles ADD COLUMN IF NOT EXISTS site_id uuid REFERENCES sites(id) ON DELETE SET NULL;

-- Index for filtering by site
CREATE INDEX IF NOT EXISTS idx_articles_site_id ON articles(site_id) WHERE site_id IS NOT NULL;

-- Update RLS policies to allow site-scoped access
-- (existing policies use tenant_id which still applies)