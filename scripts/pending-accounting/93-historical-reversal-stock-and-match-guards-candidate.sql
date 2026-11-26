-- Candidat 93 : annulation/suppression historique, regroupement par article/dépôt, verrous et protection des rapprochements.
-- Recette uniquement après 64/67/68/71/73/80. Le moteur de restauration des conversions tracées est conservé.
CREATE FUNCTION public._restore_historical_sale_stock(t uuid,sid uuid,p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $f$
DECLARE art record; d record; z record; plan jsonb:='[]'; prior numeric; expected numeric; lot_qty numeric; movement_qty numeric;
BEGIN
 IF p_kind NOT IN ('sale_cancel','sale_delete') THEN RAISE EXCEPTION 'Type de restauration invalide.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.sale_lot_deductions sd LEFT JOIN public.sale_items si ON si.tenant_id=t AND si.sale_id=sid AND si.article_id=sd.article_id WHERE sd.tenant_id=t AND sd.sale_id=sid AND (si.id IS NULL OR sd.quantity<=0 OR sd.quantity::text IN ('NaN','Infinity','-Infinity'))) THEN RAISE EXCEPTION 'Sortie historique incohérente.' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND NOT EXISTS(SELECT 1 FROM public.sale_items i WHERE i.tenant_id=t AND i.sale_id=sid AND i.article_id=m.article_id)) THEN RAISE EXCEPTION 'Mouvement sans article de vente.' USING ERRCODE='55000';END IF;
 FOR art IN SELECT si.article_id,sum(si.quantity) quantity,bool_or(coalesce(a.track_stock,false)) tracked
  FROM public.sale_items si LEFT JOIN public.articles a ON a.id=si.article_id AND a.tenant_id=t
  WHERE si.tenant_id=t AND si.sale_id=sid AND si.article_id IS NOT NULL GROUP BY si.article_id ORDER BY si.article_id LOOP
  expected:=art.quantity;
  SELECT coalesce(sum(sd.quantity),0) INTO lot_qty FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid AND sd.article_id=art.article_id;
  SELECT coalesce(-sum(m.quantity),0) INTO movement_qty FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id;
  IF NOT art.tracked AND lot_qty=0 AND movement_qty=0 THEN CONTINUE;END IF;
  IF expected<=0 OR expected::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Quantité historique invalide.' USING ERRCODE='55000';END IF;
  IF lot_qty>0 AND lot_qty<>expected THEN RAISE EXCEPTION 'Sorties de lots partielles : rapprochement requis avant annulation ou suppression.' USING ERRCODE='55000';END IF;
  IF EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id) THEN
   IF movement_qty<>expected OR EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id AND m.quantity>=0) THEN RAISE EXCEPTION 'Mouvements historiques incomplets ou contradictoires.' USING ERRCODE='55000';END IF;
   IF lot_qty>0 AND EXISTS(
     SELECT 1 FROM (SELECT m.site_id,-sum(m.quantity) qty FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id GROUP BY m.site_id) m
     FULL JOIN (SELECT sd.site_id,sum(sd.quantity) qty FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid AND sd.article_id=art.article_id GROUP BY sd.site_id) l USING(site_id)
     WHERE m.qty IS DISTINCT FROM l.qty) THEN RAISE EXCEPTION 'Lots et mouvements historiques incompatibles.' USING ERRCODE='55000';END IF;
   FOR z IN SELECT m.site_id,-sum(m.quantity) qty FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id GROUP BY m.site_id LOOP
    plan:=plan||jsonb_build_array(jsonb_build_object('article_id',art.article_id,'site_id',z.site_id,'quantity',z.qty));
   END LOOP;
  ELSIF lot_qty>0 THEN
   FOR z IN SELECT sd.site_id,sum(sd.quantity) qty FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid AND sd.article_id=art.article_id GROUP BY sd.site_id LOOP
    plan:=plan||jsonb_build_array(jsonb_build_object('article_id',art.article_id,'site_id',z.site_id,'quantity',z.qty));
   END LOOP;
  ELSE
   FOR z IN SELECT public._historical_return_stock_site(t,sid,si.id) site_id,si.quantity qty FROM public.sale_items si WHERE si.tenant_id=t AND si.sale_id=sid AND si.article_id=art.article_id LOOP
    plan:=plan||jsonb_build_array(jsonb_build_object('article_id',art.article_id,'site_id',z.site_id,'quantity',z.qty));
   END LOOP;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(plan) p(article_id uuid,site_id uuid,quantity numeric)
 LEFT JOIN public.sites st ON st.id=p.site_id AND st.tenant_id=t
 LEFT JOIN public.stock_levels sl ON sl.tenant_id=t AND sl.article_id=p.article_id AND sl.site_id=p.site_id
 WHERE st.id IS NULL OR sl.article_id IS NULL OR public.current_user_can_access_site(p.site_id) IS DISTINCT FROM true OR p.quantity<=0)
 THEN RAISE EXCEPTION 'Stock ou dépôt historique introuvable ou inaccessible.' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.stock_levels sl WHERE sl.tenant_id=t AND EXISTS(SELECT 1 FROM jsonb_to_recordset(plan) p(article_id uuid,site_id uuid,quantity numeric) WHERE p.article_id=sl.article_id AND p.site_id=sl.site_id) ORDER BY sl.article_id,sl.site_id FOR UPDATE;
 PERFORM 1 FROM public.stock_lots l WHERE l.tenant_id=t AND EXISTS(SELECT 1 FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid AND sd.lot_id=l.id) ORDER BY l.article_id,l.site_id,l.id FOR UPDATE;
 FOR d IN SELECT sd.lot_id,sd.article_id,sd.site_id,sum(sd.quantity) qty FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid GROUP BY sd.lot_id,sd.article_id,sd.site_id ORDER BY sd.article_id,sd.site_id,sd.lot_id LOOP
  UPDATE public.stock_lots l SET remaining_quantity=l.remaining_quantity+d.qty WHERE l.id=d.lot_id AND l.tenant_id=t AND l.article_id=d.article_id AND l.site_id=d.site_id AND l.remaining_quantity+d.qty<=l.initial_quantity;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot historique incohérent.' USING ERRCODE='55000';END IF;
 END LOOP;
 FOR z IN SELECT p.article_id,p.site_id,sum(p.quantity) qty FROM jsonb_to_recordset(plan) p(article_id uuid,site_id uuid,quantity numeric) GROUP BY p.article_id,p.site_id ORDER BY p.article_id,p.site_id LOOP
  SELECT sl.quantity INTO STRICT prior FROM public.stock_levels sl WHERE sl.tenant_id=t AND sl.article_id=z.article_id AND sl.site_id=z.site_id FOR UPDATE;
  UPDATE public.stock_levels SET quantity=prior+z.qty,updated_at=now() WHERE tenant_id=t AND article_id=z.article_id AND site_id=z.site_id;
  INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note)
  VALUES(t,z.article_id,z.site_id,'adjustment',z.qty,prior,prior+z.qty,p_kind,sid,auth.uid(),'Restauration historique '||sid::text);
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION public._restore_historical_sale_stock(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._guard_historical_matched_sale_rows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE t uuid;s uuid;a uuid;new_t uuid;new_s uuid;new_a uuid;
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN RETURN NEW;END IF;
 IF TG_OP<>'INSERT' THEN t:=OLD.tenant_id;s:=OLD.sale_id;a:=OLD.article_id;END IF;
 IF TG_OP<>'DELETE' THEN new_t:=NEW.tenant_id;new_s:=NEW.sale_id;new_a:=NEW.article_id;END IF;
 IF EXISTS(SELECT 1 FROM public.historical_sale_lot_matches m JOIN public.sale_lot_deductions d ON d.id=m.deduction_id AND d.tenant_id=m.tenant_id WHERE (d.tenant_id=t AND d.sale_id=s AND d.article_id=a) OR (d.tenant_id=new_t AND d.sale_id=new_s AND d.article_id=new_a)) THEN
  RAISE EXCEPTION 'Historique rapproché : les lignes et sorties d’origine ne peuvent plus être réécrites. Utilisez le parcours de correction.' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public._guard_historical_matched_sale_rows() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_historical_matched_sale_item BEFORE INSERT OR UPDATE OR DELETE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION public._guard_historical_matched_sale_rows();
CREATE TRIGGER trg_historical_matched_deduction BEFORE INSERT OR UPDATE OR DELETE ON public.sale_lot_deductions FOR EACH ROW EXECUTE FUNCTION public._guard_historical_matched_sale_rows();
DO $p$
DECLARE src text; fn text; a text;b text;n int; start_at int;end_at int;kind text;tail text;
BEGIN
 FOREACH fn IN ARRAY ARRAY['cancel_sale(uuid,uuid,text,text,uuid)','delete_sale_and_recalculate(uuid,uuid,text)'] LOOP
  src:=pg_get_functiondef(('public.'||fn)::regprocedure);
  a:=$a$PERFORM public.assert_tenant_access(p_tenant_id);$a$;
  b:=$b$PERFORM public.assert_tenant_access(p_tenant_id);
PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':edit:sale:'||p_sale_id::text,0));
IF EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=p_tenant_id AND resource_type='sale' AND resource_key=p_sale_id::text AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Vente en cours de modification.' USING ERRCODE='55000';END IF;$b$;
  n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre annulation/suppression : %',fn;END IF;src:=replace(src,a,b);
  IF fn LIKE 'cancel_sale%' THEN kind:='sale_cancel';tail:=E'END IF;\n\n-- Remboursement espèces : mouvement de caisse';ELSE kind:='sale_delete';tail:=E'END IF;\n\nINSERT INTO sale_deletion_log';END IF;
  a:='IF NOT public._restore_converted_sale_stock(v_tenant_id,p_sale_id,'||quote_literal(kind)||') THEN';
  start_at:=position(a in src);end_at:=position(tail in src);
  IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'Bloc restauration inattendu : %',fn;END IF;
  b:=a||E'\n PERFORM public._restore_historical_sale_stock(v_tenant_id,p_sale_id,'||quote_literal(kind)||E');\n';
  src:=substring(src from 1 for start_at-1)||b||substring(src from end_at);
  IF kind='sale_delete' THEN
   a:=$a$IF v_sale.status = 'cancelled' THEN$a$;
   b:=$b$IF v_sale.sale_number IS NULL AND EXISTS(SELECT 1 FROM public.historical_sale_lot_matches m JOIN public.sale_lot_deductions d ON d.id=m.deduction_id AND d.tenant_id=m.tenant_id WHERE m.tenant_id=v_tenant_id AND d.sale_id=p_sale_id) THEN RETURN jsonb_build_object('success',false,'error','Historique rapproché : utilisez une annulation conservant les justificatifs.');END IF;
IF v_sale.status = 'cancelled' THEN$b$;
   n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre suppression physique inattendue';END IF;src:=replace(src,a,b);
  END IF;
  EXECUTE src;
 END LOOP;
 src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 a:=$a$IF p_request_id IS NOT NULL THEN
IF btrim(p_request_id)=''$a$;
 b:=$b$PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text||':edit:sale:'||p_sale_id::text,0));
IF EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=v_tenant_id AND resource_type='sale' AND resource_key=p_sale_id::text AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Vente en cours de modification.' USING ERRCODE='55000';END IF;
IF p_request_id IS NOT NULL THEN
IF btrim(p_request_id)=''$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre verrou retour historique inattendue';END IF;EXECUTE replace(src,a,b);
END $p$;
