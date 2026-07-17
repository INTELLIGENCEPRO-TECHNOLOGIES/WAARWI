/*
# Cash session guards and supplier payment fix

## Summary

This migration fixes a critical bug in `register_supplier_payment` where cash movements
and theoretical balance updates were only created for the unapplied remainder (positioned
balance), not for amounts applied to specific supplier orders. It also adds mandatory
"cash session must be open" guards to all payment registration functions so that no
payment can be recorded without an open cash session.

## Changes

### 1. `register_supplier_payment` (modified)
- **Cash session guard**: when `p_from_cash` is true, the function now requires
  `p_cash_session_id` to be provided and the session to be open. Raises
  'La caisse doit être ouverte d'abord' if missing/closed.
- **Balance check**: when `p_from_cash` is true, verifies the session's available
  balance (`opening_amount + theoretical_amount`) is >= `p_amount`. Raises
  'Solde caisse insuffisant' if not.
- **Cash movements for all applications**: a `cash_movements` row (kind `expense`)
  is now created for **every** supplier order payment (both the targeted order and
  the FIFO loop), not just the unapplied remainder. Each application also calls
  `increment_session_theoretical` to decrement the theoretical balance.
- **Site resolution**: `v_site_id` is fetched once at the start from the cash session.
- The unapplied remainder block keeps its existing cash movement logic but reuses
  the already-fetched `v_site_id`.

### 2. `register_sale_payment` (modified)
- **Cash session guard**: if `p_cash_session_id` is NULL, raises
  'La caisse doit être ouverte d'abord'. This ensures no sale payment can be
  recorded without an open cash session.
- **Balance check**: verifies the session's available balance is >= `p_amount`
  before recording the payment. Raises 'Solde caisse insuffisant' if not.

### 3. `register_customer_payment` (modified)
- **Cash session guard**: if `p_cash_session_id` is NULL, raises
  'La caisse doit être ouverte d'abord'.
- **Balance check**: verifies the session's available balance is >= `p_amount`
  before processing. Raises 'Solde caisse insuffisant' if not.
- The per-invoice imputation (via `register_sale_payment`) inherits the same guard,
  so the check at the top of `register_customer_payment` covers the whole flow.

## Security
- No RLS policy changes.
- All functions remain `SECURITY DEFINER` with the same ownership semantics.

## Important notes
1. The cash session guards are intentionally strict: any payment (customer or
   supplier) that goes through these RPCs now requires an open cash session.
2. `create_pos_sale` and `create_credit_sale` are NOT affected because they do
   not call `register_sale_payment` internally — they insert `sale_payments`
   directly and manage `cash_sessions.theoretical_amount` themselves.
3. The balance check uses `opening_amount + COALESCE(theoretical_amount, 0)`
   as the available cash. `theoretical_amount` accumulates all cash
   movements (sales income, expense outflows, prepayments) so this reflects
   the real available cash in the drawer.
*/

-- ============================================================
-- 1. register_supplier_payment — fixed cash movements + guards
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_supplier_payment(
  p_supplier_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT '',
  p_cash_session_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_from_cash boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_remaining numeric;
  v_order record;
  v_due numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_applied_orders jsonb := '[]'::jsonb;
  v_site_id uuid;
  v_new_paid numeric;
  v_session_status text;
  v_session_balance numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'Fournisseur obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  -- Cash session guard: if paying from cash, session must be provided and open
  IF p_from_cash THEN
    IF p_cash_session_id IS NULL THEN
      RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
    END IF;
    SELECT status INTO v_session_status FROM cash_sessions WHERE id = p_cash_session_id;
    IF v_session_status IS NULL OR v_session_status <> 'open' THEN
      RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
    END IF;
    -- Balance check
    SELECT COALESCE(opening_amount, 0) + COALESCE(theoretical_amount, 0)
    INTO v_session_balance
    FROM cash_sessions WHERE id = p_cash_session_id;
    IF v_session_balance IS NULL OR v_session_balance < p_amount THEN
      RAISE EXCEPTION 'Solde caisse insuffisant';
    END IF;
    -- Fetch site_id once
    SELECT site_id INTO v_site_id FROM cash_sessions WHERE id = p_cash_session_id;
  END IF;

  v_remaining := p_amount;

  -- Si une commande précise est ciblée, la traiter d'abord
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM supplier_orders
    WHERE id = p_order_id AND tenant_id = v_tenant_id
    AND supplier_id = p_supplier_id AND status NOT IN ('cancelled','draft');
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
    v_due := GREATEST(0, COALESCE(v_order.total,0) - COALESCE(v_order.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      v_new_paid := COALESCE(v_order.paid,0) + v_take;
      UPDATE supplier_orders SET paid = v_new_paid WHERE id = v_order.id;
      INSERT INTO supplier_payments (
        tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference
      ) VALUES (
        v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id,
        COALESCE(p_method_name,''), v_take, COALESCE(p_reference,'')
      );
      -- Cash movement for this application (not just the remainder)
      IF p_from_cash AND p_cash_session_id IS NOT NULL THEN
        INSERT INTO cash_movements (
          tenant_id, cash_session_id, site_id, user_id, kind, amount,
          reason, note, reference, supplier_id, payment_method_id, method_name
        ) VALUES (
          v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'expense', v_take,
          'Règlement commande ' || v_order.order_number, '', COALESCE(p_reference,''),
          p_supplier_id, p_payment_method_id, COALESCE(p_method_name,'')
        );
        PERFORM increment_session_theoretical(p_cash_session_id, -v_take);
      END IF;
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_orders := v_applied_orders || jsonb_build_object(
        'order_id', v_order.id, 'order_number', v_order.order_number, 'amount', v_take);
    END IF;
  END IF;

  -- Imputation FIFO sur les autres commandes impayées
  FOR v_order IN
    SELECT * FROM supplier_orders
    WHERE tenant_id = v_tenant_id
    AND supplier_id = p_supplier_id
    AND status NOT IN ('cancelled','draft')
    AND COALESCE(paid,0) < COALESCE(total,0)
    AND (p_order_id IS NULL OR id <> p_order_id)
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(0, COALESCE(v_order.total,0) - COALESCE(v_order.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      v_new_paid := COALESCE(v_order.paid,0) + v_take;
      UPDATE supplier_orders SET paid = v_new_paid WHERE id = v_order.id;
      INSERT INTO supplier_payments (
        tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference
      ) VALUES (
        v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id,
        COALESCE(p_method_name,''), v_take, COALESCE(p_reference,'')
      );
      -- Cash movement for this FIFO application
      IF p_from_cash AND p_cash_session_id IS NOT NULL THEN
        INSERT INTO cash_movements (
          tenant_id, cash_session_id, site_id, user_id, kind, amount,
          reason, note, reference, supplier_id, payment_method_id, method_name
        ) VALUES (
          v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'expense', v_take,
          'Règlement commande ' || v_order.order_number, '', COALESCE(p_reference,''),
          p_supplier_id, p_payment_method_id, COALESCE(p_method_name,'')
        );
        PERFORM increment_session_theoretical(p_cash_session_id, -v_take);
      END IF;
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_orders := v_applied_orders || jsonb_build_object(
        'order_id', v_order.id, 'order_number', v_order.order_number, 'amount', v_take);
    END IF;
  END LOOP;

  -- Reliquat non imputé = solde positionné
  IF v_remaining > 0 THEN
    -- Paiement sans commande (solde positionné)
    INSERT INTO supplier_payments (
      tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference
    ) VALUES (
      v_tenant_id, p_supplier_id, NULL, p_payment_method_id,
      COALESCE(p_method_name,''), v_remaining, COALESCE(p_reference,'')
    );

    -- Réduire le solde fournisseur directement
    UPDATE suppliers
    SET balance = GREATEST(0, COALESCE(balance,0) - v_remaining)
    WHERE id = p_supplier_id AND tenant_id = v_tenant_id;

    -- Ajustement de solde négatif pour le grand livre fournisseur
    INSERT INTO balance_adjustments (
      tenant_id, entity_type, entity_id,
      previous_balance, new_balance, amount,
      note, user_id
    ) VALUES (
      v_tenant_id, 'supplier', p_supplier_id,
      (SELECT COALESCE(balance,0) + v_remaining FROM suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant_id),
      (SELECT COALESCE(balance,0) FROM suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant_id),
      -v_remaining,
      'Règlement solde · ' || COALESCE(p_method_name,''),
      auth.uid()
    );

    -- Mouvement de caisse pour le reliquat
    IF p_from_cash AND p_cash_session_id IS NOT NULL THEN
      INSERT INTO cash_movements (
        tenant_id, cash_session_id, site_id, user_id, kind, amount,
        reason, note, reference, supplier_id, payment_method_id, method_name
      ) VALUES (
        v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'expense', v_remaining,
        'Règlement solde fournisseur', '', COALESCE(p_reference,''),
        p_supplier_id, p_payment_method_id, COALESCE(p_method_name,'')
      );
      PERFORM increment_session_theoretical(p_cash_session_id, -v_remaining);
    END IF;
  END IF;

  -- Recalcul final du solde pour cohérence
  PERFORM recompute_supplier_balance(p_supplier_id);

  RETURN jsonb_build_object(
    'applied', v_applied,
    'unapplied', v_remaining,
    'orders', v_applied_orders
  );
END;
$function$;

-- ============================================================
-- 2. register_sale_payment — add cash session guard + balance check
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_sale_payment(
  p_sale_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT NULL,
  p_cash_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_sale record;
  v_new_paid numeric;
  v_new_status text;
  v_pm_type text;
  v_session_status text;
  v_session_balance numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  -- Cash session guard: every sale payment requires an open cash session
  IF p_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;
  SELECT status INTO v_session_status FROM cash_sessions WHERE id = p_cash_session_id;
  IF v_session_status IS NULL OR v_session_status <> 'open' THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;
  -- Balance check
  SELECT COALESCE(opening_amount, 0) + COALESCE(theoretical_amount, 0)
  INTO v_session_balance
  FROM cash_sessions WHERE id = p_cash_session_id;
  IF v_session_balance IS NULL OR v_session_balance < p_amount THEN
    RAISE EXCEPTION 'Solde caisse insuffisant';
  END IF;

  IF p_payment_method_id IS NOT NULL THEN
    SELECT payment_type INTO v_pm_type FROM payment_methods
    WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
    IF COALESCE(v_pm_type, '') = 'credit' THEN
      RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
    END IF;
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id;
  IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Facture introuvable'; END IF;

  INSERT INTO sale_payments (
    tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference
  ) VALUES (
    v_tenant_id, p_sale_id, p_cash_session_id, p_payment_method_id,
    COALESCE(p_method_name, ''), p_amount, COALESCE(p_reference, '')
  );

  v_new_paid := COALESCE(v_sale.paid, 0) + p_amount;
  v_new_status := CASE
    WHEN v_sale.status = 'cancelled' THEN 'cancelled'
    WHEN v_new_paid >= v_sale.total THEN 'paid'
    ELSE 'partial'
  END;

  UPDATE sales SET paid = v_new_paid, status = v_new_status WHERE id = p_sale_id;

  IF p_cash_session_id IS NOT NULL THEN
    UPDATE cash_sessions
    SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
    WHERE id = p_cash_session_id;

    INSERT INTO cash_movements (
      tenant_id, site_id, cash_session_id, user_id,
      kind, amount, reason, note, reference,
      customer_id, payment_method_id, method_name
    ) VALUES (
      v_tenant_id, v_sale.site_id, p_cash_session_id, auth.uid(),
      'income', p_amount,
      'Règlement ' || v_sale.sale_number,
      '',
      v_sale.sale_number,
      v_sale.customer_id, p_payment_method_id,
      COALESCE(p_method_name, '')
    );
  END IF;

  -- Decrease customer balance (allow negative = overpayment/avoir)
  IF v_sale.customer_id IS NOT NULL THEN
    UPDATE customers
    SET balance = COALESCE(balance, 0) - p_amount
    WHERE id = v_sale.customer_id;
  END IF;

  RETURN jsonb_build_object('paid', v_new_paid, 'status', v_new_status);
END;
$function$;

-- ============================================================
-- 3. register_customer_payment — add cash session guard + balance check
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_customer_payment(
  p_customer_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT '',
  p_cash_session_id uuid DEFAULT NULL,
  p_sale_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_tenant_id uuid;
  v_pm_type text;
  v_remaining numeric;
  v_sale record;
  v_due numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_applied_sales jsonb := '[]'::jsonb;
  v_site_id uuid;
  v_session_status text;
  v_session_balance numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  -- Cash session guard: every customer payment requires an open cash session
  IF p_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;
  SELECT status INTO v_session_status FROM cash_sessions WHERE id = p_cash_session_id;
  IF v_session_status IS NULL OR v_session_status <> 'open' THEN
    RAISE EXCEPTION 'La caisse doit être ouverte d''abord';
  END IF;
  -- Balance check
  SELECT COALESCE(opening_amount, 0) + COALESCE(theoretical_amount, 0)
  INTO v_session_balance
  FROM cash_sessions WHERE id = p_cash_session_id;
  IF v_session_balance IS NULL OR v_session_balance < p_amount THEN
    RAISE EXCEPTION 'Solde caisse insuffisant';
  END IF;

  IF p_payment_method_id IS NOT NULL THEN
    SELECT payment_type INTO v_pm_type FROM payment_methods
    WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
    IF COALESCE(v_pm_type, '') = 'credit' THEN
      RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
    END IF;
  END IF;

  v_remaining := p_amount;

  -- Si une facture précise est ciblée, la traiter d'abord
  IF p_sale_id IS NOT NULL THEN
    SELECT * INTO v_sale FROM sales
    WHERE id = p_sale_id AND tenant_id = v_tenant_id
    AND customer_id = p_customer_id AND status <> 'cancelled';
    IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Facture introuvable'; END IF;
    v_due := GREATEST(0, COALESCE(v_sale.total,0) - COALESCE(v_sale.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      PERFORM register_sale_payment(v_sale.id, p_payment_method_id, p_method_name,
        v_take, p_reference, p_cash_session_id);
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_sales := v_applied_sales || jsonb_build_object(
        'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_take);
    END IF;
  END IF;

  -- Imputation FIFO sur les autres factures impayées
  FOR v_sale IN
    SELECT * FROM sales
    WHERE tenant_id = v_tenant_id
    AND customer_id = p_customer_id
    AND status <> 'cancelled'
    AND COALESCE(paid,0) < COALESCE(total,0)
    AND (p_sale_id IS NULL OR id <> p_sale_id)
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(0, COALESCE(v_sale.total,0) - COALESCE(v_sale.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      PERFORM register_sale_payment(v_sale.id, p_payment_method_id, p_method_name,
        v_take, p_reference, p_cash_session_id);
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_sales := v_applied_sales || jsonb_build_object(
        'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_take);
    END IF;
  END LOOP;

  -- If there's unapplied amount (positioned balance without matching invoices):
  -- 1. Reduce customer balance
  -- 2. Create a cash_movement so it appears in the cash session
  -- 3. Create a negative balance_adjustment so it appears in the customer ledger
  IF v_remaining > 0 THEN
    UPDATE customers
    SET balance = COALESCE(balance, 0) - v_remaining
    WHERE id = p_customer_id AND tenant_id = v_tenant_id;

    -- Get site_id from cash session
    IF p_cash_session_id IS NOT NULL THEN
      SELECT site_id INTO v_site_id FROM cash_sessions WHERE id = p_cash_session_id;
    END IF;

    -- Record cash movement (income) so it appears in the cash session
    INSERT INTO cash_movements (
      tenant_id, cash_session_id, site_id, user_id, kind, amount,
      reason, note, reference, customer_id, payment_method_id, method_name
    ) VALUES (
      v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'income', v_remaining,
      'Règlement solde client', '', COALESCE(p_reference, ''),
      p_customer_id, p_payment_method_id, COALESCE(p_method_name, '')
    );

    -- Update session theoretical_amount for the unapplied portion
    IF p_cash_session_id IS NOT NULL THEN
      UPDATE cash_sessions
      SET theoretical_amount = COALESCE(theoretical_amount, 0) + v_remaining
      WHERE id = p_cash_session_id;
    END IF;

    -- Record negative balance_adjustment so it shows in customer ledger
    INSERT INTO balance_adjustments (
      tenant_id, entity_type, entity_id,
      previous_balance, new_balance, amount,
      note, user_id
    ) VALUES (
      v_tenant_id, 'customer', p_customer_id,
      (SELECT COALESCE(balance, 0) + v_remaining FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id),
      (SELECT COALESCE(balance, 0) FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id),
      -v_remaining,
      'Règlement solde · ' || COALESCE(p_method_name, ''),
      auth.uid()
    );
  ELSE
    -- All applied to invoices - just update session for the full amount
    -- (register_sale_payment already handles session for each payment)
    -- No additional session update needed here
    NULL;
  END IF;

  RETURN jsonb_build_object(
    'applied', v_applied,
    'unapplied', v_remaining,
    'sales', v_applied_sales
  );
END;
$function$;
