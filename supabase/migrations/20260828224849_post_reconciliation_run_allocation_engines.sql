/*
# Post-reconciliation: run credit allocation engines

## Summary
After balance reconciliation created corrective adjustments, some customers may
now have negative adjustments or avoirs with remaining credit. Run the allocation
engines to distribute that credit to unpaid invoices.

## Important Notes
1. Runs _allocate_negative_adjustments_to_invoices for customers with unused negative adjustments
2. Runs _apply_avoirs_internal for customers with unused avoirs
3. Both engines create sale_payments with affects_balance=false (no double-counting)
*/

DO $$
DECLARE
  v_cust record;
BEGIN
  -- Allocate negative adjustments to unpaid invoices
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

  -- Allocate avoirs to unpaid invoices
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
