/*
# Corrige create_pos_sale : respecter articles.track_stock

## Contexte
La fonction `create_pos_sale` (parcours ventes comptant sans lots) déduisait le
stock et créait un mouvement de stock pour CHAQUE ligne, même lorsque
`articles.track_stock = false`. Les autres parcours (`create_pos_sale_lot`,
`create_credit_sale`) lisent déjà `track_stock` côté serveur et sautent
proprement ces opérations. Résultat : les ventes de pur "service" (article non
suivi en stock) échouaient au déclencheur de stock négatif.

## Modifications
1. Fonctions
   - `create_pos_sale(...)` : signature INCHANGÉE, comportement métier inchangé
     pour les articles suivis (déduction stock + mouvement + interdiction stock
     négatif conservés). Ajout d'une lecture serveur de `articles.track_stock`;
     si `false`, la ligne est vendue normalement mais AUCUNE ligne
     `stock_levels` n'est créée/mise à jour et AUCUN `stock_movements` n'est
     inséré pour cet article.

## Sécurité
- Aucun changement RLS. `SECURITY DEFINER` conservé, `search_path` conservé.
- Le drapeau est lu en base ; le client ne peut pas contourner le suivi de
  stock via la requête RPC.

## Notes importantes
1. Aucune migration destructive. Aucune suppression, aucun renommage.
2. Le déclencheur d'interdiction du stock négatif reste actif tel quel pour les
   articles suivis.
*/

CREATE OR REPLACE FUNCTION public.create_pos_sale(
  p_items jsonb,
  p_payments jsonb,
  p_site_id uuid,
  p_cash_session_id uuid,
  p_customer_id uuid DEFAULT NULL::uuid,
  p_discount numeric DEFAULT 0,
  p_note text DEFAULT ''::text
)
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
  v_track_stock boolean;
  v_article_id uuid;
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
    v_article_id := (v_item->>'article_id')::uuid;

    -- Coût et drapeau de suivi lus côté serveur (jamais le navigateur)
    SELECT COALESCE(purchase_price, 0), COALESCE(track_stock, true)
      INTO v_purchase_cost, v_track_stock
      FROM articles WHERE id = v_article_id;
    v_purchase_cost := COALESCE(v_purchase_cost, 0);
    v_track_stock := COALESCE(v_track_stock, true);

    INSERT INTO sale_items (tenant_id, sale_id, article_id, name, quantity, unit_price, discount, total, purchase_cost, site_id)
    VALUES (v_tenant_id, v_sale_id, v_article_id, v_item->>'name',
      (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'discount')::numeric, 0), v_line_total, v_purchase_cost, p_site_id);

    IF v_track_stock THEN
      SELECT quantity INTO v_previous FROM stock_levels WHERE article_id = v_article_id AND site_id = p_site_id;
      IF v_previous IS NULL THEN
        v_previous := 0;
        INSERT INTO stock_levels (tenant_id, article_id, site_id, quantity) VALUES (v_tenant_id, v_article_id, p_site_id, 0);
      END IF;
      v_new := v_previous - (v_item->>'quantity')::numeric;
      UPDATE stock_levels SET quantity = v_new, updated_at = now() WHERE article_id = v_article_id AND site_id = p_site_id;

      INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
      VALUES (v_tenant_id, v_article_id, p_site_id, 'sale', -(v_item->>'quantity')::numeric, v_previous, v_new, 'sale', v_sale_id, v_user_id, 'Vente ' || v_sale_number);
    END IF;
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
