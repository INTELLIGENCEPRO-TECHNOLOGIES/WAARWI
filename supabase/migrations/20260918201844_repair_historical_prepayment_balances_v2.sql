/*
# Repair historical customer balances — clean approach (v2)

## Summary
The previous repair created reconciliation adjustments that fed back into the formula.
This v2 approach:
1. Computes the correct balance from ground truth excluding ALL reconciliation adjustments
2. Directly updates customers.balance without creating new reconciliation adjustments
3. Logs corrections via RAISE NOTICE for audit trail

## Formula (matches recalculate_customer_balance but excludes reconciliation)
balance = sales - payments(affects_balance) - prepays - avoirs + withdrawals + loans + adjustments(non-reconciliation)

## Safety
- Idempotent: running again after correction finds no drift.
- No new balance_adjustments created (avoids circular dependency).
- Only customers with prepayments are checked.
*/

DO $$
DECLARE
  v_cust RECORD;
  v_count int := 0;
BEGIN
  -- First remove the reconciliation adjustments we just created that are now baked into the formula
  -- These were created by our previous repair attempt and by prior reconciliation runs
  -- We keep them as-is but exclude them from the computation

  FOR v_cust IN
    WITH cust_with_prepay AS (
      SELECT DISTINCT customer_id, tenant_id FROM customer_prepayments WHERE amount > 0
    ),
    computed AS (
      SELECT
        c.id AS customer_id,
        c.tenant_id,
        c.name,
        COALESCE(c.balance, 0) AS stored_balance,
        COALESCE((SELECT SUM(total) FROM sales s WHERE s.customer_id = c.id AND s.tenant_id = c.tenant_id AND s.status <> 'cancelled'), 0)
        - COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.customer_id = c.id AND s.tenant_id = c.tenant_id AND COALESCE(sp.affects_balance, true) = true), 0)
        - COALESCE((SELECT SUM(pp.amount) FROM customer_prepayments pp WHERE pp.customer_id = c.id AND pp.tenant_id = c.tenant_id), 0)
        - COALESCE((SELECT SUM(sr.total) FROM sale_returns sr WHERE sr.customer_id = c.id AND sr.tenant_id = c.tenant_id AND sr.status = 'approved' AND sr.refund_method = 'avoir'), 0)
        + COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.customer_id = c.id AND cm.tenant_id = c.tenant_id AND cm.kind = 'customer_withdrawal'), 0)
        + COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.customer_id = c.id AND cm.tenant_id = c.tenant_id AND cm.kind = 'customer_loan'), 0)
        + COALESCE((SELECT SUM(ba.amount) FROM balance_adjustments ba WHERE ba.entity_id = c.id AND ba.tenant_id = c.tenant_id AND ba.entity_type = 'customer' AND ba.kind <> 'reconciliation'), 0)
        AS computed_balance
      FROM customers c
      JOIN cust_with_prepay cwp ON cwp.customer_id = c.id AND cwp.tenant_id = c.tenant_id
    )
    SELECT customer_id, tenant_id, name, stored_balance, computed_balance,
           computed_balance - stored_balance AS delta
    FROM computed
    WHERE ABS(computed_balance - stored_balance) > 0.01
  LOOP
    RAISE NOTICE 'Repairing %: stored=%, computed=%, delta=%',
      v_cust.name, v_cust.stored_balance, v_cust.computed_balance, v_cust.delta;

    UPDATE customers
    SET balance = v_cust.computed_balance
    WHERE id = v_cust.customer_id AND tenant_id = v_cust.tenant_id;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Repaired % customer balances (v2, no circular adjustments)', v_count;
END;
$$;
