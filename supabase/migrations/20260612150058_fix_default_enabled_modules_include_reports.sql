-- Fix: ensure "reports" is in the default enabled_modules for all new tenants
ALTER TABLE tenants ALTER COLUMN enabled_modules SET DEFAULT
  '["dashboard","pos","cash_history","articles","stock","tiers","sales","billing","supplier_orders","online_orders","reports","settings"]'::jsonb;

-- Also add reports to any existing tenant that doesn't have it
UPDATE tenants 
SET enabled_modules = enabled_modules || '["reports"]'::jsonb 
WHERE NOT (enabled_modules @> '["reports"]'::jsonb);