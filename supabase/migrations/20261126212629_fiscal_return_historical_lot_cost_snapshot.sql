ALTER TABLE public.quote_conversion_stock_trace ADD COLUMN lot_cost_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE OR REPLACE FUNCTION public._return_lot_snapshot_cost(t uuid,sid uuid,li uuid,lid uuid,fallback numeric) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce((SELECT (x->>2)::numeric FROM public.quote_conversion_stock_trace tr CROSS JOIN LATERAL jsonb_array_elements(tr.lot_cost_manifest) x WHERE tr.tenant_id=t AND tr.sale_id=sid AND x->>0=li::text AND x->>1=lid::text LIMIT 1),fallback,0)
$$;
REVOKE ALL ON FUNCTION public._return_lot_snapshot_cost(uuid,uuid,uuid,uuid,numeric) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.convert_quote_atomic(p_tenant_id uuid, p_quote_id uuid, p_window_id uuid, p_lock_token uuid, p_expected_version text, p_stock_site_id uuid, p_cash_session_id uuid, p_payments jsonb, p_lot_assignments jsonb DEFAULT '{}'::jsonb, p_ipm jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE q public.quotes%ROWTYPE; res jsonb; sid uuid; rec record; lot public.stock_lots%ROWTYPE; alloc record; prev numeric; nextq numeric; needed numeric; assigned numeric; method text; neg boolean; rep public.sales_representatives%ROWTYPE; cfg public.rep_commission_settings%ROWTYPE; typ text; base text; rate numeric; fixed numeric; margin numeric; baseval numeric; commission jsonb; gross numeric; realpaid numeric; ben public.ipm_beneficiaires%ROWTYPE; cv public.ipm_conventions%ROWTYPE; day date:=(now() AT TIME ZONE 'Africa/Dakar')::date; eligible numeric; ipm_part numeric; patient numeric; rounding numeric; docs jsonb; hdr jsonb;
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'quote',p_quote_id::text,p_window_id,p_lock_token);
 SELECT * INTO STRICT q FROM public.quotes WHERE id=p_quote_id AND tenant_id=p_tenant_id FOR UPDATE;
 IF p_lot_assignments IS NULL OR jsonb_typeof(p_lot_assignments)<>'object' THEN RAISE EXCEPTION 'Sélection de lots invalide.' USING ERRCODE='22023';END IF;
 IF p_ipm IS NOT NULL AND jsonb_typeof(p_ipm)<>'object' THEN RAISE EXCEPTION 'Prise en charge IPM invalide.' USING ERRCODE='22023';END IF;
 SELECT coalesce(settings->>'stock_method','none') INTO method FROM public.tenants WHERE id=p_tenant_id;
 IF method NOT IN ('none','cmup','lot') THEN RAISE EXCEPTION 'Méthode de stock inconnue.' USING ERRCODE='55000';END IF;
 SELECT CASE WHEN s.is_warehouse AND s.parent_site_id IS NOT NULL THEN coalesce(parent.allow_negative_stock,s.allow_negative_stock) ELSE s.allow_negative_stock END INTO neg
 FROM public.sites s LEFT JOIN public.sites parent ON parent.id=s.parent_site_id AND parent.tenant_id=s.tenant_id
 WHERE s.id=p_stock_site_id AND s.tenant_id=p_tenant_id AND s.is_active IS NOT FALSE;
 IF NOT FOUND OR public.current_user_can_access_site(p_stock_site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Dépôt inaccessible.' USING ERRCODE='42501';END IF;
 IF method<>'lot' AND p_lot_assignments<>'{}'::jsonb THEN RAISE EXCEPTION 'Les lots ne sont pas activés.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_lot_assignments) x WHERE jsonb_typeof(x.value)<>'array' OR NOT EXISTS(SELECT 1 FROM public.quote_items i JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE i.quote_id=q.id AND i.tenant_id=p_tenant_id AND a.id::text=x.key AND coalesce(a.track_stock,true))) THEN RAISE EXCEPTION 'Lot affecté à un article absent du devis ou non suivi.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.quote_items WHERE quote_id=q.id AND tenant_id=p_tenant_id AND nullif(imei,'') IS NOT NULL) THEN RAISE EXCEPTION 'La conversion de lignes avec IMEI nécessite le parcours de traçabilité dédié.' USING ERRCODE='55000';END IF;
 IF p_cash_session_id IS NOT NULL AND public._cs_multi_enabled(p_tenant_id) THEN PERFORM public._cs_assert_operational(p_cash_session_id,p_tenant_id,q.site_id);END IF;
 -- A registered IPM beneficiary cannot be silently treated as an ordinary customer.
 IF q.customer_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ipm_beneficiaires b WHERE b.tenant_id=p_tenant_id AND b.customer_id=q.customer_id AND b.statut='actif' AND (b.date_debut_couverture IS NULL OR b.date_debut_couverture<=day) AND (b.date_fin_couverture IS NULL OR b.date_fin_couverture>=day)) THEN
  IF p_ipm IS NULL THEN RAISE EXCEPTION 'Confirmez la prise en charge IPM du client.' USING ERRCODE='55000';END IF;
  SELECT * INTO ben FROM public.ipm_beneficiaires b WHERE b.id=(p_ipm->>'beneficiaire_id')::uuid AND b.tenant_id=p_tenant_id AND b.customer_id=q.customer_id AND b.statut='actif' AND (b.date_debut_couverture IS NULL OR b.date_debut_couverture<=day) AND (b.date_fin_couverture IS NULL OR b.date_fin_couverture>=day) FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.ipm_organismes o WHERE o.id=ben.organisme_id AND o.tenant_id=p_tenant_id AND o.is_active) THEN RAISE EXCEPTION 'Bénéficiaire ou organisme IPM indisponible.' USING ERRCODE='42501';END IF;
  SELECT * INTO cv FROM public.ipm_conventions c WHERE c.id=ben.convention_id AND c.tenant_id=p_tenant_id AND c.organisme_id=ben.organisme_id AND c.is_active AND (c.date_debut IS NULL OR c.date_debut<=day) AND (c.date_fin IS NULL OR c.date_fin>=day) FOR SHARE;
  IF NOT FOUND OR cv.taux_defaut NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Convention IPM invalide.' USING ERRCODE='55000';END IF;
  IF public._sale_vat_enabled(p_tenant_id,q.site_id) OR coalesce(q.discount,0)<>0 OR cv.plafond_jour IS NOT NULL OR cv.plafond_mois IS NOT NULL OR cv.plafond_annuel IS NOT NULL OR ben.plafond_individuel IS NOT NULL OR (cv.application_plafond='avant_calcul' AND cv.plafond_facture IS NOT NULL) THEN RAISE EXCEPTION 'Cette convention IPM nécessite un contrôle spécifique (TVA, remise ou plafond). Aucune facture créée.' USING ERRCODE='55000';END IF;
  docs:=coalesce(p_ipm->'documents','{}');
  IF ((cv.ordonnance_obligatoire OR cv.numero_ordonnance_obligatoire) AND nullif(btrim(coalesce(docs->>'numero_ordonnance','')),'') IS NULL) OR (cv.medecin_prescripteur_obligatoire AND nullif(btrim(coalesce(docs->>'medecin','')),'') IS NULL) OR ((cv.bon_prise_en_charge_obligatoire OR cv.numero_bon_obligatoire) AND nullif(btrim(coalesce(docs->>'numero_bon','')),'') IS NULL) OR (cv.matricule_obligatoire AND nullif(btrim(coalesce(ben.matricule,'')),'') IS NULL) THEN RAISE EXCEPTION 'Documents IPM obligatoires manquants.' USING ERRCODE='22023';END IF;
  SELECT coalesce(sum(i.total) FILTER(WHERE a.ipm_eligible IS NOT FALSE),0) INTO eligible FROM public.quote_items i JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE i.quote_id=q.id AND i.tenant_id=p_tenant_id;
  IF cv.mode_calcul NOT IN ('total_facture','ligne_par_ligne','articles_eligibles') OR cv.mode_arrondi NOT IN ('round','floor','ceil','round5','round10','round25','round50','round100') THEN RAISE EXCEPTION 'Règle de calcul IPM inconnue.' USING ERRCODE='55000';END IF;
  rounding:=CASE cv.mode_arrondi WHEN 'round5' THEN 5 WHEN 'round10' THEN 10 WHEN 'round25' THEN 25 WHEN 'round50' THEN 50 WHEN 'round100' THEN 100 ELSE 1 END;
  SELECT coalesce(sum(CASE cv.mode_arrondi WHEN 'floor' THEN floor(x) WHEN 'ceil' THEN ceil(x) ELSE round(x/rounding)*rounding END),0) INTO ipm_part FROM (
   SELECT i.total*cv.taux_defaut/100 x FROM public.quote_items i JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE i.quote_id=q.id AND i.tenant_id=p_tenant_id AND a.ipm_eligible IS NOT FALSE AND cv.mode_calcul='ligne_par_ligne'
   UNION ALL SELECT (CASE WHEN cv.mode_calcul='total_facture' THEN q.total ELSE eligible END)*cv.taux_defaut/100 WHERE cv.mode_calcul<>'ligne_par_ligne'
  ) vals;
  ipm_part:=greatest(0,least(q.total,ipm_part,coalesce(nullif(cv.plafond_facture,0),q.total)));patient:=q.total-ipm_part;
  IF (p_ipm->>'expected_part_ipm')::numeric IS DISTINCT FROM ipm_part THEN RAISE EXCEPTION 'La part IPM a changé. Vérifiez la répartition avant la conversion.' USING ERRCODE='40001';END IF;
 ELSIF p_ipm IS NOT NULL THEN RAISE EXCEPTION 'Aucune couverture IPM active pour ce client.' USING ERRCODE='42501';END IF;
 -- Existing checked conversion serializes creation, numbering, initial payment and status.
 -- Its release operation is transactional too: any failure below restores the quote and lease.
 res:=public.convert_checked_quote_to_sale(p_tenant_id,p_quote_id,p_window_id,p_lock_token,p_expected_version,p_stock_site_id,p_cash_session_id,p_payments);
 sid:=(res->>'sale_id')::uuid;
 SELECT total,coalesce(paid,0) INTO gross,realpaid FROM public.sales WHERE id=sid AND tenant_id=p_tenant_id FOR UPDATE;
 IF ben.id IS NOT NULL AND realpaid>patient THEN RAISE EXCEPTION 'Le règlement ou les acomptes dépassent la part du patient.' USING ERRCODE='22023';END IF;
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
   IF assigned IS DISTINCT FROM rec.qty THEN RAISE EXCEPTION 'La quantité affectée aux lots doit correspondre exactement au devis.' USING ERRCODE='22023';END IF;
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
  INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(p_tenant_id,rec.article_id,p_stock_site_id,'sale',-rec.qty,prev,nextq,'sale',sid,auth.uid(),'Facture '||(res->>'sale_number')||' (devis converti)');
 END LOOP;
 -- Calculate the representative commission from server-side settings and actual historical costs.
 IF q.representative_id IS NOT NULL THEN
  SELECT * INTO rep FROM public.sales_representatives WHERE tenant_id=p_tenant_id AND id=q.representative_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Représentant du devis introuvable.' USING ERRCODE='55000';END IF;
  SELECT * INTO cfg FROM public.rep_commission_settings WHERE tenant_id=p_tenant_id;
  IF cfg.enabled IS TRUE THEN
   typ:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN rep.commission_type ELSE cfg.commission_type END;
   base:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN coalesce(rep.commission_base,cfg.commission_base) ELSE cfg.commission_base END;
   rate:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN coalesce(rep.commission_rate,0) ELSE cfg.rate END;
   fixed:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN coalesce(rep.commission_fixed,0) ELSE cfg.fixed_amount END;
   IF typ NOT IN ('pct_ca','fixe','pct_marge') OR base NOT IN ('ht','ttc','net','marge') OR rate<0 OR fixed<0 THEN RAISE EXCEPTION 'Règle de commission invalide.' USING ERRCODE='55000';END IF;
   SELECT q.total-coalesce(sum(quantity*purchase_cost),0) INTO margin FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=sid;
   baseval:=CASE base WHEN 'marge' THEN margin WHEN 'ttc' THEN gross WHEN 'net' THEN q.total ELSE q.total END;
   commission:=jsonb_build_object('type',typ,'base',base,'rate',rate,'fixed_amount',fixed,'base_amount',round(baseval,2),'amount',round(greatest(0,CASE typ WHEN 'fixe' THEN fixed WHEN 'pct_marge' THEN margin*rate/100 ELSE baseval*rate/100 END),2),'computed_at',now());
  END IF;
 END IF;
 hdr:=CASE WHEN q.doc_header IS NULL THEN NULL ELSE (q.doc_header-'doc_date')||jsonb_build_object('doc_date',day::text) END;
 UPDATE public.sales SET representative_id=q.representative_id,rep_commission=commission,doc_header=hdr,status=CASE WHEN coalesce(paid,0)>=total THEN 'paid' WHEN coalesce(paid,0)>0 THEN 'partial' ELSE 'validated' END WHERE id=sid AND tenant_id=p_tenant_id;
 IF ben.id IS NOT NULL THEN
  INSERT INTO public.ipm_ventes(tenant_id,organisme_id,beneficiaire_id,convention_id,sale_id,date_vente,part_ipm,part_client,montant_total,part_beneficiaire_payee,statut,numero_ordonnance,medecin_prescripteur,numero_bon_pec,taux_prise_en_charge,montant_eligible,montant_non_eligible)
  VALUES(p_tenant_id,ben.organisme_id,ben.id,cv.id,sid,day,ipm_part,patient,gross,least(realpaid,patient),'en_attente',nullif(docs->>'numero_ordonnance',''),nullif(docs->>'medecin',''),nullif(docs->>'numero_bon',''),cv.taux_defaut,eligible,q.total-eligible);
  -- The IPM receivable is not a cash payment; keep sales.paid equal to actual payments/credits.
 END IF;
 IF q.customer_id IS NOT NULL THEN PERFORM public.recalculate_customer_balance(q.customer_id);END IF;
 INSERT INTO public.quote_conversion_stock_trace(tenant_id,sale_id,stock_manifest,lot_manifest,lot_cost_manifest)
 SELECT p_tenant_id,sid,(SELECT coalesce(jsonb_agg(jsonb_build_array(article_id,site_id,trim_scale(qty)) ORDER BY article_id,site_id),'[]') FROM (SELECT article_id,site_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=p_tenant_id AND reference_id=sid AND reference_type='sale' GROUP BY article_id,site_id) x),(SELECT coalesce(jsonb_agg(jsonb_build_array(lot_id,article_id,site_id,trim_scale(qty)) ORDER BY lot_id,article_id,site_id),'[]') FROM (SELECT lot_id,article_id,site_id,sum(quantity) qty FROM public.sale_lot_deductions WHERE tenant_id=p_tenant_id AND sale_id=sid GROUP BY lot_id,article_id,site_id) x),
 (SELECT coalesce(jsonb_agg(jsonb_build_array(x.sale_item_id,x.lot_id,x.cost) ORDER BY x.sale_item_id,x.lot_id),'[]') FROM (SELECT DISTINCT d.sale_item_id,d.lot_id,l.purchase_price cost FROM public.sale_lot_deductions d JOIN public.stock_lots l ON l.id=d.lot_id AND l.tenant_id=p_tenant_id WHERE d.tenant_id=p_tenant_id AND d.sale_id=sid) x);
 RETURN res||jsonb_build_object('stock_atomic',true,'part_ipm',ipm_part,'part_client',patient);
END $function$;

CREATE OR REPLACE FUNCTION public._allocate_traced_fiscal_return(t uuid, sid uuid, rid uuid, riid uuid, p_alloc jsonb, p_restock boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    SELECT t,riid,si.id,l.id,rec.quantity,p_restock,public._return_lot_snapshot_cost(t,sid,si.id,l.id,si.purchase_cost) FROM public.stock_lots l WHERE l.id=rec.lot_id AND l.tenant_id=t AND l.article_id=si.article_id AND l.site_id=si.site_id;
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
END $function$;

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
  v_options jsonb;
  v_cost numeric;
  v_available numeric;
  v_lot_count int;
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
    SELECT x->'lots' INTO v_alloc FROM jsonb_array_elements(p_items) x WHERE x->>'sale_item_id'=v_item.id::text AND x ? 'lots' LIMIT 1;
    v_cost:=coalesce(v_item.cost,0);
    IF v_traced THEN
      IF v_alloc IS NULL OR v_alloc='[]' THEN
        v_options:=public._return_lot_options(v_tenant_id,v_item.id);
        SELECT coalesce(sum((x->>'available')::numeric),0),count(*) FILTER(WHERE (x->>'available')::numeric>0) INTO v_available,v_lot_count FROM jsonb_array_elements(v_options) x;
        IF v_lot_count=1 THEN
          SELECT jsonb_agg(jsonb_build_object('lot_id',x->>'lot_id','quantity',v_item.quantity)) INTO v_alloc FROM jsonb_array_elements(v_options) x WHERE (x->>'available')::numeric>0;
        ELSIF v_available=v_item.quantity AND v_lot_count>0 THEN
          SELECT jsonb_agg(jsonb_build_object('lot_id',x->>'lot_id','quantity',(x->>'available')::numeric)) INTO v_alloc FROM jsonb_array_elements(v_options) x WHERE (x->>'available')::numeric>0;
        END IF;
      END IF;
      IF v_alloc IS NOT NULL AND v_alloc<>'[]' THEN
        SELECT coalesce(sum(a.quantity*public._return_lot_snapshot_cost(v_tenant_id,p_sale_id,v_item.id,a.lot_id,v_item.cost))/nullif(sum(a.quantity),0),v_item.cost,0) INTO v_cost FROM jsonb_to_recordset(v_alloc) a(lot_id uuid,quantity numeric);
      END IF;
    END IF;
    INSERT INTO public.sale_return_items (
      tenant_id, return_id, article_id, sale_item_id, name, quantity, unit_price, purchase_cost,
      total, vat_net_amount, vat_amount, vat_rate
    ) VALUES (
      v_tenant_id, v_result.id, v_item.article, v_item.id, v_item.name, v_item.quantity, v_item.price,
      v_cost, v_item.net + v_item.vat, v_item.net, v_item.vat, v_item.rate
    ) RETURNING id INTO v_return_item;
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
