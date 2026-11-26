-- Phase 8: rollback-only integration recipe, after pending migrations in a test database.
DO $recipe$
DECLARE t uuid;u uuid;other uuid;ax uuid;ax2 uuid;c1 uuid;c2 uuid;alien uuid;lid uuid;dt date;mo date;acc text;amt numeric;before_debit numeric;before_credit numeric;after_debit numeric;after_credit numeric;shares jsonb;r jsonb;rr jsonb;ref text:=left(replace(gen_random_uuid()::text,'-',''),12);v int;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' LIMIT 1;
 SELECT id INTO other FROM public.tenants WHERE id<>t LIMIT 1;
 SELECT l.id,l.account_code,e.entry_date,l.debit-l.credit INTO lid,acc,dt,amt FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id JOIN public.accounts a ON a.tenant_id=l.tenant_id AND a.code=l.account_code
 WHERE l.tenant_id=t AND e.status='posted' AND l.account_code ~ '^[67]' AND a.is_active AND l.debit<>l.credit AND NOT EXISTS(SELECT 1 FROM public.accounting_month_closures m WHERE m.tenant_id=t AND m.month_start=date_trunc('month',e.entry_date)::date AND m.closed_at IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=t AND f.fiscal_year>=extract(year FROM e.entry_date)) ORDER BY e.entry_date DESC LIMIT 1;
 IF u IS NULL OR other IS NULL OR lid IS NULL THEN RAISE EXCEPTION 'Fixture ouverte requise';END IF;
 mo:=date_trunc('month',dt)::date;
 SELECT sum(debit),sum(credit) INTO before_debit,before_credit FROM public.journal_lines WHERE tenant_id=t;
 BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.create_accounting_analytic_dimension(t,NULL,'A'||upper(ref),'Recette axe');ax:=(r->>'id')::uuid;
 r:=public.create_accounting_analytic_dimension(t,NULL,'B'||upper(ref),'Recette axe 2');ax2:=(r->>'id')::uuid;
 r:=public.create_accounting_analytic_dimension(t,ax,'C1','Recette section 1');c1:=(r->>'id')::uuid;
 r:=public.create_accounting_analytic_dimension(t,ax,'C2','Recette section 2');c2:=(r->>'id')::uuid;
 r:=public.create_accounting_analytic_dimension(t,ax2,'C1','Autre axe');alien:=(r->>'id')::uuid;
 shares:=jsonb_build_array(jsonb_build_object('center_id',c1,'bps',3333),jsonb_build_object('center_id',c2,'bps',6667));
 BEGIN PERFORM public.save_accounting_analytic_allocation(t,ax,lid,jsonb_build_array(jsonb_build_object('center_id',c1,'bps',9999)),'Invalide',0);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Total incorrect accepté';EXCEPTION WHEN raise_exception THEN NULL;END;
 BEGIN PERFORM public.save_accounting_analytic_allocation(t,ax,lid,jsonb_build_array(jsonb_build_object('center_id',alien,'bps',10000)),'Invalide',0);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Section autre axe acceptée';EXCEPTION WHEN raise_exception THEN NULL;END;
 PERFORM public.save_accounting_analytic_allocation(t,ax,lid,shares,'Recette',0);
 BEGIN PERFORM public.save_accounting_analytic_allocation(t,ax,lid,shares,'Conflit',0);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Conflit non bloqué';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 PERFORM public.save_accounting_analytic_budget(t,ax,c1,mo,acc,1000,'Budget recette',0);
 BEGIN PERFORM public.save_accounting_analytic_budget(t,ax,c1,mo,acc,1200,'Conflit',0);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Budget conflit accepté';EXCEPTION WHEN SQLSTATE '40001' THEN NULL;END;
 r:=public.accounting_analytic_report(t,ax,mo,'summary','',0,100);
 rr:=public.accounting_analytic_report(t,ax2,mo,'summary','',0,100);
 IF (r->'totals'->>'ledger_signed')::numeric IS DISTINCT FROM (r->'totals'->>'allocated_signed')::numeric OR (rr->'totals'->>'unallocated_lines')::bigint-(r->'totals'->>'unallocated_lines')::bigint<>1 THEN RAISE EXCEPTION 'Ventilation non réconciliée ou axes non indépendants';END IF;
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r->'rows') x WHERE x->>'center_id'=c1::text AND x->>'account_code'=acc AND (x->>'budget')::numeric=1000) THEN RAISE EXCEPTION 'Budget non restitué';END IF;
 BEGIN PERFORM public.accounting_analytic_report(other,ax,mo);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Fuite tenant';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 SELECT sum(debit),sum(credit) INTO after_debit,after_credit FROM public.journal_lines WHERE tenant_id=t;
 IF before_debit IS DISTINCT FROM after_debit OR before_credit IS DISTINCT FROM after_credit THEN RAISE EXCEPTION 'Écritures générales modifiées';END IF;
 EXECUTE 'RESET ROLE';
 RAISE EXCEPTION USING ERRCODE='P9099',MESSAGE='RECETTE_OK_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'P9099' THEN IF SQLERRM<>'RECETTE_OK_ROLLBACK' THEN RAISE;END IF;
 END;
END $recipe$;
