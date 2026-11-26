-- 141 : empêcher la perte silencieuse d'une demande non confirmée lors d'une restauration historique.
-- Les demandes acquittées/annulées n'empêchent pas de restaurer une ancienne archive.
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public._br_rs_request_restore(uuid,uuid,integer,uuid)'::regprocedure);
 a:=$a$  SELECT count(*) INTO v_n FROM public._br_restore_tables rt WHERE rt.job_id=v_job;$a$;
 b:=$b$  IF NOT ('return_request_journal'=ANY(v_keys)) AND EXISTS(SELECT 1 FROM public.return_request_journal r WHERE r.tenant_id=p_tenant AND r.state IN ('pending','succeeded')) THEN
   RETURN public._br_rs_fail(v_job,'BRR-020','Archive sans demandes de retour encore actives. Régularisez les demandes avant restauration.',jsonb_build_object('missing_trace_table','return_request_journal'));
  END IF;
  SELECT count(*) INTO v_n FROM public._br_restore_tables rt WHERE rt.job_id=v_job;$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre journal restore request';END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public._br_rs_exec_preflight(public._br_restore_jobs)'::regprocedure);
 a:=$a$  v_drift := public.br_check_schema_drift();$a$;
 b:=$b$  IF p_job.operation='restore' AND NOT EXISTS(SELECT 1 FROM public._br_restore_tables rt WHERE rt.job_id=p_job.id AND rt.table_name='return_request_journal' AND rt.presence='archived') AND EXISTS(SELECT 1 FROM public.return_request_journal r WHERE r.tenant_id=p_job.tenant_id AND r.state IN ('pending','succeeded')) THEN
   RAISE EXCEPTION 'BRR-020: archive missing an active return request' USING ERRCODE='55000';
  END IF;
  v_drift := public.br_check_schema_drift();$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre journal restore execute';END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public.br_preflight_restore(uuid)'::regprocedure);
 a:=$a$SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$a$;
 b:=$b$IF jsonb_typeof(v_backup.payload->'return_request_journal') IS DISTINCT FROM 'array' AND EXISTS(SELECT 1 FROM public.return_request_journal r WHERE r.tenant_id=v_tenant_id AND r.state IN ('pending','succeeded')) THEN
 v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','RETURN_REQUEST_MISSING','severity','fatal','table','return_request_journal','message','Régularisez les demandes de retour actives avant de restaurer cette ancienne sauvegarde.'));
END IF;
SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre journal préflight V2';END IF;EXECUTE replace(src,a,b);
END $p$;