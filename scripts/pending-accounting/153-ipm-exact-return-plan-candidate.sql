-- 153 : exact return plan based on original line shares, not current convention.
-- Reserve a private ledger for the future atomic writer. No financial or stock operation here.
CREATE TABLE public.ipm_return_line_snapshots(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 sale_id uuid NOT NULL REFERENCES public.ipm_sale_line_snapshots(sale_id),
 sale_item_id uuid NOT NULL REFERENCES public.sale_items(id),
 return_id uuid NOT NULL REFERENCES public.sale_returns(id),
 return_item_id uuid PRIMARY KEY REFERENCES public.sale_return_items(id),
 prior_quantity numeric NOT NULL CHECK(prior_quantity>=0 AND prior_quantity::text NOT IN ('NaN','Infinity','-Infinity')),
 quantity numeric NOT NULL CHECK(quantity>0 AND quantity::text NOT IN ('NaN','Infinity','-Infinity')),
 ipm_amount numeric NOT NULL CHECK(ipm_amount>=0 AND ipm_amount=round(ipm_amount,2) AND ipm_amount::text NOT IN ('NaN','Infinity','-Infinity')),
 patient_amount numeric NOT NULL CHECK(patient_amount>=0 AND patient_amount=round(patient_amount,2) AND patient_amount::text NOT IN ('NaN','Infinity','-Infinity')),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(return_id,sale_item_id)
);
ALTER TABLE public.ipm_return_line_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ipm_return_line_snapshots FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ipm_return_line_snapshots_sale ON public.ipm_return_line_snapshots(tenant_id,sale_id,sale_item_id);
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
SELECT 'public','ipm_return_line_snapshots','direct','tenant_id','operation',greatest(101,coalesce(max(restore_order),0)+1),'delete',false FROM public._br_table_registry WHERE schema_name='public' AND table_name IN ('ipm_sale_line_snapshots','sale_returns','sale_return_items','sale_items');

CREATE FUNCTION public._ipm_exact_return_plan(p_tenant uuid,p_sale uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $f$
DECLARE snap public.ipm_sale_line_snapshots;s public.sales;r record;l record;prior_qty numeric;delta jsonb;planned jsonb:='[]';total_i numeric:=0;total_p numeric:=0;remaining_i numeric;remaining_p numeric;all_done boolean;prior_pending boolean;
BEGIN
 SELECT * INTO snap FROM public.ipm_sale_line_snapshots WHERE tenant_id=p_tenant AND sale_id=p_sale;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO STRICT s FROM public.sales WHERE tenant_id=p_tenant AND id=p_sale;
 IF NOT EXISTS(SELECT 1 FROM public.ipm_ventes i WHERE i.id=snap.ipm_sale_id AND i.tenant_id=p_tenant AND i.sale_id=p_sale AND i.convention_id=snap.convention_id) OR s.total IS DISTINCT FROM (snap.snapshot->>'gross')::numeric OR coalesce(s.vat_enabled_at_issue,false) OR coalesce(s.discount,0)<>0 THEN RAISE EXCEPTION 'Facture et ventilation IPM historique non concordantes.' USING ERRCODE='55000';END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Lignes de retour invalides.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) z(sale_item_id uuid,quantity numeric) WHERE z.sale_item_id IS NULL OR z.quantity IS NULL OR z.quantity<=0 OR z.quantity::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Quantité de retour invalide.' USING ERRCODE='22023';END IF;
 -- Check the source lines, including unselected lines: a changed invoice cannot be silently reused.
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(snap.snapshot->'lines') x(line_id uuid,quantity numeric,gross numeric,ipm numeric,patient numeric)
 FULL JOIN (SELECT id,quantity,total FROM public.sale_items WHERE tenant_id=p_tenant AND sale_id=p_sale) si ON si.id=x.line_id
 WHERE si.id IS NULL OR x.line_id IS NULL OR si.quantity IS DISTINCT FROM x.quantity OR si.total IS DISTINCT FROM x.gross OR x.ipm+x.patient IS DISTINCT FROM x.gross) THEN RAISE EXCEPTION 'Lignes de facture modifiées ou ventilation incomplète.' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.sale_returns sr LEFT JOIN public.sale_return_items ri ON ri.return_id=sr.id AND ri.tenant_id=p_tenant
 LEFT JOIN public.ipm_return_line_snapshots d ON d.return_item_id=ri.id AND d.tenant_id=p_tenant AND d.sale_id=p_sale AND d.return_id=sr.id AND d.sale_item_id=ri.sale_item_id
 WHERE sr.tenant_id=p_tenant AND sr.sale_id=p_sale AND sr.status IN ('approved','pending') AND (d.return_item_id IS NULL OR d.quantity IS DISTINCT FROM ri.quantity OR d.ipm_amount+d.patient_amount IS DISTINCT FROM ri.total)) THEN
  RETURN jsonb_build_object('exact',false,'reason','retour_anterieur_sans_ventilation');
 END IF;
 -- Verify the whole cumulative history, so a malformed row cannot reserve the wrong amount.
 FOR r IN SELECT d.*,sr.status AS return_status,x.quantity AS original_quantity,x.ipm AS original_ipm,x.patient AS original_patient,
 coalesce(sum(d.quantity) OVER(PARTITION BY d.sale_item_id ORDER BY d.prior_quantity,d.return_item_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) AS expected_prior
 FROM public.ipm_return_line_snapshots d JOIN public.sale_returns sr ON sr.id=d.return_id AND sr.tenant_id=p_tenant AND sr.sale_id=p_sale
 JOIN jsonb_to_recordset(snap.snapshot->'lines') x(line_id uuid,quantity numeric,ipm numeric,patient numeric) ON x.line_id=d.sale_item_id
 WHERE d.tenant_id=p_tenant AND d.sale_id=p_sale AND sr.status IN ('approved','pending')
 LOOP
  IF r.prior_quantity IS DISTINCT FROM r.expected_prior OR r.prior_quantity+r.quantity>r.original_quantity THEN RAISE EXCEPTION 'Chronologie des retours IPM incohérente.' USING ERRCODE='55000';END IF;
  delta:=public._ipm_return_line_delta(r.original_ipm,r.original_patient,r.original_quantity,r.prior_quantity,r.quantity);
  IF (delta->>'ipm')::numeric IS DISTINCT FROM r.ipm_amount OR (delta->>'patient')::numeric IS DISTINCT FROM r.patient_amount THEN RAISE EXCEPTION 'Historique de ventilation des retours incohérent.' USING ERRCODE='55000';END IF;
 END LOOP;
 SELECT (snap.snapshot->>'ipm')::numeric-coalesce(sum(d.ipm_amount),0),(snap.snapshot->>'patient')::numeric-coalesce(sum(d.patient_amount),0)
 INTO remaining_i,remaining_p FROM public.ipm_return_line_snapshots d JOIN public.sale_returns sr ON sr.id=d.return_id AND sr.tenant_id=p_tenant AND sr.sale_id=p_sale
 WHERE d.tenant_id=p_tenant AND d.sale_id=p_sale AND sr.status IN ('approved','pending');
 IF remaining_i<0 OR remaining_p<0 THEN RAISE EXCEPTION 'Solde des ventilations négatif.' USING ERRCODE='55000';END IF;
 FOR r IN SELECT sale_item_id,sum(quantity) qty FROM jsonb_to_recordset(p_items) z(sale_item_id uuid,quantity numeric) GROUP BY sale_item_id ORDER BY sale_item_id LOOP
  SELECT * INTO l FROM jsonb_to_recordset(snap.snapshot->'lines') x(line_id uuid,quantity numeric,ipm numeric,patient numeric) WHERE x.line_id=r.sale_item_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ligne absente de la ventilation historique.' USING ERRCODE='22023';END IF;
  SELECT coalesce(sum(d.quantity),0) INTO prior_qty FROM public.ipm_return_line_snapshots d JOIN public.sale_returns sr ON sr.id=d.return_id AND sr.tenant_id=p_tenant AND sr.sale_id=p_sale WHERE d.tenant_id=p_tenant AND d.sale_id=p_sale AND d.sale_item_id=r.sale_item_id AND sr.status IN ('approved','pending');
  delta:=public._ipm_return_line_delta(l.ipm,l.patient,l.quantity,prior_qty,r.qty);
  total_i:=total_i+(delta->>'ipm')::numeric;total_p:=total_p+(delta->>'patient')::numeric;
  planned:=planned||jsonb_build_array(delta||jsonb_build_object('sale_item_id',r.sale_item_id,'quantity',r.qty,'prior_quantity',prior_qty,'original_quantity',l.quantity));
 END LOOP;
 IF total_i>remaining_i OR total_p>remaining_p THEN RAISE EXCEPTION 'Ventilation du retour supérieure au reliquat.' USING ERRCODE='55000';END IF;
 SELECT NOT EXISTS(SELECT 1 FROM jsonb_to_recordset(snap.snapshot->'lines') x(line_id uuid,quantity numeric) WHERE x.quantity IS DISTINCT FROM
 coalesce((SELECT sum(d.quantity) FROM public.ipm_return_line_snapshots d JOIN public.sale_returns sr ON sr.id=d.return_id AND sr.tenant_id=p_tenant AND sr.sale_id=p_sale WHERE d.tenant_id=p_tenant AND d.sale_id=p_sale AND d.sale_item_id=x.line_id AND sr.status IN ('approved','pending')),0)
 +coalesce((SELECT sum(z.quantity) FROM jsonb_to_recordset(planned) z(sale_item_id uuid,quantity numeric) WHERE z.sale_item_id=x.line_id),0)) INTO all_done;
 SELECT EXISTS(SELECT 1 FROM public.sale_returns WHERE tenant_id=p_tenant AND sale_id=p_sale AND status='pending') INTO prior_pending;
 RETURN jsonb_build_object('exact',true,'lines',planned,'gross',total_i+total_p,'ipm_return',total_i,'patient_return',total_p,'remaining_ipm_after',remaining_i-total_i,'remaining_patient_after',remaining_p-total_p,'all_quantities_returned_after',all_done,'prior_pending',prior_pending);
END $f$;
REVOKE ALL ON FUNCTION public._ipm_exact_return_plan(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;

-- Preserve the checked historical diagnostic; augment only when original evidence exists.
ALTER FUNCTION public.inspect_ipm_return(uuid,jsonb) RENAME TO _inspect_ipm_return_historical;
REVOKE ALL ON FUNCTION public._inspect_ipm_return_historical(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.inspect_ipm_return(p_sale_id uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE base jsonb;plan jsonb;state text;t uuid:=public.current_tenant_id();
BEGIN
 base:=public._inspect_ipm_return_historical(p_sale_id,p_items);
 IF base->>'ipm' IS DISTINCT FROM 'true' THEN RETURN base;END IF;
 plan:=public._ipm_exact_return_plan(t,p_sale_id,p_items);
 IF plan IS NULL THEN RETURN base;END IF;
 IF plan->>'exact' IS DISTINCT FROM 'true' THEN RETURN base||jsonb_build_object('state','historique_a_rapprocher','split_exact',false,'ipm_return',NULL,'patient_return',NULL,'historical_evidence',plan->>'reason');END IF;
 state:=CASE WHEN (base->>'organism_payment')::boolean OR (base->>'organism_rejection')::boolean THEN 'regularisation_reglement_rejet'
 WHEN base->>'invoice_id' IS NOT NULL OR (base->>'bordereau_id' IS NOT NULL AND base->>'bordereau_status' IS DISTINCT FROM 'brouillon') THEN 'regularisation_document_emis'
 WHEN (plan->>'prior_pending')::boolean THEN 'retour_en_attente'
 WHEN base->>'bordereau_id' IS NOT NULL THEN 'bordereau_brouillon' ELSE 'non_bordereaute' END;
 RETURN base||plan||jsonb_build_object('state',state,'split_exact',true,'ipm_min',(plan->>'ipm_return')::numeric,'ipm_max',(plan->>'ipm_return')::numeric,'historical_evidence','original_line_snapshot');
END $f$;
REVOKE ALL ON FUNCTION public.inspect_ipm_return(uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.inspect_ipm_return(uuid,jsonb) TO authenticated;

DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public._br_rs_request_restore(uuid,uuid,integer,uuid)'::regprocedure);
 a:=$a$'historical_sale_lot_matches','ipm_sale_line_snapshots'$a$;b:=$b$'historical_sale_lot_matches','ipm_sale_line_snapshots','ipm_return_line_snapshots'$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre restauration retour IPM : %',n;END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public._br_rs_exec_preflight(public._br_restore_jobs)'::regprocedure);
 a:=$a$  v_drift := public.br_check_schema_drift();$a$;b:=$b$  IF p_job.operation='restore' AND NOT EXISTS(SELECT 1 FROM public._br_restore_tables rt WHERE rt.job_id=p_job.id AND rt.table_name='ipm_return_line_snapshots' AND rt.presence='archived') AND EXISTS(SELECT 1 FROM public.ipm_return_line_snapshots x WHERE x.tenant_id=p_job.tenant_id) THEN RAISE EXCEPTION 'BRR-020: archive missing IPM return line shares' USING ERRCODE='55000';END IF;
  v_drift := public.br_check_schema_drift();$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre exécution retour IPM : %',n;END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public.br_preflight_restore(uuid)'::regprocedure);
 a:=$a$SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$a$;b:=$b$IF jsonb_typeof(v_backup.payload->'ipm_return_line_snapshots') IS DISTINCT FROM 'array' AND EXISTS(SELECT 1 FROM public.ipm_return_line_snapshots x WHERE x.tenant_id=v_tenant_id) THEN
 v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','IPM_RETURN_SNAPSHOT_MISSING','severity','fatal','table','ipm_return_line_snapshots','message','Archive sans ventilation historique des retours IPM.'));
END IF;
SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre préflight retour IPM : %',n;END IF;EXECUTE replace(src,a,b);
END $p$;
