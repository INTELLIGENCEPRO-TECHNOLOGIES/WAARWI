/*
  # Ensure every tenant has a shop_settings row

  1. Backfill
    - Insert a shop_settings row (inactive, using tenant name as default shop name)
      for every tenant that does not yet have one.

  2. Trigger
    - `ensure_shop_settings_on_tenant_insert`: AFTER INSERT on tenants, automatically
      creates a shop_settings row. This guarantees the "Boutique en ligne"
      configuration screen is always available, regardless of business type.
*/

INSERT INTO shop_settings (tenant_id, shop_name)
SELECT t.id, COALESCE(t.name, '')
FROM tenants t
LEFT JOIN shop_settings s ON s.tenant_id = t.id
WHERE s.id IS NULL;

CREATE OR REPLACE FUNCTION public.ensure_shop_settings_on_tenant_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO shop_settings (tenant_id, shop_name)
  VALUES (NEW.id, COALESCE(NEW.name, ''))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ensure_shop_settings ON tenants;
CREATE TRIGGER trg_ensure_shop_settings
AFTER INSERT ON tenants
FOR EACH ROW EXECUTE FUNCTION public.ensure_shop_settings_on_tenant_insert();