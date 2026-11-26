-- Recette actualisée : passage par le même verrou que l'application, sans contournement.
-- Execute after pending migrations 12–21 on a test database; all mutations roll back.
DO $recipe$
DECLARE t uuid;u uuid;other uuid;bank text;contra text;fee text;dt date:=(now() AT TIME ZONE 'Africa/Dakar')::date;initial numeric;r jsonb;sid uuid;proposal jsonb;fee_id uuid;expected numeric;before_count int;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' LIMIT 1;
 SELECT id INTO other FROM public.tenants WHERE id<>t LIMIT 1;
 SELECT code INTO bank FROM public.accounts WHERE tenant_id=t AND code='5210000' AND is_active;
 SELECT code INTO contra FROM public.accounts WHERE tenant_id=t AND code='5710000' AND is_active;
 SELECT code INTO fee FROM public.accounts WHERE tenant_id=t AND class=6 AND account_type='general' AND is_active ORDER BY code LIMIT 1;
 IF u IS NULL OR other IS NULL OR bank IS NULL OR contra IS NULL OR fee IS NULL OR EXISTS(SELECT 1 FROM public.accounting_bank_statements WHERE tenant_id=t AND account_code=bank AND status<>'cancelled') THEN RAISE EXCEPTION 'Préconditions de recette absentes';END IF;
 SELECT coalesce(sum(l.debit-l.credit),0) INTO initial FROM public.journal_lines l JOIN public.journal_entries e ON e.id=l.entry_id AND e.tenant_id=l.tenant_id WHERE l.tenant_id=t AND l.account_code=bank AND e.status='posted' AND e.entry_date<dt;
 BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.post_locked_manual_entry(t,'BQ',dt,'RECETTE UNIQUE','REF-UNIQUE',jsonb_build_array(jsonb_build_object('account_code',bank,'debit',98765.43,'credit',0),jsonb_build_object('account_code',contra,'debit',0,'credit',98765.43)),gen_random_uuid(), md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','BQ'||':'||to_char(dt,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
 FOR i IN 1..2 LOOP
 PERFORM public.post_locked_manual_entry(t,'BQ',dt,'RECETTE AMBIGUE','REF-DOUBLE',jsonb_build_array(jsonb_build_object('account_code',bank,'debit',76543.21,'credit',0),jsonb_build_object('account_code',contra,'debit',0,'credit',76543.21)),gen_random_uuid(), md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','BQ'||':'||to_char(dt,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
 END LOOP;
 r:=public.create_bank_statement(t,bank,'RECETTE AUTO',dt,dt,initial,initial+98765.43+76543.21-321.09,jsonb_build_array(
 jsonb_build_object('date',dt,'label','Unique','reference','REF-UNIQUE','amount',98765.43),
 jsonb_build_object('date',dt,'label','Ambigu','reference','REF-DOUBLE','amount',76543.21),
 jsonb_build_object('date',dt,'label','Frais','reference','REF-FRAIS','amount',-321.09)));
 sid:=(r->>'id')::uuid;
 r:=public.bank_pointing_suggestions(t,sid);
 IF (r->>'suggested')::int<>1 OR (r->>'ambiguous')::int<>1 THEN RAISE EXCEPTION 'Propositions incohérentes : %',r;END IF;
 proposal:=r->'rows'->0;
 BEGIN PERFORM public.bank_pointing_suggestions(other,sid);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Fuite tenant';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM public.confirm_bank_pointing_batch(t,sid,jsonb_build_array(proposal));
 BEGIN PERFORM public.confirm_bank_pointing_batch(t,sid,jsonb_build_array(proposal));RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Double pointage accepté';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 SELECT id INTO STRICT fee_id FROM public.accounting_bank_statement_lines WHERE tenant_id=t AND statement_id=sid AND reference='REF-FRAIS';
 r:=public.post_missing_bank_operation(t,sid,fee_id,fee,-321.09,'Frais justifiés de recette');
 IF r->>'success'<>'true' THEN RAISE EXCEPTION 'Frais non comptabilisés';END IF;
 BEGIN PERFORM public.post_missing_bank_operation(t,sid,fee_id,fee,-321.09,'Doublon');RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Double comptabilisation acceptée';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 r:=public.bank_statement_report(t,sid,0);
 IF (r->>'bank_pending_count')::int<>1 THEN RAISE EXCEPTION 'Solde des pointages incorrect';END IF;
 BEGIN PERFORM public.finish_bank_statement(t,sid,NULL);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Validation prématurée';EXCEPTION WHEN raise_exception THEN NULL;END;
 EXECUTE 'RESET ROLE';
 RAISE EXCEPTION USING ERRCODE='P9099',MESSAGE='RECETTE_OK_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'P9099' THEN IF SQLERRM<>'RECETTE_OK_ROLLBACK' THEN RAISE;END IF;
 END;
END $recipe$;
