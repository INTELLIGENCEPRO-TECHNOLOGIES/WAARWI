/*
# Fix register_supplier_payment: invalid UUID string comparison

## Problem
The `register_supplier_payment` function declares `p_order_id` as `uuid` but
compared it to text literals (`''` and `'__balance__'`). When a valid UUID was
passed (a specific order selected), PostgreSQL tried to cast the empty string
`''` to UUID to evaluate `p_order_id <> ''`, raising:
  `invalid input syntax for type uuid: ""`

The frontend already converts `'__balance__'` to `NULL` before calling the RPC,
so the string guards were both unnecessary and invalid on a UUID-typed parameter.

## Fix
Rewrite `register_supplier_payment` to use only `IS NULL` checks on
`p_order_id`, matching the working pattern in `register_customer_payment`
(which uses `IF p_sale_id IS NOT NULL THEN` for its UUID parameter).

## Changes
- Replaced `IF p_order_id IS NOT NULL AND p_order_id <> '' AND p_order_id <> '__balance__' THEN`
  with `IF p_order_id IS NOT NULL THEN`.
- Replaced FIFO loop guard
  `AND (p_order_id IS NULL OR p_order_id = '' OR p_order_id = '__balance__' OR id <> p_order_id)`
  with `AND (p_order_id IS NULL OR id <> p_order_id)`.

## Security
- No RLS or policy changes.
- No table schema changes.
- SECURITY DEFINER preserved; function signature unchanged.
*/

CREATE OR REPLACE FUNCTION public.register_supplier_payment(
  p_supplier_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT '',
  p_cash_session_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_from_cash boolean DEFAULT false
) RETURNS jsonb
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
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'Fournisseur obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

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

    -- Mouvement de caisse si l'utilisateur a choisi de sortir l'argent de la caisse
    IF p_from_cash AND p_cash_session_id IS NOT NULL THEN
      SELECT site_id INTO v_site_id FROM cash_sessions WHERE id = p_cash_session_id;
      INSERT INTO cash_movements (
        tenant_id, cash_session_id, site_id, user_id, kind, amount,
        reason, note, reference, supplier_id, payment_method_id, method_name
      ) VALUES (
        v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'expense', v_remaining,
        'Règlement solde fournisseur', '', COALESCE(p_reference,''),
        p_supplier_id, p_payment_method_id, COALESCE(p_method_name,'')
      );
      -- Diminuer le théorique de caisse (sortie d'espèces)
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
