/*
# RS1 Section C — Enhance customer_payments table

## Purpose
Extend the customer_payments table with the columns needed for the new
register_customer_balance_payment RPC (Section B), accounting integration
(Section F), and auditability.

## New columns
- payment_method_id (uuid, FK → payment_methods, nullable)
- method_name (text, default '')
- site_id (uuid, FK → sites, nullable)
- cash_movement_id (uuid, FK → cash_movements, nullable)
- user_id (uuid, nullable)
- idempotency_key (text, nullable)
- status (text, default 'confirmed')
- accounting_status (text, default 'not_accounted')
- accounting_entry_id (uuid, FK → journal_entries, nullable)
- accounted_at (timestamptz, nullable)

## Constraints
- UNIQUE(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
- status CHECK in ('confirmed','cancelled')
- accounting_status CHECK in ('not_accounted','accounted')

## Security changes
- Revoke INSERT, UPDATE, DELETE from authenticated on customer_payments
  (only SECURITY DEFINER RPCs may write)
- Keep SELECT for authenticated (tenant-scoped via existing RLS)
- Drop INSERT/UPDATE/DELETE policies, keep SELECT policy

## Important notes
1. No existing data is modified — all new columns have defaults or are nullable.
2. The table currently has zero rows for ADAMA (diagnostic confirmed).
3. The old 'method' column is kept (not dropped) for backwards compatibility.
*/

-- ============================================================
-- 1. Add new columns (idempotent via DO block)
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='payment_method_id') THEN
    ALTER TABLE public.customer_payments ADD COLUMN payment_method_id uuid REFERENCES public.payment_methods(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='method_name') THEN
    ALTER TABLE public.customer_payments ADD COLUMN method_name text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='site_id') THEN
    ALTER TABLE public.customer_payments ADD COLUMN site_id uuid REFERENCES public.sites(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='cash_movement_id') THEN
    ALTER TABLE public.customer_payments ADD COLUMN cash_movement_id uuid REFERENCES public.cash_movements(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='user_id') THEN
    ALTER TABLE public.customer_payments ADD COLUMN user_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='idempotency_key') THEN
    ALTER TABLE public.customer_payments ADD COLUMN idempotency_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='status') THEN
    ALTER TABLE public.customer_payments ADD COLUMN status text NOT NULL DEFAULT 'confirmed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='accounting_status') THEN
    ALTER TABLE public.customer_payments ADD COLUMN accounting_status text NOT NULL DEFAULT 'not_accounted';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='accounting_entry_id') THEN
    ALTER TABLE public.customer_payments ADD COLUMN accounting_entry_id uuid REFERENCES public.journal_entries(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='customer_payments' AND column_name='accounted_at') THEN
    ALTER TABLE public.customer_payments ADD COLUMN accounted_at timestamptz;
  END IF;
END $$;

-- ============================================================
-- 2. Constraints (idempotent)
-- ============================================================

-- Unique partial index for idempotency
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_customer_payments_idempotency') THEN
    CREATE UNIQUE INDEX uq_customer_payments_idempotency
      ON public.customer_payments (tenant_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  END IF;
END $$;

-- CHECK constraints
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customer_payments_status') THEN
    ALTER TABLE public.customer_payments ADD CONSTRAINT chk_customer_payments_status
      CHECK (status IN ('confirmed','cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_customer_payments_accounting_status') THEN
    ALTER TABLE public.customer_payments ADD CONSTRAINT chk_customer_payments_accounting_status
      CHECK (accounting_status IN ('not_accounted','accounted'));
  END IF;
END $$;

-- Index on cash_session for quick lookups
CREATE INDEX IF NOT EXISTS idx_customer_payments_session ON public.customer_payments (cash_session_id);

-- ============================================================
-- 3. Security: revoke write from authenticated, keep SELECT only
-- ============================================================

-- Revoke all DML except SELECT from authenticated
REVOKE INSERT, UPDATE, DELETE ON public.customer_payments FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.customer_payments FROM anon;
REVOKE ALL ON public.customer_payments FROM PUBLIC;

-- Ensure SELECT is granted
GRANT SELECT ON public.customer_payments TO authenticated;

-- Drop write policies (keep SELECT policy)
DROP POLICY IF EXISTS "insert_customer_payments" ON public.customer_payments;
DROP POLICY IF EXISTS "update_customer_payments" ON public.customer_payments;
DROP POLICY IF EXISTS "delete_customer_payments" ON public.customer_payments;

-- Verify SELECT policy exists (recreate if not)
DROP POLICY IF EXISTS "select_customer_payments" ON public.customer_payments;
CREATE POLICY "select_customer_payments" ON public.customer_payments
  FOR SELECT TO authenticated USING (tenant_id = current_tenant_id());
