-- Recette actualisée : passage par le même verrou que l'application, sans contournement.
-- À exécuter après le lot, uniquement après autorisation, puis ROLLBACK.
-- Fixture 2025 sur TEST COMPTA : les écritures réelles commencent en 2026.
BEGIN;
DO $test$
DECLARE t uuid;u uuid;other uuid;e1 uuid;e2 uuid;yr int:=2025;d date:='2025-12-15';r jsonb;s jsonb;r2 jsonb;blocked boolean;opening numeric;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO STRICT other FROM public.tenants WHERE id<>t ORDER BY id LIMIT 1;
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' ORDER BY id LIMIT 1;
 IF u IS NULL OR EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=t AND entry_date<'2026-01-01') OR EXISTS(SELECT 1 FROM public.accounting_fiscal_years WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.accounting_month_closures WHERE tenant_id=t AND month_start BETWEEN '2025-01-01' AND '2025-12-31' AND closed_at IS NOT NULL) THEN RAISE EXCEPTION 'Préconditions de recette indisponibles : choisir un exercice fictif vierge.'; END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 -- Insérer les pièces fictives avant de fermer les mois. Les données sont annulées.
 INSERT INTO public.journal_entries(tenant_id,entry_number,journal_type,entry_date,reference,description,total_debit,total_credit,is_balanced,source_type,status,posted_at,posted_by)
 VALUES(t,'RECETTE-EXERCICE-1','OD',d,'TEST','RECETTE EXERCICE',1000,1000,true,'manual','posted',now(),u) RETURNING id INTO e1;
 INSERT INTO public.journal_lines(tenant_id,entry_id,account_code,account_name,debit,credit)
 SELECT t,e1,a.code,a.name,CASE WHEN a.code='5210000' THEN 1000 ELSE 0 END,CASE WHEN a.code='7010000' THEN 1000 ELSE 0 END FROM public.accounts a WHERE a.tenant_id=t AND a.code IN ('5210000','7010000');
 INSERT INTO public.journal_entries(tenant_id,entry_number,journal_type,entry_date,reference,description,total_debit,total_credit,is_balanced,source_type,status,posted_at,posted_by)
 VALUES(t,'RECETTE-EXERCICE-2','OD',d,'TEST','RECETTE EXERCICE',200,200,true,'manual','posted',now(),u) RETURNING id INTO e2;
 INSERT INTO public.journal_lines(tenant_id,entry_id,account_code,account_name,debit,credit)
 SELECT t,e2,a.code,a.name,CASE WHEN a.code='6010000' THEN 200 ELSE 0 END,CASE WHEN a.code='5210000' THEN 200 ELSE 0 END FROM public.accounts a WHERE a.tenant_id=t AND a.code IN ('5210000','6010000');
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.preview_fiscal_year(t,yr,'1310000','1390000');s:=r->'snapshot';
 IF (s->>'result')::numeric IS DISTINCT FROM 800 OR (s->>'carry_debit')::numeric IS DISTINCT FROM 800 OR (s->>'carry_credit')::numeric IS DISTINCT FROM 800 OR (s->>'blocked')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Simulation de RAN incorrecte : %',s;END IF;
 blocked:=false;BEGIN PERFORM public.close_fiscal_year(t,yr,'1310000','1390000',r->>'review_token','Recette');EXCEPTION WHEN SQLSTATE '55000' THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Clôture autorisée avant les clôtures mensuelles.';END IF;
 blocked:=false;BEGIN PERFORM public.preview_fiscal_year(other,yr,'1310000','1390000');EXCEPTION WHEN insufficient_privilege THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Isolation inter-tenant échouée.';END IF;
 EXECUTE 'RESET ROLE';
 -- Simuler les douze attestations mensuelles ; la RPC mensuelle est déjà testée séparément.
 INSERT INTO public.accounting_month_closures(tenant_id,month_start,closed_at,closed_by,note,control_snapshot)
 SELECT t,m::date,now(),u,'Fixture de recette','{}'::jsonb FROM generate_series('2025-01-01'::timestamp,'2025-12-01'::timestamp,interval '1 month') m
 ON CONFLICT(tenant_id,month_start) DO UPDATE SET closed_at=excluded.closed_at,closed_by=excluded.closed_by,note=excluded.note,control_snapshot=excluded.control_snapshot;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.preview_fiscal_year(t,yr,'1310000','1390000');s:=r->'snapshot';
 IF (s->>'blocked')::boolean IS DISTINCT FROM false THEN RAISE EXCEPTION 'Clôture encore bloquée : %',s;END IF;
 blocked:=false;BEGIN PERFORM public.close_fiscal_year(t,yr,'1310000','1390000','invalid','Recette');EXCEPTION WHEN SQLSTATE '55000' THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Jeton périmé accepté.';END IF;
 r2:=public.close_fiscal_year(t,yr,'1310000','1390000',r->>'review_token','Recette');
 IF (r2->>'success')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Clôture non confirmée.';END IF;
 r2:=public.close_fiscal_year(t,yr,'1310000','1390000',r->>'review_token','Recette');
 IF (r2->>'already_closed')::boolean IS DISTINCT FROM true THEN RAISE EXCEPTION 'Double clôture.';END IF;
 r:=public.accounting_account_statement(t,'5210000','2026-01-01','2026-01-01',0);
 IF r->>'opening_mode' IS DISTINCT FROM 'fiscal' OR (r->>'opening_balance')::numeric IS DISTINCT FROM 800 THEN RAISE EXCEPTION 'RAN banque non repris.';END IF;
 r:=public.accounting_account_statement(t,'7010000','2026-01-01','2026-01-01',0);
 IF (r->>'opening_balance')::numeric IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Compte de gestion non remis à zéro.';END IF;
 r:=public.accounting_account_statement(t,'1310000','2026-01-01','2026-01-01',0);
 IF (r->>'opening_balance')::numeric IS DISTINCT FROM -800 THEN RAISE EXCEPTION 'Résultat non reporté.';END IF;
 blocked:=false;BEGIN PERFORM public.post_locked_manual_entry(t,'OD',d,'RECETTE VERROU','TEST',jsonb_build_array(jsonb_build_object('account_code','5210000','debit',1,'credit',0),jsonb_build_object('account_code','7010000','debit',0,'credit',1)),gen_random_uuid(), md5('recette-verrou:'||auth.uid()::text)::uuid, (public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(d,'YYYY-MM'),md5('recette-verrou:'||auth.uid()::text)::uuid,'acquire')->>'token')::uuid);EXCEPTION WHEN SQLSTATE '55000' THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Écriture dans exercice clôturé acceptée.';END IF;
 EXECUTE 'RESET ROLE';
END;$test$;
ROLLBACK;
