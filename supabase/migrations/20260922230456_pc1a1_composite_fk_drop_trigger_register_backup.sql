/*
# PC1A.1 — Composite FK, drop trigger, register in backup registry

Forward-only correctif for accounting_account_mappings.

1. Modified Tables
   - `accounts`: add UNIQUE(tenant_id, id) to support composite FK reference.
     This is purely additive — does not affect existing data or queries.
   - `accounting_account_mappings`:
     - DROP simple FK on account_id → accounts(id)
     - ADD composite FK (tenant_id, account_id) → accounts(tenant_id, id)
       ON DELETE RESTRICT — enforces cross-tenant integrity at the engine level.
     - account_id remains non-unique: one account can fulfil multiple roles.

2. Dropped Objects
   - Trigger `trg_mapping_tenant_integrity` — superseded by composite FK.
   - Function `check_mapping_tenant_integrity()` — no longer needed.

3. Backup Registry
   - Register `accounting_account_mappings` in `_br_table_registry` with:
     category='structure', restore_order=20, reset_behavior='preserve',
     is_mandatory=false, tenant_link='direct'.

4. Important Notes
   - No data modified in any table (accounts, journal_entries, journal_lines,
     accounting_account_mappings all unchanged in row count and content).
   - No function body, privilege, or RLS policy modified on any existing object.
   - Idempotent: uses IF NOT EXISTS, DROP IF EXISTS, ON CONFLICT DO NOTHING.
*/

-- ============================================================
-- 1. Add UNIQUE(tenant_id, id) on accounts for composite FK target
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'accounts'::regclass
      AND contype = 'u'
      AND conname = 'uq_accounts_tenant_id_id'
  ) THEN
    ALTER TABLE accounts ADD CONSTRAINT uq_accounts_tenant_id_id UNIQUE (tenant_id, id);
  END IF;
END $$;

-- ============================================================
-- 2. Replace simple FK with composite FK on accounting_account_mappings
-- ============================================================
-- Drop the simple FK (idempotent via IF EXISTS in DO block)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'accounting_account_mappings'::regclass
      AND conname = 'accounting_account_mappings_account_id_fkey'
  ) THEN
    ALTER TABLE accounting_account_mappings
      DROP CONSTRAINT accounting_account_mappings_account_id_fkey;
  END IF;
END $$;

-- Add composite FK (tenant_id, account_id) → accounts(tenant_id, id)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'accounting_account_mappings'::regclass
      AND conname = 'fk_mapping_account_same_tenant'
  ) THEN
    ALTER TABLE accounting_account_mappings
      ADD CONSTRAINT fk_mapping_account_same_tenant
      FOREIGN KEY (tenant_id, account_id)
      REFERENCES accounts(tenant_id, id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ============================================================
-- 3. Drop trigger and function (superseded by composite FK)
-- ============================================================
DROP TRIGGER IF EXISTS trg_mapping_tenant_integrity ON accounting_account_mappings;
DROP FUNCTION IF EXISTS check_mapping_tenant_integrity();

-- ============================================================
-- 4. Register in _br_table_registry (idempotent)
-- ============================================================
INSERT INTO _br_table_registry (
  schema_name, table_name, tenant_link, tenant_id_column,
  category, restore_order, reset_behavior, is_mandatory
) VALUES (
  'public', 'accounting_account_mappings', 'direct', 'tenant_id',
  'structure', 20, 'preserve', false
) ON CONFLICT (schema_name, table_name) DO NOTHING;
