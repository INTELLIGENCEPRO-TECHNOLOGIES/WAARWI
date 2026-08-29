/*
# Financial Engine Schema Foundation

## Summary
Creates the schema foundation for the unified financial engine:
- credit_allocations: authoritative proof of credit-to-target mappings
- customer_payments: direct payments against balance adjustments (not tied to invoices)
- balance_regularization_log: audit trail for migration-time balance corrections
- Adds amount_used and kind columns to balance_adjustments
- Creates set_customer_balance server-side RPC for safe balance positioning

## New Tables

### credit_allocations
  - id (uuid PK)
  - tenant_id (uuid FK tenants)
  - customer_id (uuid FK customers)
  - source_type (text: avoir, prepay, negative_adjustment, customer_payment)
  - source_id (uuid)
  - target_type (text: invoice, adjustment)
  - target_id (uuid)
  - amount (numeric > 0)
  - created_at (timestamptz)
  - UNIQUE constraint on (source_id, target_id, source_type, target_type) for idempotence
  - Protected: SELECT only via RLS; INSERT/UPDATE/DELETE revoked from authenticated/anon

### customer_payments
  - id (uuid PK)
  - tenant_id (uuid FK tenants)
  - customer_id (uuid FK customers)
  - amount (numeric > 0)
  - method (text)
  - reference (text)
  - cash_session_id (uuid nullable FK cash_sessions)
  - target_adjustment_id (uuid nullable FK balance_adjustments)
  - created_at (timestamptz)

### balance_regularization_log
  - id (uuid PK)
  - tenant_id (uuid FK tenants)
  - customer_id (uuid FK customers)
  - previous_balance (numeric)
  - new_balance (numeric)
  - delta (numeric)
  - reason (text)
  - justification (jsonb)
  - created_at (timestamptz)

## Modified Tables

### balance_adjustments
  - Added: amount_used (numeric, default 0, CHECK >= 0 AND <= abs(amount))
  - Added: kind (text, default 'manual', values: manual, carryover)

## New Functions

### set_customer_balance(p_customer_id uuid, p_target_balance numeric, p_note text)
  - SECURITY DEFINER, locks customer FOR UPDATE
  - Calculates delta = target - current balance
  - Creates balance_adjustment with computed delta
  - Updates customers.balance atomically
  - Returns the new balance_adjustment id

## Security
  - credit_allocations: RLS enabled, SELECT only to authenticated (tenant scoped)
  - INSERT/UPDATE/DELETE revoked from authenticated and anon on credit_allocations
  - customer_payments: standard 4-policy RLS to authenticated
  - balance_regularization_log: SELECT only to authenticated
  - set_customer_balance: GRANT TO authenticated only
*/

-- ============================================================
-- 1. credit_allocations table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.credit_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('avoir', 'prepay', 'negative_adjustment', 'customer_payment')),
  source_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('invoice', 'adjustment')),
  target_id uuid NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_credit_allocation_source_target UNIQUE (source_id, target_id, source_type, target_type)
);

CREATE INDEX IF NOT EXISTS idx_credit_allocations_tenant_customer ON public.credit_allocations(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_credit_allocations_source ON public.credit_allocations(source_id);
CREATE INDEX IF NOT EXISTS idx_credit_allocations_target ON public.credit_allocations(target_id);

ALTER TABLE public.credit_allocations ENABLE ROW LEVEL SECURITY;

-- SELECT only: no direct writes allowed via RLS
DROP POLICY IF EXISTS "select_credit_allocations" ON public.credit_allocations;
CREATE POLICY "select_credit_allocations" ON public.credit_allocations FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());

-- Revoke direct write access - only server functions can write
REVOKE INSERT ON public.credit_allocations FROM authenticated, anon;
REVOKE UPDATE ON public.credit_allocations FROM authenticated, anon;
REVOKE DELETE ON public.credit_allocations FROM authenticated, anon;

-- ============================================================
-- 2. customer_payments table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.customer_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  method text NOT NULL DEFAULT 'cash',
  reference text DEFAULT '',
  cash_session_id uuid REFERENCES public.cash_sessions(id) ON DELETE SET NULL,
  target_adjustment_id uuid REFERENCES public.balance_adjustments(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_payments_tenant_customer ON public.customer_payments(tenant_id, customer_id);

ALTER TABLE public.customer_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_customer_payments" ON public.customer_payments;
CREATE POLICY "select_customer_payments" ON public.customer_payments FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "insert_customer_payments" ON public.customer_payments;
CREATE POLICY "insert_customer_payments" ON public.customer_payments FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "update_customer_payments" ON public.customer_payments;
CREATE POLICY "update_customer_payments" ON public.customer_payments FOR UPDATE
  TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "delete_customer_payments" ON public.customer_payments;
CREATE POLICY "delete_customer_payments" ON public.customer_payments FOR DELETE
  TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- 3. balance_regularization_log table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.balance_regularization_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  previous_balance numeric NOT NULL,
  new_balance numeric NOT NULL,
  delta numeric NOT NULL,
  reason text NOT NULL DEFAULT '',
  justification jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_balance_reg_log_tenant ON public.balance_regularization_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_balance_reg_log_customer ON public.balance_regularization_log(customer_id);

ALTER TABLE public.balance_regularization_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_balance_reg_log" ON public.balance_regularization_log;
CREATE POLICY "select_balance_reg_log" ON public.balance_regularization_log FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());

-- ============================================================
-- 4. Add amount_used and kind to balance_adjustments
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'balance_adjustments' AND column_name = 'amount_used'
  ) THEN
    ALTER TABLE public.balance_adjustments ADD COLUMN amount_used numeric NOT NULL DEFAULT 0;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'balance_adjustments' AND column_name = 'kind'
  ) THEN
    ALTER TABLE public.balance_adjustments ADD COLUMN kind text NOT NULL DEFAULT 'manual';
  END IF;
END $$;

-- Add constraint for amount_used bounds
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_balance_adj_amount_used_bounds'
  ) THEN
    ALTER TABLE public.balance_adjustments
      ADD CONSTRAINT chk_balance_adj_amount_used_bounds
      CHECK (amount_used >= 0 AND amount_used <= abs(amount));
  END IF;
END $$;

-- Add constraint for kind values
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_balance_adj_kind_values'
  ) THEN
    ALTER TABLE public.balance_adjustments
      ADD CONSTRAINT chk_balance_adj_kind_values
      CHECK (kind IN ('manual', 'carryover'));
  END IF;
END $$;

-- ============================================================
-- 5. set_customer_balance RPC (server-side delta calculation)
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_customer_balance(
  p_customer_id uuid,
  p_target_balance numeric,
  p_note text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_current_balance numeric;
  v_delta numeric;
  v_adj_id uuid;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;

  -- Lock customer and read current balance
  SELECT balance INTO v_current_balance
  FROM public.customers
  WHERE id = p_customer_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'Client introuvable ou accès refusé';
  END IF;

  v_delta := p_target_balance - v_current_balance;
  IF v_delta = 0 THEN RETURN NULL; END IF;

  -- Create balance adjustment with the computed delta
  INSERT INTO public.balance_adjustments (
    id, tenant_id, entity_type, entity_id,
    previous_balance, new_balance, amount, note, kind, user_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'customer', p_customer_id,
    v_current_balance, p_target_balance, v_delta,
    COALESCE(p_note, ''), 'manual', auth.uid()
  ) RETURNING id INTO v_adj_id;

  -- Update balance atomically
  UPDATE public.customers
  SET balance = p_target_balance
  WHERE id = p_customer_id AND tenant_id = v_tenant_id;

  RETURN v_adj_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_balance(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_customer_balance(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_customer_balance(uuid, numeric, text) TO authenticated;
