-- 146: original IPM shares for newly converted non-VAT invoices. No historical backfill.
CREATE TABLE public.ipm_sale_line_snapshots (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 sale_id uuid PRIMARY KEY REFERENCES public.sales(id),
 ipm_sale_id uuid NOT NULL UNIQUE REFERENCES public.ipm_ventes(id),
 convention_id uuid NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND jsonb_typeof(snapshot->'lines')='array'),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.ipm_sale_line_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ipm_sale_line_snapshots FROM PUBLIC,anon,authenticated,service_role;
CREATE INDEX ipm_sale_line_snapshots_tenant ON public.ipm_sale_line_snapshots(tenant_id);
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
SELECT 'public','ipm_sale_line_snapshots','direct','tenant_id','operation',greatest(100,coalesce(max(restore_order),0)+1),'delete',false
FROM public._br_table_registry WHERE schema_name='public' AND table_name IN ('sales','ipm_ventes');

CREATE FUNCTION public._ipm_capture_new_sale_snapshot(p_tenant uuid,p_sale uuid,p_ipm_sale uuid)
RETURNS void LANGUAGE plpgsql SET search_path='' AS $f$
DECLARE s public.sales;i public.ipm_ventes;cv public.ipm_conventions;raw_lines jsonb;shares jsonb;full_lines jsonb;step numeric;eligible_total numeric;
BEGIN
 SELECT * INTO STRICT s FROM public.sales WHERE id=p_sale AND tenant_id=p_tenant FOR UPDATE;
 SELECT * INTO STRICT i FROM public.ipm_ventes WHERE id=p_ipm_sale AND tenant_id=p_tenant AND sale_id=p_sale FOR SHARE;
 SELECT * INTO STRICT cv FROM public.ipm_conventions WHERE id=i.convention_id AND tenant_id=p_tenant AND organisme_id=i.organisme_id FOR SHARE;
 IF coalesce(s.vat_enabled_at_issue,false) OR coalesce(s.discount,0)<>0 OR i.montant_total IS DISTINCT FROM s.total OR i.part_ipm+i.part_client IS DISTINCT FROM s.total OR i.taux_prise_en_charge IS DISTINCT FROM cv.taux_defaut OR cv.mode_calcul NOT IN ('total_facture','articles_eligibles','ligne_par_ligne') OR cv.mode_arrondi NOT IN ('round','floor','ceil','round5','round10','round25','round50','round100') OR EXISTS(SELECT 1 FROM public.sale_returns r WHERE r.tenant_id=p_tenant AND r.sale_id=p_sale AND r.status IN ('pending','approved')) THEN
 RAISE EXCEPTION 'Ventilation IPM non compatible avec une nouvelle facture sans TVA.' USING ERRCODE='55000';END IF;
 PERFORM a.id FROM public.articles a WHERE a.tenant_id=p_tenant AND EXISTS(SELECT 1 FROM public.sale_items l WHERE l.tenant_id=p_tenant AND l.sale_id=p_sale AND l.article_id=a.id) ORDER BY a.id FOR SHARE;
 IF EXISTS(SELECT 1 FROM public.sale_items l LEFT JOIN public.articles a ON a.id=l.article_id AND a.tenant_id=p_tenant WHERE l.tenant_id=p_tenant AND l.sale_id=p_sale AND (a.id IS NULL OR l.quantity IS NULL OR l.quantity<=0 OR l.quantity::text IN ('NaN','Infinity','-Infinity'))) THEN RAISE EXCEPTION 'Ligne IPM sans origine vérifiable.' USING ERRCODE='55000';END IF;
 step:=CASE cv.mode_arrondi WHEN 'round5' THEN 5 WHEN 'round10' THEN 10 WHEN 'round25' THEN 25 WHEN 'round50' THEN 50 WHEN 'round100' THEN 100 ELSE 1 END;
 SELECT coalesce(jsonb_agg(jsonb_build_object('line_id',l.id,'gross',l.total,'allocation_base',
 CASE WHEN cv.mode_calcul='total_facture' THEN l.total WHEN a.ipm_eligible IS FALSE THEN 0
 WHEN cv.mode_calcul='ligne_par_ligne' THEN least(l.total,CASE cv.mode_arrondi WHEN 'floor' THEN floor(l.total*cv.taux_defaut/100) WHEN 'ceil' THEN ceil(l.total*cv.taux_defaut/100) ELSE round(l.total*cv.taux_defaut/100/step)*step END)
 ELSE l.total END,'eligible',a.ipm_eligible IS NOT FALSE,'quantity',l.quantity) ORDER BY l.id),'[]'::jsonb),
 coalesce(sum(l.total) FILTER(WHERE a.ipm_eligible IS NOT FALSE),0)
 INTO raw_lines,eligible_total FROM public.sale_items l JOIN public.articles a ON a.id=l.article_id AND a.tenant_id=p_tenant WHERE l.tenant_id=p_tenant AND l.sale_id=p_sale;
 shares:=public._ipm_allocate_line_shares(raw_lines,i.part_ipm);
 IF (shares->>'gross')::numeric IS DISTINCT FROM s.total OR (shares->>'patient')::numeric IS DISTINCT FROM i.part_client OR eligible_total IS DISTINCT FROM i.montant_eligible THEN RAISE EXCEPTION 'Ventilation IPM et facture non concordantes.' USING ERRCODE='55000';END IF;
 SELECT jsonb_agg(x.value||jsonb_build_object('quantity',r.value->'quantity','eligible',r.value->'eligible','allocation_base',r.value->'allocation_base') ORDER BY x.value->>'line_id') INTO full_lines
 FROM jsonb_array_elements(shares->'lines') x JOIN jsonb_array_elements(raw_lines) r ON r.value->>'line_id'=x.value->>'line_id';
 INSERT INTO public.ipm_sale_line_snapshots(tenant_id,sale_id,ipm_sale_id,convention_id,snapshot)
 VALUES(p_tenant,p_sale,p_ipm_sale,cv.id,(shares-'lines')||jsonb_build_object('lines',full_lines,'rule',jsonb_build_object('version',1,'mode',cv.mode_calcul,'rounding',cv.mode_arrondi,'rate',cv.taux_defaut,'invoice_cap',cv.plafond_facture,'cap_application',cv.application_plafond)));
END $f$;
REVOKE ALL ON FUNCTION public._ipm_capture_new_sale_snapshot(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public.convert_quote_atomic(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 a:=$a$  SELECT coalesce(sum(i.total) FILTER(WHERE a.ipm_eligible IS NOT FALSE),0) INTO eligible$a$;
 b:=$b$  PERFORM a.id FROM public.articles a WHERE a.tenant_id=p_tenant_id AND EXISTS(SELECT 1 FROM public.quote_items i WHERE i.quote_id=q.id AND i.tenant_id=p_tenant_id AND i.article_id=a.id) ORDER BY a.id FOR SHARE;
  SELECT coalesce(sum(i.total) FILTER(WHERE a.ipm_eligible IS NOT FALSE),0) INTO eligible$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre verrou articles IPM : %',n;END IF;src:=replace(src,a,b);
 a:=$a$  -- The IPM receivable is not a cash payment; keep sales.paid equal to actual payments/credits.$a$;
 b:=$b$  PERFORM public._ipm_capture_new_sale_snapshot(p_tenant_id,sid,(SELECT i.id FROM public.ipm_ventes i WHERE i.tenant_id=p_tenant_id AND i.sale_id=sid));
  -- The IPM receivable is not a cash payment; keep sales.paid equal to actual payments/credits.$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre capture IPM : %',n;END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public._br_rs_request_restore(uuid,uuid,integer,uuid)'::regprocedure);
 a:=$a$'quote_conversion_stock_trace','sale_return_lot_allocations','historical_sale_lot_matches'$a$;
 b:=$b$'quote_conversion_stock_trace','sale_return_lot_allocations','historical_sale_lot_matches','ipm_sale_line_snapshots'$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre registre préflight IPM : %',n;END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public._br_rs_exec_preflight(public._br_restore_jobs)'::regprocedure);
 a:=$a$  v_drift := public.br_check_schema_drift();$a$;
 b:=$b$  IF p_job.operation='restore' AND NOT EXISTS(SELECT 1 FROM public._br_restore_tables rt WHERE rt.job_id=p_job.id AND rt.table_name='ipm_sale_line_snapshots' AND rt.presence='archived') AND EXISTS(SELECT 1 FROM public.ipm_sale_line_snapshots x WHERE x.tenant_id=p_job.tenant_id) THEN
   RAISE EXCEPTION 'BRR-020: archive missing original IPM line shares' USING ERRCODE='55000';
  END IF;
  v_drift := public.br_check_schema_drift();$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre exécution restauration IPM : %',n;END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public.br_preflight_restore(uuid)'::regprocedure);
 a:=$a$SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$a$;
 b:=$b$IF jsonb_typeof(v_backup.payload->'ipm_sale_line_snapshots') IS DISTINCT FROM 'array' AND EXISTS(SELECT 1 FROM public.ipm_sale_line_snapshots x WHERE x.tenant_id=v_tenant_id) THEN
 v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','IPM_LINE_SNAPSHOT_MISSING','severity','fatal','table','ipm_sale_line_snapshots','message','Archive sans ventilation IPM historique existante.'));
END IF;
SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre préflight historique IPM : %',n;END IF;EXECUTE replace(src,a,b);
END $p$;
