-- Add parent_site_id to link depots to their parent store
ALTER TABLE sites ADD COLUMN IF NOT EXISTS parent_site_id uuid REFERENCES sites(id) ON DELETE SET NULL;

-- Index for efficient depot lookups by parent store
CREATE INDEX IF NOT EXISTS idx_sites_parent_site_id ON sites(parent_site_id) WHERE parent_site_id IS NOT NULL;

COMMENT ON COLUMN sites.parent_site_id IS 'For depots (is_warehouse=true): the store this depot belongs to. NULL for regular stores.';
