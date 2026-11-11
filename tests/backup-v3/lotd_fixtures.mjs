import { readFileSync } from 'node:fs';
import { migration } from './deps.mjs';

// Lot D — replica of the production objects the restore/reset engine touches, with the same automatic behaviours
// (default register, closed_by forced on insert, prepayment consumption, supplier balance recalculation,
// negative stock guard, automatic numbering). Synthetic data only.
export const LOT_D = process.env.BR_LOT_D_MIGRATION || '';
export const lotDSql = () => (process.env.BR_LOT_D_SQL ? readFileSync(process.env.BR_LOT_D_SQL, 'utf8') : migration(LOT_D));

export const U = {
  ownerA: 'a0000000-0000-0000-0000-000000000001', superA: 'a0000000-0000-0000-0000-000000000002',
  cashierA: 'a0000000-0000-0000-0000-000000000003', viewerA: 'a0000000-0000-0000-0000-000000000004',
  ownerB: 'b0000000-0000-0000-0000-000000000001',
};
export const S = {
  A1: '5a000000-0000-0000-0000-000000000001', A2: '5a000000-0000-0000-0000-000000000002',
  B1: '5b000000-0000-0000-0000-000000000001',
};

export const LOTD_SCHEMA = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('brtest.uid', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE tenant_backups ADD COLUMN IF NOT EXISTS format_version integer, ADD COLUMN IF NOT EXISTS kind text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(), ADD COLUMN IF NOT EXISTS row_counts jsonb, ADD COLUMN IF NOT EXISTS checksums jsonb;

CREATE OR REPLACE FUNCTION public._br_is_verified_server()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(current_setting('role', true), 'none') = 'service_role'
      OR (session_user::text NOT IN ('authenticator','anon','authenticated','service_role')
          AND coalesce(current_setting('role', true), 'none') NOT IN ('anon','authenticated'));
$$;
CREATE OR REPLACE FUNCTION _br_insertable_columns(p_schema text, p_table text, p_payload_keys text[], p_deferred_cols text[])
RETURNS text[] LANGUAGE plpgsql STABLE AS $$
DECLARE v_cols text[];
BEGIN
  SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols FROM pg_attribute a
  WHERE a.attrelid = (p_schema || '.' || p_table)::regclass AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
    AND a.attname::text = ANY(p_payload_keys) AND a.attname::text != ALL(coalesce(p_deferred_cols, '{}'));
  RETURN coalesce(v_cols, '{}');
END $$;

CREATE TABLE sites (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, is_warehouse boolean NOT NULL DEFAULT false, parent_site_id uuid REFERENCES sites(id),
  allow_negative_stock boolean NOT NULL DEFAULT false);
CREATE TABLE profiles (id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  full_name text, role text NOT NULL DEFAULT 'viewer', permissions jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true,
  default_site_id uuid REFERENCES sites(id) ON DELETE SET NULL, assigned_site_ids uuid[] DEFAULT '{}', touched integer NOT NULL DEFAULT 0);
CREATE TABLE role_permissions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role text NOT NULL, permissions jsonb NOT NULL DEFAULT '{}');
CREATE TABLE cash_registers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE, code text NOT NULL, name text NOT NULL, is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX cash_registers_one_default_per_site ON cash_registers (site_id) WHERE is_default;
CREATE TABLE cash_register_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cash_register_id uuid NOT NULL REFERENCES cash_registers(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES auth.users(id),
  is_active boolean NOT NULL DEFAULT true);
CREATE TABLE customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, balance numeric(20,2) NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE suppliers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, balance numeric(20,2) NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE vaults (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE, current_balance numeric NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE mt_accounts (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label text NOT NULL, balance numeric NOT NULL DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE articles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL, price numeric(20,6));
CREATE TABLE part_categories (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES part_categories(id) ON DELETE CASCADE, name text NOT NULL);
CREATE TABLE stock_levels (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE, site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  quantity numeric DEFAULT 0, reserved numeric DEFAULT 0, updated_at timestamptz DEFAULT now());
CREATE TABLE stock_lots (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE, site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  initial_quantity numeric NOT NULL, remaining_quantity numeric NOT NULL);
CREATE TABLE accounting_sequences (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  journal_type text NOT NULL, fiscal_year integer NOT NULL, last_number integer NOT NULL DEFAULT 0, UNIQUE (tenant_id, journal_type, fiscal_year));
CREATE TABLE cash_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE, cash_register_id uuid NOT NULL REFERENCES cash_registers(id),
  user_id uuid REFERENCES auth.users(id), status text NOT NULL DEFAULT 'open', closed_by uuid REFERENCES auth.users(id));
CREATE UNIQUE INDEX idx_cash_sessions_one_open_per_register ON cash_sessions (cash_register_id) WHERE status = 'open';
CREATE TABLE customer_prepayments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE, amount numeric(20,2) NOT NULL, amount_used numeric(20,2) NOT NULL DEFAULT 0,
  cash_movement_id uuid);
CREATE TABLE cash_movements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL, prepayment_id uuid REFERENCES customer_prepayments(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'ENC', amount numeric(20,2) NOT NULL, receipt_number text, big bigint);
ALTER TABLE customer_prepayments ADD CONSTRAINT customer_prepayments_cm_fkey FOREIGN KEY (cash_movement_id) REFERENCES cash_movements(id) ON DELETE SET NULL;
CREATE TABLE sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id), customer_id uuid REFERENCES customers(id), session_id uuid REFERENCES cash_sessions(id),
  sale_number text, total numeric(20,6) NOT NULL DEFAULT 0);
CREATE TABLE sale_returns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE, return_number text);
CREATE TABLE customer_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id), piece_number text, amount numeric(20,2));
CREATE TABLE online_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, order_number text);
CREATE TABLE stock_documents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, doc_number text);
CREATE TABLE supplier_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id), total numeric(20,2) NOT NULL);
CREATE TABLE tenant_doc_counters (tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, doc_kind text NOT NULL,
  last_number bigint NOT NULL DEFAULT 0, PRIMARY KEY (tenant_id, doc_kind));
CREATE TABLE cash_supervision_requests (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id uuid REFERENCES cash_sessions(id) ON DELETE CASCADE, note text);

CREATE OR REPLACE FUNCTION next_doc_number(p_tenant_id uuid, p_kind text, p_prefix text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number) VALUES (p_tenant_id, p_kind, 1)
  ON CONFLICT (tenant_id, doc_kind) DO UPDATE SET last_number = tenant_doc_counters.last_number + 1 RETURNING last_number INTO n;
  RETURN p_prefix || '-' || lpad(n::text, 5, '0');
END $$;
CREATE OR REPLACE FUNCTION _ensure_default_cash_register(p_tenant_id uuid, p_site_id uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM cash_registers WHERE site_id = p_site_id AND is_default;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO cash_registers (tenant_id, site_id, code, name, is_active, is_default) VALUES (p_tenant_id, p_site_id, 'CAISSE-1', 'Caisse 1', true, true)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION _trg_sites_default_cash_register() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM _ensure_default_cash_register(NEW.tenant_id, NEW.id); RETURN NULL; END $$;
CREATE TRIGGER _trg_sites_default_cash_register AFTER INSERT ON sites FOR EACH ROW EXECUTE FUNCTION _trg_sites_default_cash_register();
CREATE OR REPLACE FUNCTION _trg_cash_sessions_register() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.cash_register_id IS NULL THEN NEW.cash_register_id := _ensure_default_cash_register(NEW.tenant_id, NEW.site_id); END IF; RETURN NEW; END $$;
CREATE TRIGGER _trg_cash_sessions_register BEFORE INSERT ON cash_sessions FOR EACH ROW EXECUTE FUNCTION _trg_cash_sessions_register();
CREATE OR REPLACE FUNCTION _trg_cs_closed_by() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.closed_by := NULL; RETURN NEW; END $$;
CREATE TRIGGER _trg_cs_closed_by BEFORE INSERT ON cash_sessions FOR EACH ROW EXECUTE FUNCTION _trg_cs_closed_by();
CREATE OR REPLACE FUNCTION assign_cash_movement_receipt_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.receipt_number IS NULL THEN
    NEW.receipt_number := NEW.kind || '-' || lpad(split_part(next_doc_number(NEW.tenant_id, 'cm_' || NEW.kind, 'X'), '-', 2)::bigint::text, 8, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assign_cash_movement_receipt_number BEFORE INSERT ON cash_movements FOR EACH ROW EXECUTE FUNCTION assign_cash_movement_receipt_number();
CREATE OR REPLACE FUNCTION _trg_sale_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.sale_number IS NULL THEN NEW.sale_number := next_doc_number(NEW.tenant_id, 'sale', 'V'); END IF; RETURN NEW; END $$;
CREATE TRIGGER _trg_sale_public_code BEFORE INSERT ON sales FOR EACH ROW EXECUTE FUNCTION _trg_sale_number();
CREATE OR REPLACE FUNCTION apply_customer_prepayments() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS NOT NULL THEN
    UPDATE customer_prepayments SET amount_used = least(amount, amount_used + NEW.total) WHERE customer_id = NEW.customer_id AND amount_used < amount;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER sales_apply_prepayments AFTER INSERT ON sales FOR EACH ROW EXECUTE FUNCTION apply_customer_prepayments();
CREATE OR REPLACE FUNCTION update_supplier_balance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE suppliers s SET balance = (SELECT coalesce(sum(o.total), 0) FROM supplier_orders o WHERE o.supplier_id = s.id) WHERE s.id = NEW.supplier_id;
  RETURN NULL;
END $$;
CREATE TRIGGER trigger_update_supplier_balance AFTER INSERT OR UPDATE ON supplier_orders FOR EACH ROW EXECUTE FUNCTION update_supplier_balance();
CREATE OR REPLACE FUNCTION check_negative_stock_trigger_fn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quantity < 0 AND NOT (SELECT allow_negative_stock FROM sites WHERE id = NEW.site_id) THEN
    RAISE EXCEPTION '[NEGATIVE_STOCK_FORBIDDEN]';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER check_negative_stock_trigger BEFORE INSERT OR UPDATE ON stock_levels FOR EACH ROW EXECUTE FUNCTION check_negative_stock_trigger_fn();
CREATE OR REPLACE FUNCTION trg_profiles_touch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.touched := NEW.touched + 1; RETURN NEW; END $$;
CREATE TRIGGER trg_set_owner_access_mode BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION trg_profiles_touch();

UPDATE _br_table_registry SET created_at = '2026-09-04', restore_order = 30 WHERE table_name LIKE 'syn\\_%';
UPDATE _br_table_registry SET restore_order = 40 WHERE table_name = 'syn_child';
INSERT INTO _br_table_registry (table_name, tenant_link, tenant_id_column, category, restore_order, reset_behavior, self_ref_columns, deferred_fk_columns, created_at) VALUES
 ('sites','direct','tenant_id','structure',10,'preserve',ARRAY['parent_site_id'],NULL,'2026-09-04'),
 ('role_permissions','direct','tenant_id','structure',10,'preserve',NULL,NULL,'2026-09-04'),
 ('accounting_sequences','direct','tenant_id','structure',10,'preserve',NULL,NULL,'2026-09-04'),
 ('part_categories','direct','tenant_id','structure',10,'preserve',ARRAY['parent_id'],NULL,'2026-09-04'),
 ('vaults','direct','tenant_id','structure',20,'preserve',NULL,NULL,'2026-09-04'),
 ('customers','direct','tenant_id','structure',20,'preserve',NULL,NULL,'2026-09-04'),
 ('suppliers','direct','tenant_id','structure',20,'preserve',NULL,NULL,'2026-09-04'),
 ('mt_accounts','direct','tenant_id','structure',20,'preserve',NULL,NULL,'2026-09-04'),
 ('cash_registers','direct','tenant_id','structure',20,'preserve',NULL,NULL,'2026-10-30'),
 ('articles','direct','tenant_id','structure',30,'preserve',NULL,NULL,'2026-09-04'),
 ('cash_register_assignments','direct','tenant_id','structure',40,'preserve',NULL,NULL,'2026-10-30'),
 ('stock_levels','direct','tenant_id','structure',40,'preserve',NULL,NULL,'2026-09-04'),
 ('stock_lots','direct','tenant_id','structure',40,'preserve',NULL,NULL,'2026-09-04'),
 ('cash_sessions','direct','tenant_id','operation',50,'delete',NULL,NULL,'2026-09-04'),
 ('customer_prepayments','direct','tenant_id','operation',50,'delete',NULL,ARRAY['cash_movement_id'],'2026-09-04'),
 ('sales','direct','tenant_id','operation',60,'delete',NULL,NULL,'2026-09-04'),
 ('supplier_orders','direct','tenant_id','operation',60,'delete',NULL,NULL,'2026-09-04'),
 ('online_orders','direct','tenant_id','operation',60,'delete',NULL,NULL,'2026-09-04'),
 ('stock_documents','direct','tenant_id','operation',60,'delete',NULL,NULL,'2026-09-04'),
 ('cash_supervision_requests','direct','tenant_id','operation',60,'delete',NULL,NULL,'2026-11-10'),
 ('cash_movements','direct','tenant_id','operation',70,'delete',NULL,NULL,'2026-09-04'),
 ('customer_payments','direct','tenant_id','operation',70,'delete',NULL,NULL,'2026-09-04'),
 ('tenant_doc_counters','direct','tenant_id','operation',70,'delete',NULL,NULL,'2026-09-04'),
 ('sale_returns','direct','tenant_id','operation',80,'delete',NULL,NULL,'2026-09-04');
UPDATE _br_table_registry SET reset_behavior = 'delete' WHERE table_name IN ('syn_items','syn_nopk');
`;

export const LOTD_REGISTRY_PROFILES = `
INSERT INTO _br_table_registry (table_name, tenant_link, tenant_id_column, category, exclusion_reason)
VALUES ('profiles','excluded','tenant_id','platform','identities are never restored');
`;

// Tenant A: 2 shops (A2 allows negative stock), 3 registers, 4 users, open + closed sessions; tenant B = control.
export const LOTD_SEED = `
INSERT INTO auth.users (id) VALUES ('${U.ownerA}'),('${U.superA}'),('${U.cashierA}'),('${U.viewerA}'),('${U.ownerB}');
UPDATE tenants SET owner_user_id = '${U.ownerA}' WHERE id = '00000000-0000-0000-0000-00000000000a';
UPDATE tenants SET owner_user_id = '${U.ownerB}' WHERE id = '00000000-0000-0000-0000-00000000000b';
INSERT INTO sites (id, tenant_id, name, allow_negative_stock) VALUES
  ('${S.A1}','00000000-0000-0000-0000-00000000000a','Magasin A1',false),
  ('${S.A2}','00000000-0000-0000-0000-00000000000a','Magasin A2',true),
  ('${S.B1}','00000000-0000-0000-0000-00000000000b','Magasin B1',false);
INSERT INTO sites (tenant_id, name, is_warehouse, parent_site_id) VALUES ('00000000-0000-0000-0000-00000000000a','Dépôt A1',true,'${S.A1}');
INSERT INTO profiles (id, tenant_id, full_name, role, default_site_id, assigned_site_ids, permissions) VALUES
  ('${U.ownerA}','00000000-0000-0000-0000-00000000000a','Owner A','admin','${S.A1}',ARRAY['${S.A1}','${S.A2}']::uuid[],'{"all":true}'),
  ('${U.superA}','00000000-0000-0000-0000-00000000000a','Super A','super_admin','${S.A2}','{}','{}'),
  ('${U.cashierA}','00000000-0000-0000-0000-00000000000a','Caissier A','cashier','${S.A2}',ARRAY['${S.A2}']::uuid[],'{"pos":true}'),
  ('${U.viewerA}','00000000-0000-0000-0000-00000000000a','Lecteur A','viewer',NULL,'{}','{}'),
  ('${U.ownerB}','00000000-0000-0000-0000-00000000000b','Owner B','admin','${S.B1}','{}','{}');
INSERT INTO role_permissions (tenant_id, role, permissions) VALUES ('00000000-0000-0000-0000-00000000000a','cashier','{"sell":true}'),
  ('00000000-0000-0000-0000-00000000000b','cashier','{"sell":false}');
INSERT INTO cash_registers (tenant_id, site_id, code, name) VALUES ('00000000-0000-0000-0000-00000000000a','${S.A1}','CAISSE-2','Caisse 2');
INSERT INTO cash_register_assignments (tenant_id, cash_register_id, user_id)
  SELECT tenant_id, id, '${U.cashierA}' FROM cash_registers WHERE tenant_id = '00000000-0000-0000-0000-00000000000a' AND site_id = '${S.A2}';
INSERT INTO accounting_sequences (tenant_id, journal_type, fiscal_year, last_number) VALUES
  ('00000000-0000-0000-0000-00000000000a','VT',2026,41),('00000000-0000-0000-0000-00000000000b','VT',2026,7);
INSERT INTO part_categories (id, tenant_id, parent_id, name) VALUES
  ('c0000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000a',NULL,'Racine');
INSERT INTO part_categories (id, tenant_id, parent_id, name) VALUES
  ('c0000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000003','Freins');
INSERT INTO part_categories (id, tenant_id, parent_id, name) VALUES
  ('c0000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-000000000001','Plaquettes');
INSERT INTO vaults (tenant_id, site_id, current_balance) VALUES ('00000000-0000-0000-0000-00000000000a','${S.A1}',150000.50),
  ('00000000-0000-0000-0000-00000000000a','${S.A2}',99999999999999.99),('00000000-0000-0000-0000-00000000000b','${S.B1}',10);
INSERT INTO mt_accounts (tenant_id, label, balance) VALUES ('00000000-0000-0000-0000-00000000000a','Orange Money',123456789.123456789),
  ('00000000-0000-0000-0000-00000000000b','Wave',5);
INSERT INTO customers (id, tenant_id, name, balance) VALUES
  ('cc000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','Client 1',2500.00),
  ('cc000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','Client 2',-75.25),
  ('cc000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','Client B',1);
INSERT INTO suppliers (id, tenant_id, name) VALUES ('5f000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','Fournisseur 1'),
  ('5f000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','Fournisseur B');
INSERT INTO supplier_orders (tenant_id, supplier_id, total) VALUES ('00000000-0000-0000-0000-00000000000a','5f000000-0000-0000-0000-000000000001',1000),
  ('00000000-0000-0000-0000-00000000000a','5f000000-0000-0000-0000-000000000001',234.56),
  ('00000000-0000-0000-0000-00000000000b','5f000000-0000-0000-0000-0000000000b1',9);
UPDATE suppliers SET balance = balance - 34.56 WHERE id = '5f000000-0000-0000-0000-000000000001';
INSERT INTO articles (id, tenant_id, name, price) VALUES ('ae000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','Plaquette',12345.678901),
  ('ae000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','Disque',0.000001),
  ('ae000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','Article B',1);
INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity, reserved) VALUES
  ('00000000-0000-0000-0000-00000000000a','ae000000-0000-0000-0000-000000000001','${S.A1}',10.5,1),
  ('00000000-0000-0000-0000-00000000000a','ae000000-0000-0000-0000-000000000001','${S.A2}',-3,0),
  ('00000000-0000-0000-0000-00000000000a','ae000000-0000-0000-0000-000000000002','${S.A2}',7,0),
  ('00000000-0000-0000-0000-00000000000b','ae000000-0000-0000-0000-0000000000b1','${S.B1}',4,0);
INSERT INTO stock_lots (tenant_id, article_id, site_id, initial_quantity, remaining_quantity) VALUES
  ('00000000-0000-0000-0000-00000000000a','ae000000-0000-0000-0000-000000000001','${S.A1}',20,10.5);
INSERT INTO cash_sessions (id, tenant_id, site_id, cash_register_id, user_id, status)
  SELECT '5e000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','${S.A1}', id, '${U.cashierA}','closed'
  FROM cash_registers WHERE site_id = '${S.A1}' AND code = 'CAISSE-2';
UPDATE cash_sessions SET closed_by = '${U.ownerA}' WHERE id = '5e000000-0000-0000-0000-000000000001';
INSERT INTO cash_sessions (id, tenant_id, site_id, user_id, status) VALUES
  ('5e000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','${S.A1}','${U.cashierA}','open'),
  ('5e000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-00000000000a','${S.A2}','${U.cashierA}','open'),
  ('5e000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-00000000000b','${S.B1}','${U.ownerB}','open');
INSERT INTO customer_prepayments (id, tenant_id, customer_id, amount) VALUES
  ('9e000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','cc000000-0000-0000-0000-000000000001',500);
INSERT INTO cash_movements (id, tenant_id, session_id, prepayment_id, kind, amount, big) VALUES
  ('3e000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a','5e000000-0000-0000-0000-000000000002','9e000000-0000-0000-0000-000000000001','ACO',500,9223372036854775807);
UPDATE customer_prepayments SET cash_movement_id = '3e000000-0000-0000-0000-000000000001' WHERE id = '9e000000-0000-0000-0000-000000000001';
INSERT INTO cash_movements (tenant_id, session_id, kind, amount) VALUES
  ('00000000-0000-0000-0000-00000000000a','5e000000-0000-0000-0000-000000000003','ENC',1999.99),
  ('00000000-0000-0000-0000-00000000000b','5e000000-0000-0000-0000-0000000000b1','ENC',1);
INSERT INTO sales (tenant_id, site_id, customer_id, session_id, total)
  SELECT '00000000-0000-0000-0000-00000000000a', CASE WHEN g % 2 = 0 THEN '${S.A1}' ELSE '${S.A2}' END::uuid,
         CASE WHEN g = 1 THEN 'cc000000-0000-0000-0000-000000000001' END::uuid,
         CASE WHEN g % 2 = 0 THEN '5e000000-0000-0000-0000-000000000002' ELSE '5e000000-0000-0000-0000-000000000003' END::uuid,
         100.000001 * g FROM generate_series(1, 12) g;
INSERT INTO sales (tenant_id, site_id, total) VALUES ('00000000-0000-0000-0000-00000000000b','${S.B1}',5);
INSERT INTO sale_returns (tenant_id, sale_id, return_number)
  SELECT tenant_id, id, next_doc_number(tenant_id, 'return', 'RET') FROM sales WHERE tenant_id = '00000000-0000-0000-0000-00000000000a' ORDER BY sale_number LIMIT 2;
INSERT INTO customer_payments (tenant_id, customer_id, piece_number, amount) VALUES
  ('00000000-0000-0000-0000-00000000000a','cc000000-0000-0000-0000-000000000002', next_doc_number('00000000-0000-0000-0000-00000000000a','reglement_client','REG'), 10);
INSERT INTO online_orders (tenant_id, order_number) VALUES ('00000000-0000-0000-0000-00000000000a','WEB-00004');
INSERT INTO stock_documents (tenant_id, doc_number) VALUES ('00000000-0000-0000-0000-00000000000a', next_doc_number('00000000-0000-0000-0000-00000000000a','stock_exit','BS'));
INSERT INTO cash_supervision_requests (tenant_id, session_id, note) VALUES ('00000000-0000-0000-0000-00000000000a','5e000000-0000-0000-0000-000000000003','controle');
UPDATE tenant_doc_counters SET last_number = 3 WHERE tenant_id = '00000000-0000-0000-0000-00000000000a' AND doc_kind = 'online_order';
INSERT INTO tenant_doc_counters VALUES ('00000000-0000-0000-0000-00000000000a','quote',2);
`;

// Test-only SQL helpers: v2 archive builder (same payload/checksum layout as production v2) and per-tenant fingerprints.
export const LOTD_TEST_HELPERS = `
CREATE OR REPLACE FUNCTION _t_make_v2(p_tenant uuid, p_omit text[], p_created timestamptz, p_drop jsonb DEFAULT '{}', p_style text DEFAULT 'sha256')
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE r record; v_payload jsonb := '{}'; v_counts jsonb := '{}'; v_checks jsonb := '{}'; v_arr jsonb; v_id uuid; v_drop text[]; v_chk text; v_ord text;
BEGIN
  FOR r IN SELECT table_name FROM _br_table_registry WHERE tenant_link IN ('direct','indirect') AND NOT (table_name = ANY (p_omit)) LOOP
    v_drop := ARRAY(SELECT jsonb_array_elements_text(coalesce(p_drop -> r.table_name, '[]')));
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t) - $2), ''[]'') FROM public.%I t WHERE %s', r.table_name, _br_rs_tenant_pred(r.table_name, 't'))
      INTO v_arr USING p_tenant, v_drop;
    v_payload := v_payload || jsonb_build_object(r.table_name, v_arr);
    v_counts := v_counts || jsonb_build_object(r.table_name, jsonb_array_length(v_arr));
    IF p_style = 'md5' THEN
      v_ord := CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                     AND c.table_name = r.table_name AND c.column_name = 'id') THEN 't.id::text' ELSE 'row_to_json(t)::text' END;
      EXECUTE format('SELECT md5(string_agg(md5(row_to_json(t)::text), '''' ORDER BY %s)) FROM public.%I t WHERE %s',
                     v_ord, r.table_name, _br_rs_tenant_pred(r.table_name, 't')) INTO v_chk USING p_tenant;
    ELSE
      SELECT encode(sha256(convert_to(string_agg(j::text, '' ORDER BY j::text), 'UTF8')), 'hex') INTO v_chk FROM jsonb_array_elements(v_arr) j;
    END IF;
    IF jsonb_array_length(v_arr) = 0 AND p_style <> 'sha256' THEN v_chk := ''; END IF;
    v_checks := v_checks || jsonb_build_object(r.table_name, v_chk);
  END LOOP;
  INSERT INTO tenant_backups (tenant_id, status, payload, format_version, kind, created_at, row_counts, checksums)
  VALUES (p_tenant, 'verified', v_payload, 2, 'manual', p_created, v_counts, v_checks) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
CREATE OR REPLACE FUNCTION _t_tenant_state(p_tenant uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r record; v jsonb := '{}'; l record;
BEGIN
  FOR r IN SELECT table_name FROM _br_table_registry WHERE tenant_link IN ('direct','indirect') ORDER BY table_name LOOP
    SELECT * INTO l FROM _br_rs_live_state(r.table_name, p_tenant);
    v := v || jsonb_build_object(r.table_name, l.o_rows::text || ':' || coalesce(l.o_checksum, '-'));
  END LOOP;
  RETURN v || jsonb_build_object('profiles', (SELECT count(*)::text || ':' || md5(string_agg(to_jsonb(p)::text, '' ORDER BY p.id)) FROM profiles p WHERE p.tenant_id = p_tenant),
    'auth.users', (SELECT count(*)::text || ':' || md5(string_agg(to_jsonb(u)::text, '' ORDER BY u.id)) FROM auth.users u));
END $$;
`;
