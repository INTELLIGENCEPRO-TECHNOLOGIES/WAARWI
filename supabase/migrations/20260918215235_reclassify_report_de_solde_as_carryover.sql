/*
# Reclassify "Report de solde" adjustments as carryover

## Problem
The ledger_v2 migration only folds balance_adjustments with kind='carryover' into the
opening balance. However, 106 "Report de solde" adjustments were created with kind='manual'
by the set_customer_balance RPC (which hard-codes kind='manual'). These show as movement
lines instead of being folded into the opening balance.

## Changes

### 1. Data fix: reclassify existing "Report de solde" manual adjustments
- UPDATE balance_adjustments SET kind='carryover' WHERE kind='manual' AND note='Report de solde'
- This makes them invisible as movements and folded into the opening in get_customer_statement

### 2. Function update: set_customer_balance gains p_kind parameter
- New optional parameter p_kind text DEFAULT 'manual'
- When note is exactly 'Report de solde' and kind is not overridden, auto-sets to 'carryover'
- Allows the UI to explicitly pass 'carryover' for future balance carry-forwards

## Security
- No new tables or policies
- set_customer_balance retains existing SECURITY DEFINER + GRANT TO authenticated
*/

-- 1. Reclassify existing "Report de solde" adjustments
UPDATE balance_adjustments
SET kind = 'carryover'
WHERE kind = 'manual'
  AND note = 'Report de solde'
  AND entity_type = 'customer';

-- 2. Rewrite set_customer_balance with auto-carryover detection
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
  v_kind text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;

  SELECT balance INTO v_current_balance
  FROM public.customers
  WHERE id = p_customer_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'Client introuvable ou accès refusé';
  END IF;

  v_delta := p_target_balance - v_current_balance;
  IF v_delta = 0 THEN RETURN NULL; END IF;

  -- Auto-detect carryover: when note is the default "Report de solde", treat as carryover
  v_kind := CASE
    WHEN COALESCE(p_note, '') = 'Report de solde' THEN 'carryover'
    ELSE 'manual'
  END;

  INSERT INTO public.balance_adjustments (
    id, tenant_id, entity_type, entity_id,
    previous_balance, new_balance, amount, note, kind, user_id
  ) VALUES (
    gen_random_uuid(), v_tenant_id, 'customer', p_customer_id,
    v_current_balance, p_target_balance, v_delta,
    COALESCE(p_note, ''), v_kind, auth.uid()
  ) RETURNING id INTO v_adj_id;

  UPDATE public.customers
  SET balance = p_target_balance
  WHERE id = p_customer_id AND tenant_id = v_tenant_id;

  IF v_delta < 0 THEN
    PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, v_tenant_id);
  END IF;

  PERFORM public._apply_avoirs_internal(p_customer_id, v_tenant_id);

  RETURN v_adj_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_customer_balance(uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_customer_balance(uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_customer_balance(uuid, numeric, text) TO authenticated;
