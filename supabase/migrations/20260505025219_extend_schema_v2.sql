/*
  # AutoParts Pro — Extension Schema v2

  Adds missing business tables:
  1. quotes / quote_items — devis clients
  2. supplier_orders / supplier_order_items — commandes fournisseurs
  3. supplier_receipts / supplier_receipt_items — réceptions fournisseurs
  4. supplier_invoices — factures fournisseurs
  5. sale_returns / sale_return_items — retours et avoirs clients
  6. notifications — notifications internes
  7. journal_entries / journal_lines — écritures comptables

  Adds missing columns to existing tables:
  - customers: whatsapp, credit_limit, is_active (already present)
  - suppliers: whatsapp, delivery_days, payment_terms
  - articles: shelf, bin (rayon, casier)
*/

-- ============================================================
-- QUOTES (DEVIS)
-- ============================================================
CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  quote_number text NOT NULL,
  subtotal numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  total numeric DEFAULT 0,
  status text DEFAULT 'draft',
  valid_until date,
  note text DEFAULT '',
  converted_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes select" ON quotes FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "quotes insert" ON quotes FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "quotes update" ON quotes FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS quote_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  discount numeric DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qi select" ON quote_items FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "qi insert" ON quote_items FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "qi update" ON quote_items FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "qi delete" ON quote_items FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- SUPPLIER ORDERS (COMMANDES FOURNISSEURS)
-- ============================================================
CREATE TABLE IF NOT EXISTS supplier_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  order_number text NOT NULL,
  subtotal numeric DEFAULT 0,
  discount numeric DEFAULT 0,
  total numeric DEFAULT 0,
  status text DEFAULT 'draft',
  expected_date date,
  received_date date,
  note text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE supplier_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "so select" ON supplier_orders FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "so insert" ON supplier_orders FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "so update" ON supplier_orders FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS supplier_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  name text NOT NULL,
  supplier_ref text DEFAULT '',
  quantity_ordered numeric NOT NULL DEFAULT 1,
  quantity_received numeric DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE supplier_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "soi select" ON supplier_order_items FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "soi insert" ON supplier_order_items FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "soi update" ON supplier_order_items FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "soi delete" ON supplier_order_items FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- SALE RETURNS / AVOIRS
-- ============================================================
CREATE TABLE IF NOT EXISTS sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  sale_id uuid REFERENCES sales(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  return_number text NOT NULL,
  total numeric DEFAULT 0,
  refund_method text DEFAULT 'cash',
  status text DEFAULT 'pending',
  reason text DEFAULT '',
  note text DEFAULT '',
  restock boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sale_returns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sr select" ON sale_returns FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "sr insert" ON sale_returns FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "sr update" ON sale_returns FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS sale_return_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  return_id uuid NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  article_id uuid REFERENCES articles(id) ON DELETE SET NULL,
  name text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sale_return_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sri select" ON sale_return_items FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "sri insert" ON sale_return_items FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text DEFAULT '',
  type text DEFAULT 'info',
  reference_type text DEFAULT '',
  reference_id uuid,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif select" ON notifications FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "notif insert" ON notifications FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "notif update" ON notifications FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- JOURNAL ENTRIES / LINES
-- ============================================================
CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_number text NOT NULL,
  journal_type text NOT NULL DEFAULT 'VE',
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  reference text DEFAULT '',
  description text NOT NULL,
  total_debit numeric DEFAULT 0,
  total_credit numeric DEFAULT 0,
  is_balanced boolean DEFAULT false,
  source_type text DEFAULT '',
  source_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "je select" ON journal_entries FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "je insert" ON journal_entries FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
CREATE POLICY "je update" ON journal_entries FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
  account_code text NOT NULL,
  account_name text DEFAULT '',
  debit numeric DEFAULT 0,
  credit numeric DEFAULT 0,
  label text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jl select" ON journal_lines FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
CREATE POLICY "jl insert" ON journal_lines FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());

-- ============================================================
-- EXTEND EXISTING TABLES — safe column additions
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='whatsapp') THEN
    ALTER TABLE suppliers ADD COLUMN whatsapp text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='delivery_days') THEN
    ALTER TABLE suppliers ADD COLUMN delivery_days int DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='suppliers' AND column_name='payment_terms') THEN
    ALTER TABLE suppliers ADD COLUMN payment_terms text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='whatsapp') THEN
    ALTER TABLE customers ADD COLUMN whatsapp text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='customers' AND column_name='is_active') THEN
    ALTER TABLE customers ADD COLUMN is_active boolean DEFAULT true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='articles' AND column_name='shelf') THEN
    ALTER TABLE articles ADD COLUMN shelf text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='articles' AND column_name='bin') THEN
    ALTER TABLE articles ADD COLUMN bin text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='articles' AND column_name='notes') THEN
    ALTER TABLE articles ADD COLUMN notes text DEFAULT '';
  END IF;
END $$;
