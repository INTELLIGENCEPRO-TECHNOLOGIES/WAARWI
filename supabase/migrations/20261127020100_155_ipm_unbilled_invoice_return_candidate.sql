-- Candidat : retour des factures IPM sans TVA avant mise en bordereau.
ALTER TABLE public.sale_returns ADD COLUMN ipm_gross_total numeric
 CHECK (ipm_gross_total IS NULL OR (
  total IS NOT NULL AND total >= 0 AND ipm_gross_total >= total
  AND ipm_gross_total = round(ipm_gross_total, 2)
  AND ipm_gross_total::text NOT IN ('NaN','Infinity','-Infinity')
 ));

CREATE FUNCTION public._ipm_lock_unbilled_return(p_tenant uuid,p_sale uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $f$
DECLARE dossier public.ipm_ventes; plan jsonb;
BEGIN
 SELECT * INTO STRICT dossier FROM public.ipm_ventes
 WHERE tenant_id=p_tenant AND (sale_id=p_sale OR invoice_id=p_sale)
 FOR UPDATE;
 IF dossier.sale_id IS DISTINCT FROM p_sale OR dossier.statut IS DISTINCT FROM 'en_attente'
    OR dossier.bordereau_id IS NOT NULL OR dossier.facture_ipm_id IS NOT NULL
    OR EXISTS (SELECT 1 FROM public.sales WHERE tenant_id=p_tenant AND id=p_sale AND accounting_status='accounted') THEN
  RAISE EXCEPTION 'Ce dossier IPM doit être régularisé avant tout retour. Aucun document existant n’a été modifié.' USING ERRCODE='55000';
 END IF;

 plan:=public.inspect_ipm_return(p_sale,p_items);
 IF plan->>'state' IS DISTINCT FROM 'non_bordereaute'
    OR plan->>'historical_evidence' IS DISTINCT FROM 'original_line_snapshot'
    OR plan->>'split_exact' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Rapprochez la ventilation IPM ou terminez le retour en attente avant de continuer.' USING ERRCODE='55000';
 END IF;
 IF dossier.part_ipm IS DISTINCT FROM (plan->>'remaining_ipm_after')::numeric+(plan->>'ipm_return')::numeric
    OR dossier.part_client IS DISTINCT FROM (plan->>'remaining_patient_after')::numeric+(plan->>'patient_return')::numeric
    OR dossier.montant_total IS DISTINCT FROM dossier.part_ipm+dossier.part_client THEN
  RAISE EXCEPTION 'Les soldes IPM ne concordent pas avec la ventilation d’origine et les retours précédents.' USING ERRCODE='55000';
 END IF;
 RETURN plan||jsonb_build_object('ipm_sale_id',dossier.id);
END $f$;
REVOKE ALL ON FUNCTION public._ipm_lock_unbilled_return(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public._ipm_record_unbilled_return(p_tenant uuid,p_sale uuid,p_return uuid,p_plan jsonb)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $f$
DECLARE
 affected integer;
 remaining_eligible numeric;
 remaining_total numeric:=(p_plan->>'remaining_ipm_after')::numeric+(p_plan->>'remaining_patient_after')::numeric;
BEGIN
 INSERT INTO public.ipm_return_line_snapshots(tenant_id,sale_id,sale_item_id,return_id,return_item_id,prior_quantity,quantity,ipm_amount,patient_amount)
 SELECT p_tenant,p_sale,ri.sale_item_id,p_return,ri.id,line.prior_quantity,line.quantity,line.ipm,line.patient
 FROM jsonb_to_recordset(p_plan->'lines') line(sale_item_id uuid,prior_quantity numeric,quantity numeric,ipm numeric,patient numeric)
 JOIN public.sale_return_items ri ON ri.tenant_id=p_tenant AND ri.return_id=p_return
  AND ri.sale_item_id=line.sale_item_id AND ri.quantity=line.quantity AND ri.total=line.ipm+line.patient;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected IS DISTINCT FROM jsonb_array_length(p_plan->'lines') THEN
  RAISE EXCEPTION 'Les lignes du retour ne concordent pas avec leur ventilation IPM.' USING ERRCODE='55000';
 END IF;

 SELECT coalesce(sum(line.gross-coalesce(returned.gross,0)),0) INTO remaining_eligible
 FROM public.ipm_sale_line_snapshots origin
 CROSS JOIN LATERAL jsonb_to_recordset(origin.snapshot->'lines') line(line_id uuid,gross numeric,eligible boolean)
 LEFT JOIN LATERAL (
  SELECT sum(proof.ipm_amount+proof.patient_amount) AS gross
  FROM public.ipm_return_line_snapshots proof
  JOIN public.sale_returns prior ON prior.id=proof.return_id AND prior.tenant_id=p_tenant
  WHERE proof.tenant_id=p_tenant AND proof.sale_id=p_sale AND proof.sale_item_id=line.line_id
    AND prior.status IN ('pending','approved')
 ) returned ON true
 WHERE origin.tenant_id=p_tenant AND origin.sale_id=p_sale AND line.eligible;
 IF remaining_eligible NOT BETWEEN 0 AND remaining_total THEN
  RAISE EXCEPTION 'Solde des articles éligibles incohérent.' USING ERRCODE='55000';
 END IF;

 UPDATE public.ipm_ventes
 SET part_ipm=(p_plan->>'remaining_ipm_after')::numeric,
     part_client=(p_plan->>'remaining_patient_after')::numeric,
     montant_total=remaining_total,
     montant_eligible=remaining_eligible,
     montant_non_eligible=remaining_total-remaining_eligible,
     statut=CASE WHEN (p_plan->>'all_quantities_returned_after')::boolean THEN 'annulee' ELSE statut END
 WHERE tenant_id=p_tenant AND id=(p_plan->>'ipm_sale_id')::uuid;
END $f$;
REVOKE ALL ON FUNCTION public._ipm_record_unbilled_return(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Reuse all locks, lot validation, stock movements, credit accounting and request
-- hashing of the existing invoice-return engine. Keep the POS entry point separate.
DO $patch$
DECLARE
 definition text:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 amendment record;
BEGIN
 FOR amendment IN SELECT * FROM (VALUES
  ($a$FUNCTION public._process_sale_return_without_vat($a$,$b$FUNCTION public._process_ipm_invoice_return_without_vat($b$),
  ($a$v_return_value numeric;$a$,$b$v_return_value numeric;
v_ipm_plan jsonb;
v_ipm_line jsonb;$b$),
  ($a$IF EXISTS(SELECT 1 FROM public.ipm_ventes i WHERE i.tenant_id=v_tenant_id AND (i.sale_id=p_sale_id OR i.invoice_id=p_sale_id)) THEN RAISE EXCEPTION 'Cette vente relève de l’IPM : utilisez le traitement spécifique IPM.' USING ERRCODE='55000';END IF;$a$,
   $b$IF p_cash_session_id IS NOT NULL OR p_refund_now OR p_request_id IS NULL THEN
 RAISE EXCEPTION 'Utilisez le parcours de retour sur facture IPM.' USING ERRCODE='22023';
END IF;
v_ipm_plan:=public._ipm_lock_unbilled_return(v_tenant_id,p_sale_id,p_items);
IF EXISTS (SELECT 1 FROM jsonb_to_recordset(p_items) AS item(sale_item_id uuid) GROUP BY sale_item_id HAVING count(*)>1) THEN
 RAISE EXCEPTION 'Sélectionnez chaque ligne de facture IPM une seule fois.' USING ERRCODE='22023';
END IF;
IF (v_ipm_plan->>'patient_return')::numeric=0 THEN v_effective_method:='none';END IF;$b$),
  ($a$v_return_value := v_returned_net - v_global_share;$a$,
   $b$SELECT line INTO STRICT v_ipm_line FROM jsonb_array_elements(v_ipm_plan->'lines') line
 WHERE line->>'sale_item_id'=v_si.id::text;
v_return_value:=(v_ipm_line->>'gross')::numeric;$b$),
  ($a$UPDATE public.sale_returns SET total = v_return_total WHERE id = v_return_id;$a$,
   $b$IF v_return_total IS DISTINCT FROM (v_ipm_plan->>'gross')::numeric THEN
 RAISE EXCEPTION 'Total du retour IPM incohérent.' USING ERRCODE='55000';
END IF;
UPDATE public.sale_returns
 SET ipm_gross_total=v_return_total,
     total=(v_ipm_plan->>'patient_return')::numeric,
     status=CASE WHEN (v_ipm_plan->>'patient_return')::numeric=0 THEN 'approved' ELSE status END
 WHERE id=v_return_id;
PERFORM public._ipm_record_unbilled_return(v_tenant_id,p_sale_id,v_return_id,v_ipm_plan);
v_return_total:=(v_ipm_plan->>'patient_return')::numeric;$b$)
 ) AS changes(anchor,replacement) LOOP
  IF (length(definition)-length(replace(definition,amendment.anchor,'')))/length(amendment.anchor)<>1 THEN
   RAISE EXCEPTION 'Ancre retour IPM introuvable ou ambiguë : %',left(amendment.anchor,100);
  END IF;
  definition:=replace(definition,amendment.anchor,amendment.replacement);
 END LOOP;
 EXECUTE definition;

 definition:=pg_get_functiondef('public.prepare_invoice_return(uuid,uuid,jsonb,text,boolean,text,boolean)'::regprocedure);
 IF strpos(definition,'res:=public._process_sale_return_without_vat(')=0 THEN
  RAISE EXCEPTION 'Ancre du retour sur facture introuvable';
 END IF;
 definition:=replace(definition,'res:=public._process_sale_return_without_vat(',
 $dispatch$IF EXISTS (SELECT 1 FROM public.ipm_ventes i WHERE i.tenant_id=t AND (i.sale_id=p_sale_id OR i.invoice_id=p_sale_id)) THEN
  res:=public._process_ipm_invoice_return_without_vat(p_sale_id,p_site_id,NULL,p_items,p_reason,false,p_restock,p_request_id,CASE WHEN p_issue_credit THEN 'avoir' ELSE NULL END);
 ELSE
  res:=public._process_sale_return_without_vat($dispatch$);
 definition:=replace(definition,'PERFORM public._check_return_requested_mode','END IF;
 PERFORM public._check_return_requested_mode');
 EXECUTE definition;
END $patch$;
REVOKE ALL ON FUNCTION public._process_ipm_invoice_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) FROM PUBLIC,anon,authenticated,service_role;
