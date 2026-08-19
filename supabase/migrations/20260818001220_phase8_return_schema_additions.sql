/*
# Phase 8a: Schema additions for transactional returns

## Summary
Adds the columns and constraints needed for the atomic return RPC.

## 1. Modified Tables

### cash_movements
  - `sale_return_id` (uuid, nullable, FK → sale_returns.id ON DELETE SET NULL)
    Links a refund cash movement directly to the return it settles.
    Enables double-refund prevention via SUM(amount) check.

### sale_returns
  - `request_id` (text, nullable)
    Client-generated idempotency key to prevent double submissions.
  - Unique partial index on (tenant_id, request_id) WHERE request_id IS NOT NULL.

## 2. Security
  - No RLS changes. Both columns are nullable additive columns on existing
    tables whose RLS is already configured.

## 3. Important Notes
  - Both columns are nullable and additive — no existing data or flow is broken.
  - The unique constraint only applies when request_id is provided (partial index),
    so existing rows with NULL request_id are unaffected.
*/

-- 1. Add sale_return_id to cash_movements
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'cash_movements'
      AND column_name = 'sale_return_id'
  ) THEN
    ALTER TABLE cash_movements
      ADD COLUMN sale_return_id uuid REFERENCES sale_returns(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 2. Add request_id to sale_returns
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sale_returns'
      AND column_name = 'request_id'
  ) THEN
    ALTER TABLE sale_returns
      ADD COLUMN request_id text;
  END IF;
END $$;

-- 3. Unique partial index for idempotency
CREATE UNIQUE INDEX IF NOT EXISTS idx_sale_returns_request_id_unique
  ON sale_returns (tenant_id, request_id)
  WHERE request_id IS NOT NULL;

-- 4. Index for efficient refund lookups by sale_return_id
CREATE INDEX IF NOT EXISTS idx_cash_movements_sale_return_id
  ON cash_movements (sale_return_id)
  WHERE sale_return_id IS NOT NULL;
