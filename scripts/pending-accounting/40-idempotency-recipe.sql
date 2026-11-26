-- Recette actualisée : passage par le même verrou que l'application, sans contournement.
-- Recipe 40: isolated database only. All changes roll back.
BEGIN;
DO $recipe$
DECLARE t uuid; other uuid; u uuid; d date:=(now() AT TIME ZONE 'Africa/Dakar')::date; k uuid:=gen_random_uuid(); k2 uuid:=gen_random_uuid(); k3 uuid:=gen_random_uuid(); a jsonb; b jsonb; c jsonb; lines jsonb; bad jsonb; before_n bigint; after_n bigint;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO STRICT other FROM public.tenants WHERE id<>t ORDER BY id LIMIT 1;
 SELECT id INTO STRICT u FROM public.profiles WHERE tenant_id=t AND role='admin' ORDER BY id LIMIT 1;
 lines:='[{"account_code":"5210000","debit":100,"credit":0},{"account_code":"5710000","debit":0,"credit":100}]';
 bad:='[{"account_code":"5210000","debit":100,"credit":0},{"account_code":"5710000","debit":0,"credit":90}]';
 SELECT count(*) INTO before_n FROM public.journal_entries WHERE tenant_id=t;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 a:=public.post_locked_manual_entry(t,'OD',d,'Recette idempotence','P10',lines,k, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(d,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
 b:=public.post_locked_manual_entry(t,'OD',d,'Recette idempotence','P10',lines,k, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(d,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
 IF NOT coalesce((a->>'success')::boolean,false) OR a->>'entry_id' IS DISTINCT FROM b->>'entry_id' OR NOT coalesce((b->>'already_posted')::boolean,false) THEN RAISE EXCEPTION 'Réessai incorrect';END IF;
 c:=public.post_locked_manual_entry(t,'OD',d,'Recette idempotence','P10',lines,k2, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(d,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
 IF c->>'entry_id' IS NULL OR c->>'entry_id'=a->>'entry_id' THEN RAISE EXCEPTION 'Saisie volontaire distincte refusée';END IF;
 BEGIN PERFORM public.post_locked_manual_entry(t,'OD',d,'Autre contenu','P10',lines,k, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(d,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Collision acceptée';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.post_locked_manual_entry(t,'OD',d,'Recette rejet','P10',bad,k3, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(d,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Déséquilibre accepté';EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT ILIKE '%desequilibree%' THEN RAISE;END IF;END;
 c:=public.post_locked_manual_entry(t,'OD',d,'Recette rejet','P10',lines,k3, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(d,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
 IF NOT coalesce((c->>'success')::boolean,false) THEN RAISE EXCEPTION 'Reprise après erreur impossible';END IF;
 BEGIN PERFORM public.post_locked_manual_entry(t,'OD',d,'Sans clé','P10',lines,NULL, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(d,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Clé absente acceptée';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.post_locked_manual_entry(other,'OD',d,'Autre tenant','P10',lines,k, md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(other,'accounting_journal','OD'||':'||to_char(d,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Fuite tenant';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.create_manual_journal_entry(t,'OD',d,'Contournement','P10',lines);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Ancien RPC accessible';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 SELECT count(*) INTO after_n FROM public.journal_entries WHERE tenant_id=t;
 IF after_n-before_n<>3 THEN RAISE EXCEPTION 'Nombre de pièces incorrect';END IF;
 IF has_function_privilege('anon','public.post_locked_manual_entry(uuid,text,date,text,text,jsonb,uuid,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.create_manual_journal_entry_idempotent(uuid,text,date,text,text,jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'RPC exposée sans verrou';END IF;
END $recipe$;
ROLLBACK;
