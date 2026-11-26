-- Candidat à tester exclusivement sur la branche isolée, après 64/67/71.
CREATE OR REPLACE FUNCTION public._historical_return_lot_deductions(t uuid,sid uuid,li uuid)
RETURNS SETOF public.sale_lot_deductions LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $f$
 SELECT d.* FROM public.sale_lot_deductions d
 JOIN public.sale_items i ON i.tenant_id=t AND i.sale_id=sid AND i.id=li AND i.article_id=d.article_id
 WHERE d.tenant_id=t AND d.sale_id=sid AND
 (d.sale_item_id=li OR (d.sale_item_id IS NULL AND (i.site_id IS NULL OR i.site_id=d.site_id)
 AND (SELECT count(*) FROM public.sale_items z WHERE z.tenant_id=t AND z.sale_id=sid AND z.article_id=d.article_id)=1))
$f$;
REVOKE ALL ON FUNCTION public._historical_return_lot_deductions(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._historical_return_stock_site(t uuid,sid uuid,li uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $f$
DECLARE i public.sale_items; s public.sales; n int; source uuid;
BEGIN
 SELECT * INTO STRICT i FROM public.sale_items WHERE tenant_id=t AND sale_id=sid AND id=li;
 SELECT * INTO STRICT s FROM public.sales WHERE tenant_id=t AND id=sid;
 IF EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.article_id=i.article_id AND d.sale_item_id IS NULL) THEN
 RAISE EXCEPTION 'Sorties de lots historiques sans ligne certaine : rapprochement nécessaire.' USING ERRCODE='55000';END IF;
 SELECT count(DISTINCT m.site_id),(array_agg(DISTINCT m.site_id))[1] INTO n,source FROM public.stock_movements m
 WHERE m.tenant_id=t AND m.reference_id=sid AND m.reference_type='sale' AND m.article_id=i.article_id AND m.quantity<0;
 IF i.site_id IS NOT NULL THEN source:=i.site_id;
 ELSIF n>1 THEN RAISE EXCEPTION 'Plusieurs dépôts historiques possibles.' USING ERRCODE='55000';
 ELSIF n=0 THEN source:=s.site_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sites st WHERE st.tenant_id=t AND st.id=source) OR public.current_user_can_access_site(source) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Dépôt historique inaccessible.' USING ERRCODE='42501';END IF;
 RETURN source;
END $f$;
REVOKE ALL ON FUNCTION public._historical_return_stock_site(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE src text; a text; b text; n integer;
BEGIN
src:=pg_get_functiondef('public._return_lot_options(uuid,uuid)'::regprocedure);
a:=$old$FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_item_id=line_id$old$;b:=$new$FROM public._historical_return_lot_deductions(t,(SELECT si.sale_id FROM public.sale_items si WHERE si.id=line_id AND si.tenant_id=t),line_id) d$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _return_lot_options(uuid,uuid): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public.read_fiscal_return_lots(uuid)'::regprocedure);
a:=$old$AND sale_item_id IS NOT NULL) THEN RETURN '{}'::jsonb;END IF;$old$;b:=$new$) THEN RETURN '{}'::jsonb;END IF;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique read_fiscal_return_lots(uuid): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean)'::regprocedure);
a:=$old$FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id;$old$;b:=$new$FROM public._historical_return_lot_deductions(t,sid,si.id) d;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
a:=$old$FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id) IS DISTINCT$old$;b:=$new$FROM public._historical_return_lot_deductions(t,sid,si.id) d) IS DISTINCT$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid)'::regprocedure);
a:=$old$EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id=v_item.id)$old$;b:=$new$EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(v_tenant_id,p_sale_id,v_item.id))$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>2 THEN RAISE EXCEPTION 'Ancre historique _prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid): %',n;END IF;src:=replace(src,a,b);
a:=$old$PERFORM public.adjust_stock(v_item.article, p_site_id, v_item.quantity, 'return_customer', 'Retour ' || v_result.return_number);$old$;b:=$new$PERFORM public.adjust_stock(v_item.article, public._historical_return_stock_site(v_tenant_id,p_sale_id,v_item.id), v_item.quantity, 'return_customer', 'Retour ' || v_result.return_number);$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
a:=$old$v_request_hash bytea;$old$;b:=$new$v_request_hash bytea;
v_stock_site uuid;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id=v_si.id)$old$;b:=$new$EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(v_tenant_id,p_sale_id,v_si.id))$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$IF v_track THEN
SELECT COALESCE(sl.quantity, 0)$old$;b:=$new$IF v_track THEN
v_stock_site:=public._historical_return_stock_site(v_tenant_id,p_sale_id,v_si.id);
SELECT COALESCE(sl.quantity, 0)$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$FROM public.stock_levels sl WHERE sl.article_id = v_si.article_id AND sl.site_id = p_site_id;$old$;b:=$new$FROM public.stock_levels sl WHERE sl.tenant_id=v_tenant_id AND sl.article_id=v_si.article_id AND sl.site_id=v_stock_site FOR UPDATE;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$VALUES (v_tenant_id, v_si.article_id, p_site_id, 0);$old$;b:=$new$VALUES (v_tenant_id,v_si.article_id,v_stock_site,0);$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$WHERE article_id = v_si.article_id AND site_id = p_site_id;$old$;b:=$new$WHERE tenant_id=v_tenant_id AND article_id=v_si.article_id AND site_id=v_stock_site;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$v_tenant_id, v_si.article_id, p_site_id, 'return_customer', v_req_qty,$old$;b:=$new$v_tenant_id,v_si.article_id,v_stock_site,'return_customer',v_req_qty,$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
END $patch$;
