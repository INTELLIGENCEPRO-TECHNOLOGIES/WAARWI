/*
# Fix: Restore balance decrease on prepayment deposit + correct BALLA DIA

## Problem
The withdrawal migration (20260722015209) rewrote record_cash_movement but
accidentally dropped the critical line:
  UPDATE customers SET balance = COALESCE(balance, 0) - p_amount WHERE id = p_customer_id;
from the customer_prepayment branch.

This was originally added in migration 20260627235718 and is CRITICAL for correct
balance accounting:
- When a customer deposits a prepayment, their balance should decrease (money received)
- Without this, customers.balance is overstated, showing phantom debt

## Impact
- BALLA DIA deposited 100,000 prepay but balance was never decreased
- Then a sale of 52,000 added to balance (balance = 52,000)
- Auto-apply paid the sale from prepay (amount_used = 52,000)
- But balance stayed at 52,000 instead of the correct -48,000
- The customer card shows Solde a payer: 4,000 instead of Solde crediteur: 48,000

## Fix
1. Restore UPDATE customers SET balance -= p_amount in prepayment branch
2. Correct BALLA DIA balance: 52,000 - 100,000 = -48,000
3. Net position logic for withdrawals now uses GREATEST(0, balance) to handle
   negative balances (credit) correctly

## Modified Functions
- record_cash_movement: restored balance decrease in prepayment branch

## Data Fix
- BALLA DIA (db17e979-3d89-4f3c-8c44-cb20659c6de7): balance corrected from
  52,000 to -48,000
*/

CREATE OR REPLACE FUNCTION public.record_cash_movement(
  p_cash_session_id uuid,
  p_site_id uuid,
  p_kind text,
  p_amount numeric,
  p_reason text DEFAULT '',
  p_note text DEFAULT '',
  p_reference text DEFAULT '',
  p_customer_id uuid DEFAULT NULL,
  p_payment_method_id uuid DEFAULT NULL,
  p_method_name text DEFAULT '',
  p_expense_category_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_movement_id uuid;
  v_prepay_id uuid;
  v_applied jsonb;
  v_pm_type text;
  v_available numeric;
  v_balance numeric;
  v_net numeric;
  v_remaining numeric;
  v_prepay record;
  v_take numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_kind NOT IN ('expense','income','customer_prepayment','customer_withdrawal') THEN
    RAISE EXCEPTION 'Type de mouvement invalide';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  IF p_kind IN ('customer_prepayment','customer_withdrawal') THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
    IF p_payment_method_id IS NOT NULL THEN
      SELECT payment_type INTO v_pm_type FROM payment_methods
      WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
      IF COALESCE(v_pm_type,'') = 'credit' THEN
        RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
      END IF;
    END IF;
  END IF;

  IF p_kind = 'customer_withdrawal' THEN
    SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_available
    FROM customer_prepayments
    WHERE tenant_id = v_tenant_id
      AND customer_id = p_customer_id
      AND amount_used < amount;

    SELECT COALESCE(balance, 0) INTO v_balance
    FROM customers
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;

    v_net := COALESCE(v_available, 0) - GREATEST(0, COALESCE(v_balance, 0));

    IF v_available IS NULL OR v_available <= 0 THEN
      RAISE EXCEPTION 'Le client n''a aucun acompte disponible';
    END IF;
    IF v_net <= 0 THEN
      RAISE EXCEPTION 'Le client a une dette de % qui couvre son acompte de %. Retrait impossible.', v_balance, v_available;
    END IF;
    IF p_amount > v_net THEN
      RAISE EXCEPTION 'Montant supérieur au retrait maximum (%). Le client a un acompte de % et une dette de % à déduire.', v_net, v_available, v_balance;
    END IF;
  END IF;

  INSERT INTO cash_movements (
    tenant_id, cash_session_id, site_id, user_id, kind, amount,
    reason, note, reference, customer_id, payment_method_id, method_name,
    expense_category_id
  ) VALUES (
    v_tenant_id, p_cash_session_id, p_site_id, auth.uid(), p_kind, p_amount,
    COALESCE(p_reason,''), COALESCE(p_note,''), COALESCE(p_reference,''),
    p_customer_id, p_payment_method_id, COALESCE(p_method_name,''),
    CASE WHEN p_kind = 'expense' THEN p_expense_category_id ELSE NULL END
  ) RETURNING id INTO v_movement_id;

  IF p_cash_session_id IS NOT NULL THEN
    IF p_kind IN ('expense','customer_withdrawal') THEN
      UPDATE cash_sessions
      SET theoretical_amount = COALESCE(theoretical_amount, 0) - p_amount
      WHERE id = p_cash_session_id;
    ELSE
      UPDATE cash_sessions
      SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
      WHERE id = p_cash_session_id;
    END IF;
  END IF;

  IF p_kind = 'customer_prepayment' THEN
    INSERT INTO customer_prepayments (
      tenant_id, customer_id, cash_movement_id, cash_session_id,
      amount, payment_method_id, method_name, reference
    ) VALUES (
      v_tenant_id, p_customer_id, v_movement_id, p_cash_session_id,
      p_amount, p_payment_method_id, COALESCE(p_method_name,''), COALESCE(p_reference,'')
    ) RETURNING id INTO v_prepay_id;

    -- CRITICAL: Decrease customer balance (prepayment = money received from customer)
    UPDATE customers
    SET balance = COALESCE(balance, 0) - p_amount
    WHERE id = p_customer_id;

    v_applied := apply_customer_prepayments(p_customer_id);

    RETURN jsonb_build_object(
      'movement_id', v_movement_id,
      'prepayment_id', v_prepay_id,
      'auto_applied', COALESCE((v_applied->>'applied')::numeric, 0)
    );
  END IF;

  IF p_kind = 'customer_withdrawal' THEN
    v_remaining := p_amount;
    FOR v_prepay IN
      SELECT * FROM customer_prepayments
       WHERE tenant_id = v_tenant_id
         AND customer_id = p_customer_id
         AND amount_used < amount
       ORDER BY created_at ASC
       FOR UPDATE
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_take := LEAST(v_remaining, v_prepay.amount - v_prepay.amount_used);
      IF v_take <= 0 THEN CONTINUE; END IF;

      UPDATE customer_prepayments
         SET amount_used = amount_used + v_take
       WHERE id = v_prepay.id;

      v_remaining := v_remaining - v_take;
    END LOOP;

    RETURN jsonb_build_object(
      'movement_id', v_movement_id,
      'withdrawn', p_amount - v_remaining
    );
  END IF;

  RETURN jsonb_build_object('movement_id', v_movement_id);
END;
$$;

-- Fix BALLA DIA balance: subtract the 100,000 prepay that was never accounted for
UPDATE customers
SET balance = COALESCE(balance, 0) - 100000
WHERE id = 'db17e979-3d89-4f3c-8c44-cb20659c6de7';
