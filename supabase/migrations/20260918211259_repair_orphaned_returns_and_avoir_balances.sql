/*
# Repair orphaned returns and reconcile avoir balances

1. Fix 9 sale_returns where customer_id IS NULL but linked sale has a customer.
2. Recalculate balance for customers with orphaned avoir returns.
3. Log repairs to balance_reconciliation_log.
*/

-- Step 1: Repair orphaned returns
UPDATE sale_returns sr
SET customer_id = s.customer_id
FROM sales s
WHERE sr.sale_id = s.id
  AND sr.customer_id IS NULL
  AND s.customer_id IS NOT NULL;

-- Step 2: Recalculate balance for avoir-orphan customers
DO $$
DECLARE
  v_stored numeric;
  v_computed numeric;
  v_sales numeric; v_payments numeric; v_prepays numeric; v_avoirs numeric;
  v_withdrawals numeric; v_loans numeric; v_adjustments numeric;
  v_cid uuid; v_tid uuid;
BEGIN
  FOR v_cid, v_tid IN
    SELECT DISTINCT sr.customer_id, sr.tenant_id
    FROM sale_returns sr
    WHERE sr.status = 'approved' AND sr.refund_method = 'avoir'
      AND sr.customer_id IS NOT NULL
      AND sr.id IN (
        'dba3752b-2fc5-4696-a88c-45b91d327af0',
        '8c5ed219-cbbf-487c-a007-60f7a98dee64'
      )
  LOOP
    SELECT COALESCE(balance, 0) INTO v_stored
    FROM customers WHERE id = v_cid AND tenant_id = v_tid;

    SELECT COALESCE(SUM(total), 0) INTO v_sales FROM sales
    WHERE customer_id = v_cid AND tenant_id = v_tid
      AND status <> 'cancelled' AND deleted_at IS NULL;

    SELECT COALESCE(SUM(sp.amount), 0) INTO v_payments FROM sale_payments sp
    JOIN sales s ON s.id = sp.sale_id
    WHERE s.customer_id = v_cid AND s.tenant_id = v_tid
      AND COALESCE(sp.affects_balance, true) = true;

    SELECT COALESCE(SUM(amount), 0) INTO v_prepays FROM customer_prepayments
    WHERE customer_id = v_cid AND tenant_id = v_tid;

    SELECT COALESCE(SUM(total), 0) INTO v_avoirs FROM sale_returns
    WHERE customer_id = v_cid AND tenant_id = v_tid
      AND status = 'approved' AND refund_method = 'avoir';

    SELECT COALESCE(SUM(amount), 0) INTO v_withdrawals FROM cash_movements
    WHERE customer_id = v_cid AND tenant_id = v_tid AND kind = 'customer_withdrawal';

    SELECT COALESCE(SUM(amount), 0) INTO v_loans FROM cash_movements
    WHERE customer_id = v_cid AND tenant_id = v_tid AND kind = 'customer_loan';

    SELECT COALESCE(SUM(amount), 0) INTO v_adjustments FROM balance_adjustments
    WHERE entity_id = v_cid AND tenant_id = v_tid AND entity_type = 'customer'
      AND kind NOT IN ('reconciliation','cancel_reversal');

    v_computed := v_sales - v_payments - v_prepays - v_avoirs + v_withdrawals + v_loans + v_adjustments;

    IF v_computed <> v_stored THEN
      UPDATE customers SET balance = v_computed WHERE id = v_cid AND tenant_id = v_tid;

      INSERT INTO balance_reconciliation_log (tenant_id, customer_id, previous_balance, computed_balance, delta, note)
      VALUES (v_tid, v_cid, v_stored, v_computed, v_computed - v_stored,
              'repair_orphaned_avoir_return_customer_link');
    END IF;
  END LOOP;
END;
$$;
