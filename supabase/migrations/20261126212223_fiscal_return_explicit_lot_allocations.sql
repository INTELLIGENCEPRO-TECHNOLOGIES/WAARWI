CREATE TABLE public.sale_return_lot_allocations (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 return_item_id uuid NOT NULL REFERENCES public.sale_return_items(id),
 sale_item_id uuid NOT NULL REFERENCES public.sale_items(id),
 lot_id uuid NOT NULL REFERENCES public.stock_lots(id),
 quantity numeric NOT NULL CHECK(quantity>0 AND quantity::text NOT IN ('NaN','Infinity','-Infinity')),
 restocked boolean NOT NULL,
 purchase_price numeric NOT NULL,
 PRIMARY KEY(return_item_id,lot_id)
);
ALTER TABLE public.sale_return_lot_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sale_return_lot_allocations FROM PUBLIC,anon,authenticated;
CREATE INDEX sale_return_lot_allocations_line_idx ON public.sale_return_lot_allocations(tenant_id,sale_item_id,lot_id);
CREATE OR REPLACE FUNCTION public._return_lot_options(t uuid, line_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH sold AS (
 SELECT d.lot_id,sum(d.quantity) sold FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_item_id=line_id GROUP BY d.lot_id
 ), used AS (
 SELECT a.lot_id,sum(a.quantity) qty FROM public.sale_return_lot_allocations a JOIN public.sale_return_items ri ON ri.id=a.return_item_id AND ri.tenant_id=t JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t WHERE a.tenant_id=t AND a.sale_item_id=line_id AND r.status IN ('pending','approved') GROUP BY a.lot_id
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('lot_id',s.lot_id,'batch_number',l.batch_number,'expiry_date',l.expiry_date,'site_name',st.name,'sold',s.sold,'available',greatest(0,s.sold-coalesce(u.qty,0))) ORDER BY l.batch_number,s.lot_id),'[]') FROM sold s JOIN public.stock_lots l ON l.id=s.lot_id AND l.tenant_id=t JOIN public.sites st ON st.id=l.site_id AND st.tenant_id=t LEFT JOIN used u ON u.lot_id=s.lot_id
$$;
CREATE OR REPLACE FUNCTION public.read_fiscal_return_lots(p_sale_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=public.current_tenant_id(); s public.sales%ROWTYPE;
BEGIN
 PERFORM public._cr_require_caller();
 IF NOT(coalesce(public._cr_profile_has_permission(auth.uid(),'edit_invoices'),false) OR coalesce(public._cr_profile_has_permission(auth.uid(),'pos_returns'),false)) THEN RAISE EXCEPTION 'Permission de retour requise.' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND tenant_id=t;
 IF NOT FOUND OR public.current_user_can_access_site(s.site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Facture inaccessible.' USING ERRCODE='42501';END IF;
 IF s.vat_net_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=p_sale_id) THEN RETURN '{}'::jsonb;END IF;
 IF EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND public.current_user_can_access_site(d.site_id) IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Dépôt historique inaccessible.' USING ERRCODE='42501';END IF;
 RETURN coalesce((SELECT jsonb_object_agg(i.id::text,public._return_lot_options(t,i.id)) FROM public.sale_items i WHERE i.tenant_id=t AND i.sale_id=p_sale_id),'{}');
END $$;
CREATE OR REPLACE FUNCTION public._allocate_traced_fiscal_return(t uuid,sid uuid,rid uuid,riid uuid,p_alloc jsonb,p_restock boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tr public.quote_conversion_stock_trace%ROWTYPE; i public.sale_return_items%ROWTYPE; si public.sale_items%ROWTYPE; actual jsonb; lots jsonb; options jsonb; chosen jsonb; prev numeric; rec record; total_remaining numeric; qty numeric; count_remaining int; prior_unmapped numeric; prior_physical numeric;
BEGIN
 SELECT * INTO STRICT tr FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=sid;
 SELECT * INTO STRICT i FROM public.sale_return_items WHERE tenant_id=t AND id=riid AND return_id=rid;
 SELECT * INTO STRICT si FROM public.sale_items WHERE tenant_id=t AND sale_id=sid AND id=i.sale_item_id;
 SELECT coalesce(jsonb_agg(jsonb_build_array(article_id,site_id,trim_scale(x.qty)) ORDER BY article_id,site_id),'[]') INTO actual FROM (SELECT article_id,site_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid AND reference_type='sale' GROUP BY article_id,site_id) x;
 SELECT coalesce(jsonb_agg(jsonb_build_array(lot_id,article_id,site_id,trim_scale(x.qty)) ORDER BY lot_id,article_id,site_id),'[]') INTO lots FROM (SELECT lot_id,article_id,site_id,sum(quantity) qty FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=sid GROUP BY lot_id,article_id,site_id) x;
 IF actual IS DISTINCT FROM tr.stock_manifest OR lots IS DISTINCT FROM tr.lot_manifest THEN RAISE EXCEPTION 'Historique de sortie incohérent. Retour bloqué.' USING ERRCODE='55000';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tr.stock_manifest) x WHERE x->>0=si.article_id::text AND x->>1=si.site_id::text) THEN
  IF p_alloc IS NOT NULL AND p_alloc<>'[]'::jsonb THEN RAISE EXCEPTION 'Aucun lot pour cette ligne.' USING ERRCODE='22023';END IF; RETURN;
 END IF;
 IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Dépôt historique inaccessible.' USING ERRCODE='42501';END IF;
 options:=public._return_lot_options(t,si.id);
 IF jsonb_array_length(options)>0 THEN
  IF (SELECT sum(d.quantity) FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id) IS DISTINCT FROM si.quantity THEN RAISE EXCEPTION 'Traçabilité des lots incomplète.' USING ERRCODE='55000';END IF;
  SELECT coalesce(sum(ri.quantity-coalesce((SELECT sum(a.quantity) FROM public.sale_return_lot_allocations a WHERE a.tenant_id=t AND a.return_item_id=ri.id),0)),0),coalesce(sum(ri.quantity-coalesce((SELECT sum(a.quantity) FROM public.sale_return_lot_allocations a WHERE a.tenant_id=t AND a.return_item_id=ri.id),0)) FILTER(WHERE r.restock),0)
  INTO prior_unmapped,prior_physical FROM public.sale_return_items ri JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t WHERE ri.tenant_id=t AND ri.sale_item_id=si.id AND r.status IN ('pending','approved') AND r.id<>rid;
  IF jsonb_array_length(options)=1 THEN
   options:=jsonb_set(options,'{0,available}',to_jsonb(greatest(0,(options->0->>'available')::numeric-prior_unmapped)));
  ELSIF prior_physical>0 AND p_restock THEN RAISE EXCEPTION 'Un ancien retour physique multi-lots est sans affectation vérifiable.' USING ERRCODE='55000';END IF;
  SELECT coalesce(sum((x->>'available')::numeric),0),count(*) FILTER(WHERE (x->>'available')::numeric>0) INTO total_remaining,count_remaining FROM jsonb_array_elements(options) x;
  IF p_alloc IS NOT NULL AND p_alloc<>'[]' THEN chosen:=p_alloc;
  ELSIF count_remaining=1 THEN SELECT jsonb_agg(jsonb_build_object('lot_id',x->>'lot_id','quantity',i.quantity)) INTO chosen FROM jsonb_array_elements(options) x WHERE (x->>'available')::numeric>0;
  ELSIF total_remaining=i.quantity THEN SELECT jsonb_agg(jsonb_build_object('lot_id',x->>'lot_id','quantity',(x->>'available')::numeric)) INTO chosen FROM jsonb_array_elements(options) x WHERE (x->>'available')::numeric>0;
  ELSIF NOT p_restock THEN chosen:='[]';
  ELSE RAISE EXCEPTION 'Indiquez les quantités réellement retournées pour chaque lot.' USING ERRCODE='22023';END IF;
  IF chosen<>'[]' THEN
   IF jsonb_typeof(chosen) IS DISTINCT FROM 'array' OR jsonb_array_length(chosen)>500 THEN RAISE EXCEPTION 'Affectation de lots invalide.' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_to_recordset(chosen) a(lot_id uuid,quantity numeric) WHERE a.lot_id IS NULL OR a.quantity IS NULL OR a.quantity<=0 OR a.quantity::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Quantité de lot invalide.' USING ERRCODE='22023';END IF;
   IF (SELECT sum(a.quantity) FROM jsonb_to_recordset(chosen) a(lot_id uuid,quantity numeric)) IS DISTINCT FROM i.quantity THEN RAISE EXCEPTION 'Le total des lots doit correspondre à la quantité retournée.' USING ERRCODE='22023';END IF;
   FOR rec IN SELECT a.lot_id,sum(a.quantity) quantity FROM jsonb_to_recordset(chosen) a(lot_id uuid,quantity numeric) GROUP BY a.lot_id ORDER BY a.lot_id LOOP
    SELECT (x->>'available')::numeric INTO qty FROM jsonb_array_elements(options) x WHERE x->>'lot_id'=rec.lot_id::text;
    IF NOT FOUND OR qty<rec.quantity THEN RAISE EXCEPTION 'Lot étranger à la ligne ou quantité restante dépassée.' USING ERRCODE='22023';END IF;
    INSERT INTO public.sale_return_lot_allocations(tenant_id,return_item_id,sale_item_id,lot_id,quantity,restocked,purchase_price)
    SELECT t,riid,si.id,l.id,rec.quantity,p_restock,l.purchase_price FROM public.stock_lots l WHERE l.id=rec.lot_id AND l.tenant_id=t AND l.article_id=si.article_id AND l.site_id=si.site_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Lot historique introuvable.' USING ERRCODE='55000';END IF;
    IF p_restock THEN
     UPDATE public.stock_lots SET remaining_quantity=remaining_quantity+rec.quantity WHERE id=rec.lot_id AND tenant_id=t AND article_id=si.article_id AND site_id=si.site_id AND remaining_quantity+rec.quantity<=initial_quantity;
     IF NOT FOUND THEN RAISE EXCEPTION 'Quantité historique du lot incohérente.' USING ERRCODE='55000';END IF;
    END IF;
   END LOOP;
  END IF;
 ELSIF p_alloc IS NOT NULL AND p_alloc<>'[]' THEN RAISE EXCEPTION 'Aucun lot pour cette ligne.' USING ERRCODE='22023';
 ELSIF EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.article_id=si.article_id AND d.site_id=si.site_id) THEN RAISE EXCEPTION 'Traçabilité de lot absente pour la ligne.' USING ERRCODE='55000';END IF;
 IF NOT p_restock THEN RETURN;END IF;
 SELECT quantity INTO prev FROM public.stock_levels WHERE tenant_id=t AND article_id=si.article_id AND site_id=si.site_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Stock historique introuvable.' USING ERRCODE='55000';END IF;
 UPDATE public.stock_levels SET quantity=prev+i.quantity,updated_at=now() WHERE tenant_id=t AND article_id=si.article_id AND site_id=si.site_id;
 INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(t,si.article_id,si.site_id,'return_customer',i.quantity,prev,prev+i.quantity,'sale_return',rid,auth.uid(),'Retour fiscal sur facture '||sid::text);
END $$;
REVOKE ALL ON FUNCTION public._return_lot_options(uuid,uuid),public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean),public.read_fiscal_return_lots(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_fiscal_return_lots(uuid) TO authenticated;

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
  v_alloc jsonb;
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
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x ? 'lots' AND jsonb_typeof(x->'lots') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'Affectation de lots invalide.' USING ERRCODE='22023';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x ? 'lots' AND jsonb_array_length(x->'lots')>0) THEN
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x GROUP BY x->>'sale_item_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Regroupez les affectations par ligne.' USING ERRCODE='22023';END IF;
   SELECT sha256(v_hash||convert_to((SELECT jsonb_agg(jsonb_build_array(x->>'sale_item_id',(SELECT jsonb_agg(jsonb_build_array(a.lot_id,trim_scale(a.qty)) ORDER BY a.lot_id) FROM (SELECT (z->>'lot_id')::uuid lot_id,sum((z->>'quantity')::numeric) qty FROM jsonb_array_elements(x->'lots') z GROUP BY 1) a)) ORDER BY x->>'sale_item_id') FROM jsonb_array_elements(p_items) x WHERE x ? 'lots' AND jsonb_array_length(x->'lots')>0)::text,'UTF8')) INTO v_hash;
  END IF;
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
    SELECT x->'lots' INTO v_alloc FROM jsonb_array_elements(p_items) x WHERE x->>'sale_item_id'=v_item.id::text AND x ? 'lots' LIMIT 1;
    IF v_traced THEN
      PERFORM public._allocate_traced_fiscal_return(v_tenant_id,p_sale_id,v_result.id,v_return_item,v_alloc,coalesce(p_restock,false));
    ELSIF v_alloc IS NOT NULL AND v_alloc<>'[]' THEN RAISE EXCEPTION 'Affectation de lots non prise en charge pour cette facture historique.' USING ERRCODE='55000';
    ELSIF p_restock AND EXISTS (
      SELECT 1 FROM public.articles a WHERE a.id = v_item.article AND a.tenant_id = v_tenant_id AND a.track_stock
    ) THEN
      PERFORM public.adjust_stock(v_item.article, p_site_id, v_item.quantity, 'return_customer', 'Retour ' || v_result.return_number);
    END IF;
  END LOOP;
  RETURN v_result;
END;
$function$;
REVOKE ALL ON FUNCTION public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
