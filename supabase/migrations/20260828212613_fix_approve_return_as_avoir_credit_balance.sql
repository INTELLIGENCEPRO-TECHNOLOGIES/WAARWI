/*
# Fix approve_return_as_avoir: credit customer balance and run allocation

## Summary
The Billing page's "Avoir" workflow calls `approve_return_as_avoir`, which previously
only changed the return's status/method columns WITHOUT touching `customers.balance`.
This caused the stored balance to drift from the computed grand livre balance.

## Changes

### approve_return_as_avoir (rewritten)
  - IDEMPOTENCY: if the return is already `status = 'approved'`, returns early without
    modifying anything (prevents double-subtraction on repeated clicks).
  - FINANCIAL EVENT: subtracts `return.total` from `customers.balance` (the single
    balance modification for this avoir).
  - ALLOCATION: calls `_apply_avoirs_internal` to distribute the credit to unpaid
    invoices and open adjustments (this function never touches balance).
  - Handles returns with no customer (no-op for anonymous sales).

## Security
  - Same SECURITY DEFINER + tenant isolation as before.
  - GRANT EXECUTE TO authenticated only.
*/

CREATE OR REPLACE FUNCTION public.approve_return_as_avoir(
  p_return_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_ret record;
  v_alloc_result jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT * INTO v_ret FROM public.sale_returns
  WHERE id = p_return_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_ret.id IS NULL THEN RAISE EXCEPTION 'Retour introuvable'; END IF;

  -- IDEMPOTENCY: if already approved, do nothing (prevents double balance subtraction)
  IF v_ret.status = 'approved' THEN
    RETURN jsonb_build_object(
      'success', true,
      'idempotent', true,
      'credit_balance', v_ret.total,
      'message', 'Avoir déjà approuvé — aucune modification'
    );
  END IF;

  IF v_ret.status <> 'pending' THEN
    RAISE EXCEPTION 'Seuls les retours en attente peuvent être convertis en avoir';
  END IF;

  -- Update return status
  UPDATE public.sale_returns
  SET status = 'approved',
      refund_method = 'avoir',
      refunded_at = now(),
      approved_by = auth.uid()
  WHERE id = p_return_id;

  -- FINANCIAL EVENT: credit the customer balance (single modification)
  IF v_ret.customer_id IS NOT NULL AND COALESCE(v_ret.total, 0) > 0 THEN
    UPDATE public.customers
    SET balance = COALESCE(balance, 0) - v_ret.total
    WHERE id = v_ret.customer_id AND tenant_id = v_tenant_id;

    -- ALLOCATION: distribute credit to open targets (does NOT touch balance)
    v_alloc_result := public._apply_avoirs_internal(v_ret.customer_id, v_tenant_id);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'idempotent', false,
    'credit_balance', v_ret.total,
    'allocation', COALESCE(v_alloc_result, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.approve_return_as_avoir(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_return_as_avoir(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_return_as_avoir(uuid) TO authenticated;
