CREATE OR REPLACE FUNCTION public._restock_traced_fiscal_return(t uuid, sid uuid, rid uuid, riid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE tr public.quote_conversion_stock_trace%ROWTYPE; i public.sale_return_items%ROWTYPE; si public.sale_items%ROWTYPE; actual jsonb; lots jsonb; n numeric; prev numeric; rec record; qty numeric; prior numeric; lot_count int;
BEGIN
 SELECT * INTO STRICT tr FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=sid;
 SELECT * INTO STRICT i FROM public.sale_return_items WHERE tenant_id=t AND id=riid AND return_id=rid;
 SELECT * INTO STRICT si FROM public.sale_items WHERE tenant_id=t AND sale_id=sid AND id=i.sale_item_id;
 SELECT coalesce(jsonb_agg(jsonb_build_array(article_id,site_id,trim_scale(x.qty)) ORDER BY article_id,site_id),'[]') INTO actual FROM (SELECT article_id,site_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid AND reference_type='sale' GROUP BY article_id,site_id) x;
 SELECT coalesce(jsonb_agg(jsonb_build_array(lot_id,article_id,site_id,trim_scale(x.qty)) ORDER BY lot_id,article_id,site_id),'[]') INTO lots FROM (SELECT lot_id,article_id,site_id,sum(quantity) qty FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=sid GROUP BY lot_id,article_id,site_id) x;
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
END $function$;
