/*
  # Add paid_at column to supplier_payments

  1. Schema
    - Add `paid_at` timestamptz default now() to `supplier_payments`.
  2. Indexing
    - Create index on tenant_id + paid_at DESC for fast timeline queries.
    - Secondary indexes on supplier_id and order_id.
  3. Safety
    - Idempotent via IF NOT EXISTS.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_payments' AND column_name = 'paid_at'
  ) THEN
    ALTER TABLE supplier_payments ADD COLUMN paid_at timestamptz DEFAULT now();
    UPDATE supplier_payments SET paid_at = created_at WHERE paid_at IS NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_tenant ON supplier_payments(tenant_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_supplier ON supplier_payments(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_payments_order ON supplier_payments(order_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_orders' AND column_name = 'paid'
  ) THEN
    ALTER TABLE supplier_orders ADD COLUMN paid numeric DEFAULT 0;
  END IF;
END $$;
