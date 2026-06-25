/*
  # Per-site document header configuration

  Adds document header fields to sites so each store can have its own
  logo, legal name, NINEA, RCCM, email, website, and ticket header layout.
  
  When printing, the system will use site-specific values if set,
  falling back to the tenant-level values.
*/

ALTER TABLE sites ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS legal_name text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS ninea text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS rccm text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS ticket_header_config jsonb;

COMMENT ON COLUMN sites.logo_url IS 'Site-specific logo for document headers. Falls back to tenant logo_url if NULL.';
COMMENT ON COLUMN sites.legal_name IS 'Site-specific legal/commercial name for documents. Falls back to tenant legal_name if NULL.';
COMMENT ON COLUMN sites.ninea IS 'Site-specific NINEA for documents. Falls back to tenant ninea if NULL.';
COMMENT ON COLUMN sites.rccm IS 'Site-specific RCCM for documents. Falls back to tenant rccm if NULL.';
COMMENT ON COLUMN sites.email IS 'Site-specific email for documents. Falls back to tenant email if NULL.';
COMMENT ON COLUMN sites.website IS 'Site-specific website for documents. Falls back to tenant website if NULL.';
COMMENT ON COLUMN sites.ticket_header_config IS 'Site-specific header layout config (same schema as tenants.ticket_header_config). Falls back to tenant config if NULL.';