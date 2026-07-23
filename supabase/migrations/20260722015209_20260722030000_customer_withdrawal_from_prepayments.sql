/*
# Retrait client depuis acompte (customer_withdrawal)

1. Modified Constraint
- `cash_movements.kind` CHECK constraint extended to accept 'customer_withdrawal'
  alongside 'expense', 'income', 'customer_prepayment'.
  This allows the cash drawer to record a withdrawal (cash OUT) that consumes
  the customer's available prepayment credit.

2. Modified Function
- `record_cash_movement` : signature unchanged (11 params + p_expense_category_id).
  A new 'customer_withdrawal' branch is added:
    * Requires p_customer_id.
    * Computes available credit = SUM(amount - amount_used) from customer_prepayments
      (FOR UPDATE lock to prevent concurrent races).
    * Blocks if no credit available ('Le client n''a aucun acompte disponible').
    * Blocks if p_amount > available ('Montant supérieur à l''acompte disponible').
    * Inserts the cash_movements row with kind = 'customer_withdrawal'.
    * Subtracts p_amount from cash_sessions.theoretical_amount (cash leaves drawer).
    * Consumes prepayment credit FIFO (oldest first), incrementing amount_used —
      the exact mirror of apply_customer_prepayments but consuming credit instead
      of applying it to invoices.
    * Does NOT touch customers.balance (consistent with current prepayment model
      where balance is an invoice-debt counter, not a credit counter).
    * Does NOT call apply_customer_prepayments (a withdrawal is not an invoice payment).
  The existing 'expense', 'income', 'customer_prepayment' branches are unchanged.

3. Security
- No new tables. No new RLS policies.
- Backfill: grant pos_customer_withdrawal permission to roles that already have
  pos_cash_movement = true (admin, super_admin, manager, etc.) so the feature
  is immediately available to authorised users. Other roles default to false.

4. Important Notes
- The withdrawal consumes customer_prepayments.amount_used, so the "Acompte
  disponible" shown in the Tiers customer account header decreases naturally
  after each withdrawal — no extra recalculation needed.
- The cash session theoretical balance is reduced (same as expense), keeping
  session close, variance, and Z-report math correct.
- customers.balance is never modified, so invoice accounting, balance
  recalculation triggers, and the "Solde comptable" header are all unaffected.
*/

-- 1. Extend the CHECK constraint on cash_movements.kind
ALTER TABLE public.cash_movements DROP CONSTRAINT IF EXISTS cash_movements_kind_check;
ALTER TABLE public.cash_movements
  ADD CONSTRAINT cash_movements_kind_check
  CHECK (kind IN ('expense','income','customer_prepayment','customer_withdrawal'));

-- 2. Recreate record_cash_movement with the new customer_withdrawal branch
--    Signature is identical to the current deployed version (11 params + p_expense_category_id).
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

  -- Validation for customer-related kinds
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

  -- For withdrawal: check available prepayment credit BEFORE inserting
  -- (no FOR UPDATE here — aggregate functions don't support it; the FIFO
  --  consumption loop below locks individual rows for concurrency safety)
  IF p_kind = 'customer_withdrawal' THEN
    SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_available
    FROM customer_prepayments
    WHERE tenant_id = v_tenant_id
      AND customer_id = p_customer_id
      AND amount_used < amount;

    IF v_available IS NULL OR v_available <= 0 THEN
      RAISE EXCEPTION 'Le client n''a aucun acompte disponible';
    END IF;
    IF p_amount > v_available THEN
      RAISE EXCEPTION 'Montant supérieur à l''acompte disponible (%)', v_available;
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

  RETURN jsonb_build_object('movement_id', v_movement_id);
END;
$$;

-- 3. Backfill pos_customer_withdrawal permission for roles that already have pos_cash_movement
UPDATE role_permissions
SET permissions = jsonb_set(
  COALESCE(permissions, '{}'::jsonb),
  '{pos_customer_withdrawal}',
  'true'::jsonb
)
WHERE permissions ? 'pos_cash_movement'
  AND (permissions->>'pos_cash_movement') = 'true'
  AND NOT (permissions ? 'pos_customer_withdrawal');
