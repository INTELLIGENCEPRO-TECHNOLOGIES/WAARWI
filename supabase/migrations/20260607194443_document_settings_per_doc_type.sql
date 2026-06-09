
-- Add doc_type to document_settings so settings are per document type
-- Supported types: invoice, quote, supplier_order, credit_note

-- Drop the old unique constraint on tenant_id alone
ALTER TABLE document_settings DROP CONSTRAINT IF EXISTS document_settings_tenant_id_key;

-- Add doc_type column
ALTER TABLE document_settings
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'invoice';

-- Rename existing rows to type 'invoice' (they had no type before)
UPDATE document_settings SET doc_type = 'invoice' WHERE doc_type = 'invoice';

-- New unique constraint: one setting row per tenant per document type
ALTER TABLE document_settings
  ADD CONSTRAINT document_settings_tenant_doc_type_key UNIQUE (tenant_id, doc_type);

-- Add doc_header to tables that don't have it yet
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS doc_header jsonb DEFAULT NULL;
ALTER TABLE sales  ADD COLUMN IF NOT EXISTS doc_header jsonb DEFAULT NULL;
ALTER TABLE supplier_orders ADD COLUMN IF NOT EXISTS doc_header jsonb DEFAULT NULL;
