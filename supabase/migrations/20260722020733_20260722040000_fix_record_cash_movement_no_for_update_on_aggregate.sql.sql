-- Fix: remove FOR UPDATE from the aggregate availability check
-- (aggregate functions don't support FOR UPDATE; the FIFO consumption
--  loop below already locks individual rows for concurrency safety)
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
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_movement_id uuid;
  v_prepay_id uuid;
  v_available numeric;
  v_remaining numeric;
  v_prepay RECORD;
  v_take numeric;
  v_applied jsonb;
BEGIN
  v_tenant_id := public.current_tenant_id();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  IF p_kind NOT IN ('expense','income','customer_prepayment','customer_withdrawal') THEN
    RAISE EXCEPTION 'Invalid kind: %', p_kind;
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  IF p_kind IN ('customer_prepayment','customer_withdrawal') AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer is required for this movement kind';
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
