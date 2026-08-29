/*
# Regularization: ADAMA CISSE confirmed carryover and balance correction

## Summary
Applies the confirmed regularization for ADAMA CISSE based on simulation results:
- Stored balance: 135,000 FCFA
- Authoritative balance (with confirmed carryover): 70,000 FCFA
- Correction: -65,000 FCFA

## Steps (all within same transaction):

### Step B: Create confirmed carryover as balance_adjustment
  - amount = 135,000 (positive = debit = customer owes)
  - kind = 'carryover'
  - This is a confirmed pre-existing debt from before the system migration

### Step C: Correct stored balance (cache repair, not financial event)
  - customers.balance := 70,000 (the authoritative value)
  - Log in balance_regularization_log with full justification

### Step D: Create retroactive credit allocations
  - RET-00003 (200,000 avoir): 135,000 already allocated to F-00001 (existing sale_payment)
  - RET-00003 remaining 65,000: allocate to the carryover adjustment
  - Set credit_used = 200,000 (fully used)
  - Set amount_used = 65,000 on the carryover adjustment

## Pre-conditions verified by simulation:
  - Report confirmed: 135,000 FCFA
  - Authoritative balance: 70,000 FCFA
  - Correction: -65,000 FCFA
  - Total allocation RET-00003: 200,000 FCFA
  - Final credit available: 0 FCFA

## Security
  - One-off migration, no new functions or policies
  - Tenant isolation maintained
*/

DO $$
DECLARE
  v_cust_id uuid := 'e1e9fadc-3b3b-4542-bd83-3cb81ce711ef';
  v_tenant_id uuid := '31f9910a-5e94-4dc1-8ab5-c204bbcdb7db';
  v_adj_id uuid;
  v_return_id uuid;
  v_f00001_id uuid;
  v_current_balance numeric;
  v_target_balance numeric := 70000;
  v_credit_used numeric;
BEGIN
  -- Verify pre-conditions
  SELECT balance INTO v_current_balance FROM public.customers
  WHERE id = v_cust_id AND tenant_id = v_tenant_id;
  
  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'ADAMA CISSE not found';
  END IF;
  
  IF v_current_balance <> 135000 THEN
    RAISE NOTICE 'ADAMA CISSE balance is %, not 135000 - skipping regularization', v_current_balance;
    RETURN;
  END IF;

  -- Get RET-00003 return id
  SELECT id, credit_used INTO v_return_id, v_credit_used
  FROM public.sale_returns
  WHERE tenant_id = v_tenant_id AND customer_id = v_cust_id
    AND return_number = 'RET-00003' AND refund_method = 'avoir' AND status = 'approved';
    
  IF v_return_id IS NULL THEN
    RAISE EXCEPTION 'RET-00003 not found for ADAMA CISSE';
  END IF;

  -- Get F-00001 sale id
  SELECT id INTO v_f00001_id FROM public.sales
  WHERE tenant_id = v_tenant_id AND customer_id = v_cust_id AND sale_number = 'F-00001';

  IF v_f00001_id IS NULL THEN
    RAISE EXCEPTION 'F-00001 not found for ADAMA CISSE';
  END IF;

  -- ============================
  -- Step B: Create confirmed carryover
  -- ============================
  INSERT INTO public.balance_adjustments (
    id, tenant_id, entity_type, entity_id,
    previous_balance, new_balance, amount, note, kind, amount_used, user_id, created_at
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'customer', v_cust_id,
    0, 135000, 135000,
    'Report de solde antérieur confirmé (migration du moteur financier)',
    'carryover', 65000, NULL,
    '2026-08-22T00:00:00+00:00'::timestamptz  -- retroactive date before first invoice
  ) RETURNING id INTO v_adj_id;

  -- ============================
  -- Step C: Correct stored balance (cache repair)
  -- ============================
  UPDATE public.customers
  SET balance = v_target_balance
  WHERE id = v_cust_id AND tenant_id = v_tenant_id;

  INSERT INTO public.balance_regularization_log (
    tenant_id, customer_id, previous_balance, new_balance, delta, reason, justification
  ) VALUES (
    v_tenant_id, v_cust_id, 135000, 70000, -65000,
    'Correction migration: le solde stocké ne reflétait pas le crédit RET-00003 imputé sur le report',
    jsonb_build_object(
      'carryover_confirmed', 135000,
      'avoir_RET_00003_total', 200000,
      'allocated_to_F00001', 135000,
      'allocated_to_carryover', 65000,
      'authoritative_balance', 70000,
      'simulation_date', '2026-08-28'
    )
  );

  -- ============================
  -- Step D: Create retroactive credit allocations
  -- ============================
  
  -- Allocation 1: RET-00003 -> F-00001 for 135,000 (existing sale_payment already proves this)
  INSERT INTO public.credit_allocations (
    tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
  ) VALUES (
    v_tenant_id, v_cust_id, 'avoir', v_return_id, 'invoice', v_f00001_id, 135000
  )
  ON CONFLICT ON CONSTRAINT uq_credit_allocation_source_target DO NOTHING;

  -- Allocation 2: RET-00003 -> carryover adjustment for 65,000
  INSERT INTO public.credit_allocations (
    tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
  ) VALUES (
    v_tenant_id, v_cust_id, 'avoir', v_return_id, 'adjustment', v_adj_id, 65000
  )
  ON CONFLICT ON CONSTRAINT uq_credit_allocation_source_target DO NOTHING;

  -- Set credit_used to 200,000 (fully allocated)
  UPDATE public.sale_returns
  SET credit_used = 200000
  WHERE id = v_return_id;

  RAISE NOTICE 'ADAMA CISSE regularized: balance 135000 -> 70000, carryover 135000 (amount_used=65000), RET-00003 fully allocated';
END $$;
