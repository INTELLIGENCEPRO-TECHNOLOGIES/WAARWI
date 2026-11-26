-- Branche de recette uniquement, ne pas rejouer en production.
CREATE OR REPLACE FUNCTION public._process_sale_return_without_vat(p_sale_id uuid, p_site_id uuid, p_cash_session_id uuid, p_items jsonb, p_reason text DEFAULT 'Retour au POS'::text, p_refund_now boolean DEFAULT true, p_restock boolean DEFAULT true, p_request_id text DEFAULT NULL::text, p_refund_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_sale record;
v_session record;
v_site record;
v_item jsonb;
v_si record;
v_already_returned numeric;
v_remaining numeric;
v_req_qty numeric;
v_return_total numeric := 0;
v_return_id uuid;
v_return_number text;
v_article_names text[] := '{}';
v_prev_stock numeric;
v_new_stock numeric;
v_track boolean;
v_existing_return_id uuid;
v_effective_method text;
v_line_net numeric;
v_unit_net numeric;
v_returned_net numeric;
v_global_share numeric;
v_return_value numeric;
BEGIN
PERFORM public._cs_assert_sale_usable(p_sale_id);
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN
RAISE EXCEPTION 'Non authentifié';
END IF;

IF p_refund_method = 'avoir' THEN
v_effective_method := 'avoir';
ELSIF p_refund_now THEN
v_effective_method := 'cash';
ELSE
v_effective_method := 'none';
END IF;

IF p_request_id IS NOT NULL THEN
SELECT id INTO v_existing_return_id
FROM public.sale_returns
WHERE tenant_id = v_tenant_id AND request_id = p_request_id;

IF v_existing_return_id IS NOT NULL THEN
RETURN (
SELECT jsonb_build_object(
'success', true, 'return_id', sr.id, 'return_number', sr.return_number,
'total', sr.total, 'refunded', sr.refunded_at IS NOT NULL, 'idempotent', true
)
FROM public.sale_returns sr WHERE sr.id = v_existing_return_id
);
END IF;
END IF;

SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id AND tenant_id = v_tenant_id;
IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Vente introuvable ou accès refusé'; END IF;
IF v_sale.status = 'cancelled' THEN RAISE EXCEPTION 'Impossible de retourner une vente annulée'; END IF;

SELECT * INTO v_site FROM public.sites WHERE id = p_site_id AND tenant_id = v_tenant_id;
IF v_site.id IS NULL THEN RAISE EXCEPTION 'Site introuvable ou accès refusé'; END IF;

SELECT * INTO v_session FROM public.cash_sessions
WHERE id = p_cash_session_id AND tenant_id = v_tenant_id AND site_id = p_site_id AND status = 'open';
IF v_session.id IS NULL THEN RAISE EXCEPTION 'Session de caisse invalide ou fermée'; END IF;

IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Aucun article à retourner'; END IF;

v_return_number := next_doc_number(v_tenant_id, 'return', 'RET');

INSERT INTO public.sale_returns (
id, tenant_id, site_id, sale_id, customer_id, user_id,
cash_session_id, return_number, total, refund_method, status, reason, restock, request_id
) VALUES (
gen_random_uuid(), v_tenant_id, p_site_id, p_sale_id, v_sale.customer_id, auth.uid(),
p_cash_session_id, v_return_number, 0, v_effective_method,
'approved', COALESCE(p_reason, 'Retour au POS'), p_restock, p_request_id
) RETURNING id INTO v_return_id;

FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
LOOP
SELECT * INTO v_si FROM public.sale_items
WHERE id = (v_item->>'sale_item_id')::uuid AND sale_id = p_sale_id AND tenant_id = v_tenant_id
FOR UPDATE;

IF v_si.id IS NULL THEN
RAISE EXCEPTION 'Article (sale_item_id %) ne fait pas partie de cette vente', v_item->>'sale_item_id';
END IF;

v_req_qty := (v_item->>'quantity')::numeric;
IF v_req_qty <= 0 THEN CONTINUE; END IF;

SELECT COALESCE(SUM(sri.quantity), 0) INTO v_already_returned
FROM public.sale_return_items sri
JOIN public.sale_returns sr ON sr.id = sri.return_id
WHERE sri.sale_item_id = v_si.id AND sr.status IN ('approved', 'pending');

v_remaining := v_si.quantity - v_already_returned;
IF v_req_qty > v_remaining THEN
RAISE EXCEPTION 'Quantité retournée (%) dépasse le disponible (%) pour article %',
v_req_qty, v_remaining, v_si.name;
END IF;

-- Valeur nette du retour : net de remise de ligne + quote-part de remise globale.
v_line_net := COALESCE(v_si.total, (v_si.quantity * v_si.unit_price) - COALESCE(v_si.discount, 0));
v_unit_net := CASE WHEN v_si.quantity > 0 THEN v_line_net / v_si.quantity ELSE 0 END;
v_returned_net := v_unit_net * v_req_qty;
v_global_share := CASE WHEN COALESCE(v_sale.subtotal, 0) > 0
THEN COALESCE(v_sale.discount, 0) * (v_returned_net / v_sale.subtotal) ELSE 0 END;
v_return_value := v_returned_net - v_global_share;

INSERT INTO public.sale_return_items (
id, tenant_id, return_id, article_id, sale_item_id,
name, quantity, unit_price, purchase_cost, total
) VALUES (
gen_random_uuid(), v_tenant_id, v_return_id, v_si.article_id, v_si.id,
v_si.name, v_req_qty, v_si.unit_price, COALESCE(v_si.purchase_cost, 0),
v_return_value
);

v_return_total := v_return_total + v_return_value;
v_article_names := v_article_names || (v_si.name || CASE WHEN v_req_qty > 1 THEN ' x' || v_req_qty ELSE '' END);

IF p_restock AND v_si.article_id IS NOT NULL THEN
SELECT COALESCE(a.track_stock, true) INTO v_track FROM public.articles a WHERE a.id = v_si.article_id;
IF v_track THEN
SELECT COALESCE(sl.quantity, 0) INTO v_prev_stock
FROM public.stock_levels sl WHERE sl.article_id = v_si.article_id AND sl.site_id = p_site_id;
IF v_prev_stock IS NULL THEN
v_prev_stock := 0;
INSERT INTO public.stock_levels (tenant_id, article_id, site_id, quantity)
VALUES (v_tenant_id, v_si.article_id, p_site_id, 0);
END IF;
v_new_stock := v_prev_stock + v_req_qty;
UPDATE public.stock_levels SET quantity = v_new_stock, updated_at = now()
WHERE article_id = v_si.article_id AND site_id = p_site_id;
INSERT INTO public.stock_movements (
tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, user_id, note
) VALUES (
v_tenant_id, v_si.article_id, p_site_id, 'return_customer', v_req_qty,
v_prev_stock, v_new_stock, auth.uid(), 'Retour ' || v_return_number
);
END IF;
END IF;
END LOOP;

UPDATE public.sale_returns SET total = v_return_total WHERE id = v_return_id;

IF v_effective_method = 'cash' AND v_return_total > 0 THEN
INSERT INTO public.cash_movements (
tenant_id, site_id, cash_session_id, user_id, kind, amount, reason, reference, sale_return_id
) VALUES (
v_tenant_id, p_site_id, p_cash_session_id, auth.uid(),
'refund', v_return_total,
'Retour ' || v_return_number || ': ' || array_to_string(v_article_names, ', '),
v_return_number, v_return_id
);
UPDATE public.cash_sessions
SET theoretical_amount = GREATEST(0, COALESCE(theoretical_amount, 0) - v_return_total)
WHERE id = p_cash_session_id;
UPDATE public.sale_returns
SET refunded_at = now(), refund_cash_session_id = p_cash_session_id, approved_by = auth.uid()
WHERE id = v_return_id;

ELSIF v_effective_method = 'avoir' AND v_return_total > 0 AND v_sale.customer_id IS NOT NULL THEN
UPDATE public.customers
SET balance = COALESCE(balance, 0) - v_return_total
WHERE id = v_sale.customer_id AND tenant_id = v_tenant_id;
PERFORM public._apply_avoirs_internal(v_sale.customer_id, v_tenant_id);
END IF;

RETURN jsonb_build_object(
'success', true, 'return_id', v_return_id, 'return_number', v_return_number,
'total', v_return_total, 'refunded', v_effective_method = 'cash',
'refund_method', v_effective_method, 'items_count', jsonb_array_length(p_items),
'article_names', array_to_string(v_article_names, ', '), 'idempotent', false
);
END;
$function$;
REVOKE ALL ON FUNCTION public._process_sale_return_without_vat(p_sale_id uuid, p_site_id uuid, p_cash_session_id uuid, p_items jsonb, p_reason text, p_refund_now boolean, p_restock boolean, p_request_id text, p_refund_method text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.process_sale_return(p_sale_id uuid, p_site_id uuid, p_cash_session_id uuid, p_items jsonb, p_reason text DEFAULT 'Retour au POS'::text, p_refund_now boolean DEFAULT true, p_restock boolean DEFAULT true, p_request_id text DEFAULT NULL::text, p_refund_method text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_return public.sale_returns;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.sales WHERE id = p_sale_id AND tenant_id = v_tenant_id AND vat_enabled_at_issue
  ) THEN
    RETURN public._process_sale_return_without_vat(p_sale_id, p_site_id, p_cash_session_id, p_items,
      p_reason, p_refund_now, p_restock, p_request_id, p_refund_method);
  END IF;

  PERFORM public._cr_require_caller();
  IF NOT public._cr_profile_has_permission(auth.uid(), 'pos_returns') THEN
    RAISE EXCEPTION 'Permission de retour en caisse requise.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cash_sessions
    WHERE id = p_cash_session_id AND tenant_id = v_tenant_id AND site_id = p_site_id AND status = 'open') THEN
    RAISE EXCEPTION 'Session de caisse invalide ou fermée.';
  END IF;
  IF public._cs_multi_enabled(v_tenant_id) THEN
    PERFORM public._cs_assert_operational(p_cash_session_id, v_tenant_id, p_site_id);
  END IF;

  v_return := public._prepare_vat_sale_return(p_sale_id, p_site_id, p_items, p_reason, p_restock, p_request_id, p_cash_session_id);
  IF v_return.status = 'pending' THEN
    IF p_refund_method = 'avoir' THEN
      PERFORM public.approve_return_as_avoir(v_return.id);
    ELSIF p_refund_now THEN
      PERFORM public.process_return_as_cash(v_return.id, p_cash_session_id);
    END IF;
    SELECT * INTO v_return FROM public.sale_returns r WHERE r.id = v_return.id;
  END IF;
  RETURN jsonb_build_object('success', true, 'return_id', v_return.id, 'return_number', v_return.return_number,
    'total', v_return.total, 'vat_net_amount', v_return.vat_net_amount, 'vat_amount', v_return.vat_amount,
    'refunded', v_return.refund_method = 'cash', 'refund_method', v_return.refund_method);
END;
$function$;
REVOKE ALL ON FUNCTION public.process_sale_return(p_sale_id uuid, p_site_id uuid, p_cash_session_id uuid, p_items jsonb, p_reason text, p_refund_now boolean, p_restock boolean, p_request_id text, p_refund_method text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) TO authenticated;
