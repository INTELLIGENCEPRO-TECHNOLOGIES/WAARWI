
-- Document settings per tenant
CREATE TABLE document_settings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Optional header fields
  show_delivery_date boolean NOT NULL DEFAULT false,
  show_reference     boolean NOT NULL DEFAULT false,
  show_warranty      boolean NOT NULL DEFAULT false,
  show_representative boolean NOT NULL DEFAULT false,
  default_representative text NOT NULL DEFAULT '',

  -- Require header validation before item entry
  require_header_lock boolean NOT NULL DEFAULT false,

  -- Column configuration: [{key,label,visible,order,width,align}]
  columns_config jsonb NOT NULL DEFAULT '[]'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(tenant_id)
);

ALTER TABLE document_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_own_document_settings" ON document_settings
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "insert_own_document_settings" ON document_settings
  FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "update_own_document_settings" ON document_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "delete_own_document_settings" ON document_settings
  FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- Add doc_header to quotes and sales for optional header fields
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS doc_header jsonb DEFAULT NULL;
ALTER TABLE sales  ADD COLUMN IF NOT EXISTS doc_header jsonb DEFAULT NULL;
