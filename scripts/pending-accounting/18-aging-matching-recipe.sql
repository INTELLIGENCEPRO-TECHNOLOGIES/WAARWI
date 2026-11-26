-- Recette actualisée : passage par le même verrou que l'application, sans contournement.
-- Run after 12–17, in test or explicit rollback recipe only.
DO $recipe$
DECLARE t uuid;u uuid;other uuid;aux text;bank text;expense text;dt date;r jsonb;r2 jsonb;report jsonb;line1 uuid;line2 uuid;before_net numeric;after_net numeric;tag text;cnt int;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' LIMIT 1;
 SELECT id INTO other FROM public.tenants WHERE id<>t LIMIT 1;
 SELECT a.code INTO aux FROM public.accounts a JOIN public.customers c ON c.tenant_id=a.tenant_id AND c.account_code=a.code WHERE a.tenant_id=t AND a.is_active AND a.account_type='auxiliary' AND a.code LIKE '411%' GROUP BY a.code HAVING count(*)=1 ORDER BY a.code LIMIT 1;
 SELECT code INTO bank FROM public.accounts WHERE tenant_id=t AND class=5 AND account_type='general' AND is_active ORDER BY code LIMIT 1;
 SELECT code INTO expense FROM public.accounts WHERE tenant_id=t AND code LIKE '658%' AND account_type='general' AND is_active ORDER BY code LIMIT 1;
 IF u IS NULL OR other IS NULL OR aux IS NULL OR bank IS NULL OR expense IS NULL THEN RAISE EXCEPTION 'Fixtures de recette insuffisantes';END IF;
 dt:=(now() AT TIME ZONE 'Africa/Dakar')::date;tag:='RECETTE '||gen_random_uuid()::text;
 BEGIN
  PERFORM set_config('request.jwt.claim.sub',u::text,true);
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  report:=public.accounting_open_items(t,'client',dt,'summary',aux);
  before_net:=(report->'totals'->>'net')::numeric;
  BEGIN PERFORM public.accounting_open_items(other,'client',dt);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Fuite tenant';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  r:=public.post_locked_manual_entry(t,'OD',dt,tag,'',jsonb_build_array(jsonb_build_object('account_code',aux,'debit',12345,'credit',0,'label',tag),jsonb_build_object('account_code',bank,'debit',0,'credit',12345,'label',tag)),gen_random_uuid(), md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(dt,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
  r2:=public.post_locked_manual_entry(t,'OD',dt,tag,'',jsonb_build_array(jsonb_build_object('account_code',aux,'debit',0,'credit',12245,'label',tag),jsonb_build_object('account_code',bank,'debit',12245,'credit',0,'label',tag)),gen_random_uuid(), md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(dt,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
  SELECT id INTO STRICT line1 FROM public.journal_lines WHERE tenant_id=t AND entry_id=(r->>'entry_id')::uuid AND account_code=aux;
  SELECT id INTO STRICT line2 FROM public.journal_lines WHERE tenant_id=t AND entry_id=(r2->>'entry_id')::uuid AND account_code=aux;
  report:=public.accounting_open_items(t,'client',dt,'items',aux,tag);
  IF (report->>'count')::int<>2 OR (report->'totals'->>'unknown')::numeric<>12345 OR (report->'totals'->>'credit')::numeric<>12245 OR (report->'totals'->>'net')::numeric<>100 THEN RAISE EXCEPTION 'Postes ouverts incorrects';END IF;
  PERFORM public.set_accounting_line_due_date(t,line1,dt+30,'Contrat de recette',0);
  BEGIN PERFORM public.set_accounting_line_due_date(t,line1,dt+31,'Conflit',0);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Conflit non bloqué';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
  report:=public.accounting_open_items(t,'client',dt,'summary',aux,tag,'current');
  IF (report->'totals'->>'gross')::numeric<>12345 THEN RAISE EXCEPTION 'Ventilation échéance invalide';END IF;
  BEGIN PERFORM public.set_accounting_line_due_date(t,line2,dt+30,'Interdit',0);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Échéance sur règlement acceptée';EXCEPTION WHEN raise_exception THEN NULL;END;
  BEGIN PERFORM public.match_accounting_small_difference(t,aux,ARRAY[line1,line2],dt,expense,101,'Recette');RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Écart obsolète accepté';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
  r:=public.match_accounting_small_difference(t,aux,ARRAY[line1,line2],dt,expense,100,'Recette écart justifié');
  IF r->>'success'<>'true' OR (r->>'difference')::numeric<>100 THEN RAISE EXCEPTION 'OD écart invalide';END IF;
  SELECT count(*) INTO cnt FROM public.accounting_match_lines WHERE tenant_id=t AND line_id IN(line1,line2) AND released_at IS NULL;
  IF cnt<>2 THEN RAISE EXCEPTION 'Lettrage incomplet';END IF;
  report:=public.accounting_open_items(t,'client',dt,'summary',aux);
  after_net:=(report->'totals'->>'net')::numeric;
  IF before_net IS DISTINCT FROM after_net THEN RAISE EXCEPTION 'Le solde net ne se réconcilie pas';END IF;
  BEGIN PERFORM public.match_accounting_small_difference(t,aux,ARRAY[line1,line2],dt,expense,100,'Recette');RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Double OD acceptée';EXCEPTION WHEN raise_exception THEN NULL;END;
  BEGIN PERFORM public.confirm_accounting_matching_batch(t,aux,dt,jsonb_build_array(jsonb_build_object('root',gen_random_uuid(),'line_ids',jsonb_build_array(line1,line2))));RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Proposition inventée acceptée';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION USING ERRCODE='P9099',MESSAGE='RECETTE_OK_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'P9099' THEN IF SQLERRM<>'RECETTE_OK_ROLLBACK' THEN RAISE;END IF;
 END;
END $recipe$;
