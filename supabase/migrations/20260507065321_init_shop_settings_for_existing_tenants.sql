/*
  # Initialize shop_settings and public_slug for existing tenants

  ## Purpose
  - Auto-generate a public_slug for any tenant that doesn't have one yet
  - Create a default (inactive) shop_settings row for each tenant that doesn't have one
  - delivery_modes and payment_modes are jsonb columns
*/

-- Generate slug for tenants that don't have one yet
UPDATE tenants
SET public_slug = generate_tenant_slug(name)
WHERE public_slug IS NULL OR public_slug = '';

-- Create default shop_settings rows for tenants that don't have one
INSERT INTO shop_settings (
  tenant_id, is_active, shop_name, tagline, logo_url, phone, whatsapp,
  address, welcome_msg, footer_text, delivery_modes, payment_modes, primary_color
)
SELECT
  t.id,
  false,
  t.name,
  '',
  COALESCE(t.logo_url, ''),
  COALESCE(t.phone, ''),
  COALESCE(t.phone, ''),
  COALESCE(t.address, ''),
  'Bienvenue dans notre boutique en ligne.',
  'Contactez-nous pour toute question.',
  '["retrait", "livraison"]'::jsonb,
  '["paiement_livraison", "wave", "orange_money"]'::jsonb,
  COALESCE(t.primary_color, '#0f766e')
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM shop_settings s WHERE s.tenant_id = t.id
);
