/*
# PC1A — Create accounting_account_mappings table

Foundational table for the configurable chart-of-accounts system.
Maps a per-tenant functional role code (e.g. 'CAISSE', 'CLIENT_COLLECTIF')
to an account in the `accounts` table. A single account can serve multiple
roles; each (tenant_id, role_code) pair is unique.

1. New Table
   - `accounting_account_mappings`
     - `id` (uuid, PK)
     - `tenant_id` (uuid, NOT NULL, FK → tenants ON DELETE CASCADE)
     - `role_code` (text, NOT NULL) — engine-defined role identifier
     - `account_id` (uuid, NOT NULL, FK → accounts ON DELETE RESTRICT)
     - `created_at` (timestamptz, default now())
     - UNIQUE(tenant_id, role_code) — one mapping per role per tenant
     - account_id is NOT unique: one account can fulfil several roles

2. Cross-tenant integrity
   - Trigger `trg_mapping_tenant_integrity` rejects any row where
     the referenced account does not belong to the same tenant.

3. Security
   - RLS enabled, strict multi-tenant isolation.
   - SELECT only for `authenticated` role, scoped to own tenant.
   - No INSERT / UPDATE / DELETE policies — writes happen exclusively
     via service_role (migrations) or SECURITY DEFINER functions (PC1B/PC1D).
   - All privileges revoked from PUBLIC and anon.
   - authenticated granted SELECT only.

4. Important Notes
   - This migration is purely additive: it creates one new table, one
     function, and one trigger. It does NOT modify `accounts`,
     `journal_entries`, `journal_lines`, or any existing function.
   - No backfill is performed — the table starts empty (0 rows).
   - Idempotent: uses IF NOT EXISTS / OR REPLACE / DROP POLICY IF EXISTS.
*/

-- ============================================================
-- 1. Create the table
-- ============================================================
CREATE TABLE IF NOT EXISTS accounting_account_mappings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_code   text NOT NULL,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_mapping_tenant_role UNIQUE (tenant_id, role_code)
);

-- ============================================================
-- 2. Cross-tenant integrity trigger
-- ============================================================
CREATE OR REPLACE FUNCTION check_mapping_tenant_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM accounts
    WHERE id = NEW.account_id
      AND tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'accounting_account_mappings: account_id % does not belong to tenant_id %',
      NEW.account_id, NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mapping_tenant_integrity ON accounting_account_mappings;
CREATE TRIGGER trg_mapping_tenant_integrity
  BEFORE INSERT OR UPDATE ON accounting_account_mappings
  FOR EACH ROW
  EXECUTE FUNCTION check_mapping_tenant_integrity();

-- ============================================================
-- 3. Row Level Security
-- ============================================================
ALTER TABLE accounting_account_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mapping_select_own_tenant" ON accounting_account_mappings;
CREATE POLICY "mapping_select_own_tenant"
  ON accounting_account_mappings
  FOR SELECT
  TO authenticated
  USING (tenant_id = current_tenant_id());

-- No INSERT / UPDATE / DELETE policies.
-- Writes are restricted to service_role and SECURITY DEFINER functions only.

-- ============================================================
-- 4. Table-level privileges (lock down)
-- ============================================================
REVOKE ALL ON accounting_account_mappings FROM PUBLIC;
REVOKE ALL ON accounting_account_mappings FROM anon;

GRANT SELECT ON accounting_account_mappings TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON accounting_account_mappings FROM authenticated;
GRANT ALL ON accounting_account_mappings TO service_role;

-- ============================================================
-- 5. Revoke PUBLIC/anon from the trigger function
-- ============================================================
REVOKE ALL ON FUNCTION check_mapping_tenant_integrity() FROM PUBLIC;
REVOKE ALL ON FUNCTION check_mapping_tenant_integrity() FROM anon;
