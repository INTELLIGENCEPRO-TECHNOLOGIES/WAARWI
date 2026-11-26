-- Prérequis de la branche de recette reconstruite UNIQUEMENT. Ne pas rejouer en production.
CREATE OR REPLACE FUNCTION public._calculate_sale_price(p_tenant_id uuid, p_site_id uuid, p_items jsonb, p_discount numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_enabled boolean := public._sale_vat_enabled(p_tenant_id, p_site_id);
  v_lines jsonb;
  v_subtotal numeric;
  v_net numeric;
  v_vat numeric := 0;
  v_invalid boolean;
BEGIN
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lignes de vente invalides.'; END IF;

  WITH lines AS (
    SELECT l.ord::text AS line_key,
      (l.item->>'quantity')::numeric * (l.item->>'unit_price')::numeric
        - COALESCE((l.item->>'discount')::numeric, 0) AS base,
      COALESCE(a.vat_rate, 0) AS rate, a.id AS article
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS l(item, ord)
    LEFT JOIN public.articles a ON v_enabled AND a.tenant_id = p_tenant_id
      AND a.id = NULLIF(l.item->>'article_id', '')::uuid
  )
  SELECT COALESCE(sum(base), 0),
    COALESCE(bool_or(article IS NULL OR rate NOT BETWEEN 0 AND 100 OR base IS NULL OR base < 0
      OR base IN ('NaN'::numeric, 'Infinity'::numeric)), false),
    jsonb_agg(jsonb_build_object('line_key', line_key, 'base', base, 'rate', rate)) FILTER (WHERE v_enabled)
  INTO v_subtotal, v_invalid, v_lines
  FROM lines;

  v_net := greatest(0, v_subtotal - COALESCE(p_discount, 0));
  IF v_enabled THEN
    IF v_invalid OR COALESCE(p_discount, 0) NOT BETWEEN 0 AND v_subtotal THEN
      RAISE EXCEPTION 'Vérifiez les articles, leurs taux de TVA et la remise HT.';
    END IF;
    SELECT COALESCE(sum(l.vat), 0) INTO v_vat
    FROM public._sale_vat_lines(COALESCE(v_lines, '[]'), p_discount) l;
    v_net := round(v_net, 2);
  END IF;
  RETURN jsonb_build_object('enabled', v_enabled, 'subtotal', v_subtotal,
    'ht', v_net, 'vat', v_vat, 'ttc', v_net + v_vat);
END;
$function$;
REVOKE ALL ON FUNCTION public._calculate_sale_price(p_tenant_id uuid, p_site_id uuid, p_items jsonb, p_discount numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._sale_total_for_issue(p_tenant_id uuid, p_site_id uuid, p_items jsonb, p_discount numeric, p_legacy_total numeric, p_expected_ttc numeric)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_enabled boolean := public._sale_vat_enabled(p_tenant_id, p_site_id);
  v_total numeric := p_legacy_total;
BEGIN
  IF v_enabled THEN
    v_total := (public._calculate_sale_price(p_tenant_id, p_site_id, p_items, p_discount)->>'ttc')::numeric;
    IF p_expected_ttc IS NULL THEN RAISE EXCEPTION 'Actualisez la caisse pour confirmer le prix TTC.'; END IF;
  END IF;
  IF p_expected_ttc IS NOT NULL AND round(p_expected_ttc, 2) <> round(v_total, 2) THEN
    RAISE EXCEPTION 'Le prix TTC a changé. Vérifiez le nouveau montant avant d’encaisser.';
  END IF;
  RETURN v_total;
END;
$function$;
REVOKE ALL ON FUNCTION public._sale_total_for_issue(p_tenant_id uuid, p_site_id uuid, p_items jsonb, p_discount numeric, p_legacy_total numeric, p_expected_ttc numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.next_doc_number(p_tenant_id uuid, p_kind text, p_prefix text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_num bigint;
BEGIN
IF p_tenant_id IS NULL THEN
RAISE EXCEPTION 'next_doc_number: tenant_id required';
END IF;

INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number)
VALUES (p_tenant_id, p_kind, 1)
ON CONFLICT (tenant_id, doc_kind)
DO UPDATE SET last_number = tenant_doc_counters.last_number + 1
RETURNING last_number INTO v_num;

RETURN p_prefix || '-' || lpad(v_num::text, 5, '0');
END;
$function$;
REVOKE ALL ON FUNCTION public.next_doc_number(p_tenant_id uuid, p_kind text, p_prefix text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.convert_quote_to_sale(p_quote_id uuid, p_site_id uuid, p_cash_session_id uuid DEFAULT NULL::uuid, p_payments jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
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
v_expected_ttc numeric := (p_payments->0->>'expected_ttc')::numeric;
BEGIN
IF p_payments->0 ? 'expected_ttc' THEN p_payments := p_payments - 0; END IF;
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

v_total := public._sale_total_for_issue(v_tenant_id, p_site_id,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('article_id', i.article_id, 'quantity', i.quantity,
    'unit_price', i.unit_price, 'discount', i.discount)), '[]')
   FROM public.quote_items i WHERE i.quote_id = p_quote_id AND i.tenant_id = v_tenant_id),
  v_quote.discount, COALESCE(v_quote.total, 0), v_expected_ttc);


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
REVOKE ALL ON FUNCTION public.convert_quote_to_sale(p_quote_id uuid, p_site_id uuid, p_cash_session_id uuid, p_payments jsonb) FROM PUBLIC,anon,authenticated;
