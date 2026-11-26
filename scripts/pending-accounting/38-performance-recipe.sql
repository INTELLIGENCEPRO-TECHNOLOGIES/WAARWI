-- Staging only: run after script 37, with representative data and an authenticated accountant.
-- Capture EXPLAIN (ANALYZE, BUFFERS) before/after script 37 on an isolated clone.
-- Do not run synthetic inserts or large EXPLAIN ANALYZE scans in production.
DO $audit$
DECLARE n text;
BEGIN
 FOREACH n IN ARRAY ARRAY['idx_acc_entries_tenant_date_piece','idx_acc_lines_tenant_entry','idx_acc_lines_tenant_account_entry','idx_acc_budget_axis_month'] LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.'||n) AND indisvalid AND indisready) THEN RAISE EXCEPTION 'Index absent/invalide : %',n;END IF;
 END LOOP;
END $audit$;

-- Verify consistency of one-statement export versus ordinary pagination.
-- Use a test tenant with >= 101 but <= 5000 filtered ledger lines.
DO $recipe$
DECLARE t uuid;u uuid;dt date:=(now() AT TIME ZONE 'Africa/Dakar')::date;f date;r jsonb;p jsonb;offset_n int:=0;expected jsonb:='[]';n int;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' LIMIT 1;
 IF u IS NULL THEN RAISE EXCEPTION 'Administrateur de recette requis';END IF;
 f:=date_trunc('year',dt)::date;
 BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.accounting_period_books(t,f,dt,'ledger',NULL,NULL,0,5000);
 n:=(r->>'count')::int;
 IF n<101 OR n>5000 THEN RAISE EXCEPTION 'Fixture requise : 101 à 5000 lignes';END IF;
 IF jsonb_array_length(r->'rows')<>n THEN RAISE EXCEPTION 'Export incomplet';END IF;
 WHILE offset_n<n LOOP
 p:=public.accounting_period_books(t,f,dt,'ledger',NULL,NULL,offset_n,100);
 IF p->'totals' IS DISTINCT FROM r->'totals' OR p->>'count' IS DISTINCT FROM r->>'count' THEN RAISE EXCEPTION 'Totaux différents';END IF;
 expected:=expected||(p->'rows');offset_n:=offset_n+100;
 END LOOP;
 IF expected IS DISTINCT FROM r->'rows' THEN RAISE EXCEPTION 'Ordre ou contenu différent';END IF;
 BEGIN PERFORM public.accounting_period_books(t,f,dt,'ledger',NULL,NULL,100,5000);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Export à offset non nul accepté';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 EXECUTE 'RESET ROLE';
 RAISE EXCEPTION USING ERRCODE='P9099',MESSAGE='RECETTE_OK_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'P9099' THEN IF SQLERRM<>'RECETTE_OK_ROLLBACK' THEN RAISE;END IF;
 END;
END $recipe$;

-- Benchmark matrix on staging: 10k / 100k / 1M journal lines distributed across tenants.
-- Measure first page and deep page, account inquiry, monthly balance, aging, budget and ledger exports.
-- Record plan, actual duration, shared reads/hits, temporary writes, output bytes and insert latency.
-- Compare identical totals and sorted IDs. Test tenant isolation and simultaneous posting.
-- Export: test 5001 rows and >5 MiB rejected, 5000 bounded rows returned without truncation.
-- Analytic: compare export with paged summary AND allocation lines; verify signed cents and budget.
-- Record results before keeping each candidate index. Do not remove existing indexes on this evidence alone.
