-- Candidat 147. Nouveau parcours ordinaire, non raccordé à l'interface.
-- L'IPM est volontairement exclue de cette première recette jusqu'à séparation des créances.
-- La clé et l'empreinte sont archivées avec sales par le registre existant.
ALTER TABLE public.sales ADD COLUMN billing_create_key uuid, ADD COLUMN billing_create_hash text;
ALTER TABLE public.sales ADD CONSTRAINT billing_create_pair CHECK((billing_create_key IS NULL)=(billing_create_hash IS NULL));
CREATE UNIQUE INDEX billing_create_request_unique ON public.sales(tenant_id,user_id,billing_create_key) WHERE billing_create_key IS NOT NULL;
CREATE FUNCTION public._protect_billing_create_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN
 IF TG_OP='UPDATE' AND OLD.billing_create_key IS NOT NULL AND (OLD.tenant_id,OLD.user_id,OLD.billing_create_key,OLD.billing_create_hash) IS DISTINCT FROM (NEW.tenant_id,NEW.user_id,NEW.billing_create_key,NEW.billing_create_hash) THEN RAISE EXCEPTION 'Identité de création protégée.' USING ERRCODE='42501';END IF;
 IF current_user IN ('anon','authenticated') THEN
  IF TG_OP='INSERT' AND (NEW.billing_create_key IS NOT NULL OR NEW.billing_create_hash IS NOT NULL) THEN RAISE EXCEPTION 'Clé de création réservée au serveur.' USING ERRCODE='42501';END IF;
  IF TG_OP='UPDATE' AND (OLD.billing_create_key,OLD.billing_create_hash) IS DISTINCT FROM (NEW.billing_create_key,NEW.billing_create_hash) THEN RAISE EXCEPTION 'Clé de création réservée au serveur.' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public._protect_billing_create_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_billing_create_identity BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION public._protect_billing_create_identity();

CREATE FUNCTION public.create_direct_invoice_atomic(p_tenant_id uuid,p_sale jsonb,p_items jsonb,p_payments jsonb,p_stock_site_id uuid,p_lot_assignments jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE me public.profiles;sid uuid;prior public.sales;payload_hash text;site_id_arg uuid;customer_id_arg uuid;session_id_arg uuid;rep_id uuid;subtotal numeric;gross numeric;realpaid numeric;inv_number text;price jsonb;normalized jsonb;rec record;lot public.stock_lots%ROWTYPE;alloc record;prev numeric;nextq numeric;needed numeric;assigned numeric;method text;neg boolean;day date:=(now() AT TIME ZONE 'Africa/Dakar')::date;rep public.sales_representatives%ROWTYPE;cfg public.rep_commission_settings%ROWTYPE;typ text;base text;rate numeric;fixed numeric;margin numeric;baseval numeric;commission jsonb;
BEGIN
 me:=public._cr_require_caller();
 IF me.tenant_id IS DISTINCT FROM p_tenant_id OR NOT coalesce(public._cr_profile_has_permission(me.id,'edit_invoices'),false) THEN RAISE EXCEPTION 'Permission de facturation requise.' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL OR jsonb_typeof(p_sale) IS DISTINCT FROM 'object' OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_typeof(p_payments) IS DISTINCT FROM 'array' OR jsonb_typeof(p_lot_assignments) IS DISTINCT FROM 'object' OR p_stock_site_id IS NULL THEN RAISE EXCEPTION 'Demande de facture invalide.' USING ERRCODE='22023';END IF;
 IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 OR jsonb_array_length(p_payments)>50 OR octet_length((p_sale||jsonb_build_object('items',p_items,'payments',p_payments,'lots',p_lot_assignments))::text)>500000 THEN RAISE EXCEPTION 'Demande de facture trop volumineuse.' USING ERRCODE='22023';END IF;
 site_id_arg:=(p_sale->>'site_id')::uuid;customer_id_arg:=nullif(p_sale->>'customer_id','')::uuid;session_id_arg:=nullif(p_sale->>'cash_session_id','')::uuid;rep_id:=nullif(p_sale->>'representative_id','')::uuid;
 IF site_id_arg IS NULL OR public.current_user_can_access_site(site_id_arg) IS DISTINCT FROM true OR public.current_user_can_access_site(p_stock_site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Magasin ou dépôt inaccessible.' USING ERRCODE='42501';END IF;
 payload_hash:=encode(sha256(convert_to(jsonb_build_array(p_sale,p_items,p_payments,p_stock_site_id,p_lot_assignments)::text,'UTF8')),'hex');
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':direct-invoice:'||me.id::text||':'||p_request_id::text,0));
 SELECT * INTO prior FROM public.sales WHERE tenant_id=p_tenant_id AND user_id=me.id AND billing_create_key=p_request_id;
 IF FOUND THEN
  IF prior.billing_create_hash IS DISTINCT FROM payload_hash THEN RAISE EXCEPTION 'Référence de création réutilisée avec un contenu différent.' USING ERRCODE='23505';END IF;
  IF public.current_user_can_access_site(prior.site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Facture inaccessible.' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('sale_id',prior.id,'sale_number',prior.sale_number,'idempotent',true);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sites x WHERE x.id=site_id_arg AND x.tenant_id=p_tenant_id AND x.is_active IS NOT FALSE AND NOT coalesce(x.is_warehouse,false)) THEN RAISE EXCEPTION 'Magasin de facturation invalide.' USING ERRCODE='42501';END IF;
 IF customer_id_arg IS NOT NULL THEN
  PERFORM 1 FROM public.customers c WHERE c.id=customer_id_arg AND c.tenant_id=p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client inaccessible.' USING ERRCODE='42501';END IF;
  IF EXISTS(SELECT 1 FROM public.ipm_beneficiaires b WHERE b.tenant_id=p_tenant_id AND b.customer_id=customer_id_arg AND b.statut='actif' AND (b.date_debut_couverture IS NULL OR b.date_debut_couverture<=day) AND (b.date_fin_couverture IS NULL OR b.date_fin_couverture>=day)) THEN RAISE EXCEPTION 'Facture IPM : parcours spécifique à utiliser.' USING ERRCODE='55000';END IF;
 END IF;
 IF rep_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_representatives WHERE id=rep_id AND tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Représentant inaccessible.' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) z(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric) LEFT JOIN public.articles a ON a.id=z.article_id AND a.tenant_id=p_tenant_id WHERE a.id IS NULL OR z.quantity IS NULL OR z.unit_price IS NULL OR z.quantity<=0 OR z.unit_price<0 OR coalesce(z.discount,0)<0 OR coalesce(z.discount,0)>z.quantity*z.unit_price OR z.quantity::text IN ('NaN','Infinity','-Infinity') OR z.unit_price::text IN ('NaN','Infinity','-Infinity') OR coalesce(z.discount,0)::text IN ('NaN','Infinity','-Infinity') OR nullif(btrim(z.name),'') IS NULL) THEN RAISE EXCEPTION 'Ligne de facture invalide.' USING ERRCODE='22023';END IF;
 PERFORM a.id FROM public.articles a WHERE a.tenant_id=p_tenant_id AND EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) z(article_id uuid) WHERE z.article_id=a.id) ORDER BY a.id FOR SHARE;
 SELECT jsonb_agg(jsonb_build_object('article_id',z.article_id,'name',z.name,'quantity',z.quantity,'unit_price',z.unit_price,'discount',coalesce(z.discount,0),'total',z.quantity*z.unit_price-coalesce(z.discount,0)) ORDER BY ord),sum(z.quantity*z.unit_price-coalesce(z.discount,0))
 INTO normalized,subtotal FROM jsonb_array_elements(p_items) WITH ORDINALITY e(item,ord) CROSS JOIN LATERAL jsonb_to_record(e.item) z(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric);
 price:=public._calculate_sale_price(p_tenant_id,site_id_arg,normalized,0);gross:=(price->>'ttc')::numeric;
 IF gross<=0 OR gross IS DISTINCT FROM (p_sale->>'total')::numeric THEN RAISE EXCEPTION 'Prix TTC à confirmer.' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_payments) z(amount numeric) WHERE z.amount IS NULL OR z.amount<=0 OR round(z.amount,2)<>z.amount OR z.amount::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Règlement invalide.' USING ERRCODE='22023';END IF;
 SELECT coalesce(sum(z.amount),0) INTO realpaid FROM jsonb_to_recordset(p_payments) z(amount numeric);
 IF realpaid>gross OR (realpaid<gross AND customer_id_arg IS NULL) THEN RAISE EXCEPTION 'Montant payé ou client de la facture invalide.' USING ERRCODE='22023';END IF;
 IF session_id_arg IS NOT NULL AND public._cs_multi_enabled(p_tenant_id) THEN PERFORM public._cs_assert_operational(session_id_arg,p_tenant_id,site_id_arg);END IF;
 SELECT coalesce(settings->>'stock_method','none') INTO method FROM public.tenants WHERE id=p_tenant_id;
 IF method NOT IN ('none','cmup','lot') THEN RAISE EXCEPTION 'Méthode de stock inconnue.' USING ERRCODE='55000';END IF;
 SELECT CASE WHEN x.is_warehouse AND x.parent_site_id IS NOT NULL THEN coalesce(parent.allow_negative_stock,x.allow_negative_stock) ELSE x.allow_negative_stock END INTO neg FROM public.sites x LEFT JOIN public.sites parent ON parent.id=x.parent_site_id AND parent.tenant_id=x.tenant_id WHERE x.id=p_stock_site_id AND x.tenant_id=p_tenant_id AND x.is_active IS NOT FALSE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dépôt inaccessible.' USING ERRCODE='42501';END IF;
 IF method<>'lot' AND p_lot_assignments<>'{}'::jsonb THEN RAISE EXCEPTION 'Lots non activés.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_lot_assignments) x WHERE jsonb_typeof(x.value)<>'array' OR NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(normalized) z(article_id uuid) JOIN public.articles a ON a.id=z.article_id AND a.tenant_id=p_tenant_id WHERE a.id::text=x.key AND coalesce(a.track_stock,true))) THEN RAISE EXCEPTION 'Affectation de lot invalide.' USING ERRCODE='22023';END IF;
 inv_number:=public.next_doc_number(p_tenant_id,'invoice','F');
 sid:=public.create_billing_sale_with_items(jsonb_build_object('site_id',site_id_arg,'customer_id',customer_id_arg,'sale_number',inv_number,'subtotal',subtotal,'total',gross,'paid',realpaid,'status',CASE WHEN realpaid=gross THEN 'paid' WHEN realpaid>0 THEN 'partial' ELSE 'validated' END,'cash_session_id',session_id_arg,'representative_id',rep_id,'doc_header',p_sale->'doc_header','note',p_sale->>'note'),normalized,p_payments);
 -- Freeze article and stock source on the invoice; do not deduct untracked services.
 UPDATE public.sale_items SET site_id=p_stock_site_id WHERE tenant_id=p_tenant_id AND sale_id=sid;
 FOR rec IN SELECT i.article_id,sum(i.quantity) qty FROM public.sale_items i JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE i.sale_id=sid AND i.tenant_id=p_tenant_id AND coalesce(a.track_stock,true) GROUP BY i.article_id ORDER BY i.article_id LOOP
  INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(p_tenant_id,rec.article_id,p_stock_site_id,0) ON CONFLICT(article_id,site_id) DO NOTHING;
  SELECT coalesce(quantity,0) INTO STRICT prev FROM public.stock_levels WHERE tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=p_stock_site_id FOR UPDATE;
  nextq:=prev-rec.qty;
  IF nextq<0 AND (method='lot' OR neg IS NOT TRUE) THEN RAISE EXCEPTION 'Stock insuffisant dans le dépôt de sortie.' USING ERRCODE='55000';END IF;
  IF method='lot' THEN
   IF NOT (p_lot_assignments ? rec.article_id::text) OR jsonb_array_length(p_lot_assignments->rec.article_id::text)=0 THEN RAISE EXCEPTION 'Sélectionnez les lots pour chaque article suivi.' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_lot_assignments->rec.article_id::text) x(lot_id uuid,quantity numeric) WHERE lot_id IS NULL OR quantity IS NULL OR quantity<=0 OR quantity::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Quantités de lots invalides.' USING ERRCODE='22023';END IF;
   SELECT sum(quantity) INTO assigned FROM jsonb_to_recordset(p_lot_assignments->rec.article_id::text) x(lot_id uuid,quantity numeric);
   IF assigned IS DISTINCT FROM rec.qty THEN RAISE EXCEPTION 'La quantité affectée aux lots doit correspondre exactement à la facture.' USING ERRCODE='22023';END IF;
   needed:=0;
   FOR alloc IN SELECT lot_id,sum(quantity) qty FROM jsonb_to_recordset(p_lot_assignments->rec.article_id::text) x(lot_id uuid,quantity numeric) GROUP BY lot_id ORDER BY lot_id LOOP
    SELECT * INTO lot FROM public.stock_lots WHERE id=alloc.lot_id AND tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=p_stock_site_id FOR UPDATE;
    IF NOT FOUND OR lot.remaining_quantity<alloc.qty OR (lot.expiry_date IS NOT NULL AND lot.expiry_date<day) THEN RAISE EXCEPTION 'Lot insuffisant, périmé ou hors dépôt.' USING ERRCODE='55000';END IF;
    UPDATE public.stock_lots SET remaining_quantity=remaining_quantity-alloc.qty WHERE id=lot.id AND tenant_id=p_tenant_id;
    -- Allocate each consumed lot across the exact invoice lines; repeated article lines share one stock reservation.
    INSERT INTO public.sale_lot_deductions(tenant_id,sale_id,sale_item_id,lot_id,article_id,site_id,quantity)
    WITH ordered AS (SELECT i.id,i.quantity,sum(i.quantity) OVER(ORDER BY i.id ROWS UNBOUNDED PRECEDING) AS end_qty FROM public.sale_items i WHERE i.tenant_id=p_tenant_id AND i.sale_id=sid AND i.article_id=rec.article_id),
    portions AS (SELECT id,greatest(0,least(end_qty,needed+alloc.qty)-greatest(end_qty-quantity,needed)) qty FROM ordered)
    SELECT p_tenant_id,sid,id,lot.id,rec.article_id,p_stock_site_id,qty FROM portions WHERE qty>0;
    needed:=needed+alloc.qty;
   END LOOP;
   UPDATE public.sale_items i SET purchase_cost=c.weighted_cost FROM (
    SELECT d.sale_item_id,sum(d.quantity*l.purchase_price)/sum(d.quantity) weighted_cost FROM public.sale_lot_deductions d JOIN public.stock_lots l ON l.id=d.lot_id AND l.tenant_id=p_tenant_id
    WHERE d.tenant_id=p_tenant_id AND d.sale_id=sid AND d.article_id=rec.article_id GROUP BY d.sale_item_id
   ) c WHERE i.id=c.sale_item_id AND i.tenant_id=p_tenant_id AND i.sale_id=sid;
  END IF;
  UPDATE public.stock_levels SET quantity=nextq,updated_at=now() WHERE tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=p_stock_site_id;
  INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(p_tenant_id,rec.article_id,p_stock_site_id,'sale',-rec.qty,prev,nextq,'sale',sid,auth.uid(),'Facture '||inv_number);
 END LOOP;

 -- Calculate the representative commission from server-side settings and actual historical costs.
 IF rep_id IS NOT NULL THEN
  SELECT * INTO rep FROM public.sales_representatives WHERE tenant_id=p_tenant_id AND id=rep_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Représentant du devis introuvable.' USING ERRCODE='55000';END IF;
  SELECT * INTO cfg FROM public.rep_commission_settings WHERE tenant_id=p_tenant_id;
  IF cfg.enabled IS TRUE THEN
   typ:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN rep.commission_type ELSE cfg.commission_type END;
   base:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN coalesce(rep.commission_base,cfg.commission_base) ELSE cfg.commission_base END;
   rate:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN coalesce(rep.commission_rate,0) ELSE cfg.rate END;
   fixed:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN coalesce(rep.commission_fixed,0) ELSE cfg.fixed_amount END;
   IF typ NOT IN ('pct_ca','fixe','pct_marge') OR base NOT IN ('ht','ttc','net','marge') OR rate<0 OR fixed<0 THEN RAISE EXCEPTION 'Règle de commission invalide.' USING ERRCODE='55000';END IF;
   SELECT subtotal-coalesce(sum(quantity*purchase_cost),0) INTO margin FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=sid;
   baseval:=CASE base WHEN 'marge' THEN margin WHEN 'ttc' THEN gross WHEN 'net' THEN subtotal ELSE subtotal END;
   commission:=jsonb_build_object('type',typ,'base',base,'rate',rate,'fixed_amount',fixed,'base_amount',round(baseval,2),'amount',round(greatest(0,CASE typ WHEN 'fixe' THEN fixed WHEN 'pct_marge' THEN margin*rate/100 ELSE baseval*rate/100 END),2),'computed_at',now());
  END IF;
 END IF;

 UPDATE public.sales SET rep_commission=commission,billing_create_key=p_request_id,billing_create_hash=payload_hash WHERE id=sid AND tenant_id=p_tenant_id;
 INSERT INTO public.quote_conversion_stock_trace(tenant_id,sale_id,stock_manifest,lot_manifest,lot_cost_manifest)
 SELECT p_tenant_id,sid,(SELECT coalesce(jsonb_agg(jsonb_build_array(article_id,site_id,trim_scale(qty)) ORDER BY article_id,site_id),'[]') FROM (SELECT article_id,site_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=p_tenant_id AND reference_id=sid AND reference_type='sale' GROUP BY article_id,site_id) x),(SELECT coalesce(jsonb_agg(jsonb_build_array(lot_id,article_id,site_id,trim_scale(qty)) ORDER BY lot_id,article_id,site_id),'[]') FROM (SELECT lot_id,article_id,site_id,sum(quantity) qty FROM public.sale_lot_deductions WHERE tenant_id=p_tenant_id AND sale_id=sid GROUP BY lot_id,article_id,site_id) x),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(x.sale_item_id,x.lot_id,x.cost) ORDER BY x.sale_item_id,x.lot_id),'[]') FROM (SELECT DISTINCT d.sale_item_id,d.lot_id,l.purchase_price cost FROM public.sale_lot_deductions d JOIN public.stock_lots l ON l.id=d.lot_id AND l.tenant_id=p_tenant_id WHERE d.tenant_id=p_tenant_id AND d.sale_id=sid) x);
 IF customer_id_arg IS NOT NULL THEN PERFORM public.recalculate_customer_balance(customer_id_arg);END IF;
 RETURN jsonb_build_object('sale_id',sid,'sale_number',inv_number,'idempotent',false);
END $f$;
REVOKE ALL ON FUNCTION public.create_direct_invoice_atomic(uuid,jsonb,jsonb,jsonb,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.create_direct_invoice_atomic(uuid,jsonb,jsonb,jsonb,uuid,jsonb,uuid) TO authenticated;
