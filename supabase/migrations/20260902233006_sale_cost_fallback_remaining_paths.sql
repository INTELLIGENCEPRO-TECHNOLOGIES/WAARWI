/*
# Fiabilisation du coût d'achat sur les autres chemins de vente

## Contexte (langage clair)
Le coût d'achat d'un article vendu sert à calculer la marge. Trois façons de créer
ou modifier une vente enregistraient encore un coût à zéro, ce qui gonflait la marge :

1. `create_pos_sale` (ancien point de vente sans gestion de lots) : ne retombait pas
   sur le prix d'achat de la fiche article quand le point de vente n'envoyait rien.
2. `convert_quote_to_sale` (transformation d'un devis en facture) : ne reprenait aucun
   coût, donc chaque facture issue d'un devis avait une marge fausse.
3. `update_sale_items_and_totals` (modification d'une facture existante) : réécrivait
   les lignes sans coût, effaçant le coût au passage.

## Correction
Dans les trois cas, si aucun coût fiable n'est disponible, on retombe désormais sur le
prix d'achat renseigné dans la fiche article. Aucune autre logique n'est modifiée.

## Sécurité
- Fonctions SECURITY DEFINER conservées à l'identique (mêmes signatures, mêmes droits).
- Aucune donnée existante modifiée ; correction appliquée aux nouvelles écritures.
*/

-- 1) create_pos_sale : fallback prix d'achat article ─────────────────────────────
CREATE OR REPLACE FUNCTION public.create_pos_sale(p_items jsonb, p_payments jsonb, p_site_id uuid, p_cash_session_id uuid, p_customer_id uuid DEFAULT NULL::uuid, p_discount numeric DEFAULT 0, p_note text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_tenant_id uuid;
v_user_id uuid;
v_sale_id uuid;
v_sale_number text;
v_item jsonb;
v_payment jsonb;
v_subtotal numeric := 0;
v_total numeric := 0;
v_paid numeric := 0;
v_previous numeric;
v_new numeric;
v_line_total numeric;
v_status text;
v_pm_type text;
v_pm_id uuid;
v_amount numeric;
v_session uuid;
v_cash_in_session numeric := 0;
v_purchase_cost numeric;
BEGIN
v_user_id := auth.uid();
v_tenant_id := current_tenant_id();

IF v_tenant_id IS NULL THEN
RAISE EXCEPTION 'Tenant introuvable';
END IF;

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
IF v_pm_id IS NOT NULL THEN
SELECT payment_type INTO v_pm_type FROM payment_methods WHERE id = v_pm_id;
END IF;
IF COALESCE(v_pm_type,'') <> 'credit' THEN
v_paid := v_paid + v_amount;
END IF;
END LOOP;

v_status := CASE
WHEN v_paid >= v_total AND v_total > 0 THEN 'paid'
WHEN v_paid > 0 THEN 'partial'
ELSE 'validated'
END;

INSERT INTO sales (tenant_id, site_id, cash_session_id, customer_id, user_id, sale_number, subtotal, discount, total, paid, status, note)
VALUES (v_tenant_id, p_site_id, p_cash_session_id, p_customer_id, v_user_id, v_sale_number, v_subtotal, COALESCE(p_discount,0), v_total, v_paid,
v_status, COALESCE(p_note, ''))
RETURNING id INTO v_sale_id;

FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
v_line_total := (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount')::numeric, 0);

v_purchase_cost := COALESCE((v_item->>'purchase_cost')::numeric, 0);
IF v_purchase_cost <= 0 THEN
SELECT COALESCE(purchase_price, 0) INTO v_purchase_cost
FROM articles WHERE id = (v_item->>'article_id')::uuid;
v_purchase_cost := COALESCE(v_purchase_cost, 0);
END IF;

INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost)
VALUES (v_tenant_id, v_sale_id, (v_item->>'article_id')::uuid, v_item->>'name',
(v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
COALESCE((v_item->>'discount')::numeric, 0), v_line_total,
v_purchase_cost);

SELECT quantity INTO v_previous FROM stock_levels
WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;

IF v_previous IS NULL THEN
v_previous := 0;
INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity)
VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 0);
END IF;

v_new := v_previous - (v_item->>'quantity')::numeric;

UPDATE stock_levels SET quantity = v_new, updated_at = now()
WHERE article_id = (v_item->>'article_id')::uuid AND site_id = p_site_id;

INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
VALUES (v_tenant_id, (v_item->>'article_id')::uuid, p_site_id, 'sale',
-(v_item->>'quantity')::numeric, v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente ' || v_sale_number);
END LOOP;

FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
v_pm_id := NULLIF(v_payment->>'payment_method_id','')::uuid;
v_pm_type := NULL;
IF v_pm_id IS NOT NULL THEN
SELECT payment_type INTO v_pm_type FROM payment_methods WHERE id = v_pm_id;
END IF;
v_session := CASE WHEN COALESCE(v_pm_type,'') = 'credit' THEN NULL ELSE p_cash_session_id END;
v_amount := (v_payment->>'amount')::numeric;

INSERT INTO sale_payments (tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference)
VALUES (v_tenant_id, v_sale_id, v_session, v_pm_id,
v_payment->>'method_name',
v_amount,
COALESCE(v_payment->>'reference', ''));

IF v_session IS NOT NULL THEN
v_cash_in_session := v_cash_in_session + v_amount;
END IF;
END LOOP;

IF p_cash_session_id IS NOT NULL AND v_cash_in_session > 0 THEN
UPDATE cash_sessions
SET theoretical_amount = COALESCE(theoretical_amount, 0) + v_cash_in_session
WHERE id = p_cash_session_id;
END IF;

IF p_customer_id IS NOT NULL AND v_paid < v_total THEN
UPDATE customers
SET balance = COALESCE(balance, 0) + (v_total - v_paid)
WHERE id = p_customer_id;
END IF;

RETURN jsonb_build_object('sale_number', v_sale_number, 'sale_id', v_sale_id);
END;
$function$;

-- 2) convert_quote_to_sale : reprendre le prix d'achat de la fiche article ────────
CREATE OR REPLACE FUNCTION public.convert_quote_to_sale(p_quote_id uuid, p_site_id uuid, p_cash_session_id uuid DEFAULT NULL::uuid, p_payments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
v_tenant_id uuid;
v_user_id uuid;
v_quote record;
v_sale_id uuid;
v_sale_number text;
v_subtotal numeric := 0;
v_total numeric := 0;
v_paid numeric := 0;
v_payment jsonb;
v_item record;
BEGIN
v_tenant_id := current_tenant_id();
v_user_id := auth.uid();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

SELECT * INTO v_quote FROM quotes
WHERE id = p_quote_id AND tenant_id = v_tenant_id;

IF v_quote.id IS NULL THEN RAISE EXCEPTION 'Devis introuvable'; END IF;
IF v_quote.converted_sale_id IS NOT NULL THEN
RAISE EXCEPTION 'Devis déjà converti';
END IF;

v_subtotal := COALESCE(v_quote.subtotal, 0);
v_total := COALESCE(v_quote.total, 0);

FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
v_paid := v_paid + COALESCE((v_payment->>'amount')::numeric, 0);
END LOOP;

v_sale_number := public.next_doc_number(v_tenant_id, 'invoice', 'F');

INSERT INTO sales (
tenant_id, site_id, cash_session_id, customer_id, user_id,
sale_number, subtotal, discount, total, paid, status, source, note
) VALUES (
v_tenant_id, p_site_id, p_cash_session_id, v_quote.customer_id, v_user_id,
v_sale_number, v_subtotal, COALESCE(v_quote.discount, 0), v_total, v_paid,
CASE WHEN v_paid >= v_total THEN 'paid' ELSE 'partial' END,
'quote', COALESCE(v_quote.note, '')
) RETURNING id INTO v_sale_id;

FOR v_item IN SELECT * FROM quote_items WHERE quote_id = p_quote_id LOOP
INSERT INTO sale_items (
tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost
) VALUES (
v_tenant_id, v_sale_id, v_item.article_id, v_item.name,
v_item.quantity, v_item.unit_price, v_item.discount, v_item.total,
COALESCE((SELECT purchase_price FROM articles WHERE id = v_item.article_id), 0)
);
END LOOP;

FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments) LOOP
INSERT INTO sale_payments (
tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference
) VALUES (
v_tenant_id, v_sale_id, p_cash_session_id,
NULLIF(v_payment->>'payment_method_id','')::uuid,
v_payment->>'method_name',
(v_payment->>'amount')::numeric,
COALESCE(v_payment->>'reference', '')
);

IF p_cash_session_id IS NOT NULL THEN
UPDATE cash_sessions
SET theoretical_amount = COALESCE(theoretical_amount, 0) + (v_payment->>'amount')::numeric
WHERE id = p_cash_session_id;
END IF;
END LOOP;

UPDATE quotes SET status = 'converted', converted_sale_id = v_sale_id
WHERE id = p_quote_id;

RETURN jsonb_build_object('sale_id', v_sale_id, 'sale_number', v_sale_number);
END;
$function$;

-- 3) update_sale_items_and_totals : conserver un coût via la fiche article ────────
CREATE OR REPLACE FUNCTION public.update_sale_items_and_totals(p_sale_id uuid, p_tenant_id uuid, p_items jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_doc_header jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_sale record;
v_new_total numeric := 0;
v_item record;
v_old_customer_id uuid;
v_new_balance numeric;
v_purchase_cost numeric;
BEGIN
  PERFORM public.assert_tenant_access(p_tenant_id);
SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = p_tenant_id;
IF v_sale IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
END IF;

IF v_sale.accounting_status = 'accounted' THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente comptabilisée, modification impossible');
END IF;

v_old_customer_id := v_sale.customer_id;

-- Restore stock from old items
FOR v_item IN
SELECT si.article_id, si.quantity
FROM sale_items si WHERE si.sale_id = p_sale_id
LOOP
UPDATE stock_levels SET quantity = quantity + v_item.quantity
WHERE article_id = v_item.article_id AND tenant_id = p_tenant_id;
END LOOP;

-- Delete old items
DELETE FROM sale_items WHERE sale_id = p_sale_id;

-- Insert new items and deduct stock
FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (
article_id uuid, name text, quantity numeric, unit_price numeric, discount numeric, vat_rate numeric, imei text
)
LOOP
v_purchase_cost := COALESCE((SELECT purchase_price FROM articles WHERE id = v_item.article_id), 0);

INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, vat_rate, total, imei, purchase_cost)
VALUES (
p_tenant_id, p_sale_id, v_item.article_id, v_item.name,
v_item.quantity, v_item.unit_price, COALESCE(v_item.discount, 0),
COALESCE(v_item.vat_rate, 0),
(v_item.quantity * v_item.unit_price) - COALESCE(v_item.discount, 0),
v_item.imei,
v_purchase_cost
);
v_new_total := v_new_total + (v_item.quantity * v_item.unit_price) - COALESCE(v_item.discount, 0);

UPDATE stock_levels SET quantity = quantity - v_item.quantity
WHERE article_id = v_item.article_id AND tenant_id = p_tenant_id;
END LOOP;

-- Update sale totals
UPDATE sales SET
total = v_new_total,
subtotal = v_new_total,
customer_id = COALESCE(p_customer_id, customer_id),
doc_header = COALESCE(p_doc_header, doc_header),
status = CASE
WHEN paid >= v_new_total THEN 'paid'
WHEN paid > 0 THEN 'partial'
ELSE status
END
WHERE id = p_sale_id;

-- Recalculate balance for old and new customer (include balance adjustments)
IF v_old_customer_id IS NOT NULL THEN
v_new_balance := COALESCE((
SELECT SUM(total - paid) FROM sales
WHERE customer_id = v_old_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
), 0) + COALESCE((
SELECT SUM(amount) FROM balance_adjustments
WHERE entity_id = v_old_customer_id AND entity_type = 'customer' AND tenant_id = p_tenant_id
), 0);

UPDATE customers SET balance = v_new_balance WHERE id = v_old_customer_id;
END IF;

IF p_customer_id IS NOT NULL AND p_customer_id != v_old_customer_id THEN
v_new_balance := COALESCE((
SELECT SUM(total - paid) FROM sales
WHERE customer_id = p_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
), 0) + COALESCE((
SELECT SUM(amount) FROM balance_adjustments
WHERE entity_id = p_customer_id AND entity_type = 'customer' AND tenant_id = p_tenant_id
), 0);

UPDATE customers SET balance = v_new_balance WHERE id = p_customer_id;
END IF;

RETURN jsonb_build_object('success', true, 'new_total', v_new_total);
END;
$function$;