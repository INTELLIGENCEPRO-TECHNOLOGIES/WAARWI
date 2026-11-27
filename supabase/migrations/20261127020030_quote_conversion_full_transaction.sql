CREATE OR REPLACE FUNCTION public.convert_quote_atomic(p_tenant_id uuid,p_quote_id uuid,p_window_id uuid,p_lock_token uuid,p_expected_version text,p_stock_site_id uuid,p_cash_session_id uuid,p_payments jsonb,p_lot_assignments jsonb DEFAULT '{}'::jsonb,p_ipm jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.quotes%ROWTYPE; res jsonb; sid uuid; rec record; lot public.stock_lots%ROWTYPE; alloc record; prev numeric; nextq numeric; cost numeric; needed numeric; assigned numeric; method text; neg boolean; rep public.sales_representatives%ROWTYPE; cfg public.rep_commission_settings%ROWTYPE; typ text; base text; rate numeric; fixed numeric; margin numeric; baseval numeric; commission jsonb; gross numeric; realpaid numeric; ben public.ipm_beneficiaires%ROWTYPE; cv public.ipm_conventions%ROWTYPE; day date:=(now() AT TIME ZONE 'Africa/Dakar')::date; eligible numeric; ipm_part numeric; patient numeric; rounding numeric; docs jsonb; hdr jsonb;
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'quote',p_quote_id::text,p_window_id,p_lock_token);
 SELECT * INTO STRICT q FROM public.quotes WHERE id=p_quote_id AND tenant_id=p_tenant_id FOR UPDATE;
 IF p_lot_assignments IS NULL OR jsonb_typeof(p_lot_assignments)<>'object' THEN RAISE EXCEPTION 'Sélection de lots invalide.' USING ERRCODE='22023';END IF;
 IF p_ipm IS NOT NULL AND jsonb_typeof(p_ipm)<>'object' THEN RAISE EXCEPTION 'Prise en charge IPM invalide.' USING ERRCODE='22023';END IF;
 SELECT coalesce(settings->>'stock_method','none') INTO method FROM public.tenants WHERE id=p_tenant_id;
 IF method NOT IN ('none','cmup','lot') THEN RAISE EXCEPTION 'Méthode de stock inconnue.' USING ERRCODE='55000';END IF;
 SELECT allow_negative_stock INTO neg FROM public.sites WHERE id=p_stock_site_id AND tenant_id=p_tenant_id AND is_active IS NOT FALSE;
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
   cost:=0;
   FOR alloc IN SELECT lot_id,sum(quantity) qty FROM jsonb_to_recordset(p_lot_assignments->rec.article_id::text) x(lot_id uuid,quantity numeric) GROUP BY lot_id ORDER BY lot_id LOOP
    SELECT * INTO lot FROM public.stock_lots WHERE id=alloc.lot_id AND tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=p_stock_site_id FOR UPDATE;
    IF NOT FOUND OR lot.remaining_quantity<alloc.qty OR (lot.expiry_date IS NOT NULL AND lot.expiry_date<day) THEN RAISE EXCEPTION 'Lot insuffisant, périmé ou hors dépôt.' USING ERRCODE='55000';END IF;
    UPDATE public.stock_lots SET remaining_quantity=remaining_quantity-alloc.qty WHERE id=lot.id AND tenant_id=p_tenant_id;
    INSERT INTO public.sale_lot_deductions(tenant_id,sale_id,lot_id,article_id,site_id,quantity) VALUES(p_tenant_id,sid,lot.id,rec.article_id,p_stock_site_id,alloc.qty);
    cost:=cost+alloc.qty*coalesce(lot.purchase_price,0);
   END LOOP;
   UPDATE public.sale_items SET purchase_cost=cost/rec.qty WHERE tenant_id=p_tenant_id AND sale_id=sid AND article_id=rec.article_id;
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
 RETURN res||jsonb_build_object('stock_atomic',true,'part_ipm',ipm_part,'part_client',patient);
END $$;
REVOKE ALL ON FUNCTION public.convert_checked_quote_to_sale(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb),public.convert_quote_atomic(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.convert_quote_atomic(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,jsonb) TO authenticated;

