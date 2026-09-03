/*
# Préservation du coût historique lors d'une modification de facture

## Objet
`update_sale_items_and_totals` supprimait toutes les lignes et réinsérait le
coût au **prix d'achat actuel** de la fiche, détruisant le coût historique.

Nouveau comportement :
- Avant suppression, on mémorise le coût historique par article de la vente.
- Une ligne dont l'article existait conserve son `purchase_cost` historique.
- Une ligne dont l'article est nouveau (ou changé) reçoit une valorisation
  serveur (`articles.purchase_price`).
- Aucun coût existant n'est remis silencieusement à zéro.
- Aucun recalcul rétroactif des anciennes factures.

## Sécurité
SECURITY DEFINER, `search_path` figé. Aucune donnée d'autres ventes modifiée.
*/

CREATE OR REPLACE FUNCTION public.update_sale_items_and_totals(
  p_sale_id uuid, p_tenant_id uuid, p_items jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_doc_header jsonb DEFAULT NULL::jsonb)
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
v_old_costs jsonb;
v_hist jsonb;
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

-- Mémoriser le coût historique par article AVANT toute suppression.
SELECT COALESCE(jsonb_object_agg(article_id::text, purchase_cost), '{}'::jsonb)
INTO v_old_costs
FROM (
  SELECT DISTINCT ON (article_id) article_id, purchase_cost
  FROM sale_items
  WHERE sale_id = p_sale_id AND article_id IS NOT NULL
  ORDER BY article_id, created_at ASC
) q;

-- Restaurer le stock des anciennes lignes
FOR v_item IN SELECT si.article_id, si.quantity FROM sale_items si WHERE si.sale_id = p_sale_id
LOOP
UPDATE stock_levels SET quantity = quantity + v_item.quantity
WHERE article_id = v_item.article_id AND tenant_id = p_tenant_id;
END LOOP;

DELETE FROM sale_items WHERE sale_id = p_sale_id;

FOR v_item IN SELECT * FROM jsonb_to_recordset(p_items) AS (
article_id uuid, name text, quantity numeric, unit_price numeric, discount numeric, vat_rate numeric, imei text
)
LOOP
-- Coût : historique si l'article existait, sinon valorisation serveur (fiche).
v_hist := v_old_costs -> v_item.article_id::text;
IF v_hist IS NOT NULL THEN
v_purchase_cost := v_hist::numeric;
ELSE
v_purchase_cost := COALESCE((SELECT purchase_price FROM articles WHERE id = v_item.article_id), 0);
END IF;

INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, vat_rate, total, imei, purchase_cost)
VALUES (
p_tenant_id, p_sale_id, v_item.article_id, v_item.name,
v_item.quantity, v_item.unit_price, COALESCE(v_item.discount, 0),
COALESCE(v_item.vat_rate, 0),
(v_item.quantity * v_item.unit_price) - COALESCE(v_item.discount, 0),
v_item.imei, v_purchase_cost
);
v_new_total := v_new_total + (v_item.quantity * v_item.unit_price) - COALESCE(v_item.discount, 0);

UPDATE stock_levels SET quantity = quantity - v_item.quantity
WHERE article_id = v_item.article_id AND tenant_id = p_tenant_id;
END LOOP;

UPDATE sales SET
total = v_new_total,
subtotal = v_new_total,
customer_id = COALESCE(p_customer_id, customer_id),
doc_header = COALESCE(p_doc_header, doc_header),
status = CASE WHEN paid >= v_new_total THEN 'paid' WHEN paid > 0 THEN 'partial' ELSE status END
WHERE id = p_sale_id;

IF v_old_customer_id IS NOT NULL THEN
v_new_balance := COALESCE((
SELECT SUM(total - paid) FROM sales WHERE customer_id = v_old_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
), 0) + COALESCE((
SELECT SUM(amount) FROM balance_adjustments WHERE entity_id = v_old_customer_id AND entity_type = 'customer' AND tenant_id = p_tenant_id
), 0);
UPDATE customers SET balance = v_new_balance WHERE id = v_old_customer_id;
END IF;

IF p_customer_id IS NOT NULL AND p_customer_id != v_old_customer_id THEN
v_new_balance := COALESCE((
SELECT SUM(total - paid) FROM sales WHERE customer_id = p_customer_id AND tenant_id = p_tenant_id AND status != 'cancelled'
), 0) + COALESCE((
SELECT SUM(amount) FROM balance_adjustments WHERE entity_id = p_customer_id AND entity_type = 'customer' AND tenant_id = p_tenant_id
), 0);
UPDATE customers SET balance = v_new_balance WHERE id = p_customer_id;
END IF;

RETURN jsonb_build_object('success', true, 'new_total', v_new_total);
END;
$function$;
