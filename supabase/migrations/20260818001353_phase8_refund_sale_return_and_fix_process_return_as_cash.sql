/*
# Phase 8c: Deferred refund RPC + fix process_return_as_cash

## Summary
1. New function `refund_sale_return` for deferred/partial refunds after a return
   has already been created. Prevents double refunds by checking total already
   refunded vs return total.

2. Updated `process_return_as_cash` to use kind='refund' (was 'expense'),
   set sale_return_id on the cash movement, and add double-refund guard.

## New Function: refund_sale_return
  - p_return_id (uuid) — the return to refund
  - p_session_id (uuid) — cash session for the refund
  - p_amount (numeric, optional) — amount to refund; defaults to full remaining
  - Validates: return exists, belongs to tenant, status is approved
  - Calculates already-refunded total from cash_movements.sale_return_id
  - Refuses if already_refunded + new_amount > return total
  - Creates cash_movement with kind='refund', sets sale_return_id
  - Updates session theoretical_amount
  - Updates refunded_at on the return

## Modified Function: process_return_as_cash
  - Changed kind from 'expense' to 'refund'
  - Now sets sale_return_id on the cash_movement
  - Added double-refund guard
*/

-- 1. refund_sale_return: deferred/partial refund
CREATE OR REPLACE FUNCTION refund_sale_return(
  p_return_id uuid,
  p_session_id uuid,
  p_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_ret record;
  v_session record;
  v_already_refunded numeric;
  v_max_refundable numeric;
  v_refund_amount numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Non authentifié'; END IF;

  -- Validate return
  SELECT * INTO v_ret FROM sale_returns
  WHERE id = p_return_id AND tenant_id = v_tenant_id;
  IF v_ret.id IS NULL THEN RAISE EXCEPTION 'Retour introuvable'; END IF;
  IF v_ret.status NOT IN ('approved', 'pending') THEN
    RAISE EXCEPTION 'Ce retour ne peut pas être remboursé (statut: %)', v_ret.status;
  END IF;

  -- Calculate already refunded
  SELECT COALESCE(SUM(cm.amount), 0) INTO v_already_refunded
  FROM cash_movements cm
  WHERE cm.sale_return_id = p_return_id AND cm.kind = 'refund';

  v_max_refundable := COALESCE(v_ret.total, 0) - v_already_refunded;

  IF v_max_refundable <= 0 THEN
    RAISE EXCEPTION 'Ce retour a déjà été intégralement remboursé (% FCFA)', v_already_refunded;
  END IF;

  -- Determine refund amount
  v_refund_amount := COALESCE(p_amount, v_max_refundable);
  IF v_refund_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant du remboursement doit être positif';
  END IF;
  IF v_refund_amount > v_max_refundable THEN
    RAISE EXCEPTION 'Montant demandé (%) dépasse le remboursable (%). Déjà remboursé: %',
      v_refund_amount, v_max_refundable, v_already_refunded;
  END IF;

  -- Validate session
  SELECT * INTO v_session FROM cash_sessions
  WHERE id = p_session_id AND tenant_id = v_tenant_id AND status = 'open';
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session de caisse invalide ou fermée';
  END IF;

  -- Create refund movement
  INSERT INTO cash_movements (
    tenant_id, site_id, cash_session_id, user_id,
    kind, amount, reason, reference, sale_return_id
  ) VALUES (
    v_tenant_id, v_ret.site_id, p_session_id, auth.uid(),
    'refund', v_refund_amount,
    'Remboursement retour ' || v_ret.return_number,
    v_ret.return_number, p_return_id
  );

  -- Update session theoretical
  UPDATE cash_sessions
  SET theoretical_amount = GREATEST(0, COALESCE(theoretical_amount, 0) - v_refund_amount)
  WHERE id = p_session_id;

  -- Mark return as refunded
  UPDATE sale_returns
  SET refunded_at = now(),
      refund_method = 'cash',
      refund_cash_session_id = p_session_id
  WHERE id = p_return_id;

  RETURN jsonb_build_object(
    'success', true,
    'amount_refunded', v_refund_amount,
    'total_refunded', v_already_refunded + v_refund_amount,
    'return_total', v_ret.total,
    'remaining', v_max_refundable - v_refund_amount
  );
END;
$$;

GRANT EXECUTE ON FUNCTION refund_sale_return TO authenticated;

-- 2. Fix process_return_as_cash: use kind='refund', set sale_return_id, add guard
CREATE OR REPLACE FUNCTION process_return_as_cash(
  p_return_id uuid,
  p_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_ret record;
  v_session record;
  v_already_refunded numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  SELECT * INTO v_ret FROM sale_returns
  WHERE id = p_return_id AND tenant_id = v_tenant_id;
  IF v_ret.id IS NULL THEN RAISE EXCEPTION 'Retour introuvable'; END IF;
  IF v_ret.status NOT IN ('pending', 'approved') THEN
    RAISE EXCEPTION 'Ce retour ne peut pas être remboursé (statut: %)', v_ret.status;
  END IF;

  -- Double-refund guard
  SELECT COALESCE(SUM(cm.amount), 0) INTO v_already_refunded
  FROM cash_movements cm
  WHERE cm.sale_return_id = p_return_id AND cm.kind = 'refund';
  IF v_already_refunded >= COALESCE(v_ret.total, 0) THEN
    RAISE EXCEPTION 'Ce retour a déjà été remboursé';
  END IF;

  -- Try to find open session if not provided
  IF p_session_id IS NULL AND v_ret.site_id IS NOT NULL THEN
    SELECT id INTO p_session_id FROM cash_sessions
    WHERE tenant_id = v_tenant_id AND site_id = v_ret.site_id AND status = 'open'
    ORDER BY opened_at DESC LIMIT 1;
  END IF;

  -- Record cash movement if session is available
  IF p_session_id IS NOT NULL THEN
    SELECT * INTO v_session FROM cash_sessions WHERE id = p_session_id AND tenant_id = v_tenant_id;
    IF v_session.id IS NOT NULL THEN
      INSERT INTO cash_movements (
        tenant_id, site_id, cash_session_id, kind, amount, reason, reference, sale_return_id
      ) VALUES (
        v_tenant_id, v_ret.site_id, p_session_id, 'refund',
        v_ret.total,
        'Remboursement retour ' || v_ret.return_number,
        v_ret.return_number,
        p_return_id
      );
      UPDATE cash_sessions
      SET theoretical_amount = GREATEST(0, COALESCE(theoretical_amount, 0) - v_ret.total)
      WHERE id = p_session_id;
    END IF;
  END IF;

  -- Mark return as approved/refunded
  UPDATE sale_returns
  SET status = 'approved',
      refund_method = 'cash',
      refund_cash_session_id = p_session_id,
      refunded_at = now()
  WHERE id = p_return_id;

  RETURN jsonb_build_object('success', true, 'amount', v_ret.total);
END;
$$;
