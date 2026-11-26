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
 RETURN res||jsonb_build_object('stock_atomic',true,'part_ipm',ipm_part,'part_client',patient);
END $function$;

CREATE OR REPLACE FUNCTION public.save_locked_invoice_edit(p_tenant_id uuid, p_sale_id uuid, p_window_id uuid, p_lock_token uuid, p_expected_version text, p_items jsonb, p_customer_id uuid, p_doc_header jsonb, p_representative_id uuid, p_rep_commission jsonb, p_release boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.sales%ROWTYPE;snap jsonb; old_lines jsonb;new_lines jsonb;lines_changed boolean; quantities_changed boolean; total_new numeric; stock_site uuid; site_count integer; rec record; old_costs jsonb; prior_qty numeric; next_qty numeric; cid uuid; lease_result jsonb;
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'sale',p_sale_id::text,p_window_id,p_lock_token);
 PERFORM public._cs_assert_sale_usable(p_sale_id);
 SELECT * INTO s FROM public.sales WHERE tenant_id=p_tenant_id AND id=p_sale_id FOR UPDATE;
 IF NOT FOUND OR s.source IS DISTINCT FROM 'billing' OR s.accounting_status IS DISTINCT FROM 'not_accounted' OR s.status IN ('cancelled','deleted') OR s.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Cette facture ne peut plus être modifiée.' USING ERRCODE='55000';END IF;
 PERFORM public._document_edit_access(p_tenant_id,'sale',p_sale_id::text);
 PERFORM 1 FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id ORDER BY id FOR UPDATE;
 snap:=public._invoice_edit_snapshot(p_tenant_id,p_sale_id);
 IF p_expected_version IS NULL OR snap->>'version' IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'La facture a changé depuis votre ouverture. Rechargez-la avant de reprendre la saisie.' USING ERRCODE='40001';END IF;
 IF p_doc_header IS NOT NULL AND jsonb_typeof(p_doc_header)<>'object' THEN RAISE EXCEPTION 'Informations de facture invalides.' USING ERRCODE='22023';END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Au moins une ligne valide est nécessaire.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric)
 LEFT JOIN public.articles a ON a.id=x.article_id AND a.tenant_id=p_tenant_id
 WHERE a.id IS NULL OR (a.site_id IS NOT NULL AND public.current_user_can_access_site(a.site_id) IS DISTINCT FROM true) OR x.name IS NULL OR btrim(x.name)='' OR x.quantity IS NULL OR x.quantity<=0 OR x.unit_price IS NULL OR x.unit_price<0 OR coalesce(x.discount,0)<0 OR coalesce(x.discount,0)>x.quantity*x.unit_price OR x.quantity::text IN ('NaN','Infinity','-Infinity') OR x.unit_price::text IN ('NaN','Infinity','-Infinity') OR coalesce(x.discount,0)::text IN ('NaN','Infinity','-Infinity'))
 THEN RAISE EXCEPTION 'Vérifiez les articles, quantités, prix et remises.' USING ERRCODE='22023';END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=p_customer_id AND c.tenant_id=p_tenant_id AND (c.site_id IS NULL OR c.site_id=s.site_id OR public.current_user_can_access_site(c.site_id))) THEN RAISE EXCEPTION 'Client indisponible.' USING ERRCODE='42501';END IF;
 IF p_representative_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_representatives r WHERE r.id=p_representative_id AND r.tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Représentant indisponible.' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO old_lines FROM (SELECT jsonb_build_array(article_id,name,trim_scale(quantity),trim_scale(unit_price),trim_scale(coalesce(discount,0))) v FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id) q;
 SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO new_lines FROM (SELECT jsonb_build_array(article_id,name,trim_scale(quantity),trim_scale(unit_price),trim_scale(coalesce(discount,0))) v FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric)) q;
 lines_changed:=old_lines IS DISTINCT FROM new_lines;
 IF (s.vat_enabled_at_issue OR s.vat_net_amount IS NOT NULL) AND (lines_changed OR s.customer_id IS DISTINCT FROM p_customer_id) THEN RAISE EXCEPTION 'Utilisez un avoir pour corriger une facture émise avec TVA.' USING ERRCODE='55000';END IF;
 IF (lines_changed OR s.customer_id IS DISTINCT FROM p_customer_id) AND (EXISTS(SELECT 1 FROM public.sale_returns WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id) OR EXISTS(SELECT 1 FROM public.ipm_ventes WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id)) THEN RAISE EXCEPTION 'La facture comporte un retour ou une prise en charge IPM. Utilisez le parcours de correction dédié.' USING ERRCODE='55000';END IF;
 IF s.customer_id IS DISTINCT FROM p_customer_id AND coalesce(s.paid,0)>0 THEN RAISE EXCEPTION 'Le client d’une facture déjà réglée ne peut pas être remplacé directement.' USING ERRCODE='55000';END IF;
 IF lines_changed THEN
  IF EXISTS(SELECT 1 FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id HAVING count(DISTINCT coalesce(purchase_cost,0))>1) THEN RAISE EXCEPTION 'Coûts historiques différents pour un même article. Utilisez un avoir ou un parcours de correction adapté.' USING ERRCODE='55000';END IF;
  IF coalesce(s.discount,0)<>0 OR EXISTS(SELECT 1 FROM public.sale_lot_deductions WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id) OR EXISTS(SELECT 1 FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id AND nullif(imei,'') IS NOT NULL) THEN RAISE EXCEPTION 'Cette facture comporte une remise globale, des lots ou des IMEI. Utilisez un avoir ou un parcours de correction adapté.' USING ERRCODE='55000';END IF;
  SELECT sum(round(quantity*unit_price-coalesce(discount,0),2)) INTO total_new FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric);
  IF total_new<coalesce(s.paid,0) OR (total_new>coalesce(s.paid,0) AND p_customer_id IS NULL) THEN RAISE EXCEPTION 'Le nouveau total est incompatible avec les règlements ou le client.' USING ERRCODE='22023';END IF;
  SELECT EXISTS(
   WITH o AS (SELECT article_id,sum(quantity) qty FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id),
   n AS (SELECT article_id,sum(quantity) qty FROM jsonb_to_recordset(p_items) x(article_id uuid,quantity numeric) GROUP BY article_id)
   SELECT 1 FROM o FULL JOIN n USING(article_id) WHERE coalesce(o.qty,0)<>coalesce(n.qty,0)
  ) INTO quantities_changed;
  IF quantities_changed THEN
   IF (SELECT count(*) FROM public.sales WHERE tenant_id=p_tenant_id AND sale_number=s.sale_number)<>1 THEN RAISE EXCEPTION 'Numéro de facture ambigu : origine du stock indéterminée.' USING ERRCODE='55000';END IF;
   -- Resolve the ORIGINAL stock source, not the currently selected depot.
   SELECT count(DISTINCT m.site_id),(array_agg(DISTINCT m.site_id))[1] INTO site_count,stock_site FROM public.stock_movements m
   WHERE m.tenant_id=p_tenant_id AND ((m.reference_type='invoice_edit' AND m.reference_id=p_sale_id) OR (m.reference_id IS NULL AND m.movement_type='sale' AND m.note IN ('Facture '||s.sale_number,'Facture '||s.sale_number||' (credit)','Facture '||s.sale_number||' (devis converti)')));
   IF site_count<>1 OR public.current_user_can_access_site(stock_site) IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.sites WHERE id=stock_site AND tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Magasin de sortie du stock indéterminé ou inaccessible. Utilisez un avoir.' USING ERRCODE='55000';END IF;
   -- Do not infer historical stock if the original movement is missing or inconsistent.
   IF EXISTS(WITH o AS (SELECT article_id,sum(quantity) qty FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id),m AS (SELECT article_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=p_tenant_id AND site_id=stock_site AND ((reference_type='invoice_edit' AND reference_id=p_sale_id) OR (reference_id IS NULL AND movement_type='sale' AND note IN ('Facture '||s.sale_number,'Facture '||s.sale_number||' (credit)','Facture '||s.sale_number||' (devis converti)'))) GROUP BY article_id) SELECT 1 FROM o FULL JOIN m USING(article_id) LEFT JOIN public.articles a ON a.id=coalesce(o.article_id,m.article_id) AND a.tenant_id=p_tenant_id WHERE coalesce(o.qty,0)<>coalesce(m.qty,0) AND (coalesce(a.track_stock,true) OR m.article_id IS NOT NULL)) THEN RAISE EXCEPTION 'Historique de stock incohérent. Aucune modification n’a été enregistrée.' USING ERRCODE='55000';END IF;
   FOR rec IN WITH o AS (SELECT article_id,sum(quantity) qty FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id),n AS (SELECT article_id,sum(quantity) qty FROM jsonb_to_recordset(p_items) x(article_id uuid,quantity numeric) GROUP BY article_id)
   SELECT coalesce(o.article_id,n.article_id) article_id,coalesce(o.qty,0)-coalesce(n.qty,0) delta FROM o FULL JOIN n USING(article_id) JOIN public.articles a ON a.id=coalesce(o.article_id,n.article_id) AND a.tenant_id=p_tenant_id WHERE coalesce(o.qty,0)<>coalesce(n.qty,0) AND (a.track_stock OR EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.tenant_id=p_tenant_id AND m.article_id=a.id AND m.site_id=stock_site AND ((m.reference_type='invoice_edit' AND m.reference_id=p_sale_id) OR (m.reference_id IS NULL AND m.movement_type='sale' AND m.note IN ('Facture '||s.sale_number,'Facture '||s.sale_number||' (credit)','Facture '||s.sale_number||' (devis converti)'))))) ORDER BY 1 LOOP
    INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(p_tenant_id,rec.article_id,stock_site,0) ON CONFLICT(article_id,site_id) DO NOTHING;
    SELECT coalesce(quantity,0) INTO STRICT prior_qty FROM public.stock_levels WHERE tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=stock_site FOR UPDATE;
    next_qty:=prior_qty+rec.delta;
    IF next_qty<0 AND NOT coalesce((SELECT CASE WHEN s.is_warehouse AND s.parent_site_id IS NOT NULL THEN coalesce(parent.allow_negative_stock,s.allow_negative_stock) ELSE s.allow_negative_stock END FROM public.sites s LEFT JOIN public.sites parent ON parent.id=s.parent_site_id AND parent.tenant_id=s.tenant_id WHERE s.id=stock_site AND s.tenant_id=p_tenant_id),false) THEN RAISE EXCEPTION 'Stock insuffisant dans le magasin de sortie.' USING ERRCODE='55000';END IF;
    UPDATE public.stock_levels SET quantity=next_qty,updated_at=now() WHERE tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=stock_site;
    INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(p_tenant_id,rec.article_id,stock_site,'adjustment',rec.delta,prior_qty,next_qty,'invoice_edit',p_sale_id,auth.uid(),'Modification facture '||s.sale_number);
   END LOOP;
  END IF;
  SELECT coalesce(jsonb_object_agg(article_id::text,purchase_cost),'{}') INTO old_costs FROM (SELECT DISTINCT ON(article_id) article_id,purchase_cost FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id ORDER BY article_id,created_at,id) q;
  DELETE FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id;
  INSERT INTO public.sale_items(tenant_id,sale_id,site_id,article_id,name,quantity,unit_price,discount,vat_rate,total,purchase_cost)
  SELECT p_tenant_id,p_sale_id,s.site_id,x.article_id,x.name,x.quantity,x.unit_price,coalesce(x.discount,0),0,round(x.quantity*x.unit_price-coalesce(x.discount,0),2),coalesce((old_costs->>x.article_id::text)::numeric,a.purchase_price,0)
  FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric) JOIN public.articles a ON a.id=x.article_id AND a.tenant_id=p_tenant_id;
 ELSE total_new:=s.total;END IF;
 IF total_new>coalesce(s.paid,0) AND p_customer_id IS NULL THEN RAISE EXCEPTION 'Un client est requis pour une facture à crédit.' USING ERRCODE='22023';END IF;
 UPDATE public.sales SET total=total_new,subtotal=CASE WHEN lines_changed THEN total_new ELSE subtotal END,customer_id=p_customer_id,doc_header=CASE WHEN p_doc_header IS NULL THEN doc_header ELSE coalesce(doc_header,'{}'::jsonb)||p_doc_header END,representative_id=p_representative_id,rep_commission=CASE WHEN NOT lines_changed AND s.representative_id IS NOT DISTINCT FROM p_representative_id THEN s.rep_commission ELSE p_rep_commission END,status=CASE WHEN NOT lines_changed THEN status WHEN coalesce(paid,0)>=total_new THEN 'paid' WHEN coalesce(paid,0)>0 THEN 'partial' ELSE 'validated' END WHERE id=p_sale_id AND tenant_id=p_tenant_id;
 IF lines_changed OR s.customer_id IS DISTINCT FROM p_customer_id THEN
  FOR cid IN SELECT DISTINCT x FROM unnest(ARRAY[s.customer_id,p_customer_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
   PERFORM 1 FROM public.customers WHERE id=cid AND tenant_id=p_tenant_id FOR UPDATE;
   UPDATE public.customers SET balance=coalesce((SELECT sum(total-paid) FROM public.sales WHERE tenant_id=p_tenant_id AND customer_id=cid AND status NOT IN ('cancelled','deleted') AND deleted_at IS NULL),0)+coalesce((SELECT sum(amount) FROM public.balance_adjustments WHERE tenant_id=p_tenant_id AND entity_id=cid AND entity_type='customer'),0) WHERE id=cid AND tenant_id=p_tenant_id;
  END LOOP;
 END IF;
 INSERT INTO public.audit_logs(tenant_id,user_id,action,module,reference_id,old_value,new_value) VALUES(p_tenant_id,auth.uid(),'invoice_edit','billing',p_sale_id,jsonb_build_object('total',s.total,'customer_id',s.customer_id,'representative_id',s.representative_id),jsonb_build_object('total',total_new,'customer_id',p_customer_id,'representative_id',p_representative_id,'lines_changed',lines_changed));
 IF p_release THEN lease_result:=public.document_edit_lease(p_tenant_id,'sale',p_sale_id::text,p_window_id,'release',p_lock_token);END IF;
 RETURN jsonb_build_object('success',true,'new_total',total_new,'version',public._invoice_edit_snapshot(p_tenant_id,p_sale_id)->>'version','lock_released',p_release AND lease_result->>'state' IS DISTINCT FROM 'held');
END $function$;
REVOKE ALL ON FUNCTION public.convert_quote_atomic(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,jsonb),public.save_locked_invoice_edit(uuid,uuid,uuid,uuid,text,jsonb,uuid,jsonb,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.convert_quote_atomic(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,jsonb),public.save_locked_invoice_edit(uuid,uuid,uuid,uuid,text,jsonb,uuid,jsonb,uuid,jsonb,boolean) TO authenticated;
