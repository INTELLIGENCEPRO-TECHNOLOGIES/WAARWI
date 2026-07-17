/*
# Fix supplier balance double-subtraction with safe backfill

## Problem
The `recompute_supplier_balance`, `trigger_update_supplier_balance`, and
`trigger_update_old_supplier_balance` functions all compute the supplier
balance as:

  balance = order_due + adjustments - orphan_payments

where `orphan_payments` = SUM(supplier_payments WHERE order_id IS NULL).

When a "règlement de solde" (balance-only payment) is made via
`register_supplier_payment`, the function:
  1. Inserts a supplier_payment with order_id = NULL
  2. Inserts a balance_adjustment with amount = -v_remaining
  3. Calls recompute_supplier_balance

Step 3 then subtracts the orphan payment AGAIN via the formula, causing a
double-subtraction. For supplier "GROUPE SEYNABOU SERVICES" this resulted in
a balance of 0 instead of the correct 35000.

## Solution

### 1. Backfill missing balance_adjustments for orphan payments
19 out of 20 existing orphan payments (order_id IS NULL) have NO matching
balance_adjustment record. These were created by an older code path that
subtracted the payment directly from suppliers.balance without creating an
adjustment. The recompute formula's `- orphan_payments` term was the ONLY
record of these payments.

Before we can safely remove that term, we must create a balance_adjustment
of -amount for each orphan payment that lacks one. This ensures every orphan
payment is represented in the adjustments ledger, so the new formula
(order_due + adjustments) captures the same value.

The 1 orphan payment that already has a matching adjustment (SEYNABOU's
100000) is skipped to avoid creating a duplicate.

### 2. Fix recompute_supplier_balance
Remove the `- orphan_payments` term. New formula:
  balance = GREATEST(0, order_due + adjustments)

### 3. Fix trigger_update_supplier_balance
Same formula fix.

### 4. Fix trigger_update_old_supplier_balance
Same formula fix.

### 5. Recompute all supplier balances
Call recompute_supplier_balance for every supplier to apply the corrected
formula with the backfilled adjustments.

## Impact
- SEYNABOU: 0 -> 35000 (bug fix)
- All other 26 suppliers across all tenants: balances preserved (no change)
- Eliminates display discrepancy between "Dette" (ledger) and "Solde
  comptable" (balance column) for all affected suppliers

## Verification
Pre-migration analysis confirmed all 27 suppliers across 4 tenants:
- 26 suppliers: PRESERVED (new balance = current balance)
- 1 supplier (SEYNABOU): CHANGED from 0 to 35000 (correct fix)
*/

-- ============================================================================
-- Step 1: Backfill missing balance_adjustments for orphan supplier payments
-- ============================================================================
-- For each supplier_payment with order_id IS NULL that does NOT already have
-- a matching balance_adjustment (same amount, within 5 seconds), create one.
-- This ensures the new formula (order_due + adjustments) captures the same
-- value as the old formula (order_due + adjustments - orphan_payments).

INSERT INTO balance_adjustments (
  tenant_id, entity_type, entity_id,
  previous_balance, new_balance, amount,
  note, user_id, created_at
)
SELECT
  sp.tenant_id,
  'supplier',
  sp.supplier_id,
  0,
  0,
  -sp.amount,
  'Backfill règlement solde · ' || COALESCE(sp.reference, sp.method_name, ''),
  NULL,
  sp.created_at
FROM supplier_payments sp
WHERE sp.order_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM balance_adjustments ba
    WHERE ba.entity_type = 'supplier'
      AND ba.entity_id = sp.supplier_id
      AND ba.tenant_id = sp.tenant_id
      AND ABS(ba.amount) = sp.amount
      AND ABS(EXTRACT(EPOCH FROM (ba.created_at - sp.created_at))) < 5
  );

-- ============================================================================
-- Step 2: Fix recompute_supplier_balance — remove orphan payment subtraction
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recompute_supplier_balance(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_new_balance numeric;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM suppliers WHERE id = p_supplier_id;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  v_new_balance := COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = p_supplier_id
    AND o.tenant_id = v_tenant_id
    AND o.status NOT IN ('cancelled', 'draft')
  ), 0) + COALESCE((
    SELECT SUM(amount) FROM balance_adjustments
    WHERE entity_id = p_supplier_id AND entity_type = 'supplier' AND tenant_id = v_tenant_id
  ), 0);

  UPDATE suppliers
  SET balance = GREATEST(0, v_new_balance)
  WHERE id = p_supplier_id;
END;
$function$;

-- ============================================================================
-- Step 3: Fix trigger_update_supplier_balance — remove orphan payment subtraction
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trigger_update_supplier_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_supplier_id uuid;
  v_tenant_id uuid;
  v_new_balance numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_supplier_id := OLD.supplier_id;
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_supplier_id := NEW.supplier_id;
    v_tenant_id := NEW.tenant_id;
  END IF;

  IF v_supplier_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_new_balance := COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = v_supplier_id
    AND o.tenant_id = v_tenant_id
    AND o.status NOT IN ('cancelled', 'draft')
  ), 0) + COALESCE((
    SELECT SUM(amount) FROM balance_adjustments
    WHERE entity_id = v_supplier_id AND entity_type = 'supplier' AND tenant_id = v_tenant_id
  ), 0);

  UPDATE suppliers
  SET balance = GREATEST(0, v_new_balance)
  WHERE id = v_supplier_id AND tenant_id = v_tenant_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- ============================================================================
-- Step 4: Fix trigger_update_old_supplier_balance — remove orphan payment subtraction
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trigger_update_old_supplier_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_new_balance numeric;
  v_tenant_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.supplier_id IS DISTINCT FROM NEW.supplier_id AND OLD.supplier_id IS NOT NULL THEN
    v_tenant_id := OLD.tenant_id;
    v_new_balance := COALESCE((
      SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
      FROM supplier_orders o
      WHERE o.supplier_id = OLD.supplier_id
      AND o.tenant_id = v_tenant_id
      AND o.status NOT IN ('cancelled', 'draft')
    ), 0) + COALESCE((
      SELECT SUM(amount) FROM balance_adjustments
      WHERE entity_id = OLD.supplier_id AND entity_type = 'supplier' AND tenant_id = v_tenant_id
    ), 0);

    UPDATE suppliers
    SET balance = GREATEST(0, v_new_balance)
    WHERE id = OLD.supplier_id AND tenant_id = v_tenant_id;
  END IF;
  RETURN NEW;
END;
$function$;

-- ============================================================================
-- Step 5: Recompute all supplier balances with the corrected formula
-- ============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM suppliers LOOP
    PERFORM recompute_supplier_balance(r.id);
  END LOOP;
END $$;
