/*
# Retours proportionnels nets + taux de marque et de marge

## Objet
1. `process_sale_return` : la valeur d'un retour n'était calculée que sur le prix
   brut (quantité × prix unitaire), en ignorant la remise de ligne et la remise
   globale. Nouveau calcul, par unité retournée :
   - part de ligne nette = (total net de la ligne / quantité vendue) × quantité retournée ;
   - part de remise globale = remise globale × (part de ligne nette / sous-total vente) ;
   - valeur du retour = part de ligne nette − part de remise globale.
   Le coût enregistré reste le coût historique de la ligne d'origine.
   Exemple validé : 2 unités à 10 000, remise ligne 10 %, remise globale 5 %,
   coût 6 000 → vente 17 100 / marge 5 100 ; après retour d'1 unité, retour
   valorisé 8 550, coût 6 000, marge résiduelle 2 550.

2. `get_financial_summary` : ajout de deux indicateurs distincts, avec
   dénominateur nul renvoyant NULL (affiché « — »), jamais « 0 % » :
   - `taux_marque` = marge / chiffre d'affaires net ;
   - `taux_marge`  = marge / coût des marchandises vendues (CMV) net.

## Sécurité
SECURITY DEFINER / STABLE selon la fonction, `search_path` figé.
Aucune donnée existante modifiée ; aucun recalcul rétroactif.
*/

CREATE OR REPLACE FUNCTION public.process_sale_return(
  p_sale_id uuid, p_site_id uuid, p_cash_session_id uuid, p_items jsonb,
  p_reason text DEFAULT 'Retour au POS'::text, p_refund_now boolean DEFAULT true,
  p_restock boolean DEFAULT true, p_request_id text DEFAULT NULL::text, p_refund_method text DEFAULT NULL::text)
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


CREATE OR REPLACE FUNCTION public.get_financial_summary(
  p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id           uuid;
v_tz                  text;
v_ts_from             timestamptz;
v_ts_to               timestamptz;
v_ventes_validees     numeric := 0;
v_retours             numeric := 0;
v_cogs_ventes         numeric := 0;
v_cogs_retours        numeric := 0;
v_charges             numeric := 0;
v_nb_ventes           bigint  := 0;
v_nb_retours          bigint  := 0;
v_nb_ventes_retour    bigint  := 0;
v_nb_annulations      bigint  := 0;
v_montant_annule      numeric := 0;
v_nb_lignes_sans_cout bigint  := 0;
v_ca_net              numeric;
v_cogs_net            numeric;
v_marge_brute         numeric;
v_taux_marque         numeric;
v_taux_marge          numeric;
v_resultat            numeric;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

IF p_site_id IS NOT NULL THEN
IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
RAISE EXCEPTION 'Site not authorized';
END IF;
END IF;

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_from := (p_from::timestamp AT TIME ZONE v_tz);
v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

SELECT COALESCE(SUM(s.total - COALESCE(s.vat_amount, 0)), 0),
COALESCE(SUM(item_cost.cost), 0), COUNT(*)
INTO v_ventes_validees, v_cogs_ventes, v_nb_ventes
FROM sales s
LEFT JOIN LATERAL (
SELECT COALESCE(SUM(si.purchase_cost * si.quantity), 0) AS cost
FROM sale_items si WHERE si.sale_id = s.id
) item_cost ON true
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid', 'partial', 'validated')
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id);

SELECT COUNT(*) INTO v_nb_lignes_sans_cout
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
JOIN articles a ON a.id = si.article_id
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid', 'partial', 'validated')
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND a.track_stock = true AND COALESCE(si.purchase_cost, 0) = 0;

SELECT COALESCE(SUM(sr.total), 0), COALESCE(SUM(ret_cost.cost), 0),
COUNT(*), COUNT(DISTINCT sr.sale_id)
INTO v_retours, v_cogs_retours, v_nb_retours, v_nb_ventes_retour
FROM sale_returns sr
LEFT JOIN LATERAL (
SELECT COALESCE(SUM(sri.purchase_cost * sri.quantity), 0) AS cost
FROM sale_return_items sri WHERE sri.return_id = sr.id
) ret_cost ON true
WHERE sr.tenant_id = v_tenant_id
AND sr.status = 'approved'
AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
AND (p_site_id IS NULL OR sr.site_id = p_site_id);

SELECT COUNT(*), COALESCE(SUM(s.total), 0)
INTO v_nb_annulations, v_montant_annule
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.status = 'cancelled'
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id);

SELECT COALESCE(SUM(cm.amount), 0) INTO v_charges
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.kind = 'expense'
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

v_ca_net      := v_ventes_validees - v_retours;
v_cogs_net    := v_cogs_ventes - v_cogs_retours;
v_marge_brute := v_ca_net - v_cogs_net;
-- Taux de marque = marge / CA ; taux de marge = marge / CMV ; NULL si dénominateur nul.
v_taux_marque := CASE WHEN v_ca_net > 0 THEN ROUND((v_marge_brute / v_ca_net) * 100, 2) ELSE NULL END;
v_taux_marge  := CASE WHEN v_cogs_net > 0 THEN ROUND((v_marge_brute / v_cogs_net) * 100, 2) ELSE NULL END;
v_resultat    := v_marge_brute - v_charges;

RETURN jsonb_build_object(
'ventes_validees',       v_ventes_validees,
'retours',               v_retours,
'ca_net',                v_ca_net,
'cogs_ventes',           v_cogs_ventes,
'cogs_retours',          v_cogs_retours,
'cogs_net',              v_cogs_net,
'marge_brute',           v_marge_brute,
'taux_marque',           v_taux_marque,
'taux_marge',            v_taux_marge,
'charges_exploitation',  v_charges,
'resultat_exploitation', v_resultat,
'nb_ventes',             v_nb_ventes,
'nb_retours',            v_nb_retours,
'nb_ventes_avec_retour', v_nb_ventes_retour,
'nb_annulations',        v_nb_annulations,
'montant_annule',        v_montant_annule,
'nb_lignes_sans_cout',   v_nb_lignes_sans_cout
);
END;
$function$;
