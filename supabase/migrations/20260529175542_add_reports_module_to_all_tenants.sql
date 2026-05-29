/*
  # Add 'reports' module to all existing tenants

  All tenants currently have an explicit enabled_modules array that does not
  include 'reports'. This migration appends 'reports' to every tenant's
  enabled_modules array so the États page becomes visible in the sidebar.
*/

UPDATE tenants
SET enabled_modules = enabled_modules || '["reports"]'::jsonb
WHERE NOT (enabled_modules @> '["reports"]'::jsonb);
