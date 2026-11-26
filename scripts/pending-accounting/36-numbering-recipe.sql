-- Staging only, after installation of script 35. Entire fixture rolls back.
DO $recipe$
DECLARE t uuid;u uuid;dt date:=(now() AT TIME ZONE 'Africa/Dakar')::date;prev date;cur date;closed_month date;yr int;old_yr int;code text:='OD';debit_code text;credit_code text;r jsonb;n1 text;n2 text;n3 text;observed int;stored int;old_observed int;old_stored int;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' LIMIT 1;
 SELECT a.code INTO debit_code FROM public.accounts a WHERE a.tenant_id=t AND a.code='5210000' AND a.is_active;
 SELECT a.code INTO credit_code FROM public.accounts a WHERE a.tenant_id=t AND a.code='5710000' AND a.is_active;
 yr:=extract(year FROM dt)::int;old_yr:=yr-1;prev:=make_date(old_yr,12,31);cur:=dt;closed_month:=make_date(old_yr,11,1);
 IF u IS NULL OR debit_code IS NULL OR credit_code IS NULL OR old_yr<2000 OR EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=t AND f.fiscal_year>=old_yr) OR EXISTS(SELECT 1 FROM public.accounting_month_closures c WHERE c.tenant_id=t AND c.month_start IN(date_trunc('month',prev)::date,date_trunc('month',cur)::date) AND c.closed_at IS NOT NULL) THEN RAISE EXCEPTION 'Fixture : deux exercices ouverts et comptes actifs requis.';END IF;
 BEGIN
 PERFORM set_config('request.jwt.claim.sub',u::text,true);PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 SELECT coalesce(max(right(entry_number,5)::int),0) INTO observed FROM public.journal_entries WHERE tenant_id=t AND entry_number ~ ('^OD'||to_char(cur,'YY')||'[0-9]{5}$');
 SELECT coalesce(max(right(entry_number,5)::int),0) INTO old_observed FROM public.journal_entries WHERE tenant_id=t AND entry_number ~ ('^OD'||to_char(prev,'YY')||'[0-9]{5}$');
 SELECT coalesce(max(last_number),0) INTO stored FROM public.accounting_sequences WHERE tenant_id=t AND journal_type=code AND fiscal_year=yr%100;
 SELECT coalesce(max(last_number),0) INTO old_stored FROM public.accounting_sequences WHERE tenant_id=t AND journal_type=code AND fiscal_year=old_yr%100;
 IF greatest(observed,stored,old_observed,old_stored)>99996 THEN RAISE EXCEPTION 'Fixture numérotation insuffisante';END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.create_manual_journal_entry(t,code,prev,'Recette exercice précédent','RECETTE-AN',jsonb_build_array(jsonb_build_object('account_code',debit_code,'debit',100,'credit',0),jsonb_build_object('account_code',credit_code,'debit',0,'credit',100)));
 IF NOT coalesce((r->>'success')::boolean,false) THEN RAISE EXCEPTION 'Saisie antérieure refusée : %',r;END IF;
 n1:=r->>'piece_number';
 IF n1 IS DISTINCT FROM code||to_char(prev,'YY')||lpad((greatest(old_observed,old_stored)+1)::text,5,'0') THEN RAISE EXCEPTION 'Millésime antérieur incorrect : %',n1;END IF;
 r:=public.create_manual_journal_entry(t,code,cur,'Recette exercice courant','RECETTE-AN',jsonb_build_array(jsonb_build_object('account_code',debit_code,'debit',100,'credit',0),jsonb_build_object('account_code',credit_code,'debit',0,'credit',100)));
 n2:=r->>'piece_number';
 IF n2 IS DISTINCT FROM code||to_char(cur,'YY')||lpad((greatest(observed,stored)+1)::text,5,'0') THEN RAISE EXCEPTION 'Numéro courant incorrect : %',n2;END IF;
 EXECUTE 'RESET ROLE';
 -- Deliberately stale internal counter, only in the rollback fixture.
 UPDATE public.accounting_sequences SET last_number=0 WHERE tenant_id=t AND journal_type=code AND fiscal_year=yr%100;
 n3:=public.next_accounting_piece_number(t,code,cur);
 IF n3 IS DISTINCT FROM code||to_char(cur,'YY')||lpad((greatest(observed,stored)+2)::text,5,'0') THEN RAISE EXCEPTION 'Reprise compteur incohérente : %',n3;END IF;
 UPDATE public.accounting_sequences SET last_number=99999 WHERE tenant_id=t AND journal_type=code AND fiscal_year=yr%100;
 BEGIN PERFORM public.next_accounting_piece_number(t,code,cur);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Dépassement accepté';EXCEPTION WHEN numeric_value_out_of_range THEN NULL;END;
 IF (SELECT last_number FROM public.accounting_sequences WHERE tenant_id=t AND journal_type=code AND fiscal_year=yr%100)<>99999 THEN RAISE EXCEPTION 'Compteur non restauré après erreur';END IF;
 BEGIN PERFORM public.next_accounting_piece_number(t,code,dt+1);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Date future acceptée';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 INSERT INTO public.accounting_month_closures(tenant_id,month_start,closed_at,closed_by,note,control_snapshot) VALUES(t,closed_month,now(),u,'Fixture fictive','{}') ON CONFLICT(tenant_id,month_start) DO UPDATE SET closed_at=excluded.closed_at,closed_by=excluded.closed_by,note=excluded.note,control_snapshot=excluded.control_snapshot;
 BEGIN PERFORM public.next_accounting_piece_number(t,code,closed_month);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Mois fermé accepté';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 IF has_function_privilege('authenticated','public.next_accounting_piece_number(uuid,text,date)','EXECUTE') OR has_function_privilege('anon','public.next_accounting_piece_number(uuid,text,date)','EXECUTE') THEN RAISE EXCEPTION 'Numéroteur interne exposé';END IF;
 RAISE EXCEPTION USING ERRCODE='P9099',MESSAGE='RECETTE_OK_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'P9099' THEN IF SQLERRM<>'RECETTE_OK_ROLLBACK' THEN RAISE;END IF;
 END;
END $recipe$;
-- Complement with a two-session test: two postings in one journal/year, and posting vs close.
-- Verify no number duplication, deadlock recovery and no entry in a closed period.
