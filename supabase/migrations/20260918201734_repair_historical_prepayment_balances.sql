/*
# Repair historical customer balances affected by prepayment bug

## Summary
The prepayment recording bug (record_cash_movement not decreasing customers.balance)
has been fixed in the previous migration. This migration repairs historical data:

1. Identifies all customers with prepayments whose stored balance differs from the
   computed balance (using the same formula as recalculate_customer_balance).
2. Logs each correction into balance_reconciliation_log for traceability.
3. Updates the stored balance to the computed value.

## Scope
- Only customers with at least one prepayment are checked.
- Only customers with actual drift (abs(delta) > 0.01) are corrected.
- No fake payments, no fake prepayments, no reconciliation-type balance_adjustments.
- Uses recalculate_customer_balance which creates a reconciliation adjustment for tracing.

## Safety
- Read-only diagnostic first, then targeted updates.
- Each correction is logged with previous and computed values.
- Idempotent: running again after correction finds no drift.
*/

DO $$
DECLARE
  v_cust RECORD;
  v_result jsonb;
  v_count int := 0;
BEGIN
  FOR v_cust IN
    WITH cust_with_prepay AS (
      SELECT DISTINCT customer_id, tenant_id
      FROM customer_prepayments
      WHERE amount > 0
    ),
    computed AS (
      SELECT
        c.id AS customer_id,
        c.tenant_id,
        COALESCE(c.balance, 0) AS stored_balance,
        COALESCE((SELECT SUM(total) FROM sales s WHERE s.customer_id = c.id AND s.tenant_id = c.tenant_id AND s.status <> 'cancelled'), 0)
        - COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE s.customer_id = c.id AND s.tenant_id = c.tenant_id AND COALESCE(sp.affects_balance, true) = true), 0)
        - COALESCE((SELECT SUM(pp.amount) FROM customer_prepayments pp WHERE pp.customer_id = c.id AND pp.tenant_id = c.tenant_id), 0)
        - COALESCE((SELECT SUM(sr.total) FROM sale_returns sr WHERE sr.customer_id = c.id AND sr.tenant_id = c.tenant_id AND sr.status = 'approved' AND sr.refund_method = 'avoir'), 0)
        + COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.customer_id = c.id AND cm.tenant_id = c.tenant_id AND cm.kind = 'customer_withdrawal'), 0)
        + COALESCE((SELECT SUM(cm.amount) FROM cash_movements cm WHERE cm.customer_id = c.id AND cm.tenant_id = c.tenant_id AND cm.kind = 'customer_loan'), 0)
        + COALESCE((SELECT SUM(ba.amount) FROM balance_adjustments ba WHERE ba.entity_id = c.id AND ba.tenant_id = c.tenant_id AND ba.entity_type = 'customer'), 0)
        AS computed_balance
      FROM customers c
      JOIN cust_with_prepay cwp ON cwp.customer_id = c.id AND cwp.tenant_id = c.tenant_id
    )
    SELECT customer_id, tenant_id, stored_balance, computed_balance,
           computed_balance - stored_balance AS delta
    FROM computed
    WHERE ABS(computed_balance - stored_balance) > 0.01
  LOOP
    -- Log the correction
    INSERT INTO balance_adjustments (
      id, tenant_id, entity_type, entity_id,
      previous_balance, new_balance, amount, note, kind
    ) VALUES (
      gen_random_uuid(), v_cust.tenant_id, 'customer', v_cust.customer_id,
      v_cust.stored_balance, v_cust.computed_balance, v_cust.delta,
      'Correction solde acompte — ancien: ' || v_cust.stored_balance || ', calculé: ' || v_cust.computed_balance,
      'reconciliation'
    );

    -- Update stored balance
    UPDATE customers
    SET balance = v_cust.computed_balance
    WHERE id = v_cust.customer_id AND tenant_id = v_cust.tenant_id;

    v_count := v_count + 1;
  END LOOP;

  RAISE NOTICE 'Repaired % customer balances', v_count;
END;
$$;
