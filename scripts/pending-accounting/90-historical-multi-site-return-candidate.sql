-- Candidat 90 : restitution par lot et dépôt réellement débités, historique uniquement.
-- Après 64/67/68/71/73/77/80/84/86. Aucun déploiement.
DO $p$
DECLARE src text;a text;b text;n integer;
BEGIN
 src:=pg_get_functiondef('public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean)'::regprocedure);
 a:=$a$v_source_count<>1 OR v_source IS NULL$a$;b:=$b$v_source_count<1 OR v_source IS NULL$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$si.site_id:=v_source;
 END IF;
 IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN$a$;b:=$b$si.site_id:=v_source;
  IF EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(t,sid,si.id) d WHERE public.current_user_can_access_site(d.site_id) IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Un dépôt historique est inaccessible.' USING ERRCODE='42501';END IF;
 END IF;
 IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$   FOR rec IN SELECT a.lot_id,sum(a.quantity) quantity FROM jsonb_to_recordset(chosen) a(lot_id uuid,quantity numeric) GROUP BY a.lot_id ORDER BY a.lot_id LOOP$a$;b:=$b$   IF NOT v_has_trace AND p_restock THEN
    PERFORM 1 FROM public.stock_levels sl WHERE sl.tenant_id=t AND sl.article_id=si.article_id AND EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(t,sid,si.id) d WHERE d.site_id=sl.site_id) ORDER BY sl.article_id,sl.site_id FOR UPDATE;
   END IF;
   FOR rec IN SELECT a.lot_id,sum(a.quantity) quantity FROM jsonb_to_recordset(chosen) a(lot_id uuid,quantity numeric) GROUP BY a.lot_id ORDER BY a.lot_id LOOP$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$l.article_id=si.article_id AND l.site_id=si.site_id;$a$;b:=$b$l.article_id=si.article_id AND ((v_has_trace AND l.site_id=si.site_id) OR (NOT v_has_trace AND EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(t,sid,si.id) d WHERE d.lot_id=l.id AND d.site_id=l.site_id)));$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$UPDATE public.stock_lots SET remaining_quantity=remaining_quantity+rec.quantity WHERE id=rec.lot_id AND tenant_id=t AND article_id=si.article_id AND site_id=si.site_id AND remaining_quantity+rec.quantity<=initial_quantity;$a$;b:=$b$UPDATE public.stock_lots l SET remaining_quantity=l.remaining_quantity+rec.quantity WHERE l.id=rec.lot_id AND l.tenant_id=t AND l.article_id=si.article_id AND ((v_has_trace AND l.site_id=si.site_id) OR (NOT v_has_trace AND EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(t,sid,si.id) d WHERE d.lot_id=l.id AND d.site_id=l.site_id))) AND l.remaining_quantity+rec.quantity<=l.initial_quantity;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$ IF NOT p_restock THEN RETURN;END IF;
 SELECT quantity INTO prev$a$;b:=$b$ IF NOT p_restock THEN RETURN;END IF;
 IF NOT v_has_trace AND jsonb_array_length(options)>0 THEN
  FOR rec IN SELECT l.site_id,sum(a.quantity) quantity FROM public.sale_return_lot_allocations a JOIN public.stock_lots l ON l.id=a.lot_id AND l.tenant_id=t WHERE a.tenant_id=t AND a.return_item_id=riid AND a.restocked GROUP BY l.site_id ORDER BY l.site_id LOOP
   SELECT sl.quantity INTO prev FROM public.stock_levels sl WHERE sl.tenant_id=t AND sl.article_id=si.article_id AND sl.site_id=rec.site_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Stock historique introuvable.' USING ERRCODE='55000';END IF;
   UPDATE public.stock_levels SET quantity=prev+rec.quantity,updated_at=now() WHERE tenant_id=t AND article_id=si.article_id AND site_id=rec.site_id;
   INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(t,si.article_id,rec.site_id,'return_customer',rec.quantity,prev,prev+rec.quantity,'sale_return',rid,auth.uid(),'Retour historique sur vente '||sid::text);
  END LOOP;
  RETURN;
 END IF;
 SELECT quantity INTO prev$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public.save_historical_sale_lot_match(uuid,uuid,jsonb,text)'::regprocedure);
 a:=$a$ IF EXISTS(SELECT 1 FROM public.sale_items i CROSS JOIN LATERAL (
 SELECT d.site_id FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND d.sale_item_id=i.id
 UNION SELECT d.site_id FROM jsonb_to_recordset(p_matches) x(deduction_id uuid,sale_item_id uuid,quantity numeric) JOIN public.sale_lot_deductions d ON d.id=x.deduction_id WHERE x.sale_item_id=i.id
 ) a WHERE i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id GROUP BY i.id HAVING count(DISTINCT a.site_id)>1)
 THEN RAISE EXCEPTION 'Une ligne répartie sur plusieurs dépôts nécessite un rapprochement dédié.' USING ERRCODE='55000';END IF;$a$;b:=$b$ -- Les lignes sans site explicite peuvent être réparties sur les dépôts documentés.$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts save_historical_sale_lot_match(uuid,uuid,jsonb,text): %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public.save_historical_return_lot_match(uuid,jsonb,text,boolean)'::regprocedure);
 a:=$a$(SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,r.sale_id,i.id) d)<>1$a$;b:=$b$(SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,r.sale_id,i.id) d)<1$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts save_historical_return_lot_match(uuid,jsonb,text,boolean): %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public.read_historical_return_lot_matches(uuid,uuid)'::regprocedure);
 a:=$a$(SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,p_sale_id,i.id) d)=1$a$;b:=$b$(SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,p_sale_id,i.id) d)>=1$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts read_historical_return_lot_matches(uuid,uuid): %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
END $p$;
