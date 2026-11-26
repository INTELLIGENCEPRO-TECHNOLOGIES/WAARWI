-- Phase 3 — transactional confirmation of exact, document-linked matches.
CREATE OR REPLACE FUNCTION public.confirm_accounting_matching_batch(p_tenant_id uuid,p_account_code text,p_date_to date,p_groups jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE available jsonb; proposal jsonb; requested jsonb; ids uuid[]; n int:=0; result jsonb; codes jsonb:='[]'::jsonb;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_date_to IS NULL OR NOT isfinite(p_date_to) OR p_date_to>(now() AT TIME ZONE 'Africa/Dakar')::date OR p_groups IS NULL OR jsonb_typeof(p_groups)<>'array' THEN RAISE EXCEPTION 'Sélection invalide.';END IF;
 IF jsonb_array_length(p_groups) NOT BETWEEN 1 AND 25 THEN RAISE EXCEPTION 'Sélectionnez 1 à 25 groupes.';END IF;
 IF (SELECT count(DISTINCT x->>'root') FROM jsonb_array_elements(p_groups) x)<>jsonb_array_length(p_groups) THEN RAISE EXCEPTION 'Groupes dupliqués.';END IF;
 PERFORM 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=p_account_code AND class=4 AND account_type='auxiliary' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Compte auxiliaire introuvable.';END IF;
 available:=public.accounting_matching_suggestions(p_tenant_id,p_account_code,p_date_to);
 FOR requested IN SELECT value FROM jsonb_array_elements(p_groups) LOOP
  SELECT x INTO proposal FROM jsonb_array_elements(available->'rows') x WHERE x->>'root'=requested->>'root';
  IF proposal IS NULL OR proposal->'line_ids' IS DISTINCT FROM requested->'line_ids' THEN RAISE EXCEPTION 'Une proposition a changé. Actualisez avant validation.' USING ERRCODE='40001';END IF;
  SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(proposal->'line_ids');
  result:=public.match_accounting_lines(p_tenant_id,p_account_code,ids);
  IF NOT coalesce((result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Lettrage non confirmé.';END IF;
  codes:=codes||jsonb_build_array(result->>'match_code');n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('success',true,'groups',n,'codes',codes);
END;$$;
REVOKE ALL ON FUNCTION public.confirm_accounting_matching_batch(uuid,text,date,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_accounting_matching_batch(uuid,text,date,jsonb) TO authenticated;

-- Small differences only, never inferred from identical amounts.
-- A user chooses an existing expense/income account, date, exact amount and justification.
CREATE OR REPLACE FUNCTION public.match_accounting_small_difference(p_tenant_id uuid,p_account_code text,p_line_ids uuid[],p_date date,p_offset_account text,p_expected_difference numeric,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE n int; d numeric;c numeric;diff numeric;last_date date;adj jsonb;posted jsonb;new_line uuid;matched jsonb;label text;v_party uuid;party_count int;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF coalesce(cardinality(p_line_ids),0) NOT BETWEEN 2 AND 99 OR (SELECT count(DISTINCT x) FROM unnest(p_line_ids) x)<>cardinality(p_line_ids) THEN RAISE EXCEPTION 'Sélectionnez 2 à 99 lignes distinctes.';END IF;
 IF p_date IS NULL OR NOT isfinite(p_date) OR p_date>(now() AT TIME ZONE 'Africa/Dakar')::date OR extract(year from p_date)<>extract(year from CURRENT_DATE) OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'Date et justification obligatoires.';END IF;
 IF p_expected_difference IS NULL OR p_expected_difference IN ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) OR abs(p_expected_difference)>1000 OR p_expected_difference=0 OR round(p_expected_difference,2)<>p_expected_difference THEN RAISE EXCEPTION 'Écart non nul de 1 000 FCFA maximum.';END IF;
 IF p_account_code IS NULL OR p_account_code !~ '^(401|411)' OR p_offset_account IS NULL OR (p_expected_difference>0 AND p_offset_account NOT LIKE '658%') OR (p_expected_difference<0 AND p_offset_account NOT LIKE '758%') THEN RAISE EXCEPTION 'Compte d’écart incompatible.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':journal:OD',0));
 PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',p_date)::date);
 PERFORM 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code IN (p_account_code,p_offset_account) ORDER BY code FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=p_account_code AND class=4 AND account_type='auxiliary' AND is_active)
 OR NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=p_offset_account AND account_type='general' AND is_active AND class=CASE WHEN p_expected_difference>0 THEN 6 ELSE 7 END) THEN RAISE EXCEPTION 'Compte actif et nature comptable requis.';END IF;
 IF p_account_code LIKE '411%' THEN SELECT count(*),(array_agg(id))[1] INTO party_count,v_party FROM public.customers WHERE tenant_id=p_tenant_id AND account_code=p_account_code;
 ELSE SELECT count(*),(array_agg(id))[1] INTO party_count,v_party FROM public.suppliers WHERE tenant_id=p_tenant_id AND account_code=p_account_code;END IF;
 IF party_count<>1 THEN RAISE EXCEPTION 'Compte non associé à un tiers unique.';END IF;
 PERFORM 1 FROM public.journal_entries e WHERE e.tenant_id=p_tenant_id AND e.id IN (SELECT l.entry_id FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.id=ANY(p_line_ids)) ORDER BY e.id FOR UPDATE;
 PERFORM 1 FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.id=ANY(p_line_ids) ORDER BY l.id FOR UPDATE;
 SELECT count(*),sum(l.debit),sum(l.credit),max(e.entry_date) INTO n,d,c,last_date
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND l.account_code=p_account_code AND l.id=ANY(p_line_ids) AND e.status='posted' AND (l.third_party_id IS NULL OR l.third_party_id=v_party);
 IF n<>cardinality(p_line_ids) OR d<=0 OR c<=0 OR d IN ('NaN'::numeric,'Infinity'::numeric) OR c IN ('NaN'::numeric,'Infinity'::numeric) OR p_date<last_date THEN RAISE EXCEPTION 'Sélection incohérente ou date antérieure à une pièce.';END IF;
 diff:=d-c;
 IF diff IS DISTINCT FROM p_expected_difference THEN RAISE EXCEPTION 'L’écart a changé. Actualisez.' USING ERRCODE='40001';END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_match_lines WHERE tenant_id=p_tenant_id AND line_id=ANY(p_line_ids) AND released_at IS NULL) THEN RAISE EXCEPTION 'Ligne déjà lettrée.';END IF;
 label:='Écart de lettrage : '||btrim(p_reason);
 adj:=jsonb_build_array(jsonb_build_object('account_code',p_account_code,'debit',greatest(-diff,0),'credit',greatest(diff,0),'label',label),jsonb_build_object('account_code',p_offset_account,'debit',greatest(diff,0),'credit',greatest(-diff,0),'label',label));
 posted:=public.create_manual_journal_entry(p_tenant_id,'OD',p_date,label,'Écart de lettrage',adj);
 IF NOT coalesce((posted->>'success')::boolean,false) THEN RAISE EXCEPTION 'OD non validée.';END IF;
 SELECT id INTO STRICT new_line FROM public.journal_lines WHERE tenant_id=p_tenant_id AND entry_id=(posted->>'entry_id')::uuid AND account_code=p_account_code;
 matched:=public.match_accounting_lines(p_tenant_id,p_account_code,array_append(p_line_ids,new_line));
 IF NOT coalesce((matched->>'success')::boolean,false) THEN RAISE EXCEPTION 'Lettrage non validé.';END IF;
 RETURN jsonb_build_object('success',true,'entry_id',posted->>'entry_id','piece_number',posted->>'piece_number','match_code',matched->>'match_code','difference',diff);
END;$$;
REVOKE ALL ON FUNCTION public.match_accounting_small_difference(uuid,text,uuid[],date,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.match_accounting_small_difference(uuid,text,uuid[],date,text,numeric,text) TO authenticated;
