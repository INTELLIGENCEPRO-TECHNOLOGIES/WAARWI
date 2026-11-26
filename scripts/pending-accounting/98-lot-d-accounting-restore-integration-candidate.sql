-- Candidat 98 après 68/80/93 et lot D inactif ; aucune activation durable, BR020 conservé.
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory,exclusion_reason) VALUES
 ('public','document_edit_audit','direct','tenant_id','operation',98,'delete',false,NULL),
 ('public','document_edit_leases','excluded','tenant_id','platform',0,'preserve',false,'Verrous temporaires : invalidés lors du remplacement de données, jamais restaurés depuis une archive.')
ON CONFLICT(schema_name,table_name) DO NOTHING;
UPDATE public._br_table_registry SET parent_table='mt_wholesalers' WHERE schema_name='public' AND table_name='mt_wholesaler_services' AND tenant_link='indirect' AND parent_table IS NULL;
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public._br_table_registry WHERE schema_name='public' AND table_name='document_edit_leases' AND tenant_link='excluded') OR NOT EXISTS(SELECT 1 FROM public._br_table_registry WHERE schema_name='public' AND table_name='document_edit_audit' AND tenant_link='direct' AND reset_behavior='delete') OR NOT EXISTS(SELECT 1 FROM public._br_table_registry WHERE schema_name='public' AND table_name='mt_wholesaler_services' AND tenant_link='indirect' AND parent_table='mt_wholesalers') THEN RAISE EXCEPTION 'Registre des documents ou grossistes incohérent';END IF;
src:=pg_get_functiondef('public._br_lotd_install_hooks()'::regprocedure);
a:=$a$OR c.relname = 'profiles')$a$;b:=$b$OR c.relname IN ('profiles','document_edit_leases'))$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre _br_lotd_install_hooks() : %',n;END IF;src:=replace(src,a,b);
a:=$a$  RETURN jsonb_build_object('gates', v_gates, 'wrapped', v_wrapped);$a$;b:=$b$  DROP TRIGGER IF EXISTS _br_gate ON public.document_edit_leases;
  CREATE TRIGGER _br_gate BEFORE INSERT OR UPDATE OR DELETE ON public.document_edit_leases FOR EACH ROW EXECUTE FUNCTION public._br_gate('tenant_id');
  RETURN jsonb_build_object('gates', v_gates, 'wrapped', v_wrapped,'document_lease_gate',true);$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre _br_lotd_install_hooks() : %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._br_lotd_hooks_status()'::regprocedure);
a:=$a$WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect')
  ), missing AS ($a$;b:=$b$WHERE r.schema_name = 'public' AND (r.tenant_link IN ('direct','indirect') OR r.table_name='document_edit_leases')
  ), missing AS ($b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre _br_lotd_hooks_status() : %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._br_rs_request_restore(uuid,uuid,integer,uuid)'::regprocedure);
a:=$a$  RETURN jsonb_build_object('job_id', v_job, 'status', 'preparing', 'tables', v_n,$a$;b:=$b$  FOR v_status IN SELECT g.table_name FROM public._br_table_registry g
   WHERE g.schema_name='public' AND g.table_name IN ('quote_conversion_stock_trace','sale_return_lot_allocations','historical_sale_lot_matches')
     AND NOT(g.table_name=ANY(v_keys))
  LOOP
   EXECUTE format('SELECT count(*) FROM public.%I WHERE tenant_id=$1',v_status) INTO v_n USING p_tenant;
   IF v_n>0 THEN RETURN public._br_rs_fail(v_job,'BRR-020','Archive sans traçabilité historique existante : '||v_status,jsonb_build_object('missing_trace_table',v_status));END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public._br_restore_tables rt WHERE rt.job_id=v_job;
  RETURN jsonb_build_object('job_id', v_job, 'status', 'preparing', 'tables', v_n,$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre _br_rs_request_restore(uuid,uuid,integer,uuid) : %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._br_rs_swap(uuid,uuid)'::regprocedure);
a:=$a$ON CONFLICT (backend_pid) DO UPDATE SET xact_id = EXCLUDED.xact_id, tenant_id = EXCLUDED.tenant_id, job_id = EXCLUDED.job_id;$a$;b:=$b$ON CONFLICT (backend_pid) DO UPDATE SET xact_id = EXCLUDED.xact_id, tenant_id = EXCLUDED.tenant_id, job_id = EXCLUDED.job_id;
    DELETE FROM public.document_edit_leases WHERE tenant_id=j.tenant_id;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre _br_rs_swap(uuid,uuid) : %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._br_rs_reset_run(uuid,uuid)'::regprocedure);
a:=$a$ON CONFLICT (backend_pid) DO UPDATE SET xact_id = EXCLUDED.xact_id, tenant_id = EXCLUDED.tenant_id, job_id = EXCLUDED.job_id;$a$;b:=$b$ON CONFLICT (backend_pid) DO UPDATE SET xact_id = EXCLUDED.xact_id, tenant_id = EXCLUDED.tenant_id, job_id = EXCLUDED.job_id;
    DELETE FROM public.document_edit_leases WHERE tenant_id=j.tenant_id;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre _br_rs_reset_run(uuid,uuid) : %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
END $p$;
