-- Add 'ipm' module to pharmacy tenants that don't have it yet
UPDATE public.tenants
SET enabled_modules = enabled_modules || '["ipm"]'::jsonb
WHERE business_activity_type_id IN (
  SELECT id FROM public.business_activity_types WHERE LOWER(name) = 'pharmacie'
)
AND enabled_modules IS NOT NULL
AND NOT enabled_modules ? 'ipm';

-- Add 'reports' module to ALL tenants that don't have it yet
UPDATE public.tenants
SET enabled_modules = enabled_modules || '["reports"]'::jsonb
WHERE enabled_modules IS NOT NULL
AND NOT enabled_modules ? 'reports';