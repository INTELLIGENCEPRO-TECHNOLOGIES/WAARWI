-- Candidat 123 : diagnostic IPM avant tout retour ; aucune mutation.
-- Le prorata global ne constitue pas une preuve de ventilation d'un retour partiel.
CREATE FUNCTION public.inspect_ipm_return(p_sale_id uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE t uuid:=public.current_tenant_id();s public.sales;i public.ipm_ventes;b public.ipm_bordereaux;f public.ipm_factures;
 n int; x record; l public.sale_items; q numeric; gross numeric:=0; prior boolean; full_return boolean:=true;
 lo numeric;hi numeric;exact_split boolean;linked boolean;has_payment boolean;has_reject boolean;state text;
BEGIN
 PERFORM public._cr_require_caller();
 IF NOT (coalesce(public._cr_profile_has_permission(auth.uid(),'edit_invoices'),false) OR coalesce(public._cr_profile_has_permission(auth.uid(),'pos_returns'),false)) THEN RAISE EXCEPTION 'Permission de retour requise.' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM public.sales WHERE id=p_sale_id AND tenant_id=t AND deleted_at IS NULL AND status<>'cancelled';
 IF NOT FOUND OR public.current_user_can_access_site(s.site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Vente inaccessible.' USING ERRCODE='42501';END IF;
 PERFORM public._cs_assert_sale_usable(s.id);
 SELECT count(*) INTO n FROM public.ipm_ventes v WHERE v.tenant_id=t AND (v.sale_id=s.id OR v.invoice_id=s.id);
 IF n=0 THEN RETURN jsonb_build_object('ipm',false);END IF;
 IF n<>1 THEN RAISE EXCEPTION 'Plusieurs dossiers IPM pour cette facture : rapprochement nécessaire.' USING ERRCODE='55000';END IF;
 SELECT * INTO STRICT i FROM public.ipm_ventes v WHERE v.tenant_id=t AND (v.sale_id=s.id OR v.invoice_id=s.id);
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Sélectionnez les articles à retourner.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) z(sale_item_id uuid,quantity numeric) WHERE z.sale_item_id IS NULL OR z.quantity IS NULL OR z.quantity<=0 OR z.quantity::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Quantité invalide.' USING ERRCODE='22023';END IF;
 SELECT EXISTS(SELECT 1 FROM public.sale_returns r WHERE r.tenant_id=t AND r.sale_id=s.id AND r.status IN ('approved','pending')) INTO prior;
 FOR x IN SELECT z.sale_item_id,sum(z.quantity) qty FROM jsonb_to_recordset(p_items) z(sale_item_id uuid,quantity numeric) GROUP BY z.sale_item_id LOOP
  SELECT * INTO l FROM public.sale_items WHERE id=x.sale_item_id AND tenant_id=t AND sale_id=s.id;
  IF NOT FOUND OR l.quantity<=0 OR l.quantity::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Ligne inaccessible ou invalide.' USING ERRCODE='22023';END IF;
  SELECT coalesce(sum(ri.quantity),0) INTO q FROM public.sale_return_items ri JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t WHERE ri.tenant_id=t AND ri.sale_item_id=l.id AND r.status IN ('approved','pending');
  IF x.qty>l.quantity-q THEN RAISE EXCEPTION 'Quantité disponible dépassée.' USING ERRCODE='22023';END IF;
  IF x.qty<>l.quantity THEN full_return:=false;END IF;
  IF s.vat_enabled_at_issue THEN
   IF l.vat_net_amount IS NULL OR l.vat_amount IS NULL THEN RAISE EXCEPTION 'Montants fiscaux historiques incomplets.' USING ERRCODE='55000';END IF;
   gross:=gross+round((l.vat_net_amount+l.vat_amount)*x.qty/l.quantity,2);
  ELSE
   gross:=gross+round(coalesce(l.total,l.quantity*l.unit_price)*x.qty/l.quantity*(1-CASE WHEN coalesce(s.subtotal,0)>0 THEN coalesce(s.discount,0)/s.subtotal ELSE 0 END),2);
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.sale_items si WHERE si.tenant_id=t AND si.sale_id=s.id AND NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) z(sale_item_id uuid,quantity numeric) WHERE z.sale_item_id=si.id)) THEN full_return:=false;END IF;
 IF i.part_ipm<0 OR i.part_client<0 OR i.montant_total<0 OR i.part_ipm::text IN ('NaN','Infinity','-Infinity') OR i.part_client::text IN ('NaN','Infinity','-Infinity') OR i.montant_total::text IN ('NaN','Infinity','-Infinity') OR gross<0 OR gross::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Montants IPM historiques invalides.' USING ERRCODE='55000';END IF;
 IF i.bordereau_id IS NOT NULL THEN SELECT * INTO STRICT b FROM public.ipm_bordereaux WHERE id=i.bordereau_id AND tenant_id=t AND organisme_id=i.organisme_id;END IF;
 IF coalesce(i.facture_ipm_id,b.facture_ipm_id) IS NOT NULL THEN SELECT * INTO STRICT f FROM public.ipm_factures WHERE id=coalesce(i.facture_ipm_id,b.facture_ipm_id) AND tenant_id=t AND organisme_id=i.organisme_id;END IF;
 linked:=i.bordereau_id IS NOT NULL OR i.facture_ipm_id IS NOT NULL;
 has_payment:=coalesce(i.montant_ipm_paye,0)>0 OR coalesce(f.montant_regle,0)>0 OR coalesce(b.total_paye,0)>0 OR EXISTS(SELECT 1 FROM public.ipm_reglements r WHERE r.tenant_id=t AND r.facture_id=f.id);
 has_reject:=coalesce(i.montant_rejete,0)>0 OR EXISTS(SELECT 1 FROM public.ipm_rejets r WHERE r.tenant_id=t AND (r.vente_ipm_id=i.id OR r.facture_id=f.id));
 IF prior OR i.part_ipm+i.part_client<>i.montant_total OR i.montant_total IS DISTINCT FROM s.total OR gross>i.montant_total OR (full_return AND gross<>i.montant_total) THEN
  state:='historique_a_rapprocher';exact_split:=false;
 ELSE
  lo:=greatest(0,gross-i.part_client);hi:=least(gross,i.part_ipm);
  exact_split:=lo=hi;
  state:=CASE WHEN has_payment OR has_reject THEN 'regularisation_reglement_rejet' WHEN f.id IS NOT NULL OR (b.id IS NOT NULL AND b.statut IS DISTINCT FROM 'brouillon') THEN 'regularisation_document_emis' WHEN NOT exact_split THEN 'ventilation_a_justifier' WHEN linked THEN 'bordereau_brouillon' ELSE 'non_bordereaute' END;
 END IF;
 RETURN jsonb_build_object('ipm',true,'state',state,'full_return',full_return,'prior_returns',prior,'gross',gross,
  'split_exact',exact_split,'ipm_min',lo,'ipm_max',hi,'ipm_return',CASE WHEN exact_split THEN lo END,
  'patient_return',CASE WHEN exact_split THEN gross-lo END,'patient_paid',i.part_beneficiaire_payee,'original_ipm',i.part_ipm,'original_patient',i.part_client,
  'bordereau_id',i.bordereau_id,'bordereau_status',b.statut,'invoice_id',f.id,'invoice_status',f.statut,'organism_payment',has_payment,'organism_rejection',has_reject);
END $f$;
REVOKE ALL ON FUNCTION public.inspect_ipm_return(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.inspect_ipm_return(uuid,jsonb) TO authenticated;
