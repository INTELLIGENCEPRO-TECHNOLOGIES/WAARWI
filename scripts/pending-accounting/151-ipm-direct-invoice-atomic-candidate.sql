-- 151 : extend the existing candidate RPC; no client-supplied coverage accepted.
-- Clone the checked billing primitive without its early gross-based auto-credit block.
-- The original RPC and permissions are unchanged. Only the private IPM path can use the clone.
DO $p$
DECLARE src text;a integer;b integer;
BEGIN
 src:=pg_get_functiondef('public.create_billing_sale_with_items(jsonb,jsonb,jsonb)'::regprocedure);
 IF strpos(src,'public.apply_credit_to_sale(')=0 THEN RAISE EXCEPTION 'Ancre allocation historique absente';END IF;
 a:=strpos(src,$a$  IF v_customer_id IS NOT NULL
    AND (p_sale->>'status') = 'validated'$a$);
 b:=strpos(src,$a$  RETURN v_sale_id;$a$);
 IF a=0 OR b<=a OR strpos(substr(src,a,b-a),'public.apply_credit_to_sale(')=0 THEN RAISE EXCEPTION 'Ancre allocation historique invalide';END IF;
 src:=substr(src,1,a-1)||substr(src,b);
 IF strpos(src,'public.apply_credit_to_sale(')>0 THEN RAISE EXCEPTION 'Ancre allocation résiduelle';END IF;
 EXECUTE replace(src,'FUNCTION public.create_billing_sale_with_items(','FUNCTION public._create_billing_sale_without_credit_allocation(');
END $p$;
REVOKE ALL ON FUNCTION public._create_billing_sale_without_credit_allocation(jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.create_direct_invoice_atomic(p_tenant_id uuid,p_sale jsonb,p_items jsonb,p_payments jsonb,p_stock_site_id uuid,p_lot_assignments jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE me public.profiles;sid uuid;prior public.sales;payload_hash text;site_id_arg uuid;customer_id_arg uuid;session_id_arg uuid;rep_id uuid;subtotal numeric;gross numeric;realpaid numeric;inv_number text;price jsonb;normalized jsonb;rec record;lot public.stock_lots%ROWTYPE;alloc record;prev numeric;nextq numeric;needed numeric;assigned numeric;method text;neg boolean;day date:=(now() AT TIME ZONE 'Africa/Dakar')::date;rep public.sales_representatives%ROWTYPE;cfg public.rep_commission_settings%ROWTYPE;typ text;base text;rate numeric;fixed numeric;margin numeric;baseval numeric;commission jsonb; p_ipm jsonb; ben public.ipm_beneficiaires%ROWTYPE; cv public.ipm_conventions%ROWTYPE; eligible numeric; ipm_part numeric:=0; patient numeric; rounding numeric; docs jsonb; ipm_id uuid; credit_rec record; credit_result jsonb; patient_due numeric; final_paid numeric;
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
 END IF;
 IF rep_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_representatives WHERE id=rep_id AND tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Représentant inaccessible.' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) z(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric) LEFT JOIN public.articles a ON a.id=z.article_id AND a.tenant_id=p_tenant_id WHERE a.id IS NULL OR z.quantity IS NULL OR z.unit_price IS NULL OR z.quantity<=0 OR z.unit_price<0 OR coalesce(z.discount,0)<0 OR coalesce(z.discount,0)>z.quantity*z.unit_price OR z.quantity::text IN ('NaN','Infinity','-Infinity') OR z.unit_price::text IN ('NaN','Infinity','-Infinity') OR coalesce(z.discount,0)::text IN ('NaN','Infinity','-Infinity') OR nullif(btrim(z.name),'') IS NULL) THEN RAISE EXCEPTION 'Ligne de facture invalide.' USING ERRCODE='22023';END IF;
 PERFORM a.id FROM public.articles a WHERE a.tenant_id=p_tenant_id AND EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) z(article_id uuid) WHERE z.article_id=a.id) ORDER BY a.id FOR SHARE;
 SELECT jsonb_agg(jsonb_build_object('article_id',z.article_id,'name',z.name,'quantity',z.quantity,'unit_price',z.unit_price,'discount',coalesce(z.discount,0),'total',z.quantity*z.unit_price-coalesce(z.discount,0)) ORDER BY ord),sum(z.quantity*z.unit_price-coalesce(z.discount,0))
 INTO normalized,subtotal FROM jsonb_array_elements(p_items) WITH ORDINALITY e(item,ord) CROSS JOIN LATERAL jsonb_to_record(e.item) z(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric);
 price:=public._calculate_sale_price(p_tenant_id,site_id_arg,normalized,0);gross:=(price->>'ttc')::numeric;
 IF gross<=0 OR gross IS DISTINCT FROM (p_sale->>'total')::numeric THEN RAISE EXCEPTION 'Prix TTC à confirmer.' USING ERRCODE='40001';END IF;
 p_ipm:=nullif(p_sale->'ipm','null'::jsonb);
 IF p_ipm IS NOT NULL AND jsonb_typeof(p_ipm)<>'object' THEN RAISE EXCEPTION 'Prise en charge IPM invalide.' USING ERRCODE='22023';END IF;
 patient:=gross;
 -- A registered IPM beneficiary cannot be silently treated as an ordinary customer.
 IF customer_id_arg IS NOT NULL AND EXISTS(SELECT 1 FROM public.ipm_beneficiaires b WHERE b.tenant_id=p_tenant_id AND b.customer_id=customer_id_arg AND b.statut='actif' AND (b.date_debut_couverture IS NULL OR b.date_debut_couverture<=day) AND (b.date_fin_couverture IS NULL OR b.date_fin_couverture>=day)) THEN
  IF p_ipm IS NULL THEN RAISE EXCEPTION 'Confirmez la prise en charge IPM du client.' USING ERRCODE='55000';END IF;
  SELECT * INTO ben FROM public.ipm_beneficiaires b WHERE b.id=(p_ipm->>'beneficiaire_id')::uuid AND b.tenant_id=p_tenant_id AND b.customer_id=customer_id_arg AND b.statut='actif' AND (b.date_debut_couverture IS NULL OR b.date_debut_couverture<=day) AND (b.date_fin_couverture IS NULL OR b.date_fin_couverture>=day) FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.ipm_organismes o WHERE o.id=ben.organisme_id AND o.tenant_id=p_tenant_id AND o.is_active) THEN RAISE EXCEPTION 'Bénéficiaire ou organisme IPM indisponible.' USING ERRCODE='42501';END IF;
  PERFORM 1 FROM public.ipm_organismes o WHERE o.id=ben.organisme_id AND o.tenant_id=p_tenant_id AND o.is_active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organisme IPM indisponible.' USING ERRCODE='42501';END IF;
  SELECT * INTO cv FROM public.ipm_conventions c WHERE c.id=ben.convention_id AND c.tenant_id=p_tenant_id AND c.organisme_id=ben.organisme_id AND c.is_active AND (c.date_debut IS NULL OR c.date_debut<=day) AND (c.date_fin IS NULL OR c.date_fin>=day) FOR SHARE;
  IF NOT FOUND OR cv.taux_defaut NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Convention IPM invalide.' USING ERRCODE='55000';END IF;
  IF public._sale_vat_enabled(p_tenant_id,site_id_arg) OR cv.plafond_jour IS NOT NULL OR cv.plafond_mois IS NOT NULL OR cv.plafond_annuel IS NOT NULL OR ben.plafond_individuel IS NOT NULL OR (cv.application_plafond='avant_calcul' AND cv.plafond_facture IS NOT NULL) THEN RAISE EXCEPTION 'Cette convention IPM nécessite un contrôle spécifique (TVA, remise ou plafond). Aucune facture créée.' USING ERRCODE='55000';END IF;
  docs:=coalesce(nullif(p_ipm->'documents','null'::jsonb),'{}'::jsonb);
  IF jsonb_typeof(docs)<>'object' OR length(coalesce(docs->>'numero_ordonnance',''))>500 OR length(coalesce(docs->>'medecin',''))>500 OR length(coalesce(docs->>'numero_bon',''))>500 THEN RAISE EXCEPTION 'Documents IPM invalides.' USING ERRCODE='22023';END IF;
  IF ((cv.ordonnance_obligatoire OR cv.numero_ordonnance_obligatoire) AND nullif(btrim(coalesce(docs->>'numero_ordonnance','')),'') IS NULL) OR (cv.medecin_prescripteur_obligatoire AND nullif(btrim(coalesce(docs->>'medecin','')),'') IS NULL) OR ((cv.bon_prise_en_charge_obligatoire OR cv.numero_bon_obligatoire) AND nullif(btrim(coalesce(docs->>'numero_bon','')),'') IS NULL) OR (cv.matricule_obligatoire AND nullif(btrim(coalesce(ben.matricule,'')),'') IS NULL) THEN RAISE EXCEPTION 'Documents IPM obligatoires manquants.' USING ERRCODE='22023';END IF;
  SELECT coalesce(sum(i.total) FILTER(WHERE a.ipm_eligible IS NOT FALSE),0) INTO eligible FROM jsonb_to_recordset(normalized) i(article_id uuid,total numeric) JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE true;
  IF cv.mode_calcul NOT IN ('total_facture','ligne_par_ligne','articles_eligibles') OR cv.mode_arrondi NOT IN ('round','floor','ceil','round5','round10','round25','round50','round100') THEN RAISE EXCEPTION 'Règle de calcul IPM inconnue.' USING ERRCODE='55000';END IF;
  rounding:=CASE cv.mode_arrondi WHEN 'round5' THEN 5 WHEN 'round10' THEN 10 WHEN 'round25' THEN 25 WHEN 'round50' THEN 50 WHEN 'round100' THEN 100 ELSE 1 END;
  SELECT coalesce(sum(CASE cv.mode_arrondi WHEN 'floor' THEN floor(x) WHEN 'ceil' THEN ceil(x) ELSE round(x/rounding)*rounding END),0) INTO ipm_part FROM (
   SELECT i.total*cv.taux_defaut/100 x FROM jsonb_to_recordset(normalized) i(article_id uuid,total numeric) JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE a.ipm_eligible IS NOT FALSE AND cv.mode_calcul='ligne_par_ligne'
   UNION ALL SELECT (CASE WHEN cv.mode_calcul='total_facture' THEN gross ELSE eligible END)*cv.taux_defaut/100 WHERE cv.mode_calcul<>'ligne_par_ligne'
  ) vals;
  ipm_part:=greatest(0,least(gross,ipm_part,coalesce(nullif(cv.plafond_facture,0),gross)));patient:=gross-ipm_part;
  IF (p_ipm->>'expected_part_ipm')::numeric IS DISTINCT FROM ipm_part THEN RAISE EXCEPTION 'La part IPM a changé. Vérifiez la répartition avant la validation.' USING ERRCODE='40001';END IF;
 ELSIF p_ipm IS NOT NULL THEN RAISE EXCEPTION 'Aucune couverture IPM active pour ce client.' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_payments) z(amount numeric) WHERE z.amount IS NULL OR z.amount<=0 OR round(z.amount,2)<>z.amount OR z.amount::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Règlement invalide.' USING ERRCODE='22023';END IF;
 SELECT coalesce(sum(z.amount),0) INTO realpaid FROM jsonb_to_recordset(p_payments) z(amount numeric);
 IF realpaid>patient OR (realpaid<gross AND customer_id_arg IS NULL) THEN RAISE EXCEPTION 'Montant payé ou client de la facture invalide.' USING ERRCODE='22023';END IF;
 IF session_id_arg IS NOT NULL AND public._cs_multi_enabled(p_tenant_id) THEN PERFORM public._cs_assert_operational(session_id_arg,p_tenant_id,site_id_arg);END IF;
 SELECT coalesce(settings->>'stock_method','none') INTO method FROM public.tenants WHERE id=p_tenant_id;
 IF method NOT IN ('none','cmup','lot') THEN RAISE EXCEPTION 'Méthode de stock inconnue.' USING ERRCODE='55000';END IF;
 SELECT CASE WHEN x.is_warehouse AND x.parent_site_id IS NOT NULL THEN coalesce(parent.allow_negative_stock,x.allow_negative_stock) ELSE x.allow_negative_stock END INTO neg FROM public.sites x LEFT JOIN public.sites parent ON parent.id=x.parent_site_id AND parent.tenant_id=x.tenant_id WHERE x.id=p_stock_site_id AND x.tenant_id=p_tenant_id AND x.is_active IS NOT FALSE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Dépôt inaccessible.' USING ERRCODE='42501';END IF;
 IF method<>'lot' AND p_lot_assignments<>'{}'::jsonb THEN RAISE EXCEPTION 'Lots non activés.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_lot_assignments) x WHERE jsonb_typeof(x.value)<>'array' OR NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(normalized) z(article_id uuid) JOIN public.articles a ON a.id=z.article_id AND a.tenant_id=p_tenant_id WHERE a.id::text=x.key AND coalesce(a.track_stock,true))) THEN RAISE EXCEPTION 'Affectation de lot invalide.' USING ERRCODE='22023';END IF;
 inv_number:=public.next_doc_number(p_tenant_id,'invoice','F');
 IF ben.id IS NOT NULL THEN
 sid:=public._create_billing_sale_without_credit_allocation(jsonb_build_object('site_id',site_id_arg,'customer_id',customer_id_arg,'sale_number',inv_number,'subtotal',subtotal,'total',gross,'paid',realpaid,'status',CASE WHEN realpaid=gross THEN 'paid' WHEN realpaid>0 THEN 'partial' ELSE 'validated' END,'cash_session_id',session_id_arg,'representative_id',rep_id,'doc_header',p_sale->'doc_header','note',p_sale->>'note'),normalized,p_payments);
 ELSE
 sid:=public.create_billing_sale_with_items(jsonb_build_object('site_id',site_id_arg,'customer_id',customer_id_arg,'sale_number',inv_number,'subtotal',subtotal,'total',gross,'paid',realpaid,'status',CASE WHEN realpaid=gross THEN 'paid' WHEN realpaid>0 THEN 'partial' ELSE 'validated' END,'cash_session_id',session_id_arg,'representative_id',rep_id,'doc_header',p_sale->'doc_header','note',p_sale->>'note'),normalized,p_payments);
 END IF;
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
 IF ben.id IS NOT NULL THEN
  INSERT INTO public.ipm_ventes(tenant_id,organisme_id,beneficiaire_id,convention_id,sale_id,date_vente,part_ipm,part_client,montant_total,part_beneficiaire_payee,statut,numero_ordonnance,medecin_prescripteur,numero_bon_pec,taux_prise_en_charge,montant_eligible,montant_non_eligible,arrondi_applique)
  VALUES(p_tenant_id,ben.organisme_id,ben.id,cv.id,sid,day,ipm_part,patient,gross,realpaid,'en_attente',nullif(docs->>'numero_ordonnance',''),nullif(docs->>'medecin',''),nullif(docs->>'numero_bon',''),cv.taux_defaut,eligible,gross-eligible,cv.mode_arrondi) RETURNING id INTO ipm_id;
  PERFORM public._ipm_capture_new_sale_snapshot(p_tenant_id,sid,ipm_id);
  -- Credit invoices retain the original same-site FIFO automatic credit policy, capped to the patient.
  IF realpaid=0 AND patient>0 THEN
   patient_due:=patient;
   FOR credit_rec IN SELECT id,total-coalesce(credit_used,0) AS available FROM public.sale_returns WHERE tenant_id=p_tenant_id AND site_id=site_id_arg AND customer_id=customer_id_arg AND status='approved' AND refund_method='avoir' AND total>coalesce(credit_used,0) ORDER BY created_at,id FOR UPDATE LOOP
    credit_result:=public.apply_credit_to_sale(credit_rec.id,sid,least(patient_due,credit_rec.available));
    IF (credit_result->>'success')::boolean IS DISTINCT FROM true OR (credit_result->>'applied')::numeric IS NULL THEN RAISE EXCEPTION 'Imputation de l avoir patient non confirmée.' USING ERRCODE='55000';END IF;
    patient_due:=patient_due-(credit_result->>'applied')::numeric;
    EXIT WHEN patient_due<=0;
   END LOOP;
  END IF;
  SELECT coalesce(paid,0) INTO STRICT final_paid FROM public.sales WHERE id=sid AND tenant_id=p_tenant_id;
  IF final_paid>patient THEN RAISE EXCEPTION 'La part organisme a été imputée au patient.' USING ERRCODE='55000';END IF;
 END IF;
 IF customer_id_arg IS NOT NULL THEN PERFORM public.recalculate_customer_balance(customer_id_arg);END IF;
 RETURN jsonb_build_object('sale_id',sid,'sale_number',inv_number,'idempotent',false);
END $f$;
