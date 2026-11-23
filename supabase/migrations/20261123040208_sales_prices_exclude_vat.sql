-- Catalogue and document line prices are HT. Historic documents keep their
-- stored amounts and their original tax snapshots.
CREATE FUNCTION public._sale_vat_enabled(p_tenant_id uuid, p_site_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT v.enabled FROM public.sales_vat_settings v
    WHERE v.tenant_id = p_tenant_id
      AND (v.site_id IS NULL OR v.site_id = public.resolve_root_site_id(p_site_id))
    ORDER BY v.site_id IS NULL LIMIT 1
  ), false);
$$;

-- First share the global discount between the HT lines. Then accumulate VAT
-- by rate so line rounding agrees exactly with the document's taxable bases.
CREATE FUNCTION public._sale_vat_lines(p_lines jsonb, p_discount numeric)
RETURNS TABLE(line_key text, net numeric, vat numeric)
LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$
  WITH lines AS (
    SELECT l.line_key, l.base, l.rate,
      sum(l.base) OVER () AS subtotal,
      sum(l.base) OVER (ORDER BY l.rate, l.line_key COLLATE "C") AS running
    FROM jsonb_to_recordset(p_lines) AS l(line_key text, base numeric, rate numeric)
  ), bases AS (
    SELECT line_key, rate, COALESCE(
      round(running * round(subtotal - COALESCE(p_discount, 0), 2) / NULLIF(subtotal, 0), 2)
      - round((running - base) * round(subtotal - COALESCE(p_discount, 0), 2) / NULLIF(subtotal, 0), 2), 0
    ) AS net
    FROM lines
  ), tax_bases AS (
    SELECT line_key, rate, net,
      sum(net) OVER (PARTITION BY rate ORDER BY line_key COLLATE "C") AS rate_net
    FROM bases
  )
  SELECT line_key, net, round(rate_net * rate / 100, 2) - round((rate_net - net) * rate / 100, 2)
  FROM tax_bases;
$$;

CREATE FUNCTION public._calculate_sale_price(p_tenant_id uuid, p_site_id uuid, p_items jsonb, p_discount numeric)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
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
$$;

CREATE FUNCTION public.preview_sale_price(p_site_id uuid, p_items jsonb, p_discount numeric DEFAULT 0)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL OR public.current_user_can_access_site(p_site_id) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Accès refusé au prix de vente de ce magasin.' USING ERRCODE = '42501';
  END IF;
  RETURN public._calculate_sale_price(v_tenant_id, p_site_id, p_items, p_discount);
END;
$$;

CREATE FUNCTION public._sale_total_for_issue(
  p_tenant_id uuid, p_site_id uuid, p_items jsonb, p_discount numeric, p_legacy_total numeric, p_expected_ttc numeric
)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
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
$$;

REVOKE ALL ON FUNCTION public._sale_vat_enabled(uuid, uuid), public._sale_vat_lines(jsonb, numeric),
  public._calculate_sale_price(uuid, uuid, jsonb, numeric), public._sale_total_for_issue(uuid, uuid, jsonb, numeric, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.preview_sale_price(uuid, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_sale_price(uuid, jsonb, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public._finish_sale_vat()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_lines jsonb;
  v_subtotal numeric;
  v_vat numeric;
  v_ht numeric;
BEGIN
  SELECT sum(i.total), jsonb_agg(jsonb_build_object('line_key', i.id::text, 'base', i.total, 'rate', i.vat_rate))
  INTO v_subtotal, v_lines
  FROM public.sale_items i WHERE i.sale_id = NEW.id AND i.tenant_id = NEW.tenant_id;
  IF v_subtotal IS NULL OR round(v_subtotal, 2) IS DISTINCT FROM round(NEW.subtotal, 2)
     OR COALESCE(NEW.discount, 0) NOT BETWEEN 0 AND v_subtotal THEN
    RAISE EXCEPTION 'Les lignes et la remise HT de la facture ne concordent pas.';
  END IF;

  WITH snapshots AS (
    UPDATE public.sale_items i SET vat_amount = a.vat, vat_net_amount = a.net
    FROM public._sale_vat_lines(v_lines, NEW.discount) a WHERE i.id = a.line_key::uuid
    RETURNING i.vat_amount, i.vat_net_amount
  )
  SELECT sum(vat_amount), sum(vat_net_amount) INTO v_vat, v_ht FROM snapshots;
  IF v_ht + v_vat IS DISTINCT FROM NEW.total THEN
    RAISE EXCEPTION 'Le prix TTC a changé. Vérifiez les montants avant de valider la vente.';
  END IF;
  UPDATE public.sales SET vat_amount = v_vat, vat_net_amount = v_ht
  WHERE id = NEW.id AND tenant_id = NEW.tenant_id;
  RETURN NULL;
END;
$$;

-- Keep the live RPC bodies and the existing stock, cash and site guards.
-- Only replace the point where each flow computes the amount to settle.
DO $$
DECLARE
  v_path record;
  v_definition text;
  v_replacement text;
BEGIN
  FOR v_path IN SELECT * FROM (VALUES
    ('public.create_pos_sale(jsonb,jsonb,uuid,uuid,uuid,numeric,text)', 'v_total := v_subtotal - COALESCE(p_discount, 0);'),
    ('public.create_pos_sale_lot(uuid,uuid,uuid,jsonb,jsonb,numeric,text,jsonb)', 'v_total := v_subtotal - COALESCE(p_discount, 0);'),
    ('public.create_credit_sale(uuid,jsonb,numeric,uuid,uuid,text)', 'v_total := GREATEST(0, v_subtotal - COALESCE(p_discount, 0));')
  ) t(signature, original) LOOP
    v_definition := pg_get_functiondef(v_path.signature::regprocedure);
    IF strpos(v_definition, v_path.original) = 0 THEN
      RAISE EXCEPTION 'Calcul de vente introuvable dans %.', v_path.signature;
    END IF;
    v_replacement := v_path.original || E'\n  v_total := public._sale_total_for_issue(v_tenant_id, p_site_id, p_items, p_discount, v_total, (p_items->0->>\'expected_ttc\')::numeric);';
    EXECUTE replace(v_definition, v_path.original, v_replacement);
  END LOOP;
END;
$$;

-- The direct-invoice header carries the confirmed TTC, and the deferred trigger
-- verifies it before stock or payment writes can commit.
DO $$
DECLARE
  v_definition text := pg_get_functiondef('public.create_billing_sale_with_items(jsonb,jsonb,jsonb)'::regprocedure);
  v_marker text := '  INSERT INTO public.sales (';
BEGIN
  IF strpos(v_definition, v_marker) = 0 THEN RAISE EXCEPTION 'Création de facture introuvable.'; END IF;
  EXECUTE replace(v_definition, v_marker, $check$
  IF round((public.preview_sale_price(v_site_id, p_items, 0)->>'ttc')::numeric, 2)
    IS DISTINCT FROM round((p_sale->>'total')::numeric, 2) THEN
    RAISE EXCEPTION 'Le prix TTC a changé. Vérifiez le nouveau montant avant d’enregistrer.';
  END IF;

  INSERT INTO public.sales ($check$);
END;
$$;

-- A quote retains its original HT. The conversion has its own confirmed TTC.
-- The first JSON entry, when present, is a price confirmation, not a payment.
DO $$
DECLARE
  v_definition text := pg_get_functiondef('public.convert_quote_to_sale(uuid,uuid,uuid,jsonb)'::regprocedure);
  v_marker text := 'v_total := COALESCE(v_quote.total, 0);';
BEGIN
  IF strpos(v_definition, v_marker) = 0 OR strpos(v_definition, E'\nBEGIN\n') = 0 THEN
    RAISE EXCEPTION 'Conversion de devis introuvable.';
  END IF;
  v_definition := replace(v_definition, E'\nBEGIN\n', $price$
v_expected_ttc numeric := (p_payments->0->>'expected_ttc')::numeric;
BEGIN
IF p_payments->0 ? 'expected_ttc' THEN p_payments := p_payments - 0; END IF;
$price$);
  EXECUTE replace(v_definition, v_marker, $price$
v_total := public._sale_total_for_issue(v_tenant_id, p_site_id,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('article_id', i.article_id, 'quantity', i.quantity,
    'unit_price', i.unit_price, 'discount', i.discount)), '[]')
   FROM public.quote_items i WHERE i.quote_id = p_quote_id AND i.tenant_id = v_tenant_id),
  v_quote.discount, COALESCE(v_quote.total, 0), v_expected_ttc);
$price$);
END;
$$;
