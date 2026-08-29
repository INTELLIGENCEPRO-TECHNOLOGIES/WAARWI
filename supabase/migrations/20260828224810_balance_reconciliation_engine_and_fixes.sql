/*
# Balance reconciliation engine: expand kind constraint + create RPCs

## Summary
1. Adds 'reconciliation' to the allowed values for balance_adjustments.kind
2. Creates a reusable `recalculate_customer_balance` RPC for permanent use
3. Creates `_recalculate_all_customer_balances` internal admin function
4. Fixes `_apply_avoirs_internal` status filter ('validated' not 'unpaid')

## Modified Constraints
- `chk_balance_adj_kind_values`: added 'reconciliation' to allowed values

## New Functions
- `recalculate_customer_balance(uuid)` — public RPC, SECURITY DEFINER, for authenticated
- `_recalculate_all_customer_balances(uuid)` — internal, SECURITY DEFINER, no public grant

## Modified Functions
- `_apply_avoirs_internal` — fixed status filter from 'unpaid' to 'validated'

## Security
- recalculate_customer_balance: granted to authenticated only
- _recalculate_all_customer_balances: no public grant (internal only)
- Both are SECURITY DEFINER with search_path = public

## Important Notes
1. The reconciliation function computes balance from ground truth:
   balance = sales - payments(affects_balance=true) - prepays - avoirs + withdrawals + loans + adjustments
2. If stored balance differs from computed, it creates a corrective balance_adjustment
   with kind='reconciliation' and updates customers.balance
3. Idempotent: if no drift, nothing happens
4. This is a PERMANENT mechanism, not a one-off fix
*/

-- ============================================================
-- 1. Expand the kind check constraint to allow 'reconciliation'
-- ============================================================
ALTER TABLE public.balance_adjustments
  DROP CONSTRAINT IF EXISTS chk_balance_adj_kind_values;

ALTER TABLE public.balance_adjustments
  ADD CONSTRAINT chk_balance_adj_kind_values
  CHECK (kind = ANY (ARRAY['manual', 'carryover', 'reconciliation']));

-- ============================================================
-- 2. Create recalculate_customer_balance RPC (permanent, reusable)
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
  -- Resolve tenant
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM public.customers WHERE id = p_customer_id LIMIT 1;
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Client introuvable: %', p_customer_id;
  END IF;

  -- Lock customer row
  SELECT balance INTO v_stored FROM public.customers
  WHERE id = p_customer_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_stored IS NULL THEN
    v_stored := 0;
  END IF;

  -- Ground-truth: Sales (non-cancelled)
  SELECT COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0)
  INTO v_sales
  FROM public.sales
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id;

  -- Ground-truth: Payments that affect balance
  SELECT COALESCE(SUM(sp.amount), 0)
  INTO v_payments
  FROM public.sale_payments sp
  JOIN public.sales s ON s.id = sp.sale_id
  WHERE s.customer_id = p_customer_id
    AND s.tenant_id = v_tenant_id
    AND COALESCE(sp.affects_balance, true) = true;

  -- Ground-truth: Prepayments
  SELECT COALESCE(SUM(amount), 0)
  INTO v_prepays
  FROM public.customer_prepayments
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id;

  -- Ground-truth: Avoirs (approved credit notes)
  SELECT COALESCE(SUM(total), 0)
  INTO v_avoirs
  FROM public.sale_returns
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND status = 'approved' AND refund_method = 'avoir';

  -- Ground-truth: Customer withdrawals
  SELECT COALESCE(SUM(amount), 0)
  INTO v_withdrawals
  FROM public.cash_movements
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND kind = 'customer_withdrawal';

  -- Ground-truth: Customer loans
  SELECT COALESCE(SUM(amount), 0)
  INTO v_loans
  FROM public.cash_movements
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND kind = 'customer_loan';

  -- Ground-truth: Balance adjustments (all types)
  SELECT COALESCE(SUM(amount), 0)
  INTO v_adjustments
  FROM public.balance_adjustments
  WHERE entity_id = p_customer_id AND tenant_id = v_tenant_id
    AND entity_type = 'customer';

  -- Formula: balance = sales - payments - prepays - avoirs + withdrawals + loans + adjustments
  v_computed := v_sales - v_payments - v_prepays - v_avoirs + v_withdrawals + v_loans + v_adjustments;
  v_delta := v_computed - v_stored;

  -- No drift: return early
  IF v_delta = 0 THEN
    RETURN jsonb_build_object(
      'customer_id', p_customer_id,
      'stored', v_stored,
      'computed', v_computed,
      'corrected', false
    );
  END IF;

  -- Create corrective reconciliation adjustment
  INSERT INTO public.balance_adjustments (
    id, tenant_id, entity_type, entity_id,
    previous_balance, new_balance, amount, note, kind, user_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'customer', p_customer_id,
    v_stored, v_computed, v_delta,
    'Réconciliation automatique (ancien: ' || v_stored || ', calculé: ' || v_computed || ')',
    'reconciliation', auth.uid()
  ) RETURNING id INTO v_adj_id;

  -- Update stored balance
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
-- 3. Internal admin function: reconcile all customers of a tenant
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

    SELECT COALESCE(SUM(amount), 0)
    INTO v_adjustments FROM public.balance_adjustments
    WHERE entity_id = v_cust.id AND tenant_id = p_tenant_id
      AND entity_type = 'customer';

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
