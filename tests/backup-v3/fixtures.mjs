import { readFileSync } from 'node:fs';
import { migration } from './deps.mjs';

// Minimal stand-ins for the production objects the backup queue depends on, plus synthetic business tables.
export const STUBS = `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE br_backup_status AS ENUM ('creating','verified','failed','legacy','incompatible');
CREATE TABLE tenants (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, is_active boolean NOT NULL DEFAULT true);
CREATE TABLE tenant_backups (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status br_backup_status NOT NULL DEFAULT 'creating', payload jsonb NOT NULL DEFAULT '{}');
CREATE TABLE _br_table_registry (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schema_name text NOT NULL DEFAULT 'public', table_name text NOT NULL,
  tenant_link text NOT NULL, tenant_id_column text, parent_table text, category text NOT NULL, restore_order int NOT NULL DEFAULT 0,
  reset_behavior text NOT NULL DEFAULT 'preserve', self_ref_columns text[], is_mandatory boolean DEFAULT false, exclusion_reason text,
  created_at timestamptz DEFAULT now(), deferred_fk_columns text[], UNIQUE (schema_name, table_name));
CREATE TABLE _br_tenant_schedule_override (tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE, suspended boolean NOT NULL DEFAULT false);
CREATE OR REPLACE FUNCTION br_check_schema_drift() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_unregistered jsonb; v_missing jsonb;
BEGIN
SELECT coalesce(jsonb_agg(c.relname::text ORDER BY c.relname::text), '[]'::jsonb) INTO v_unregistered
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.attname = 'tenant_id' AND a.attnum > 0 AND NOT a.attisdropped
AND NOT EXISTS (SELECT 1 FROM _br_table_registry r WHERE r.schema_name = 'public' AND r.table_name = c.relname::text);
SELECT coalesce(jsonb_agg(r.table_name ORDER BY r.table_name), '[]'::jsonb) INTO v_missing FROM _br_table_registry r
WHERE r.schema_name = 'public' AND r.tenant_link != 'excluded' AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r');
RETURN jsonb_build_object('unregistered_tables', v_unregistered, 'missing_tables', v_missing,
'drift_detected', (v_unregistered != '[]'::jsonb OR v_missing != '[]'::jsonb), 'checked_at', now());
END $$;
CREATE TABLE syn_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label text, amount numeric(20,6), big bigint);
CREATE TABLE syn_counters (tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, doc_kind text NOT NULL, value bigint NOT NULL,
  PRIMARY KEY (tenant_id, doc_kind));
CREATE TABLE syn_nopk (tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, label text, qty int);
CREATE TABLE syn_parent (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name text);
CREATE TABLE syn_child (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parent_id uuid NOT NULL REFERENCES syn_parent(id) ON DELETE CASCADE, note text);
INSERT INTO _br_table_registry (table_name, tenant_link, tenant_id_column, parent_table, category) VALUES
 ('syn_items','direct','tenant_id',NULL,'operation'), ('syn_counters','direct','tenant_id',NULL,'structure'),
 ('syn_nopk','direct','tenant_id',NULL,'operation'), ('syn_parent','direct','tenant_id',NULL,'structure'),
 ('syn_child','indirect',NULL,'syn_parent','structure'),
 ('tenant_backups','excluded','tenant_id',NULL,'backup_system'), ('_br_tenant_schedule_override','excluded','tenant_id',NULL,'backup_system');
`;

export const SEED = `
INSERT INTO tenants (id, name) VALUES
  ('00000000-0000-0000-0000-00000000000a','A'), ('00000000-0000-0000-0000-00000000000b','B'),
  ('00000000-0000-0000-0000-00000000000c','C'), ('00000000-0000-0000-0000-00000000000d','D-suspended');
INSERT INTO _br_tenant_schedule_override VALUES ('00000000-0000-0000-0000-00000000000d', true);
INSERT INTO syn_items (tenant_id, label, amount, big)
  SELECT t, 'item ' || g, 1234567890.123456 + g, 9007199254740993 + g
  FROM unnest(ARRAY['00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b']::uuid[]) t, generate_series(1,50) g;
INSERT INTO syn_counters VALUES ('00000000-0000-0000-0000-00000000000a','sale',10),('00000000-0000-0000-0000-00000000000a','quote',3),
  ('00000000-0000-0000-0000-00000000000b','sale',99);
INSERT INTO syn_nopk VALUES ('00000000-0000-0000-0000-00000000000a','dup',1),('00000000-0000-0000-0000-00000000000a','dup',1),
  ('00000000-0000-0000-0000-00000000000a','zz',2),('00000000-0000-0000-0000-00000000000b','other',5);
INSERT INTO syn_parent (id, tenant_id, name) VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','pa'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b','pb');
INSERT INTO syn_child (parent_id, note) VALUES ('10000000-0000-0000-0000-000000000001','c1'),('10000000-0000-0000-0000-000000000001','c2'),
  ('10000000-0000-0000-0000-000000000002','c3');
`;

export const IDS = {
  A: '00000000-0000-0000-0000-00000000000a', B: '00000000-0000-0000-0000-00000000000b',
  C: '00000000-0000-0000-0000-00000000000c', D: '00000000-0000-0000-0000-00000000000d',
};
export const EXPECTED_A = 50 + 2 + 3 + 1 + 2;

export const QUEUE_MIGRATIONS = [
  '20261018145906_p0_2a_durable_backup_job_queue_inactive.sql',
  '20261018154909_p0_2a1_tenant_backups_job_composite_fk.sql',
];
export const LOT_B = '20261110231312_lot_b_durable_capture_engine_inactive.sql';
export const LOT_B1 = '20261110234624_lot_b1_server_capture_executor_inactive.sql';
export const LOT_C = '20261111005055_lot_c_block_export_verified_publication_inactive.sql';
export const lotCSql = () => (process.env.BR_LOT_C_SQL ? readFileSync(process.env.BR_LOT_C_SQL, 'utf8') : migration(LOT_C));

// Stand-in for the production permission helper (owner/super_admin of the current tenant), driven by GUCs.
export const LOT_C_STUBS = `
CREATE OR REPLACE FUNCTION _br_can_manage_backups(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce(current_setting('brtest.uid', true), '') <> ''
     AND p_tenant::text = current_setting('brtest.tenant', true)
     AND current_setting('brtest.admin', true) = 'on';
$$;
`;

export async function installLotC(exec) {
  await exec(LOT_C_STUBS);
  await exec(lotCSql());
}

export async function installSchema(exec) {
  await exec(STUBS);
  for (const m of QUEUE_MIGRATIONS) await exec(migration(m));
  await exec(migration(LOT_B));
  await exec(migration(LOT_B1));
}
