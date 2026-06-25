-- Add warranty_cancelled fields to sales (stored in doc_header JSONB, no new columns needed)
-- We'll store warranty_cancelled, warranty_cancelled_at, warranty_cancelled_reason in doc_header

-- Add warranty_terms field to document_settings for configuring what warranty covers
ALTER TABLE document_settings ADD COLUMN IF NOT EXISTS warranty_terms text DEFAULT '';

-- Comment
COMMENT ON COLUMN document_settings.warranty_terms IS 'Text describing what the warranty covers, displayed on warranty certificates';
