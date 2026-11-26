-- Phase 4 rollback recipe: execute only after installing the pending migration in a test transaction.
DO $recipe$
DECLARE t uuid;u uuid;other uuid;m date;r jsonb;r2 jsonb;checks jsonb:='{"journal":"done","balance":"done","sources":"done"}';v bigint;actual bigint;sample jsonb;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' LIMIT 1;
 SELECT id INTO other FROM public.tenants WHERE id<>t LIMIT 1;
 IF u IS NULL OR other IS NULL THEN RAISE EXCEPTION 'Fixtures insuffisantes';END IF;
 m:=(date_trunc('month',now() AT TIME ZONE 'Africa/Dakar')-interval '1 month')::date;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  r:=public.accounting_revision_report(t,m);r2:=public.accounting_revision_report(t,m);
  IF jsonb_array_length(r->'cycles')<>10 OR r->>'token' IS DISTINCT FROM r2->>'token' THEN RAISE EXCEPTION 'Cycles ou empreinte instables';END IF;
  sample:=public.accounting_revision_anomalies(t,m,'integrity',0,5);
  IF (sample->>'count')::bigint<>(r->>'anomaly_count')::bigint OR jsonb_array_length(sample->'rows')>5 THEN RAISE EXCEPTION 'Pagination incohérente';END IF;
  BEGIN PERFORM public.accounting_revision_report(other,m);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Fuite tenant';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN PERFORM public.accounting_revision_anomalies(other,m,'integrity',0,5);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Fuite anomalies';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  SELECT coalesce(max(revision),0) INTO v FROM public.accounting_cycle_reviews WHERE tenant_id=t AND month_start=m AND cycle='integrity';
  BEGIN PERFORM public.save_accounting_cycle_review(t,m,'integrity','observations','{}','Conclusion','Justificatif',r->>'token',v);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Contrôles incomplets acceptés';EXCEPTION WHEN raise_exception THEN NULL;END;
  BEGIN PERFORM public.save_accounting_cycle_review(t,m,'integrity','in_progress',checks,'Test','','old-token',v);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Empreinte invalide acceptée';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
  PERFORM public.save_accounting_cycle_review(t,m,'integrity','in_progress',checks,'Recette version 1','REF-1',r->>'token',v);
  BEGIN PERFORM public.save_accounting_cycle_review(t,m,'integrity','in_progress',checks,'Conflit','REF-1',r->>'token',v);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Conflit non bloqué';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
  PERFORM public.save_accounting_cycle_review(t,m,'integrity','observations',checks,'Recette version 2','REF-2',r->>'token',v+1);
  SELECT revision INTO actual FROM public.accounting_cycle_reviews WHERE tenant_id=t AND month_start=m AND cycle='integrity' AND history->-1->>'note'='Recette version 1';
  IF actual IS DISTINCT FROM v+2 THEN RAISE EXCEPTION 'Historique incorrect';END IF;
  r2:=public.accounting_revision_report(t,m);
  IF r2->>'token' IS DISTINCT FROM r->>'token' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r2->'reviews') x WHERE x->>'cycle'='integrity' AND x->>'stale'='false' AND x->>'status'='observations') THEN RAISE EXCEPTION 'Dossier non restitué';END IF;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION USING ERRCODE='P9099',MESSAGE='RECETTE_OK_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'P9099' THEN IF SQLERRM<>'RECETTE_OK_ROLLBACK' THEN RAISE;END IF;
 END;
END $recipe$;
