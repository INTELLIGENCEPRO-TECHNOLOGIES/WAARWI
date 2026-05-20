/*
  # Hardening du flux de règlements client

  1. Évolutions
    - `register_sale_payment` rejette désormais tout règlement sur un mode
      de type `credit` (le crédit client doit être une facture non payée,
      pas un mode de règlement).
    - Nouveau RPC `create_credit_sale` : crée une vente à crédit pure
      (aucune ligne `sale_payments`, statut `validated`, paid = 0).
    - Nouveau RPC `register_customer_payment` : encaissement libre d'un
      client depuis la caisse (permet d'imputer automatiquement sur la
      plus ancienne facture impayée ou sur une facture précise).

  2. Sécurité
    - Tous les RPCs sont SECURITY DEFINER avec contrôle `current_tenant_id`.
    - Aucune table modifiée, aucune donnée détruite.

  3. Compatibilité
    - Les ventes et règlements existants restent intacts.
    - `create_pos_sale` inchangé (continue d'exclure credit du paid).
*/

-- 1) Garde-fou sur register_sale_payment : rejet des modes de type credit
CREATE OR REPLACE FUNCTION register_sale_payment(
  p_sale_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT '',
  p_cash_session_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale record;
  v_new_paid numeric;
  v_new_status text;
  v_pm_type text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

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

  RETURN jsonb_build_object('paid', v_new_paid, 'status', v_new_status);
END;
$$;

-- 2) create_credit_sale : vente à crédit pure (aucun sale_payments)
CREATE OR REPLACE FUNCTION create_credit_sale(
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_discount numeric DEFAULT 0,
  p_note text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_sale_id uuid;
  v_sale_number text;
  v_subtotal numeric := 0;
  v_total numeric := 0;
  v_item jsonb;
  v_line_total numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire pour une vente à crédit'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Panier vide'; END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line_total := (COALESCE((v_item->>'quantity')::numeric, 0)
                     * COALESCE((v_item->>'unit_price')::numeric, 0))
                    - COALESCE((v_item->>'discount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
  END LOOP;
  v_total := GREATEST(0, v_subtotal - COALESCE(p_discount, 0));

  v_sale_number := next_document_number(v_tenant_id, 'sale');

  INSERT INTO sales (
    tenant_id, site_id, cash_session_id, customer_id, sale_number,
    subtotal, discount, total, paid, status, source, note
  ) VALUES (
    v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_sale_number,
    v_subtotal, COALESCE(p_discount, 0), v_total, 0, 'validated', 'pos', COALESCE(p_note, '')
  ) RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line_total := (COALESCE((v_item->>'quantity')::numeric, 0)
                     * COALESCE((v_item->>'unit_price')::numeric, 0))
                    - COALESCE((v_item->>'discount')::numeric, 0);

    INSERT INTO sale_items (
      tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost
    ) VALUES (
      v_tenant_id, v_sale_id,
      NULLIF(v_item->>'article_id','')::uuid,
      COALESCE(v_item->>'name',''),
      COALESCE((v_item->>'quantity')::numeric, 0),
      COALESCE((v_item->>'unit_price')::numeric, 0),
      COALESCE((v_item->>'discount')::numeric, 0),
      v_line_total,
      COALESCE((v_item->>'purchase_cost')::numeric, 0)
    );

    IF NULLIF(v_item->>'article_id','') IS NOT NULL THEN
      UPDATE articles
        SET stock_qty = GREATEST(0, stock_qty - COALESCE((v_item->>'quantity')::numeric, 0))
        WHERE id = (v_item->>'article_id')::uuid AND tenant_id = v_tenant_id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total);
END;
$$;

-- 3) register_customer_payment : encaissement libre d'un client
-- Imputation FIFO sur ses factures impayées (plus ancienne d'abord)
CREATE OR REPLACE FUNCTION register_customer_payment(
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
AS $$
DECLARE
  v_tenant_id uuid;
  v_pm_type text;
  v_remaining numeric;
  v_sale record;
  v_due numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_applied_sales jsonb := '[]'::jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

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

  RETURN jsonb_build_object(
    'applied', v_applied,
    'unapplied', v_remaining,
    'sales', v_applied_sales
  );
END;
$$;