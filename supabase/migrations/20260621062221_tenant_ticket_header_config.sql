-- Add per-tenant ticket header customization (visibility, order, font size, line break)
-- and ensure activity is resolved from business_activity_types (set on platform admin).

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS ticket_header_config jsonb;

COMMENT ON COLUMN tenants.ticket_header_config IS
  'Array of header items {key, show, size, breakAfter} controlling order/visibility/size of tenant header on printed tickets and documents.';
