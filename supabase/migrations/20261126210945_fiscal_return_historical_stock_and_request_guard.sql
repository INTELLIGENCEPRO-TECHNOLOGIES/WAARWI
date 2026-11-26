ALTER TABLE public.sale_returns ADD COLUMN IF NOT EXISTS request_payload_hash bytea;
CREATE OR REPLACE FUNCTION public._restock_traced_fiscal_return(t uuid,sid uuid,rid uuid,riid uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tr public.quote_conversion_stock_trace%ROWTYPE; i public.sale_return_items%ROWTYPE; si public.sale_items%ROWTYPE; actual jsonb; lots jsonb; n numeric; prev numeric; rec record; qty numeric; prior numeric; lot_count int;
BEGIN
 SELECT * INTO STRICT tr FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=sid;
 SELECT * INTO STRICT i FROM public.sale_return_items WHERE tenant_id=t AND id=riid AND return_id=rid;
 SELECT * INTO STRICT si FROM public.sale_items WHERE tenant_id=t AND sale_id=sid AND id=i.sale_item_id;
 SELECT coalesce(jsonb_agg(jsonb_build_array(article_id,site_id,trim_scale(qty)) ORDER BY article_id,site_id),'[]') INTO actual FROM (SELECT article_id,site_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid AND reference_type='sale' GROUP BY article_id,site_id) x;
 SELECT coalesce(jsonb_agg(jsonb_build_array(lot_id,article_id,site_id,trim_scale(qty)) ORDER BY lot_id,article_id,site_id),'[]') INTO lots FROM (SELECT lot_id,article_id,site_id,sum(quantity) qty FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=sid GROUP BY lot_id,article_id,site_id) x;
 IF actual IS DISTINCT FROM tr.stock_manifest OR lots IS DISTINCT FROM tr.lot_manifest THEN RAISE EXCEPTION 'Historique de sortie incohérent. Retour bloqué.' USING ERRCODE='55000';END IF;
 -- Untracked lines have no physical stock movement, irrespective of today's article setting.
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tr.stock_manifest) x WHERE x->>0=si.article_id::text AND x->>1=si.site_id::text) THEN RETURN;END IF;
 IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Dépôt historique inaccessible.' USING ERRCODE='42501';END IF;
 SELECT coalesce(sum(ri.quantity),0) INTO prior FROM public.sale_return_items ri JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t WHERE ri.tenant_id=t AND ri.sale_item_id=si.id AND r.status IN ('pending','approved') AND r.id<>rid;
 SELECT count(DISTINCT lot_id) INTO lot_count FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=sid AND sale_item_id=si.id;
 IF lot_count>1 AND (i.quantity<>si.quantity OR prior<>0) THEN RAISE EXCEPTION 'Retour partiel sur plusieurs lots : sélection explicite des lots requise.' USING ERRCODE='55000';END IF;
 IF lot_count>0 THEN
  IF (SELECT sum(quantity) FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=sid AND sale_item_id=si.id) IS DISTINCT FROM si.quantity THEN RAISE EXCEPTION 'Traçabilité des lots de la ligne incomplète.' USING ERRCODE='55000';END IF;
  FOR rec IN SELECT d.lot_id,sum(d.quantity) original_qty FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id GROUP BY d.lot_id ORDER BY d.lot_id LOOP
    qty:=CASE WHEN lot_count=1 THEN i.quantity ELSE rec.original_qty END;
    UPDATE public.stock_lots SET remaining_quantity=remaining_quantity+qty WHERE id=rec.lot_id AND tenant_id=t AND article_id=si.article_id AND site_id=si.site_id AND remaining_quantity+qty<=initial_quantity;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lot historique introuvable ou quantité incohérente.' USING ERRCODE='55000';END IF;
  END LOOP;
 ELSIF EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.article_id=si.article_id AND d.site_id=si.site_id) THEN RAISE EXCEPTION 'Traçabilité de lot absente pour la ligne.' USING ERRCODE='55000';END IF;
 SELECT quantity INTO prev FROM public.stock_levels WHERE tenant_id=t AND article_id=si.article_id AND site_id=si.site_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock historique introuvable.' USING ERRCODE='55000';END IF;
 UPDATE public.stock_levels SET quantity=prev+i.quantity,updated_at=now() WHERE tenant_id=t AND article_id=si.article_id AND site_id=si.site_id;
 INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(t,si.article_id,si.site_id,'return_customer',i.quantity,prev,prev+i.quantity,'sale_return',rid,auth.uid(),'Retour fiscal sur facture '||sid::text);
END $$;
REVOKE ALL ON FUNCTION public._restock_traced_fiscal_return(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._prepare_vat_sale_return(p_sale_id uuid, p_site_id uuid, p_items jsonb, p_reason text, p_restock boolean, p_request_id text, p_cash_session_id uuid)
 RETURNS sale_returns
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_tenant_id uuid := public.current_tenant_id();
  v_invoice public.sales;
  v_result public.sale_returns;
  v_line public.sale_items;
  v_item record;
  v_prior record;
  v_remaining numeric;
  v_net numeric;
  v_vat numeric;
  v_ttc numeric;
  v_total_ht numeric := 0;
  v_total_vat numeric := 0;
  v_lines jsonb := '[]';
  v_hash bytea;
  v_traced boolean;
  v_return_item uuid;
BEGIN
  PERFORM public._cr_require_caller();
  IF v_tenant_id IS NULL OR p_sale_id IS NULL OR p_site_id IS NULL OR NOT (coalesce(public._cr_profile_has_permission(auth.uid(),'edit_invoices'),false) OR coalesce(public._cr_profile_has_permission(auth.uid(),'pos_returns'),false)) THEN RAISE EXCEPTION 'Permission de retour requise.' USING ERRCODE='42501';END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text||':edit:sale:'||p_sale_id::text,0));
  IF EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=v_tenant_id AND resource_type='sale' AND resource_key=p_sale_id::text AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'La facture est en cours de modification. Demandez sa libération.' USING ERRCODE='55000';END IF;
  SELECT s.* INTO v_invoice FROM public.sales s
  WHERE s.id = p_sale_id AND s.tenant_id = v_tenant_id AND s.site_id = p_site_id
  FOR UPDATE;
  IF auth.uid() IS NULL OR NOT FOUND OR public.current_user_can_access_site(p_site_id) IS DISTINCT FROM true
     OR v_invoice.vat_net_amount IS NULL OR v_invoice.status NOT IN ('paid', 'partial', 'validated')
     OR v_invoice.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Facture émise avec TVA introuvable dans ce magasin.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._cs_assert_sale_usable(p_sale_id);
  IF EXISTS (SELECT 1 FROM public.ipm_ventes i WHERE i.sale_id = p_sale_id AND i.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Cette facture relève de l’IPM. La part de chaque payeur doit être traitée avant d’émettre l’avoir.';
  END IF;
  IF p_request_id IS NULL OR btrim(p_request_id) = '' OR length(p_request_id) > 160 THEN
    RAISE EXCEPTION 'Référence de traitement de l’avoir invalide.';
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Sélectionnez les lignes à retourner.' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) i(sale_item_id uuid,quantity numeric) WHERE sale_item_id IS NULL OR quantity IS NULL OR quantity<=0 OR quantity::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Ligne ou quantité de retour invalide.' USING ERRCODE='22023';END IF;
  SELECT sha256(convert_to(jsonb_build_array(p_sale_id,p_site_id,coalesce(nullif(btrim(p_reason),''),'Retour sur facture'),coalesce(p_restock,false),p_cash_session_id,(SELECT jsonb_agg(jsonb_build_array(id,trim_scale(qty)) ORDER BY id) FROM (SELECT sale_item_id id,sum(quantity) qty FROM jsonb_to_recordset(p_items) i(sale_item_id uuid,quantity numeric) GROUP BY 1) x))::text,'UTF8')) INTO v_hash;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text||':return-request:'||p_request_id,0));
  SELECT * INTO v_result FROM public.sale_returns r WHERE r.tenant_id = v_tenant_id AND r.request_id = p_request_id;
  IF FOUND THEN
    IF v_result.sale_id IS DISTINCT FROM p_sale_id OR v_result.site_id IS DISTINCT FROM p_site_id
      OR v_result.user_id IS DISTINCT FROM auth.uid() OR (v_result.request_payload_hash IS NOT NULL AND v_result.request_payload_hash IS DISTINCT FROM v_hash) THEN RAISE EXCEPTION 'Référence de traitement déjà utilisée.'; END IF;
    RETURN v_result;
  END IF;
  IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Sélectionnez les lignes à retourner.';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.quote_conversion_stock_trace WHERE tenant_id=v_tenant_id AND sale_id=p_sale_id) INTO v_traced;
  IF p_restock AND v_traced THEN
    -- Lock all source stock rows and lots in deterministic order before the line loop.
    PERFORM 1 FROM public.stock_levels sl WHERE sl.tenant_id=v_tenant_id AND EXISTS(SELECT 1 FROM public.sale_items si WHERE si.tenant_id=v_tenant_id AND si.sale_id=p_sale_id AND si.article_id=sl.article_id AND si.site_id=sl.site_id) ORDER BY sl.article_id,sl.site_id FOR UPDATE;
    PERFORM 1 FROM public.stock_lots l WHERE l.tenant_id=v_tenant_id AND EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.lot_id=l.id) ORDER BY l.article_id,l.site_id,l.id FOR UPDATE;
  END IF;
  FOR v_item IN
    SELECT (i->>'sale_item_id')::uuid AS id, sum((i->>'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(p_items) i GROUP BY 1 ORDER BY 1
  LOOP
    SELECT i.* INTO v_line FROM public.sale_items i
    WHERE i.id = v_item.id AND i.sale_id = p_sale_id AND i.tenant_id = v_tenant_id;
    IF NOT FOUND OR v_line.vat_net_amount IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0
       OR v_item.quantity IN ('NaN'::numeric, 'Infinity'::numeric) THEN
      RAISE EXCEPTION 'Ligne ou quantité de retour invalide.';
    END IF;

    SELECT COALESCE(sum(i.quantity), 0) AS quantity, COALESCE(sum(i.vat_net_amount), 0) AS net,
      COALESCE(sum(i.vat_amount), 0) AS vat INTO v_prior
    FROM public.sale_return_items i JOIN public.sale_returns r ON r.id = i.return_id AND r.tenant_id = i.tenant_id
    WHERE i.tenant_id = v_tenant_id AND i.sale_item_id = v_line.id AND r.status IN ('approved', 'pending');
    v_remaining := v_line.quantity - v_prior.quantity;
    IF v_remaining < v_item.quantity OR v_prior.net > v_line.vat_net_amount OR v_prior.vat > v_line.vat_amount THEN
      RAISE EXCEPTION 'Quantité ou montant disponible dépassé pour %.', v_line.name;
    END IF;
    v_ttc := round((v_line.vat_net_amount - v_prior.net + v_line.vat_amount - v_prior.vat)
      * v_item.quantity / v_remaining, 2);
    v_vat := greatest(v_ttc - (v_line.vat_net_amount - v_prior.net),
      least(v_ttc, v_line.vat_amount - v_prior.vat, round((v_line.vat_amount - v_prior.vat) * v_item.quantity / v_remaining, 2)));
    v_net := v_ttc - v_vat;
    v_total_ht := v_total_ht + v_net;
    v_total_vat := v_total_vat + v_vat;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'id', v_line.id, 'article', v_line.article_id, 'name', v_line.name,
      'quantity', v_item.quantity, 'price', v_line.unit_price, 'cost', v_line.purchase_cost,
      'net', v_net, 'vat', v_vat, 'rate', v_line.vat_rate
    ));
  END LOOP;

  IF v_total_ht + v_total_vat <= 0 THEN
    RAISE EXCEPTION 'L’avoir doit avoir un montant strictement positif.';
  END IF;

  INSERT INTO public.sale_returns (
    tenant_id, site_id, sale_id, customer_id, user_id, cash_session_id, return_number,
    total, vat_net_amount, vat_amount, refund_method, status, reason, restock, request_id, request_payload_hash
  ) VALUES (
    v_tenant_id, p_site_id, p_sale_id, v_invoice.customer_id, auth.uid(), p_cash_session_id,
    public.next_doc_number(v_tenant_id, 'return', 'RET'), v_total_ht + v_total_vat, v_total_ht, v_total_vat,
    'pending', 'pending', COALESCE(NULLIF(btrim(p_reason), ''), 'Retour sur facture'),
    COALESCE(p_restock, false), p_request_id, v_hash
  ) RETURNING * INTO v_result;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(v_lines) AS d(
    id uuid, article uuid, name text, quantity numeric, price numeric, cost numeric, net numeric, vat numeric, rate numeric
  )
  LOOP
    INSERT INTO public.sale_return_items (
      tenant_id, return_id, article_id, sale_item_id, name, quantity, unit_price, purchase_cost,
      total, vat_net_amount, vat_amount, vat_rate
    ) VALUES (
      v_tenant_id, v_result.id, v_item.article, v_item.id, v_item.name, v_item.quantity, v_item.price,
      COALESCE(v_item.cost, 0), v_item.net + v_item.vat, v_item.net, v_item.vat, v_item.rate
    ) RETURNING id INTO v_return_item;
    IF p_restock AND v_traced THEN
      PERFORM public._restock_traced_fiscal_return(v_tenant_id,p_sale_id,v_result.id,v_return_item);
    ELSIF p_restock AND EXISTS (
      SELECT 1 FROM public.articles a WHERE a.id = v_item.article AND a.tenant_id = v_tenant_id AND a.track_stock
    ) THEN
      PERFORM public.adjust_stock(v_item.article, p_site_id, v_item.quantity, 'return_customer', 'Retour ' || v_result.return_number);
    END IF;
  END LOOP;
  RETURN v_result;
END;
$function$;
CREATE OR REPLACE FUNCTION public.approve_return_as_avoir(p_return_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_ret record;
v_sale_customer_id uuid;
v_alloc_result jsonb;
BEGIN
PERFORM public._cr_require_caller();
IF NOT (coalesce(public._cr_profile_has_permission(auth.uid(),'edit_invoices'),false) OR coalesce(public._cr_profile_has_permission(auth.uid(),'pos_returns'),false)) THEN RAISE EXCEPTION 'Permission de retour requise.' USING ERRCODE='42501';END IF;
PERFORM public._cs_assert_return_usable(p_return_id);
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

SELECT * INTO v_ret FROM public.sale_returns
WHERE id = p_return_id AND tenant_id = v_tenant_id FOR UPDATE;

IF v_ret.id IS NULL OR public.current_user_can_access_site(v_ret.site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Retour introuvable'; END IF;

-- IDEMPOTENCY: if already approved, do nothing
IF v_ret.status = 'approved' AND v_ret.refund_method IS DISTINCT FROM 'avoir' THEN RAISE EXCEPTION 'Ce retour est déjà traité par un autre mode.' USING ERRCODE='55000';END IF;
IF v_ret.status = 'approved' THEN
RETURN jsonb_build_object(
'success', true, 'idempotent', true,
'credit_balance', v_ret.total,
'message', 'Avoir déjà approuvé — aucune modification'
);
END IF;

IF v_ret.status <> 'pending' THEN
RAISE EXCEPTION 'Seuls les retours en attente peuvent être convertis en avoir';
END IF;

-- Resolve customer from sale if return has no customer
IF v_ret.customer_id IS NULL AND v_ret.sale_id IS NOT NULL THEN
SELECT customer_id INTO v_sale_customer_id
FROM public.sales WHERE id = v_ret.sale_id AND tenant_id = v_tenant_id;
IF v_sale_customer_id IS NOT NULL THEN
UPDATE public.sale_returns SET customer_id = v_sale_customer_id
WHERE id = p_return_id;
v_ret.customer_id := v_sale_customer_id;
END IF;
END IF;

IF v_ret.customer_id IS NULL THEN RAISE EXCEPTION 'Un client est requis pour émettre un avoir.' USING ERRCODE='22023';END IF;
UPDATE public.sale_returns
SET status = 'approved', refund_method = 'avoir',
refunded_at = now(), approved_by = auth.uid()
WHERE id = p_return_id;

IF v_ret.customer_id IS NOT NULL AND COALESCE(v_ret.total, 0) > 0 THEN
UPDATE public.customers
SET balance = COALESCE(balance, 0) - v_ret.total
WHERE id = v_ret.customer_id AND tenant_id = v_tenant_id;

v_alloc_result := public._apply_avoirs_internal(v_ret.customer_id, v_tenant_id);
END IF;

RETURN jsonb_build_object(
'success', true, 'idempotent', false,
'credit_balance', v_ret.total,
'customer_id', v_ret.customer_id,
'allocation', COALESCE(v_alloc_result, '{}'::jsonb)
);
END;
$function$;
REVOKE ALL ON FUNCTION public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.approve_return_as_avoir(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_return_as_avoir(uuid) TO authenticated;
