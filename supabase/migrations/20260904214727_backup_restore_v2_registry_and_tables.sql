/*
# Backup/Restore System v2 — Part 1: Registry, Activation Lock, Schema Extensions

## Summary
Replaces the hardcoded backup/restore system with a registry-driven architecture.
This first part creates the infrastructure tables, populates the registry with all
89+ tenant-scoped tables, extends tenant_backups with verification columns, and
revokes dangerous access on all legacy functions.

## New Tables
- `_br_table_registry`: Central registry classifying every tenant-scoped table.
  Columns: schema_name, table_name, tenant_link (direct/indirect/excluded),
  tenant_id_column, parent_table, category (structure/operation/audit/backup_system/platform),
  restore_order (10-90 based on FK chains), reset_behavior (preserve/delete),
  self_ref_columns (text[]), is_mandatory, exclusion_reason.
- `_br_tenant_activation`: Fail-closed activation lock per tenant. Destructive
  operations (restore, reset, import) are blocked unless enabled=true.

## Modified Tables
- `tenant_backups`: Added columns format_version, schema_fingerprint, manifest,
  row_counts, checksums, global_checksum, status, verified_at, error_message.
  Existing rows marked status='legacy'.

## Security Changes
- RLS enabled on both new tables with no public policies (service-role only).
- SELECT granted on _br_table_registry to authenticated (read-only for UI).
- All legacy backup/restore/reset functions REVOKED from PUBLIC, anon, authenticated.
- reset_tenant_data specifically revoked — accepts arbitrary UUID.

## Important Notes
1. This is a forward-only migration. No existing data is modified or deleted.
2. The registry is the single source of truth for which tables to backup/restore.
3. Existing backups are preserved and marked as 'legacy' format.
4. Excluded tables: profiles (auth-linked), tenants (identity), tenant_subscriptions
   and subscription_action_tokens (platform-managed), backup system tables, and
   global platform tables.
5. site_doc_header_config does NOT exist as a table (it's a jsonb column) — excluded.
*/

-- ============================================================
-- SECTION 1: Backup status enum
-- ============================================================
DO $$ BEGIN
  CREATE TYPE br_backup_status AS ENUM (
    'creating', 'verified', 'failed', 'legacy', 'incompatible'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- SECTION 2: _br_table_registry
-- ============================================================
CREATE TABLE IF NOT EXISTS _br_table_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_name text NOT NULL DEFAULT 'public',
  table_name text NOT NULL,
  tenant_link text NOT NULL CHECK (tenant_link IN ('direct', 'indirect', 'excluded')),
  tenant_id_column text DEFAULT 'tenant_id',
  parent_table text,
  category text NOT NULL CHECK (category IN (
    'structure', 'operation', 'audit', 'backup_system', 'platform'
  )),
  restore_order integer NOT NULL DEFAULT 50,
  reset_behavior text NOT NULL DEFAULT 'preserve' CHECK (reset_behavior IN (
    'preserve', 'delete'
  )),
  self_ref_columns text[] DEFAULT '{}',
  is_mandatory boolean NOT NULL DEFAULT true,
  exclusion_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schema_name, table_name)
);

ALTER TABLE _br_table_registry ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON _br_table_registry FROM PUBLIC;
REVOKE ALL ON _br_table_registry FROM anon;
REVOKE ALL ON _br_table_registry FROM authenticated;
GRANT SELECT ON _br_table_registry TO authenticated;

-- ============================================================
-- SECTION 3: _br_tenant_activation
-- ============================================================
CREATE TABLE IF NOT EXISTS _br_tenant_activation (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  enabled_by uuid REFERENCES auth.users(id),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE _br_tenant_activation ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON _br_tenant_activation FROM PUBLIC;
REVOKE ALL ON _br_tenant_activation FROM anon;
REVOKE ALL ON _br_tenant_activation FROM authenticated;
GRANT SELECT ON _br_tenant_activation TO authenticated;

-- ============================================================
-- SECTION 4: Extend tenant_backups with v2 columns
-- ============================================================
ALTER TABLE tenant_backups ADD COLUMN IF NOT EXISTS format_version integer DEFAULT 1;
ALTER TABLE tenant_backups ADD COLUMN IF NOT EXISTS schema_fingerprint text;
ALTER TABLE tenant_backups ADD COLUMN IF NOT EXISTS manifest jsonb;
ALTER TABLE tenant_backups ADD COLUMN IF NOT EXISTS row_counts jsonb;
ALTER TABLE tenant_backups ADD COLUMN IF NOT EXISTS checksums jsonb;
ALTER TABLE tenant_backups ADD COLUMN IF NOT EXISTS global_checksum text;
ALTER TABLE tenant_backups ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE tenant_backups ADD COLUMN IF NOT EXISTS error_message text;

DO $$ BEGIN
  ALTER TABLE tenant_backups ADD COLUMN status br_backup_status DEFAULT 'legacy';
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

UPDATE tenant_backups SET status = 'legacy' WHERE status IS NULL;

-- ============================================================
-- SECTION 5: Populate _br_table_registry
-- ============================================================
DELETE FROM _br_table_registry;

-- ── STRUCTURE tables (restore_order 10): root tenant tables ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('sites',                    'direct', 'structure', 10, 'preserve'),
  ('accounts',                 'direct', 'structure', 10, 'preserve'),
  ('expense_categories',       'direct', 'structure', 10, 'preserve'),
  ('role_permissions',         'direct', 'structure', 10, 'preserve'),
  ('categories',               'direct', 'structure', 10, 'preserve'),
  ('accounting_accounts',      'direct', 'structure', 10, 'preserve'),
  ('accounting_sequences',     'direct', 'structure', 10, 'preserve'),
  ('document_settings',        'direct', 'structure', 10, 'preserve'),
  ('shop_settings',            'direct', 'structure', 10, 'preserve'),
  ('pricing_tier_definitions', 'direct', 'structure', 10, 'preserve'),
  ('vaults',                   'direct', 'structure', 10, 'preserve'),
  ('sales_representatives',    'direct', 'structure', 10, 'preserve'),
  ('ipm_organismes',           'direct', 'structure', 10, 'preserve'),
  ('ipm_parametres',           'direct', 'structure', 10, 'preserve'),
  ('mt_services',              'direct', 'structure', 10, 'preserve'),
  ('mt_wholesalers',           'direct', 'structure', 10, 'preserve'),
  ('mt_expense_categories',    'direct', 'structure', 10, 'preserve'),
  ('mt_init_status',           'direct', 'structure', 10, 'preserve'),
  ('mt_commission_tiers',      'direct', 'structure', 10, 'preserve');

-- Self-ref at order 10
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior, self_ref_columns) VALUES
  ('part_categories', 'direct', 'structure', 10, 'preserve', '{parent_id}');

-- ── STRUCTURE tables (restore_order 20): FK to order-10 tables ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('vehicle_brands',           'direct', 'structure', 20, 'preserve'),
  ('customers',                'direct', 'structure', 20, 'preserve'),
  ('suppliers',                'direct', 'structure', 20, 'preserve'),
  ('mt_service_points',        'direct', 'structure', 20, 'preserve'),
  ('mt_customers',             'direct', 'structure', 20, 'preserve'),
  ('mt_accounts',              'direct', 'structure', 20, 'preserve'),
  ('mt_init_balances',         'direct', 'structure', 20, 'preserve'),
  ('ipm_conventions',          'direct', 'structure', 20, 'preserve');

-- ── STRUCTURE tables (restore_order 30): FK to order-20 tables ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('vehicle_models',           'direct', 'structure', 30, 'preserve'),
  ('articles',                 'direct', 'structure', 30, 'preserve'),
  ('payment_methods',          'direct', 'structure', 30, 'preserve'),
  ('rep_commission_settings',  'direct', 'structure', 30, 'preserve'),
  ('ipm_beneficiaires',        'direct', 'structure', 30, 'preserve'),
  ('mt_service_point_services','direct', 'structure', 30, 'preserve');

-- Indirect table: mt_wholesaler_services (via mt_wholesalers.wholesaler_id)
INSERT INTO _br_table_registry (table_name, tenant_link, tenant_id_column, parent_table, category, restore_order, reset_behavior) VALUES
  ('mt_wholesaler_services', 'indirect', NULL, 'mt_wholesalers', 'structure', 30, 'preserve');

-- ── STRUCTURE tables (restore_order 40): FK to articles, vehicle_models ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('article_compatibilities',  'direct', 'structure', 40, 'preserve'),
  ('stock_levels',             'direct', 'structure', 40, 'preserve'),
  ('stock_lots',               'direct', 'structure', 40, 'preserve'),
  ('article_pricing_tiers',    'direct', 'structure', 40, 'preserve'),
  ('customer_exception_prices','direct', 'structure', 40, 'preserve');

-- ── OPERATION tables (restore_order 50): sessions/prepayments ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('cash_sessions',            'direct', 'operation', 50, 'delete'),
  ('customer_prepayments',     'direct', 'operation', 50, 'delete');

-- ── OPERATION tables (restore_order 60): document headers ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('sales',                    'direct', 'operation', 60, 'delete'),
  ('quotes',                   'direct', 'operation', 60, 'delete'),
  ('supplier_orders',          'direct', 'operation', 60, 'delete'),
  ('online_orders',            'direct', 'operation', 60, 'delete'),
  ('stock_documents',          'direct', 'operation', 60, 'delete'),
  ('journal_entries',          'direct', 'operation', 60, 'delete'),
  ('held_carts',               'direct', 'operation', 60, 'delete'),
  ('ipm_bordereaux',           'direct', 'operation', 60, 'delete'),
  ('mt_operations',            'direct', 'operation', 60, 'delete'),
  ('mt_closures',              'direct', 'operation', 60, 'delete');

-- ── OPERATION tables (restore_order 70): line items ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('sale_items',               'direct', 'operation', 70, 'delete'),
  ('sale_payments',            'direct', 'operation', 70, 'delete'),
  ('quote_items',              'direct', 'operation', 70, 'delete'),
  ('supplier_order_items',     'direct', 'operation', 70, 'delete'),
  ('supplier_payments',        'direct', 'operation', 70, 'delete'),
  ('online_order_items',       'direct', 'operation', 70, 'delete'),
  ('online_order_status_history','direct','operation', 70, 'delete'),
  ('cash_movements',           'direct', 'operation', 70, 'delete'),
  ('cash_control_lines',       'direct', 'operation', 70, 'delete'),
  ('cash_regularizations',     'direct', 'operation', 70, 'delete'),
  ('stock_movements',          'direct', 'operation', 70, 'delete'),
  ('vault_movements',          'direct', 'operation', 70, 'delete'),
  ('journal_lines',            'direct', 'operation', 70, 'delete'),
  ('balance_adjustments',      'direct', 'operation', 70, 'delete'),
  ('credit_allocations',       'direct', 'operation', 70, 'delete'),
  ('customer_payments',        'direct', 'operation', 70, 'delete'),
  ('supplier_order_receptions','direct', 'operation', 70, 'delete'),
  ('ipm_ventes',               'direct', 'operation', 70, 'delete'),
  ('ipm_factures',             'direct', 'operation', 70, 'delete'),
  ('mt_expenses',              'direct', 'operation', 70, 'delete'),
  ('mt_customer_ledger',       'direct', 'operation', 70, 'delete'),
  ('notifications',            'direct', 'operation', 70, 'delete'),
  ('tenant_doc_counters',      'direct', 'operation', 70, 'delete');

-- ── OPERATION tables (restore_order 80): post-transaction ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('sale_returns',             'direct', 'operation', 80, 'delete'),
  ('sale_lot_deductions',      'direct', 'operation', 80, 'delete'),
  ('ipm_reglements',           'direct', 'operation', 80, 'delete'),
  ('ipm_rejets',               'direct', 'operation', 80, 'delete'),
  ('mt_reconciliations',       'direct', 'operation', 80, 'delete');

-- ── OPERATION tables (restore_order 90): deepest children ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('sale_return_items',        'direct', 'operation', 90, 'delete');

-- ── AUDIT tables (restore_order 80, reset_behavior = delete) ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior) VALUES
  ('site_change_log',              'direct', 'audit', 80, 'delete'),
  ('sale_deletion_log',            'direct', 'audit', 80, 'delete'),
  ('balance_reconciliation_log',   'direct', 'audit', 80, 'delete'),
  ('balance_regularization_log',   'direct', 'audit', 80, 'delete'),
  ('mt_audit_log',                 'direct', 'audit', 80, 'delete');

-- ── BACKUP_SYSTEM tables (excluded from backup) ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior, is_mandatory, exclusion_reason, tenant_id_column) VALUES
  ('tenant_backups',         'excluded', 'backup_system', 0, 'preserve', false, 'Backup data must not be overwritten by restore', 'tenant_id'),
  ('tenant_backup_settings', 'excluded', 'backup_system', 0, 'preserve', false, 'Backup schedule configuration', 'tenant_id'),
  ('_br_table_registry',     'excluded', 'backup_system', 0, 'preserve', false, 'System metadata table', NULL),
  ('_br_tenant_activation',  'excluded', 'backup_system', 0, 'preserve', false, 'Activation lock metadata', 'tenant_id');

-- ── PLATFORM tables (excluded — not tenant-scoped or platform-managed) ──
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior, is_mandatory, exclusion_reason, tenant_id_column) VALUES
  ('tenants',                  'excluded', 'platform', 0, 'preserve', false, 'Tenant identity — cannot overwrite self', 'id'),
  ('profiles',                 'excluded', 'platform', 0, 'preserve', false, 'Auth-linked — managed by auth.users triggers', 'tenant_id'),
  ('plans',                    'excluded', 'platform', 0, 'preserve', false, 'Global platform table', NULL),
  ('business_activity_types',  'excluded', 'platform', 0, 'preserve', false, 'Global platform table', NULL),
  ('master_catalogs',          'excluded', 'platform', 0, 'preserve', false, 'Global platform table', NULL),
  ('master_catalog_categories','excluded', 'platform', 0, 'preserve', false, 'Global platform table', NULL),
  ('master_catalog_items',     'excluded', 'platform', 0, 'preserve', false, 'Global platform table', NULL),
  ('platform_login_config',    'excluded', 'platform', 0, 'preserve', false, 'Global platform table', NULL),
  ('landing_config',           'excluded', 'platform', 0, 'preserve', false, 'Global platform table', NULL),
  ('app_releases',             'excluded', 'platform', 0, 'preserve', false, 'Global platform table', NULL),
  ('platform_events',          'excluded', 'platform', 0, 'preserve', false, 'Global platform table', NULL),
  ('tenant_messages',          'excluded', 'platform', 0, 'preserve', false, 'Platform messaging — cross-tenant', NULL),
  ('tenant_message_reads',     'excluded', 'platform', 0, 'preserve', false, 'Platform messaging — cross-tenant', NULL),
  ('tenant_subscriptions',     'excluded', 'platform', 0, 'preserve', false, 'Platform-managed subscription state', 'tenant_id'),
  ('subscription_action_tokens','excluded','platform', 0, 'preserve', false, 'Platform-managed subscription tokens', 'tenant_id');

-- ============================================================
-- SECTION 6: REVOKE legacy functions from PUBLIC/anon/authenticated
-- ============================================================
DO $$
DECLARE
  v_fn text;
BEGIN
  FOR v_fn IN
    SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (
        p.proname IN (
          'tenant_create_backup',
          'tenant_restore_backup',
          'tenant_restore_from_payload',
          'reset_tenant_data',
          'tenant_reset_operations',
          '_apply_tenant_metadata',
          'tenant_run_due_auto_backup'
        )
      )
  LOOP
    BEGIN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', v_fn);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', v_fn);
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', v_fn);
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Could not revoke on %: %', v_fn, SQLERRM;
    END;
  END LOOP;
END $$;
