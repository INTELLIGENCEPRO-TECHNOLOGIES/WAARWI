/*
# Fix circular drift: exclude reconciliation adjustments from balance formula

## Problem
The reconciliation engine creates a corrective balance_adjustment with kind='reconciliation'.
But the balance formula includes ALL balance_adjustments, so the correction itself becomes
a new financial event, causing a perpetual drift equal to the correction amount.

## Solution
1. Exclude kind='reconciliation' from the balance formula in both RPCs
2. Delete the 28 stale reconciliation adjustments that already compounded the drift
3. Reset all customer balances to their pre-reconciliation state (undo the double-drift)
4. Re-run reconciliation with the fixed formula

## Modified Functions
- `recalculate_customer_balance(uuid)` — excludes reconciliation adjustments from formula
- `_recalculate_all_customer_balances(uuid)` — excludes reconciliation adjustments from formula

## Important Notes
1. Reconciliation adjustments are AUDIT records, not financial events
2. The formula now explicitly excludes kind='reconciliation' from the sum of adjustments
3. The set_customer_balance function and allocation engines are unaffected since they
   don't compute balance from ground truth
*/

-- ============================================================
-- 1. Delete stale reconciliation adjustments (they caused double-drift)
-- ============================================================
DELETE FROM public.balance_adjustments WHERE kind = 'reconciliation';

-- ============================================================
-- 2. Undo the balance changes from the stale reconciliation
--    by recalculating from ground truth (without reconciliation adjustments, which are now deleted)
-- ============================================================

-- ============================================================
-- 3. Fix recalculate_customer_balance: exclude reconciliation from formula
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalculate_customer_balance(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_stored numeric;
  v_computed numeric;
  v_delta numeric;
  v_adj_id uuid;
  v_sales numeric;
  v_payments numeric;
  v_prepays numeric;
  v_avoirs numeric;
  v_withdrawals numeric;
  v_loans numeric;
  v_adjustments numeric;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM public.customers WHERE id = p_customer_id LIMIT 1;
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Client introuvable: %', p_customer_id;
  END IF;

  SELECT balance INTO v_stored FROM public.customers
  WHERE id = p_customer_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_stored IS NULL THEN v_stored := 0; END IF;

  SELECT COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0)
  INTO v_sales FROM public.sales
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id;

  SELECT COALESCE(SUM(sp.amount), 0)
  INTO v_payments FROM public.sale_payments sp
  JOIN public.sales s ON s.id = sp.sale_id
  WHERE s.customer_id = p_customer_id AND s.tenant_id = v_tenant_id
    AND COALESCE(sp.affects_balance, true) = true;

  SELECT COALESCE(SUM(amount), 0)
  INTO v_prepays FROM public.customer_prepayments
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id;

  SELECT COALESCE(SUM(total), 0)
  INTO v_avoirs FROM public.sale_returns
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND status = 'approved' AND refund_method = 'avoir';

  SELECT COALESCE(SUM(amount), 0)
  INTO v_withdrawals FROM public.cash_movements
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND kind = 'customer_withdrawal';

  SELECT COALESCE(SUM(amount), 0)
  INTO v_loans FROM public.cash_movements
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND kind = 'customer_loan';

  -- CRITICAL: exclude kind='reconciliation' — those are audit records, not financial events
  SELECT COALESCE(SUM(amount), 0)
  INTO v_adjustments FROM public.balance_adjustments
  WHERE entity_id = p_customer_id AND tenant_id = v_tenant_id
    AND entity_type = 'customer'
    AND kind <> 'reconciliation';

  v_computed := v_sales - v_payments - v_prepays - v_avoirs + v_withdrawals + v_loans + v_adjustments;
  v_delta := v_computed - v_stored;

  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'customer_id', p_customer_id,
      'stored', v_stored,
      'computed', v_computed,
      'corrected', false
    );
  END IF;

  INSERT INTO public.balance_adjustments (
    id, tenant_id, entity_type, entity_id,
    previous_balance, new_balance, amount, note, kind, user_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'customer', p_customer_id,
    v_stored, v_computed, v_delta,
    'Réconciliation automatique (ancien: ' || v_stored || ', calculé: ' || v_computed || ')',
    'reconciliation', auth.uid()
  ) RETURNING id INTO v_adj_id;

  UPDATE public.customers SET balance = v_computed
  WHERE id = p_customer_id AND tenant_id = v_tenant_id;

  RETURN jsonb_build_object(
    'customer_id', p_customer_id,
    'stored', v_stored,
    'computed', v_computed,
    'corrected', true,
    'adjustment_id', v_adj_id,
    'delta', v_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_customer_balance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_customer_balance(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.recalculate_customer_balance(uuid) TO authenticated;

-- ============================================================
-- 4. Fix _recalculate_all_customer_balances: exclude reconciliation from formula
-- ============================================================
CREATE OR REPLACE FUNCTION public._recalculate_all_customer_balances(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cust record;
  v_stored numeric;
  v_computed numeric;
  v_delta numeric;
  v_corrections int := 0;
  v_total_delta numeric := 0;
  v_sales numeric;
  v_payments numeric;
  v_prepays numeric;
  v_avoirs numeric;
  v_withdrawals numeric;
  v_loans numeric;
  v_adjustments numeric;
BEGIN
  FOR v_cust IN
    SELECT id, balance FROM public.customers WHERE tenant_id = p_tenant_id FOR UPDATE
  LOOP
    v_stored := COALESCE(v_cust.balance, 0);

    SELECT COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0)
    INTO v_sales FROM public.sales
    WHERE customer_id = v_cust.id AND tenant_id = p_tenant_id;

    SELECT COALESCE(SUM(sp.amount), 0)
    INTO v_payments FROM public.sale_payments sp
    JOIN public.sales s ON s.id = sp.sale_id
    WHERE s.customer_id = v_cust.id AND s.tenant_id = p_tenant_id
      AND COALESCE(sp.affects_balance, true) = true;

    SELECT COALESCE(SUM(amount), 0)
    INTO v_prepays FROM public.customer_prepayments
    WHERE customer_id = v_cust.id AND tenant_id = p_tenant_id;

    SELECT COALESCE(SUM(total), 0)
    INTO v_avoirs FROM public.sale_returns
    WHERE customer_id = v_cust.id AND tenant_id = p_tenant_id
      AND status = 'approved' AND refund_method = 'avoir';

    SELECT COALESCE(SUM(amount), 0)
    INTO v_withdrawals FROM public.cash_movements
    WHERE customer_id = v_cust.id AND tenant_id = p_tenant_id
      AND kind = 'customer_withdrawal';

    SELECT COALESCE(SUM(amount), 0)
    INTO v_loans FROM public.cash_movements
    WHERE customer_id = v_cust.id AND tenant_id = p_tenant_id
      AND kind = 'customer_loan';

    -- CRITICAL: exclude kind='reconciliation'
    SELECT COALESCE(SUM(amount), 0)
    INTO v_adjustments FROM public.balance_adjustments
    WHERE entity_id = v_cust.id AND tenant_id = p_tenant_id
      AND entity_type = 'customer'
      AND kind <> 'reconciliation';

    v_computed := v_sales - v_payments - v_prepays - v_avoirs + v_withdrawals + v_loans + v_adjustments;
    v_delta := v_computed - v_stored;

    IF v_delta <> 0 THEN
      INSERT INTO public.balance_adjustments (
        id, tenant_id, entity_type, entity_id,
        previous_balance, new_balance, amount, note, kind, user_id
      ) VALUES (
        gen_random_uuid(), p_tenant_id, 'customer', v_cust.id,
        v_stored, v_computed, v_delta,
        'Réconciliation automatique (ancien: ' || v_stored || ', calculé: ' || v_computed || ')',
        'reconciliation', NULL
      );

      UPDATE public.customers SET balance = v_computed
      WHERE id = v_cust.id AND tenant_id = p_tenant_id;

      v_corrections := v_corrections + 1;
      v_total_delta := v_total_delta + abs(v_delta);
    END IF;
  END LOOP;

  RETURN jsonb_build_object('corrections', v_corrections, 'total_abs_delta', v_total_delta);
END;
$$;

REVOKE ALL ON FUNCTION public._recalculate_all_customer_balances(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._recalculate_all_customer_balances(uuid) FROM anon;
REVOKE ALL ON FUNCTION public._recalculate_all_customer_balances(uuid) FROM authenticated;

-- ============================================================
-- 5. Now run reconciliation with the fixed formula
-- ============================================================
DO $$
DECLARE
  v_tenant record;
  v_result jsonb;
BEGIN
  FOR v_tenant IN SELECT DISTINCT tenant_id FROM public.customers WHERE tenant_id IS NOT NULL
  LOOP
    v_result := public._recalculate_all_customer_balances(v_tenant.tenant_id);
    RAISE NOTICE 'Tenant %: %', v_tenant.tenant_id, v_result;
  END LOOP;
END $$;

-- ============================================================
-- 6. Run allocation engines after reconciliation
-- ============================================================
DO $$
DECLARE
  v_cust record;
BEGIN
  FOR v_cust IN
    SELECT DISTINCT ba.entity_id AS customer_id, ba.tenant_id
    FROM public.balance_adjustments ba
    WHERE ba.entity_type = 'customer'
      AND ba.amount < 0
      AND (abs(ba.amount) - COALESCE(ba.amount_used, 0)) > 0
      AND EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.tenant_id = ba.tenant_id
          AND s.customer_id = ba.entity_id
          AND s.status IN ('validated', 'partial')
          AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
      )
  LOOP
    PERFORM public._allocate_negative_adjustments_to_invoices(v_cust.customer_id, v_cust.tenant_id);
  END LOOP;

  FOR v_cust IN
    SELECT DISTINCT sr.customer_id, sr.tenant_id
    FROM public.sale_returns sr
    WHERE sr.refund_method = 'avoir'
      AND sr.status = 'approved'
      AND (COALESCE(sr.total, 0) - COALESCE(sr.credit_used, 0)) > 0
      AND sr.customer_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.sales s
        WHERE s.tenant_id = sr.tenant_id
          AND s.customer_id = sr.customer_id
          AND s.status IN ('validated', 'partial')
          AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
      )
  LOOP
    PERFORM public._apply_avoirs_internal(v_cust.customer_id, v_cust.tenant_id);
  END LOOP;
END $$;
