-- Recette actualisée : passage par le même verrou que l'application, sans contournement.
-- Run ONLY after 12,13,14 migrations in a test database, or in an explicit rollback recipe.
-- Every test mutation is rolled back even if the scenario succeeds.
DO $recipe$
DECLARE t uuid; u uuid; other uuid; a text; b text; template_id uuid; due date; next_due date; r jsonb; retry jsonb; lines jsonb; n int;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' LIMIT 1;
 SELECT id INTO other FROM public.tenants WHERE id<>t LIMIT 1;
 SELECT code INTO a FROM public.accounts WHERE tenant_id=t AND is_active AND class=5 AND account_type='general' ORDER BY code LIMIT 1;
 SELECT code INTO b FROM public.accounts WHERE tenant_id=t AND is_active AND class=7 AND account_type='general' ORDER BY code LIMIT 1;
 IF u IS NULL OR other IS NULL OR a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'Données de recette insuffisantes';END IF;
 due:=(now() AT TIME ZONE 'Africa/Dakar')::date;
 lines:=jsonb_build_array(jsonb_build_object('account_code',a,'debit',1234.56,'credit',0,'label','Recette'),jsonb_build_object('account_code',b,'debit',0,'credit',1234.56,'label','Recette'));
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT count(*) INTO n FROM public.list_accounting_journals(t) WHERE is_system;
  IF n<>5 THEN RAISE EXCEPTION 'Journaux système absents';END IF;
  PERFORM public.save_accounting_journal(t,'ZZQ','Recette journal',true,0);
  BEGIN PERFORM public.save_accounting_journal(t,'ZZQ','Conflit',true,0);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Conflit non bloqué';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
  BEGIN PERFORM public.save_accounting_journal(t,'VE','Ventes',false,0);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Désactivation système acceptée';EXCEPTION WHEN raise_exception THEN NULL;END;
  BEGIN PERFORM public.list_accounting_journals(other);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Fuite tenant';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  r:=public.save_accounting_entry_template(t,'RECETTE '||gen_random_uuid(),'ZZQ','Recette récurrence',lines);
  template_id:=(r->>'id')::uuid;
  BEGIN PERFORM public.save_accounting_entry_template(t,'Invalide','ZZQ','Recette',jsonb_set(lines,'{1,credit}','100'::jsonb));RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Déséquilibre accepté';EXCEPTION WHEN raise_exception THEN NULL;END;
  PERFORM public.schedule_accounting_entry_template(t,template_id,due,1);
  r:=public.post_locked_template_occurrence(t,template_id,due,'Recette récurrence','',lines, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','ZZQ'||':'||to_char(due,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
  retry:=public.post_locked_template_occurrence(t,template_id,due,'Recette récurrence','',lines, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','ZZQ'||':'||to_char(due,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
  IF retry->>'entry_id' IS DISTINCT FROM r->>'entry_id' OR retry->>'already_posted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Idempotence invalide';END IF;
  next_due:=(r->>'next_due_on')::date;
  IF date_trunc('month',next_due)<>date_trunc('month',due)+interval '1 month' THEN RAISE EXCEPTION 'Prochaine échéance invalide';END IF;
  SELECT count(*) INTO n FROM public.accounting_template_occurrences o WHERE o.tenant_id=t AND o.entry_id=(r->>'entry_id')::uuid;
  IF n<>1 THEN RAISE EXCEPTION 'Occurrence non unique';END IF;
  BEGIN PERFORM public.post_locked_template_occurrence(t,template_id,due,'Contenu différent','',lines, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','ZZQ'||':'||to_char(due,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Doublon accepté';EXCEPTION WHEN raise_exception THEN NULL;END;
  PERFORM public.save_accounting_journal(t,'ZZQ','Recette journal',false,1);
  BEGIN PERFORM public.post_locked_manual_entry(t,'ZZQ',due,'Journal inactif','',lines,gen_random_uuid(), md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','ZZQ'||':'||to_char(due,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Journal inactif accepté';EXCEPTION WHEN raise_exception OR invalid_parameter_value THEN NULL;END;
  IF NOT EXISTS(SELECT 1 FROM public.list_accounting_journals(t) WHERE code='ZZQ' AND NOT is_active) THEN RAISE EXCEPTION 'Historique du journal perdu';END IF;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION USING ERRCODE='P9099',MESSAGE='RECETTE_OK_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'P9099' THEN IF SQLERRM<>'RECETTE_OK_ROLLBACK' THEN RAISE; END IF;
 END;
END $recipe$;
