/*
  # AutoParts Pro Sénégal — Fondations

  Cette migration crée les fondations de l'application SaaS multi-tenant.

  1. Tables principales
    - tenants: entreprises clientes (isolation multi-tenant)
    - profiles: profils utilisateurs liés à auth.users avec tenant_id
    - sites: magasins / points de vente
    - vehicle_brands, vehicle_models: référentiel automobile
    - part_categories: catégories hiérarchiques de pièces
    - articles: fiche produit/pièce détachée
    - article_compatibilities: compatibilités véhicules
    - stock_levels: niveaux de stock par site
    - stock_movements: historique de tous les mouvements
    - customers, suppliers: tiers
    - cash_sessions: sessions de caisse
    - sales, sale_items, sale_payments: ventes comptoir
    - payment_methods: modes de règlement configurables
    - accounts: plan comptable SYSCOHADA
    - journal_entries, journal_lines: écritures comptables
    - audit_logs: journal d'audit

  2. Sécurité
    - RLS activé sur toutes les tables
    - Politiques basées sur tenant_id via profiles
    - Fonction helper current_tenant_id() pour éviter la récursion

  3. Notes
    - Les montants sont stockés en FCFA (numeric, pas de décimales par défaut)
    - Les références sont uniques par tenant
    - Les suppressions sont logiques via is_active
*/

-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- TENANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  legal_name text DEFAULT '',
  ninea text DEFAULT '',
  rccm text DEFAULT '',
  address text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  logo_url text DEFAULT '',
  primary_color text DEFAULT '#0f766e',
  currency text DEFAULT 'FCFA',
  status text DEFAULT 'active',
  plan text DEFAULT 'trial',
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- PROFILES (extends auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  full_name text DEFAULT '',
  email text DEFAULT '',
  phone text DEFAULT '',
  role text DEFAULT 'admin',
  permissions jsonb DEFAULT '{}'::jsonb,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Helper: get tenant_id from current user, avoids RLS recursion
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT tenant_id FROM profiles WHERE id = auth.uid() LIMIT 1;
$$;

-- Profiles policies
CREATE POLICY "Users view own profile"
  ON profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR tenant_id = current_tenant_id());

CREATE POLICY "Users insert own profile"
  ON profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Tenants policies
CREATE POLICY "Members view their tenant"
  ON tenants FOR SELECT TO authenticated
  USING (id = current_tenant_id());

CREATE POLICY "Authenticated create tenant"
  ON tenants FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Members update their tenant"
  ON tenants FOR UPDATE TO authenticated
  USING (id = current_tenant_id())
  WITH CHECK (id = current_tenant_id());

-- ============================================================
-- SITES / MAGASINS
-- ============================================================
CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text DEFAULT '',
  address text DEFAULT '',
  phone text DEFAULT '',
  is_warehouse boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members view sites"
  ON sites FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());
CREATE POLICY "Tenant members create sites"
  ON sites FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "Tenant members update sites"
  ON sites FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "Tenant members delete sites"
  ON sites FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id());

-- ============================================================
-- RÉFÉRENTIEL VÉHICULES
-- ============================================================
CREATE TABLE IF NOT EXISTS vehicle_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  logo_url text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE vehicle_brands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "veh brands select" ON vehicle_brands FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "veh brands insert" ON vehicle_brands FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "veh brands update" ON vehicle_brands FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "veh brands delete" ON vehicle_brands FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS vehicle_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  year_start int DEFAULT 0,
  year_end int DEFAULT 0,
  engine text DEFAULT '',
  fuel text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE vehicle_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY "veh models select" ON vehicle_models FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "veh models insert" ON vehicle_models FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "veh models update" ON vehicle_models FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "veh models delete" ON vehicle_models FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- CATÉGORIES PIÈCES
-- ============================================================
CREATE TABLE IF NOT EXISTS part_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES part_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE part_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cat select" ON part_categories FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "cat insert" ON part_categories FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "cat update" ON part_categories FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "cat delete" ON part_categories FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- SUPPLIERS
-- ============================================================
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact text DEFAULT '',
  phone text DEFAULT '',
  email text DEFAULT '',
  address text DEFAULT '',
  country text DEFAULT 'Sénégal',
  balance numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sup select" ON suppliers FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "sup insert" ON suppliers FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "sup update" ON suppliers FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "sup delete" ON suppliers FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- CUSTOMERS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text DEFAULT '',
  email text DEFAULT '',
  address text DEFAULT '',
  customer_type text DEFAULT 'particulier',
  ninea text DEFAULT '',
  credit_limit numeric DEFAULT 0,
  balance numeric DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cust select" ON customers FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "cust insert" ON customers FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "cust update" ON customers FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "cust delete" ON customers FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- ARTICLES
-- ============================================================
CREATE TABLE IF NOT EXISTS articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  internal_ref text NOT NULL,
  name text NOT NULL,
  description text DEFAULT '',
  category_id uuid REFERENCES part_categories(id) ON DELETE SET NULL,
  brand text DEFAULT '',
  oem_ref text DEFAULT '',
  supplier_ref text DEFAULT '',
  barcode text DEFAULT '',
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  condition text DEFAULT 'neuf',
  unit text DEFAULT 'pièce',
  purchase_price numeric DEFAULT 0,
  sale_price numeric DEFAULT 0,
  min_price numeric DEFAULT 0,
  wholesale_price numeric DEFAULT 0,
  vat_rate numeric DEFAULT 0,
  stock_min numeric DEFAULT 0,
  stock_max numeric DEFAULT 0,
  location text DEFAULT '',
  image_url text DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, internal_ref)
);

CREATE INDEX IF NOT EXISTS idx_articles_tenant ON articles(tenant_id);
CREATE INDEX IF NOT EXISTS idx_articles_barcode ON articles(barcode);
CREATE INDEX IF NOT EXISTS idx_articles_name ON articles(tenant_id, name);

ALTER TABLE articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "art select" ON articles FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "art insert" ON articles FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "art update" ON articles FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "art delete" ON articles FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- COMPATIBILITÉS
-- ============================================================
CREATE TABLE IF NOT EXISTS article_compatibilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES vehicle_brands(id) ON DELETE CASCADE,
  model_id uuid REFERENCES vehicle_models(id) ON DELETE CASCADE,
  year_start int DEFAULT 0,
  year_end int DEFAULT 0,
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE article_compatibilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "compat select" ON article_compatibilities FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "compat insert" ON article_compatibilities FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "compat update" ON article_compatibilities FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "compat delete" ON article_compatibilities FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- STOCKS
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  quantity numeric DEFAULT 0,
  reserved numeric DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (article_id, site_id)
);

ALTER TABLE stock_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stk select" ON stock_levels FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "stk insert" ON stock_levels FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "stk update" ON stock_levels FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "stk delete" ON stock_levels FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  movement_type text NOT NULL,
  quantity numeric NOT NULL,
  previous_qty numeric DEFAULT 0,
  new_qty numeric DEFAULT 0,
  unit_cost numeric DEFAULT 0,
  reference_type text DEFAULT '',
  reference_id uuid,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stmov_tenant ON stock_movements(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stmov_article ON stock_movements(article_id);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stmov select" ON stock_movements FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "stmov insert" ON stock_movements FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- PAYMENT METHODS
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  payment_type text DEFAULT 'cash',
  account_code text DEFAULT '',
  is_active boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pm select" ON payment_methods FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "pm insert" ON payment_methods FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "pm update" ON payment_methods FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "pm delete" ON payment_methods FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- CAISSE
-- ============================================================
CREATE TABLE IF NOT EXISTS cash_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  opening_amount numeric DEFAULT 0,
  closing_amount numeric DEFAULT 0,
  theoretical_amount numeric DEFAULT 0,
  variance numeric DEFAULT 0,
  status text DEFAULT 'open',
  note text DEFAULT ''
);

ALTER TABLE cash_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cs select" ON cash_sessions FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "cs insert" ON cash_sessions FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "cs update" ON cash_sessions FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- VENTES
-- ============================================================
CREATE TABLE IF NOT EXISTS sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sale_number text NOT NULL,
  subtotal numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  vat_amount numeric DEFAULT 0,
  total numeric DEFAULT 0,
  paid numeric DEFAULT 0,
  status text DEFAULT 'paid',
  source text DEFAULT 'pos',
  note text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_tenant ON sales(tenant_id, created_at DESC);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sales select" ON sales FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "sales insert" ON sales FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "sales update" ON sales FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS sale_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE RESTRICT,
  name text NOT NULL,
  quantity numeric NOT NULL,
  unit_price numeric NOT NULL,
  discount numeric DEFAULT 0,
  vat_rate numeric DEFAULT 0,
  total numeric NOT NULL,
  purchase_cost numeric DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "si select" ON sale_items FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "si insert" ON sale_items FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  method_name text NOT NULL,
  amount numeric NOT NULL,
  reference text DEFAULT '',
  status text DEFAULT 'confirmed',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sp select" ON sale_payments FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "sp insert" ON sale_payments FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- COMPTABILITÉ
-- ============================================================
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  class int DEFAULT 0,
  account_type text DEFAULT 'general',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, code)
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "acc select" ON accounts FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "acc insert" ON accounts FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "acc update" ON accounts FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- AUDIT
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  module text DEFAULT '',
  reference_id uuid,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit select" ON audit_logs FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "audit insert" ON audit_logs FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
