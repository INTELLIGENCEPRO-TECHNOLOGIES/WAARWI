/*
# Fix allocation function: use correct sale status values

## Summary
The _allocate_negative_adjustments_to_invoices function was filtering invoices with
status IN ('unpaid', 'partial') but the actual statuses used in the system are
'validated' (for unpaid invoices) and 'partial'. This fix corrects the filter to
match both 'validated' and 'partial' statuses.

Also re-runs the regularization for all customers with unused negative adjustments.

## Modified Functions
- _allocate_negative_adjustments_to_invoices: Fixed status filter from 'unpaid' to 'validated'

## Important Notes
- The allocation does NOT modify customers.balance
- It only creates sale_payments (with affects_balance=false) and credit_allocations
- BABACAR MBOW should get his 2 invoices marked as paid after this fix
*/

-- ============================================================
-- 1. Fix the allocation function - correct status filter
-- ============================================================
CREATE OR REPLACE FUNCTION public._allocate_negative_adjustments_to_invoices(
  p_customer_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_adj record;
  v_sale record;
  v_available numeric;
  v_due numeric;
  v_to_apply numeric;
  v_total_applied numeric := 0;
  v_applied_details jsonb := '[]'::jsonb;
  v_existing boolean;
BEGIN
  -- Lock customer row to prevent concurrent race
  PERFORM 1 FROM public.customers
  WHERE id = p_customer_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  -- Iterate negative balance_adjustments with unused credit (FIFO)
  FOR v_adj IN
    SELECT ba.* FROM public.balance_adjustments ba
    WHERE ba.tenant_id = p_tenant_id
      AND ba.entity_type = 'customer'
      AND ba.entity_id = p_customer_id
      AND ba.amount < 0
      AND (abs(ba.amount) - COALESCE(ba.amount_used, 0)) > 0
    ORDER BY ba.created_at ASC
    FOR UPDATE
  LOOP
    v_available := abs(v_adj.amount) - COALESCE(v_adj.amount_used, 0);
    IF v_available <= 0 THEN CONTINUE; END IF;

    -- Apply to unpaid invoices (FIFO by creation date)
    -- Status 'validated' = unpaid, 'partial' = partially paid
    FOR v_sale IN
      SELECT s.* FROM public.sales s
      WHERE s.tenant_id = p_tenant_id
        AND s.customer_id = p_customer_id
        AND s.status IN ('validated', 'partial')
        AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
      ORDER BY s.created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_available <= 0;

      -- Check idempotence: skip if already allocated this source to this target
      SELECT EXISTS(
        SELECT 1 FROM public.credit_allocations
        WHERE source_id = v_adj.id AND target_id = v_sale.id
          AND source_type = 'negative_adjustment' AND target_type = 'invoice'
      ) INTO v_existing;
      IF v_existing THEN CONTINUE; END IF;

      v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
      IF v_due <= 0 THEN CONTINUE; END IF;

      v_to_apply := LEAST(v_available, v_due);

      -- Create sale_payment (justification line, does NOT affect balance)
      INSERT INTO public.sale_payments (
        tenant_id, sale_id, payment_method_id, method_name, amount, reference,
        affects_balance
      ) VALUES (
        p_tenant_id, v_sale.id, NULL,
        'Règlement par solde créditeur', v_to_apply,
        COALESCE(v_adj.note, 'Report de solde'),
        false
      );

      -- Update invoice paid amount and status
      UPDATE public.sales
      SET paid = COALESCE(paid, 0) + v_to_apply,
          status = CASE
            WHEN COALESCE(paid, 0) + v_to_apply >= total THEN 'paid'
            ELSE 'partial'
          END
      WHERE id = v_sale.id;

      -- Increment amount_used on the source adjustment
      UPDATE public.balance_adjustments
      SET amount_used = COALESCE(amount_used, 0) + v_to_apply
      WHERE id = v_adj.id;

      -- Record allocation for traceability
      INSERT INTO public.credit_allocations (
        tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
      ) VALUES (
        p_tenant_id, p_customer_id, 'negative_adjustment', v_adj.id, 'invoice', v_sale.id, v_to_apply
      )
      ON CONFLICT ON CONSTRAINT uq_credit_allocation_source_target
      DO UPDATE SET amount = public.credit_allocations.amount + EXCLUDED.amount;

      v_available := v_available - v_to_apply;
      v_total_applied := v_total_applied + v_to_apply;
      v_applied_details := v_applied_details || jsonb_build_object(
        'sale_id', v_sale.id, 'adjustment_id', v_adj.id, 'amount', v_to_apply
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'total_applied', v_total_applied,
    'details', v_applied_details
  );
END;
$$;

REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM authenticated;

-- ============================================================
-- 2. Re-run regularization with corrected status filter
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
END $$;
