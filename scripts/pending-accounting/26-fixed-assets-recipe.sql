-- Recette actualisée : passage par le même verrou que l'application, sans contournement.
-- Phase 7 rollback recipe. Only run in a test database after pending migrations.
DO $recipe$
DECLARE t uuid;u uuid;other uuid;bank text;dt date:=(now() AT TIME ZONE 'Africa/Dakar')::date;svc date;last_month date;acq uuid;aid uuid;r jsonb;d jsonb;due jsonb;x jsonb;sale uuid;before_count int;fixture_code text:='RECETTE-'||left(gen_random_uuid()::text,24);
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' LIMIT 1;
 SELECT id INTO other FROM public.tenants WHERE id<>t LIMIT 1;
 SELECT code INTO bank FROM public.accounts WHERE tenant_id=t AND code='5210000' AND is_active;
 svc:=(date_trunc('month',dt)-interval '1 month')::date;
 last_month:=date_trunc('month',dt)::date-1;
 IF u IS NULL OR other IS NULL OR bank IS NULL OR extract(year FROM svc)<>extract(year FROM dt) OR EXISTS(SELECT 1 FROM public.accounting_month_closures WHERE tenant_id=t AND month_start IN(svc,date_trunc('month',dt)::date) AND closed_at IS NOT NULL) OR EXISTS(SELECT 1 FROM public.accounting_fiscal_years WHERE tenant_id=t AND fiscal_year>=extract(year FROM dt)) THEN RAISE EXCEPTION 'Préconditions de recette absentes : exercice courant, deux mois ouverts.';END IF;
 BEGIN
 INSERT INTO public.accounts(tenant_id,code,name,class,account_type,is_active) VALUES
 (t,'2449999','Recette matériel',2,'general',true),(t,'2849999','Recette amortissements',2,'general',true),(t,'6813999','Recette dotations',6,'general',true),(t,'8119999','Recette valeur de sortie',8,'general',true),(t,'8219999','Recette produit de cession',8,'general',true)
 ON CONFLICT(tenant_id,code) DO NOTHING;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.post_locked_manual_entry(t,'OD',svc,'Recette acquisition',fixture_code,jsonb_build_array(jsonb_build_object('account_code','2449999','debit',120000,'credit',0),jsonb_build_object('account_code',bank,'debit',0,'credit',120000)),gen_random_uuid(), md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(svc,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
 SELECT id INTO STRICT acq FROM public.journal_lines WHERE tenant_id=t AND entry_id=(r->>'entry_id')::uuid AND account_code='2449999';
 SELECT count(*) INTO before_count FROM public.journal_entries WHERE tenant_id=t;
 BEGIN PERFORM public.register_accounting_asset(t,fixture_code,'Recette','',acq,svc,12,0,'2849999','6813999','Facture test',false);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Attestation absente acceptée';EXCEPTION WHEN raise_exception THEN NULL;END;
 r:=public.register_accounting_asset(t,fixture_code,'Recette','',acq,svc,12,0,'2849999','6813999','Facture test',true);
 aid:=(r->>'id')::uuid;
 IF (SELECT count(*) FROM public.journal_entries WHERE tenant_id=t)<>before_count THEN RAISE EXCEPTION 'Acquisition comptabilisée deux fois';END IF;
 BEGIN PERFORM public.register_accounting_asset(t,fixture_code||'B','Recette','',acq,svc,12,0,'2849999','6813999','Doublon',true);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Acquisition réutilisée';EXCEPTION WHEN unique_violation THEN NULL;END;
 d:=public.accounting_asset_detail(t,aid);
 due:=d->'plan'->0;
 IF (due->>'through_date')::date<>last_month OR (SELECT sum((v->>'amount')::numeric) FROM jsonb_array_elements(d->'plan') v)<>120000 THEN RAISE EXCEPTION 'Plan incohérent';END IF;
 BEGIN PERFORM public.accounting_asset_detail(other,aid);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Fuite tenant';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 r:=public.post_accounting_asset_depreciation(t,aid,(due->>'period_start')::date,(due->>'amount')::numeric);
 BEGIN PERFORM public.post_accounting_asset_depreciation(t,aid,(due->>'period_start')::date,(due->>'amount')::numeric);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Double dotation';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 BEGIN PERFORM public.reverse_manual_accounting_entry(t,(r->>'entry_id')::uuid,dt,'Recette');RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Extourne directe acceptée';EXCEPTION WHEN raise_exception THEN NULL;END;
 r:=public.post_locked_manual_entry(t,'OD',dt,'Produit cession test',fixture_code,jsonb_build_array(jsonb_build_object('account_code',bank,'debit',100000,'credit',0),jsonb_build_object('account_code','8219999','debit',0,'credit',100000)),gen_random_uuid(), md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(dt,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);
 SELECT id INTO STRICT sale FROM public.journal_lines WHERE tenant_id=t AND entry_id=(r->>'entry_id')::uuid AND account_code='8219999';
 x:=public.preview_accounting_asset_disposal(t,aid,dt);
 IF (x->>'blocked')::boolean THEN RAISE EXCEPTION 'Sortie test bloquée';END IF;
 BEGIN PERFORM public.dispose_accounting_asset(t,aid,dt,'sale','8119999',sale,'Test',(x->>'net')::numeric+1,true);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='VNC erronée acceptée';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 r:=public.dispose_accounting_asset(t,aid,dt,'sale','8119999',sale,'Test',(x->>'net')::numeric,true);
 d:=public.accounting_asset_detail(t,aid);
 IF (d->'asset'->>'disposed_on')::date<>dt OR (d->>'posted')::numeric IS DISTINCT FROM (x->>'cumulative')::numeric OR (r->>'net')::numeric IS DISTINCT FROM (x->>'net')::numeric THEN RAISE EXCEPTION 'Sortie incohérente';END IF;
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=t AND id=(r->>'entry_id')::uuid AND total_debit<>total_credit) THEN RAISE EXCEPTION 'Sortie déséquilibrée';END IF;
 EXECUTE 'RESET ROLE';
 RAISE EXCEPTION USING ERRCODE='P9099',MESSAGE='RECETTE_OK_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'P9099' THEN IF SQLERRM<>'RECETTE_OK_ROLLBACK' THEN RAISE;END IF;
 END;
END $recipe$;
