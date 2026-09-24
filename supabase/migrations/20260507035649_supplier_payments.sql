/*
  # Supplier payments ledger

  1. New Tables
    - `supplier_payments` - paiements émis aux fournisseurs, optionnellement imputés à une commande fournisseur.
      - `id` (uuid, pk)
      - `tenant_id` (uuid, fk tenants)
      - `supplier_id` (uuid, fk suppliers)
      - `order_id` (uuid, fk supplier_orders, nullable pour règlements non imputés)
      - `payment_method_id` (uuid, fk payment_methods)
      - `method_name` (text)
      - `amount` (numeric)
      - `reference` (text)
      - `note` (text)
      - `created_at` (timestamptz)
  2. Security
    - Enable RLS
    - Policies select/insert/update/delete restreintes au tenant courant
*/

CREATE TABLE IF NOT EXISTS supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  order_id uuid REFERENCES supplier_orders(id) ON DELETE SET NULL,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  method_name text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  reference text DEFAULT '',
  note text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sup_payments_tenant ON supplier_payments(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sup_payments_supplier ON supplier_payments(supplier_id);

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='supplier_payments' AND policyname='supp select') THEN
    CREATE POLICY "supp select" ON supplier_payments FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='supplier_payments' AND policyname='supp insert') THEN
    CREATE POLICY "supp insert" ON supplier_payments FOR INSERT TO authenticated WITH CHECK (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='supplier_payments' AND policyname='supp update') THEN
    CREATE POLICY "supp update" ON supplier_payments FOR UPDATE TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='supplier_payments' AND policyname='supp delete') THEN
    CREATE POLICY "supp delete" ON supplier_payments FOR DELETE TO authenticated USING (tenant_id = current_tenant_id());
  END IF;
END $$;
