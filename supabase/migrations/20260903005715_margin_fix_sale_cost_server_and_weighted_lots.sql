/*
# Coût des ventes déterminé par le serveur + coût pondéré des lots

## Objet
Fiabiliser le coût enregistré (`sale_items.purchase_cost`) au moment de la vente :
- Pour un article, le coût est déterminé côté serveur depuis la base
  (`articles.purchase_price`), jamais depuis une valeur arbitraire du frontend.
- Pour une vente gérée par lots, le coût enregistré est le **coût pondéré des
  lots réellement consommés** : somme(quantité prélevée × prix du lot) / quantité totale.
- Aucune vente n'est bloquée : un coût supérieur au prix de vente reste accepté
  et produit une marge négative réelle. Le prix de vente n'est jamais utilisé
  pour dériver un coût.

## Fonctions remplacées
1. `create_pos_sale` — coût = prix d'achat fiche (serveur).
2. `create_credit_sale` — coût = prix d'achat fiche ; si méthode lot, coût pondéré FIFO.
3. `create_pos_sale_lot` — coût pondéré des lots consommés (assignations explicites ou FIFO).

## Sécurité
- Fonctions SECURITY DEFINER, `search_path` figé à `public`.
- Aucune donnée existante modifiée. Aucun backfill.
*/

-- 1. POS normal ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_items jsonb, p_payments jsonb, p_site_id uuid, p_cash_session_id uuid,
  p_customer_id uuid DEFAULT NULL::uuid, p_discount numeric DEFAULT 0, p_note text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid; v_user_id uuid; v_sale_id uuid; v_sale_number text;
v_item jsonb; v_payment jsonb;
v_subtotal numeric := 0; v_total numeric := 0; v_paid numeric := 0;
v_previous numeric; v_new numeric; v_line_total numeric; v_status text;
v_pm_type text; v_pm_id uuid; v_amount numeric; v_session uuid;
v_cash_in_session numeric := 0; v_purchase_cost numeric;
BEGIN
v_user_id := auth.uid();
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

v_sale_number := public.next_doc_number(v_tenant_id, 'sale', 'V');

FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);
v_subtotal := v_subtotal + v_line_total;
END LOOP;
v_total := v_subtotal - COALESCE(p_discount, 0);

FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
v_pm_id := NULLIF(v_payment->>'payment_method_id','')::uuid;
v_amount := (v_payment->>'amount')::numeric;
v_pm_type := NULL;
IF v_pm_id IS NOT NULL THEN SELECT payment_type INTO v_pm_type FROM payment_methods WHERE id = v_pm_id; END IF;
IF COALESCE(v_pm_type,'') <> 'credit' THEN v_paid := v_paid + v_amount; END IF;
END LOOP;

v_status := CASE WHEN v_paid >= v_total AND v_total > 0 THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'validated' END;

INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, user_id, sale_number, subtotal, discount, total, paid, status, note)
VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_user_id, v_sale_number, v_subtotal, COALESCE(p_discount,0), v_total, v_paid, v_status, COALESCE(p_note, ''))
RETURNING id INTO v_sale_id;

FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);

-- Coût déterminé par le serveur (prix d'achat fiche), jamais la valeur frontend.
SELECT COALESCE(purchase_price, 0) INTO v_purchase_cost FROM articles WHERE id = (v_item->>'article_id')::uuid;
v_purchase_cost := COALESCE(v_purchase_cost, 0);

INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost)
VALUES (v_tenant_id, v_sale_id, (v_item->>'article_id')::uuid, v_item->>'name',
(v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
COALESCE((v_item->>'discount')::numeric, 0), v_line_total, v_purchase_cost);

SELECT quantity INTO v_previous FROM stock_levels WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;
IF v_previous IS NULL THEN
v_previous := 0;
INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 0);
END IF;
v_new := v_previous - (v_item->>'quantity')::numeric;
UPDATE stock_levels SET quantity = v_new, updated_at = now() WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;

INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 'sale', -(v_item->>'quantity')::numeric, v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente ' || v_sale_number);
END LOOP;

FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
v_pm_id := NULLIF(v_payment->>'payment_method_id','')::uuid;
v_pm_type := NULL;
IF v_pm_id IS NOT NULL THEN SELECT payment_type INTO v_pm_type FROM payment_methods WHERE id = v_pm_id; END IF;
v_session := CASE WHEN COALESCE(v_pm_type,'') = 'credit' THEN NULL ELSE p_cash_session_id END;
v_amount := (v_payment->>'amount')::numeric;
INSERT INTO sale_payments (tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference)
VALUES (v_tenant_id, v_sale_id, v_session, v_pm_id, v_payment->>'method_name', v_amount, COALESCE(v_payment->>'reference', ''));
IF v_session IS NOT NULL THEN v_cash_in_session := v_cash_in_session + v_amount; END IF;
END LOOP;

IF p_cash_session_id IS NOT NULL AND v_cash_in_session > 0 THEN
UPDATE cash_sessions SET theoretical_amount = COALESCE(theoretical_amount, 0) + v_cash_in_session WHERE id = p_cash_session_id;
END IF;

IF p_customer_id IS NOT NULL AND v_paid < v_total THEN
UPDATE customers SET balance = COALESCE(balance, 0) + (v_total - v_paid) WHERE id = p_customer_id;
END IF;

RETURN jsonb_build_object('sale_number', v_sale_number, 'sale_id', v_sale_id);
END;
$function$;

-- 2. Vente à crédit --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_credit_sale(
  p_customer_id uuid, p_items jsonb, p_discount numeric DEFAULT 0,
  p_site_id uuid DEFAULT NULL::uuid, p_cash_session_id uuid DEFAULT NULL::uuid, p_note text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid; v_sale_id uuid; v_sale_number text;
v_subtotal numeric := 0; v_total numeric := 0; v_item jsonb; v_line_total numeric;
v_article_id uuid; v_qty numeric; v_previous numeric; v_new numeric; v_user_id uuid;
v_stock_method text; v_lot RECORD; v_remaining numeric; v_deduct numeric;
v_track_stock boolean; v_unused_prepay numeric; v_balance_increase numeric; v_applied jsonb;
v_purchase_cost numeric; v_cost_qty numeric; v_cost_sum numeric;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire pour une vente à crédit'; END IF;
IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Panier vide'; END IF;

v_user_id := auth.uid();
SELECT COALESCE((settings->>'stock_method'), 'none') INTO v_stock_method FROM tenants WHERE id = v_tenant_id;

FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
v_line_total := (COALESCE((v_item->>'quantity')::numeric, 0) * COALESCE((v_item->>'unit_price')::numeric, 0)) - COALESCE((v_item->>'discount')::numeric, 0);
v_subtotal := v_subtotal + v_line_total;
END LOOP;
v_total := GREATEST(0, v_subtotal - COALESCE(p_discount, 0));

v_sale_number := public.next_doc_number(v_tenant_id, 'sale', 'V');

INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, sale_number, subtotal, discount, total, paid, status, source, note)
VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_sale_number, v_subtotal, COALESCE(p_discount, 0), v_total, 0, 'validated', 'pos', COALESCE(p_note, ''))
RETURNING id INTO v_sale_id;

FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
v_line_total := (COALESCE((v_item->>'quantity')::numeric, 0) * COALESCE((v_item->>'unit_price')::numeric, 0)) - COALESCE((v_item->>'discount')::numeric, 0);
v_article_id := NULLIF(v_item->>'article_id','')::uuid;
v_qty := COALESCE((v_item->>'quantity')::numeric, 0);
v_cost_qty := 0; v_cost_sum := 0;

IF v_article_id IS NOT NULL THEN
SELECT COALESCE(track_stock, true) INTO v_track_stock FROM articles WHERE id = v_article_id;

IF COALESCE(v_track_stock, true) THEN
SELECT quantity INTO v_previous FROM stock_levels WHERE article_id = v_article_id AND site_id = p_site_id;
IF v_previous IS NULL THEN
v_previous := 0;
INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_article_id, p_site_id, 0);
END IF;
v_new := v_previous - v_qty;

IF v_stock_method = 'lot' THEN
v_remaining := v_qty;
FOR v_lot IN
SELECT id, remaining_quantity, purchase_price FROM stock_lots
WHERE article_id = v_article_id AND site_id = p_site_id AND tenant_id = v_tenant_id AND remaining_quantity > 0
ORDER BY expiry_date ASC NULLS LAST, received_at ASC
LOOP
EXIT WHEN v_remaining <= 0;
v_deduct := LEAST(v_lot.remaining_quantity, v_remaining);
UPDATE stock_lots SET remaining_quantity = remaining_quantity - v_deduct WHERE id = v_lot.id;
v_cost_qty := v_cost_qty + v_deduct;
v_cost_sum := v_cost_sum + v_deduct * COALESCE(v_lot.purchase_price, 0);
v_remaining := v_remaining - v_deduct;
END LOOP;
END IF;

UPDATE stock_levels SET quantity = v_new, updated_at = now() WHERE article_id = v_article_id AND site_id = p_site_id;
INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
VALUES (v_tenant_id, v_article_id, p_site_id, 'sale', -v_qty, v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente à crédit ' || v_sale_number);
END IF;
END IF;

-- Coût pondéré des lots consommés, sinon prix d'achat fiche (serveur).
IF v_cost_qty > 0 THEN
v_purchase_cost := v_cost_sum / v_cost_qty;
ELSE
SELECT COALESCE(purchase_price, 0) INTO v_purchase_cost FROM articles WHERE id = v_article_id;
v_purchase_cost := COALESCE(v_purchase_cost, 0);
END IF;

INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost)
VALUES (v_tenant_id, v_sale_id, v_article_id, COALESCE(v_item->>'name',''), v_qty,
COALESCE((v_item->>'unit_price')::numeric, 0), COALESCE((v_item->>'discount')::numeric, 0), v_line_total, v_purchase_cost);
END LOOP;

SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_unused_prepay
FROM customer_prepayments WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id AND amount_used < amount;

IF v_unused_prepay >= v_total THEN
v_balance_increase := 0;
ELSE
v_balance_increase := v_total - v_unused_prepay;
UPDATE customers SET balance = COALESCE(balance, 0) + v_balance_increase WHERE id = p_customer_id AND tenant_id = v_tenant_id;
END IF;

v_applied := apply_customer_prepayments(p_customer_id);

RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number, 'total', v_total,
'prepay_applied', COALESCE((v_applied->>'applied')::numeric, 0), 'balance_increased', v_balance_increase);
END;
$function$;

-- 3. POS par lots : coût pondéré des lots consommés ------------------------
CREATE OR REPLACE FUNCTION public.create_pos_sale_lot(
  p_site_id uuid, p_cash_session_id uuid, p_customer_id uuid DEFAULT NULL::uuid,
  p_items jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT '[]'::jsonb,
  p_discount numeric DEFAULT 0, p_note text DEFAULT ''::text, p_lot_assignments jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid; v_sale_id uuid; v_sale_number text; v_item jsonb; v_pay jsonb;
v_subtotal numeric := 0; v_total numeric := 0; v_paid numeric := 0; v_previous numeric; v_new numeric;
v_user_id uuid := auth.uid(); v_stock_method text; v_lot RECORD; v_remaining numeric; v_deduct numeric;
v_article_lots jsonb; v_lot_assign jsonb; v_line_total numeric; v_cash_in_session numeric := 0;
v_pm_type text; v_pm_id uuid; v_amount numeric; v_session uuid; v_status text; v_track_stock boolean;
v_purchase_cost numeric; v_cost_qty numeric; v_cost_sum numeric; v_lot_price numeric; v_article_id uuid;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

SELECT COALESCE((settings->>'stock_method'), 'none') INTO v_stock_method FROM tenants WHERE id = v_tenant_id;
v_sale_number := next_doc_number(v_tenant_id, 'sale', 'V');

FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);
v_subtotal := v_subtotal + v_line_total;
END LOOP;
v_total := v_subtotal - COALESCE(p_discount, 0);

FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
v_pm_id := NULLIF(v_pay->>'payment_method_id','')::uuid;
v_amount := (v_pay->>'amount')::numeric;
v_pm_type := NULL;
IF v_pm_id IS NOT NULL THEN SELECT payment_type INTO v_pm_type FROM payment_methods WHERE id = v_pm_id; END IF;
IF COALESCE(v_pm_type,'') <> 'credit' THEN v_paid := v_paid + v_amount; END IF;
END LOOP;

v_status := CASE WHEN v_paid >= v_total AND v_total > 0 THEN 'paid' WHEN v_paid > 0 THEN 'partial' ELSE 'validated' END;

INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, user_id, sale_number, subtotal, discount, total, paid, status, note)
VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_user_id, v_sale_number, v_subtotal, COALESCE(p_discount,0), v_total, v_paid, v_status, COALESCE(p_note,''))
RETURNING id INTO v_sale_id;

FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
v_article_id := (v_item->>'article_id')::uuid;
v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);
v_cost_qty := 0; v_cost_sum := 0;

SELECT COALESCE(track_stock, true) INTO v_track_stock FROM articles WHERE id = v_article_id;

IF COALESCE(v_track_stock, true) THEN
SELECT quantity INTO v_previous FROM stock_levels WHERE article_id = v_article_id AND site_id = p_site_id;
IF v_previous IS NULL THEN
v_previous := 0;
INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_article_id, p_site_id, 0);
END IF;
v_new := v_previous - (v_item->>'quantity')::numeric;

IF v_stock_method = 'lot' THEN
v_article_lots := NULL;
IF p_lot_assignments IS NOT NULL THEN v_article_lots := p_lot_assignments->(v_item->>'article_id'); END IF;

IF v_article_lots IS NOT NULL AND jsonb_array_length(v_article_lots) > 0 THEN
FOR v_lot_assign IN SELECT * FROM jsonb_array_elements(v_article_lots) LOOP
v_deduct := (v_lot_assign->>'quantity')::numeric;
IF v_deduct > 0 THEN
SELECT purchase_price INTO v_lot_price FROM stock_lots WHERE id = (v_lot_assign->>'lot_id')::uuid AND tenant_id = v_tenant_id;
UPDATE stock_lots SET remaining_quantity = remaining_quantity - v_deduct WHERE id = (v_lot_assign->>'lot_id')::uuid AND tenant_id = v_tenant_id;
v_cost_qty := v_cost_qty + v_deduct;
v_cost_sum := v_cost_sum + v_deduct * COALESCE(v_lot_price, 0);
END IF;
END LOOP;
ELSE
v_remaining := (v_item->>'quantity')::numeric;
FOR v_lot IN
SELECT id, remaining_quantity, purchase_price FROM stock_lots
WHERE article_id = v_article_id AND site_id = p_site_id AND tenant_id = v_tenant_id AND remaining_quantity > 0
ORDER BY expiry_date ASC NULLS LAST, received_at ASC
LOOP
EXIT WHEN v_remaining <= 0;
v_deduct := LEAST(v_lot.remaining_quantity, v_remaining);
UPDATE stock_lots SET remaining_quantity = remaining_quantity - v_deduct WHERE id = v_lot.id;
v_cost_qty := v_cost_qty + v_deduct;
v_cost_sum := v_cost_sum + v_deduct * COALESCE(v_lot.purchase_price, 0);
v_remaining := v_remaining - v_deduct;
END LOOP;
END IF;
END IF;

UPDATE stock_levels SET quantity = v_new, updated_at = now() WHERE article_id = v_article_id AND site_id = p_site_id;
INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
VALUES (v_tenant_id, v_article_id, p_site_id, 'sale', -(v_item->>'quantity')::numeric, v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente ' || v_sale_number);
END IF;

-- Coût pondéré des lots réellement consommés, sinon prix d'achat fiche (serveur).
IF v_cost_qty > 0 THEN
v_purchase_cost := v_cost_sum / v_cost_qty;
ELSE
SELECT COALESCE(purchase_price, 0) INTO v_purchase_cost FROM articles WHERE id = v_article_id;
v_purchase_cost := COALESCE(v_purchase_cost, 0);
END IF;

INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost)
VALUES (v_tenant_id, v_sale_id, v_article_id, v_item->>'name',
(v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
COALESCE((v_item->>'discount')::numeric, 0), v_line_total, v_purchase_cost);
END LOOP;

FOR v_pay IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
v_pm_id := NULLIF(v_pay->>'payment_method_id','')::uuid;
v_pm_type := NULL;
IF v_pm_id IS NOT NULL THEN SELECT payment_type INTO v_pm_type FROM payment_methods WHERE id = v_pm_id; END IF;
v_session := CASE WHEN COALESCE(v_pm_type,'') = 'credit' THEN NULL ELSE p_cash_session_id END;
v_amount := (v_pay->>'amount')::numeric;
INSERT INTO sale_payments (tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference)
VALUES (v_tenant_id, v_sale_id, v_session, v_pm_id, v_pay->>'method_name', v_amount, COALESCE(v_pay->>'reference', ''));
IF v_session IS NOT NULL THEN v_cash_in_session := v_cash_in_session + v_amount; END IF;
END LOOP;

IF p_cash_session_id IS NOT NULL AND v_cash_in_session > 0 THEN
UPDATE cash_sessions SET theoretical_amount = COALESCE(theoretical_amount, 0) + v_cash_in_session WHERE id = p_cash_session_id;
END IF;

IF p_customer_id IS NOT NULL AND v_paid < v_total THEN
UPDATE customers SET balance = COALESCE(balance, 0) + (v_total - v_paid) WHERE id = p_customer_id;
END IF;

RETURN jsonb_build_object('sale_number', v_sale_number, 'sale_id', v_sale_id);
END;
$function$;
