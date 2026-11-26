-- Candidat de correction. Recette isolée exclusivement. Ne pas publier automatiquement.
-- Les définitions existantes sont contrôlées avant toute substitution.
DO $patch$
DECLARE src text; old_text text; new_text text; n integer;
BEGIN
 src:=pg_get_functiondef('public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean)'::regprocedure);
 old_text:=$old$prior_unmapped numeric; prior_physical numeric;$old$; new_text:=$new$prior_unmapped numeric; prior_physical numeric; v_has_trace boolean; v_source_count integer; v_source uuid;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$SELECT * INTO STRICT tr FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=sid;$old$; new_text:=$new$SELECT * INTO tr FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=sid;
 v_has_trace:=FOUND;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF actual IS DISTINCT FROM tr.stock_manifest OR lots IS DISTINCT FROM tr.lot_manifest THEN$old$; new_text:=$new$IF v_has_trace AND (actual IS DISTINCT FROM tr.stock_manifest OR lots IS DISTINCT FROM tr.lot_manifest) THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tr.stock_manifest) x$old$; new_text:=$new$IF v_has_trace AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tr.stock_manifest) x$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN$old$; new_text:=$new$IF NOT v_has_trace THEN
  SELECT count(DISTINCT d.site_id), (array_agg(DISTINCT d.site_id))[1] INTO v_source_count,v_source FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id;
  IF v_source_count<>1 OR v_source IS NULL OR EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id AND d.article_id IS DISTINCT FROM si.article_id) THEN RAISE EXCEPTION 'Origine historique des lots à rapprocher.' USING ERRCODE='55000';END IF;
  si.site_id:=v_source;
 END IF;
 IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
 src:=pg_get_functiondef('public.read_fiscal_return_lots(uuid)'::regprocedure);
 old_text:=$old$IF s.vat_net_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=p_sale_id) THEN RETURN '{}'::jsonb;END IF;$old$; new_text:=$new$PERFORM public._cs_assert_sale_usable(p_sale_id);
 IF NOT EXISTS(SELECT 1 FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=p_sale_id) AND NOT EXISTS(SELECT 1 FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=p_sale_id AND sale_item_id IS NOT NULL) THEN RETURN '{}'::jsonb;END IF;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public.read_fiscal_return_lots(uuid): %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
 src:=pg_get_functiondef('public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid)'::regprocedure);
 old_text:=$old$IF v_traced THEN$old$; new_text:=$new$IF v_traced OR EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id=v_item.id) THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>2 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF p_restock AND v_traced THEN$old$; new_text:=$new$IF p_restock AND (v_traced OR EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id IS NOT NULL)) THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid): %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
 src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 old_text:=$old$v_return_value numeric;$old$; new_text:=$new$v_return_value numeric;
v_return_item uuid;
v_alloc jsonb;
v_use_lot_trace boolean;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$v_return_value
);$old$; new_text:=$new$v_return_value
) RETURNING id INTO v_return_item;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF p_restock AND v_si.article_id IS NOT NULL THEN$old$; new_text:=$new$v_alloc:=v_item->'lots';
v_use_lot_trace:=EXISTS(SELECT 1 FROM public.quote_conversion_stock_trace tr WHERE tr.tenant_id=v_tenant_id AND tr.sale_id=p_sale_id) OR EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id=v_si.id);
IF v_use_lot_trace THEN
 PERFORM public._allocate_traced_fiscal_return(v_tenant_id,p_sale_id,v_return_id,v_return_item,v_alloc,coalesce(p_restock,false));
 UPDATE public.sale_return_items ri SET purchase_cost=a.cost FROM (SELECT sum(x.purchase_price*x.quantity)/nullif(sum(x.quantity),0) cost FROM public.sale_return_lot_allocations x WHERE x.tenant_id=v_tenant_id AND x.return_item_id=v_return_item HAVING sum(x.quantity)>0) a WHERE ri.id=v_return_item AND ri.tenant_id=v_tenant_id;
ELSIF v_alloc IS NOT NULL AND v_alloc<>'[]'::jsonb THEN RAISE EXCEPTION 'Aucun lot vérifiable pour cette ligne.' USING ERRCODE='22023';
ELSIF p_restock AND v_si.article_id IS NOT NULL THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
END $patch$;
