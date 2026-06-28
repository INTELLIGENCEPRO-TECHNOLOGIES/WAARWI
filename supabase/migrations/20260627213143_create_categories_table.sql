-- Create the categories table referenced by provision_tenant and articles
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  parent_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one code per tenant
ALTER TABLE categories ADD CONSTRAINT categories_tenant_code_unique UNIQUE (tenant_id, code);

-- Indexes
CREATE INDEX idx_categories_tenant ON categories (tenant_id);
CREATE INDEX idx_categories_parent ON categories (parent_id);

-- Enable RLS
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "select_own_categories" ON categories FOR SELECT
  TO authenticated USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "insert_own_categories" ON categories FOR INSERT
  TO authenticated WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "update_own_categories" ON categories FOR UPDATE
  TO authenticated USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "delete_own_categories" ON categories FOR DELETE
  TO authenticated USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Service role bypass for provision_tenant
GRANT ALL ON categories TO service_role;

-- Add FK from articles.category_id to categories if not already present
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'articles_category_id_fkey' AND table_name = 'articles'
  ) THEN
    ALTER TABLE articles ADD CONSTRAINT articles_category_id_fkey
      FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
  END IF;
END $$;