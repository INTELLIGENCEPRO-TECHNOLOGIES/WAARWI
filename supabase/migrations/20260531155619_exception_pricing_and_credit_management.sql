/*
  # Exception Pricing and Credit/Solvency Management

  1. New Tables
    - `customer_exception_prices`
      - `id` (uuid, primary key)
      - `tenant_id` (uuid, FK to tenants)
      - `customer_id` (uuid, FK to customers)
      - `article_id` (uuid, FK to articles)
      - `exception_price` (numeric) - the special price for this customer on this article
      - `min_qty` (integer, default 1) - minimum quantity for the exception price to apply
      - `valid_from` (date, nullable) - optional start date
      - `valid_until` (date, nullable) - optional end date
      - `note` (text) - optional note about the exception
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Modified Tables
    - `suppliers`: Add `credit_limit` column (numeric, default 0)
    - `customers`: Add `credit_blocked` column (boolean, default false) - manual block on credit sales

  3. Security
    - Enable RLS on `customer_exception_prices`
    - Policies for authenticated users belonging to the same tenant

  4. Notes
    - Exception prices override normal sale_price for specific customers
    - Credit limit of 0 means unlimited credit (no restriction)
    - A positive credit_limit means balance cannot exceed that amount
    - credit_blocked allows manually blocking further credit sales
*/

-- Customer exception prices table
CREATE TABLE IF NOT EXISTS customer_exception_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  exception_price numeric NOT NULL DEFAULT 0,
  min_qty integer NOT NULL DEFAULT 1,
  valid_from date,
  valid_until date,
  note text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, customer_id, article_id)
);

ALTER TABLE customer_exception_prices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can view exception prices"
  ON customer_exception_prices FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can insert exception prices"
  ON customer_exception_prices FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can update exception prices"
  ON customer_exception_prices FOR UPDATE
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()))
  WITH CHECK (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "Tenant members can delete exception prices"
  ON customer_exception_prices FOR DELETE
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM profiles WHERE id = auth.uid()));

-- Add credit_limit to suppliers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'credit_limit'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN credit_limit numeric DEFAULT 0;
  END IF;
END $$;

-- Add credit_blocked to customers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'credit_blocked'
  ) THEN
    ALTER TABLE customers ADD COLUMN credit_blocked boolean DEFAULT false;
  END IF;
END $$;

-- Add credit_blocked to suppliers
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'credit_blocked'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN credit_blocked boolean DEFAULT false;
  END IF;
END $$;

-- Index for fast lookup of exception prices by customer
CREATE INDEX IF NOT EXISTS idx_exception_prices_customer 
  ON customer_exception_prices(tenant_id, customer_id);

-- Index for fast lookup of exception prices by article
CREATE INDEX IF NOT EXISTS idx_exception_prices_article 
  ON customer_exception_prices(tenant_id, article_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_exception_prices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS exception_prices_updated_at ON customer_exception_prices;
CREATE TRIGGER exception_prices_updated_at
  BEFORE UPDATE ON customer_exception_prices
  FOR EACH ROW
  EXECUTE FUNCTION update_exception_prices_updated_at();
