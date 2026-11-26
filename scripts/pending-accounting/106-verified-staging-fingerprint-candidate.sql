-- Candidat 106 : empreinte de la zone préparée V2/V3 et vérification sous verrou exclusif.
-- Ne modifie ni le format des archives ni la clé de chiffrement. Toute préparation antérieure sans empreinte doit être recommencée.
CREATE FUNCTION public._br_rs_stage_fingerprint(p_job uuid)
RETURNS text LANGUAGE sql STABLE SET search_path TO ''
AS $f$
 SELECT encode(sha256(convert_to(coalesce(string_agg(
   encode(sha256(convert_to(jsonb_build_array(s.table_name,s.ord,s.row_data)::text,'UTF8')),'hex'),
   '' ORDER BY s.table_name,s.ord),''),'UTF8')),'hex')
 FROM public._br_restore_rows s WHERE s.job_id=p_job
$f$;
REVOKE ALL ON FUNCTION public._br_rs_stage_fingerprint(uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public._br_rs_verify(uuid,uuid)'::regprocedure);
 a:=$a$verify_report = jsonb_build_object('issues', '[]'::jsonb,$a$;
 b:=$b$verify_report = jsonb_build_object('issues', '[]'::jsonb,'stage_fingerprint',public._br_rs_stage_fingerprint(p_job),$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre vérification stage inattendue';END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public._br_rs_exec_preflight(public._br_restore_jobs)'::regprocedure);
 a:=$a$DECLARE v_hooks jsonb; v_drift jsonb; v_timeout integer;$a$;
 b:=$b$DECLARE v_hooks jsonb; v_drift jsonb; v_timeout integer; v_trace text; v_exists boolean;$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre déclaration préflight inattendue';END IF;src:=replace(src,a,b);
 a:=$a$  v_drift := public.br_check_schema_drift();$a$;
 b:=$b$  IF p_job.operation='restore' THEN
    IF p_job.verify_report->>'stage_fingerprint' IS NULL OR p_job.verify_report->>'stage_fingerprint' IS DISTINCT FROM public._br_rs_stage_fingerprint(p_job.id) THEN
      RAISE EXCEPTION 'BRR-077: verified staging content changed; prepare archive again' USING ERRCODE='XX000';
    END IF;
    FOR v_trace IN SELECT g.table_name FROM public._br_table_registry g
      WHERE g.schema_name='public' AND g.table_name IN ('historical_sale_lot_matches','quote_conversion_stock_trace','sale_return_lot_allocations')
       AND NOT EXISTS(SELECT 1 FROM public._br_restore_tables rt WHERE rt.job_id=p_job.id AND rt.table_name=g.table_name AND rt.presence='archived')
    LOOP
      EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE tenant_id=$1)',v_trace) INTO v_exists USING p_job.tenant_id;
      IF v_exists THEN RAISE EXCEPTION 'BRR-020: archive missing existing return trace: %',v_trace USING ERRCODE='55000';END IF;
    END LOOP;
  END IF;
  v_drift := public.br_check_schema_drift();$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre préflight stage inattendue';END IF;EXECUTE replace(src,a,b);
END $p$;
