/*
# Add customer_loan movement type to record_cash_movement

## Context
Currently, customers can only withdraw from their available prepayment balance.
This migration adds a new movement kind `customer_loan` that allows a cashier
to give a customer money that creates a debt (créance) without requiring any
prepayment balance. The loan amount is added directly to the customer's balance
(outstanding debt) and can be repaid via the existing customer payment system.

## Changes
1. Modified function: `record_cash_movement`
   - Accepts new kind value: `customer_loan`
   - When kind is `customer_loan`:
     - Requires a customer_id
     - Does NOT check prepayment balance (unlike `customer_withdrawal`)
     - Inserts a cash_movement row
     - Decreases session theoretical_amount (money leaves the register)
     - Increases the customer's `balance` (their debt)
     - Respects the customer's `credit_limit` if set (blocks if exceeded)
     - Returns movement_id and loan_amount

2. No schema changes — pure function logic update.
3. No RLS/policy changes.
4. Safe to re-run (CREATE OR REPLACE).

## Important Notes
1. The loan does NOT touch customer_prepayments at all.
2. Repayment is handled by the existing `register_customer_payment` flow.
3. The tenant setting `enable_customer_loans` is checked frontend-side only.
4. The customer's credit_limit (if set) is honored to prevent unlimited loans.
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
  v_credit_limit numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_kind NOT IN ('expense','income','customer_prepayment','customer_withdrawal','customer_loan') THEN
    RAISE EXCEPTION 'Type de mouvement invalide';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  -- Validation for customer-related kinds
  IF p_kind IN ('customer_prepayment','customer_withdrawal','customer_loan') THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
    IF p_payment_method_id IS NOT NULL THEN
      SELECT payment_type INTO v_pm_type FROM payment_methods
      WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
      IF COALESCE(v_pm_type,'') = 'credit' THEN
        RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
      END IF;
    END IF;
  END IF;

  -- For withdrawal: check net position (acompte - debt) BEFORE inserting
  IF p_kind = 'customer_withdrawal' THEN
    SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_available
    FROM customer_prepayments
    WHERE tenant_id = v_tenant_id
      AND customer_id = p_customer_id
      AND amount_used < amount;

    SELECT COALESCE(balance, 0) INTO v_balance
    FROM customers
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;

    v_net := COALESCE(v_available, 0) - COALESCE(v_balance, 0);

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

  -- For loan: check credit_limit if set
  IF p_kind = 'customer_loan' THEN
    SELECT COALESCE(balance, 0), COALESCE(credit_limit, 0)
    INTO v_balance, v_credit_limit
    FROM customers
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;

    IF v_credit_limit > 0 AND (v_balance + p_amount) > v_credit_limit THEN
      RAISE EXCEPTION 'Plafond crédit dépassé (%). Solde actuel : %. Maximum prêt possible : %.',
        v_credit_limit, v_balance, GREATEST(0, v_credit_limit - v_balance);
    END IF;
  END IF;

  -- Insert the cash_movement row
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

  -- Update session theoretical_amount
  IF p_cash_session_id IS NOT NULL THEN
    IF p_kind IN ('expense','customer_withdrawal','customer_loan') THEN
      UPDATE cash_sessions
      SET theoretical_amount = COALESCE(theoretical_amount, 0) - p_amount
      WHERE id = p_cash_session_id;
    ELSE
      UPDATE cash_sessions
      SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
      WHERE id = p_cash_session_id;
    END IF;
  END IF;

  -- Prepayment: create customer_prepayments row and auto-apply
  IF p_kind = 'customer_prepayment' THEN
    INSERT INTO customer_prepayments (
      tenant_id, customer_id, cash_movement_id, cash_session_id,
      amount, payment_method_id, method_name, reference
    ) VALUES (
      v_tenant_id, p_customer_id, v_movement_id, p_cash_session_id,
      p_amount, p_payment_method_id, COALESCE(p_method_name,''), COALESCE(p_reference,'')
    ) RETURNING id INTO v_prepay_id;

    v_applied := apply_customer_prepayments(p_customer_id);

    RETURN jsonb_build_object(
      'movement_id', v_movement_id,
      'prepayment_id', v_prepay_id,
      'auto_applied', COALESCE((v_applied->>'applied')::numeric, 0)
    );
  END IF;

  -- Withdrawal: consume prepayment credit FIFO (oldest first)
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

  -- Loan: increase customer debt (balance)
  IF p_kind = 'customer_loan' THEN
    UPDATE customers
    SET balance = COALESCE(balance, 0) + p_amount
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;

    RETURN jsonb_build_object(
      'movement_id', v_movement_id,
      'loan_amount', p_amount
    );
  END IF;

  RETURN jsonb_build_object('movement_id', v_movement_id);
END;
$$;
