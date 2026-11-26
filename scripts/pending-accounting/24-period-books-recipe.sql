-- Phase 6 rollback recipe; run after the pending migrations in a test transaction.
DO $recipe$
DECLARE t uuid;u uuid;other uuid;dt date:=(now() AT TIME ZONE 'Africa/Dakar')::date;yr int;f date;r jsonb;gl jsonb;st jsonb;v jsonb;acct text;bank text;capital text;income text;previous_year int;prior jsonb;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' LIMIT 1;
 SELECT id INTO other FROM public.tenants WHERE id<>t LIMIT 1;
 SELECT code INTO bank FROM public.accounts WHERE tenant_id=t AND code='5210000' AND is_active;
 SELECT code INTO capital FROM public.accounts WHERE tenant_id=t AND code='1310000' AND is_active;
 SELECT code INTO income FROM public.accounts WHERE tenant_id=t AND class=7 AND is_active ORDER BY code LIMIT 1;
 IF u IS NULL OR other IS NULL OR bank IS NULL OR capital IS NULL OR income IS NULL THEN RAISE EXCEPTION 'Préconditions absentes';END IF;
 yr:=extract(year FROM dt)::int;previous_year:=yr-1;f:=make_date(yr,1,1);
 IF EXISTS(SELECT 1 FROM public.accounting_fiscal_years WHERE tenant_id=t AND fiscal_year>=previous_year) THEN RAISE EXCEPTION 'Utiliser une entreprise de test sans arrêté récent.';END IF;
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=t AND entry_date<f AND status='posted') THEN RAISE EXCEPTION 'Utiliser une fixture sans historique antérieur.';END IF;
 BEGIN
 -- Inject a synthetic balanced opening snapshot exclusively within the rollback fixture.
 -- This is not a legal closure and is never persisted.
 prior:=jsonb_build_object('carry',jsonb_build_array(jsonb_build_object('account_code',bank,'account_class',5,'balance',98765.43),jsonb_build_object('account_code',capital,'account_class',1,'balance',-98765.43)));
 INSERT INTO public.accounting_fiscal_years(tenant_id,fiscal_year,closed_by,note,snapshot) VALUES(t,previous_year,u,'RECETTE FICTIVE',prior);
 PERFORM set_config('request.jwt.claim.sub',u::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.accounting_period_books(t,f,dt,'balance',bank,NULL,0,20);
 IF r->>'opening_mode'<>'fiscal' OR (r->'rows'->0->>'opening')::numeric IS DISTINCT FROM 98765.43 THEN RAISE EXCEPTION 'Ouverture non reprise';END IF;
 gl:=public.accounting_period_books(t,f,dt,'ledger',bank,NULL,0,20);
 st:=public.accounting_account_statement(t,bank,f,dt,0);
 IF (st->>'opening_balance')::numeric IS DISTINCT FROM (r->'rows'->0->>'opening')::numeric OR (st->>'closing_balance')::numeric IS DISTINCT FROM (r->'rows'->0->>'closing')::numeric THEN RAISE EXCEPTION 'Interrogation et balance différentes';END IF;
 IF (gl->'totals'->>'debit')::numeric IS DISTINCT FROM (r->'totals'->>'debit')::numeric OR (gl->'totals'->>'credit')::numeric IS DISTINCT FROM (r->'totals'->>'credit')::numeric THEN RAISE EXCEPTION 'Grand livre et balance différents';END IF;
 r:=public.accounting_period_books(t,f,dt,'balance',capital,NULL,0,20);
 IF (r->'rows'->0->>'opening')::numeric IS DISTINCT FROM -98765.43 THEN RAISE EXCEPTION 'Report créditeur perdu';END IF;
 r:=public.accounting_period_books(t,f,dt,'balance',income,NULL,0,20);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE (x->>'opening')::numeric<>0) THEN RAISE EXCEPTION 'Compte de gestion reporté';END IF;
 r:=public.accounting_period_books(t,f,dt,'balance',NULL,NULL,0,1);
 IF jsonb_array_length(r->'rows')>1 OR (r->'totals'->>'opening_debit')::numeric IS DISTINCT FROM (r->'totals'->>'opening_credit')::numeric THEN RAISE EXCEPTION 'Totaux de sélection ou pagination invalides';END IF;
 BEGIN PERFORM public.accounting_period_books(other,f,dt);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Fuite tenant';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 RAISE EXCEPTION USING ERRCODE='P9099',MESSAGE='RECETTE_OK_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'P9099' THEN IF SQLERRM<>'RECETTE_OK_ROLLBACK' THEN RAISE;END IF;
 END;
END $recipe$;
