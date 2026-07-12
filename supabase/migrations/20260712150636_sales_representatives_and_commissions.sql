/*
# Représentants commerciaux & commissions

1. Nouvelles tables
- `sales_representatives` : représentants commerciaux par tenant
  - `id` (uuid, pk), `tenant_id`, `code` (unique par tenant, ex: REP-001),
    `first_name`, `last_name`, `status` ('actif'/'inactif'),
    règle de commission spécifique optionnelle (`commission_override`,
    `commission_type`, `commission_base`, `commission_rate`, `commission_fixed`),
    `created_at`, `updated_at`.
- `rep_commission_settings` : réglage global de commission (1 ligne par tenant)
  - `enabled`, `commission_type` ('pct_ca'|'fixe'|'pct_marge'),
    `commission_base` ('ht'|'ttc'|'net'|'marge'), `rate`, `fixed_amount`.

2. Tables modifiées
- `sales` : ajout `representative_id` (FK vers sales_representatives, RESTRICT
  pour interdire la suppression d'un représentant utilisé) et `rep_commission`
  (jsonb, photographie de la règle et du montant calculés à la validation).
- `quotes` : ajout `representative_id` (FK, RESTRICT).

3. Sécurité
- RLS activé sur les 2 nouvelles tables, 4 politiques CRUD chacune,
  isolées par `tenant_id = current_tenant_id()`.

4. Permissions
- Ajout des clés rep_view, rep_manage, rep_stats_view, rep_commission_view,
  rep_settings_edit, rep_export aux rôles élevés dans role_permissions.
*/

CREATE TABLE IF NOT EXISTS sales_representatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  status text NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','inactif')),
  commission_override boolean NOT NULL DEFAULT false,
  commission_type text CHECK (commission_type IN ('pct_ca','fixe','pct_marge')),
  commission_base text CHECK (commission_base IN ('ht','ttc','net','marge')),
  commission_rate numeric(8,4) DEFAULT 0,
  commission_fixed numeric(15,2) DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
ALTER TABLE sales_representatives ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_sales_representatives" ON sales_representatives;
CREATE POLICY "select_sales_representatives" ON sales_representatives FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS "insert_sales_representatives" ON sales_representatives;
CREATE POLICY "insert_sales_representatives" ON sales_representatives FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS "update_sales_representatives" ON sales_representatives;
CREATE POLICY "update_sales_representatives" ON sales_representatives FOR UPDATE
  TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS "delete_sales_representatives" ON sales_representatives;
CREATE POLICY "delete_sales_representatives" ON sales_representatives FOR DELETE
  TO authenticated USING (tenant_id = current_tenant_id());
CREATE INDEX IF NOT EXISTS idx_sales_reps_tenant ON sales_representatives(tenant_id);

CREATE TABLE IF NOT EXISTS rep_commission_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  commission_type text NOT NULL DEFAULT 'pct_ca' CHECK (commission_type IN ('pct_ca','fixe','pct_marge')),
  commission_base text NOT NULL DEFAULT 'ttc' CHECK (commission_base IN ('ht','ttc','net','marge')),
  rate numeric(8,4) NOT NULL DEFAULT 0,
  fixed_amount numeric(15,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE rep_commission_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "select_rep_commission_settings" ON rep_commission_settings;
CREATE POLICY "select_rep_commission_settings" ON rep_commission_settings FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS "insert_rep_commission_settings" ON rep_commission_settings;
CREATE POLICY "insert_rep_commission_settings" ON rep_commission_settings FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS "update_rep_commission_settings" ON rep_commission_settings;
CREATE POLICY "update_rep_commission_settings" ON rep_commission_settings FOR UPDATE
  TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
DROP POLICY IF EXISTS "delete_rep_commission_settings" ON rep_commission_settings;
CREATE POLICY "delete_rep_commission_settings" ON rep_commission_settings FOR DELETE
  TO authenticated USING (tenant_id = current_tenant_id());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='representative_id') THEN
    ALTER TABLE sales ADD COLUMN representative_id uuid REFERENCES sales_representatives(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sales' AND column_name='rep_commission') THEN
    ALTER TABLE sales ADD COLUMN rep_commission jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quotes' AND column_name='representative_id') THEN
    ALTER TABLE quotes ADD COLUMN representative_id uuid REFERENCES sales_representatives(id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_sales_representative ON sales(representative_id);
CREATE INDEX IF NOT EXISTS idx_quotes_representative ON quotes(representative_id);

UPDATE role_permissions
SET permissions = permissions
  || jsonb_build_object(
    'rep_view', true,
    'rep_manage', true,
    'rep_stats_view', true,
    'rep_commission_view', true,
    'rep_settings_edit', true,
    'rep_export', true
  ),
  updated_at = now()
WHERE role IN ('proprietaire','admin','manager','superviseur','supervisor');
