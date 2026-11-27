-- Phase 5: proposals and controlled posting; apply only at grouped release.
CREATE OR REPLACE FUNCTION public.bank_pointing_suggestions(p_tenant_id uuid,p_statement_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.accounting_bank_statements%ROWTYPE; anchor date; result jsonb;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id;
 IF NOT FOUND OR s.status<>'draft' THEN RAISE EXCEPTION 'Relevé en cours requis.';END IF;
 SELECT min(date_from) INTO anchor FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND account_code=s.account_code AND status<>'cancelled';
 WITH bank AS MATERIALIZED (
 SELECT id,operation_date,reference,label,amount FROM public.accounting_bank_statement_lines WHERE tenant_id=p_tenant_id AND statement_id=s.id AND journal_line_id IS NULL
 ), book AS MATERIALIZED (
 SELECT l.id,e.id entry_id,e.entry_number,e.entry_date,e.reference,l.label,l.debit-l.credit amount
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND l.account_code=s.account_code AND e.status='posted' AND e.entry_date BETWEEN anchor AND s.date_to
 AND NOT EXISTS(SELECT 1 FROM public.accounting_bank_statement_lines x WHERE x.tenant_id=l.tenant_id AND x.journal_line_id=l.id)
 ), candidates AS (
 SELECT b.id bank_id,j.id book_id,j.entry_id,j.entry_number,j.entry_date,b.operation_date,b.label bank_label,j.label book_label,b.amount,b.reference bank_reference,j.reference book_reference,
 (btrim(coalesce(b.reference,''))<>'' AND lower(btrim(b.reference))=lower(btrim(coalesce(j.reference,'')))) ref_equal,
 abs(b.operation_date-j.entry_date) days,
 count(*) OVER(PARTITION BY b.id) bank_count,count(*) OVER(PARTITION BY j.id) book_count
 FROM bank b JOIN book j ON j.amount=b.amount AND abs(b.operation_date-j.entry_date)<=7
 ), proposed AS (
 SELECT * FROM candidates WHERE bank_count=1 AND book_count=1 AND (ref_equal OR days=0)
 )
 SELECT jsonb_build_object('rows',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.operation_date,p.bank_id),'[]'::jsonb) FROM proposed p),
 'ambiguous',(SELECT count(DISTINCT bank_id) FROM candidates WHERE bank_count>1 OR book_count>1),
 'pending',(SELECT count(*) FROM bank),'suggested',(SELECT count(*) FROM proposed)) INTO result;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.bank_pointing_suggestions(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.bank_pointing_suggestions(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.confirm_bank_pointing_batch(p_tenant_id uuid,p_statement_id uuid,p_pairs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.accounting_bank_statements%ROWTYPE; available jsonb; pair jsonb; n int:=0;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF jsonb_typeof(p_pairs) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Sélection invalide.';END IF;
 IF jsonb_array_length(p_pairs) NOT BETWEEN 1 AND 100 OR (SELECT count(DISTINCT x->>'bank_id') FROM jsonb_array_elements(p_pairs) x)<>jsonb_array_length(p_pairs) OR (SELECT count(DISTINCT x->>'book_id') FROM jsonb_array_elements(p_pairs) x)<>jsonb_array_length(p_pairs) THEN RAISE EXCEPTION 'Sélection de 1 à 100 paires distinctes requise.';END IF;
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relevé introuvable.';END IF;
 PERFORM 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=s.account_code FOR UPDATE;
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id FOR UPDATE;
 available:=public.bank_pointing_suggestions(p_tenant_id,p_statement_id);
 FOR pair IN SELECT value FROM jsonb_array_elements(p_pairs) ORDER BY value->>'bank_id' LOOP
 IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(available->'rows') x WHERE x->>'bank_id'=pair->>'bank_id' AND x->>'book_id'=pair->>'book_id') THEN RAISE EXCEPTION 'Proposition modifiée. Relancez l’analyse.' USING ERRCODE='40001';END IF;
 PERFORM public.point_bank_statement_line(p_tenant_id,p_statement_id,(pair->>'bank_id')::uuid,(pair->>'book_id')::uuid);n:=n+1;
 END LOOP;
 RETURN jsonb_build_object('success',true,'count',n);
END;$$;
REVOKE ALL ON FUNCTION public.confirm_bank_pointing_batch(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_bank_pointing_batch(uuid,uuid,jsonb) TO authenticated;

-- Explicitly record a genuinely missing bank charge or income, never an arbitrary difference.
CREATE OR REPLACE FUNCTION public.post_missing_bank_operation(p_tenant_id uuid,p_statement_id uuid,p_bank_line_id uuid,p_counter_account text,p_expected_amount numeric,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.accounting_bank_statements%ROWTYPE;b public.accounting_bank_statement_lines%ROWTYPE; r jsonb; lid uuid; description text;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 300 OR p_expected_amount IS NULL OR p_expected_amount IN ('NaN','Infinity','-Infinity') OR p_expected_amount=0 THEN RAISE EXCEPTION 'Montant et motif requis.';END IF;
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relevé introuvable.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':journal:BQ',0));
 SELECT * INTO b FROM public.accounting_bank_statement_lines WHERE tenant_id=p_tenant_id AND statement_id=s.id AND id=p_bank_line_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Opération introuvable.';END IF;
 PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',b.operation_date)::date);
 PERFORM 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code IN (s.account_code,p_counter_account) ORDER BY code FOR UPDATE;
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id FOR UPDATE;
 SELECT * INTO b FROM public.accounting_bank_statement_lines WHERE tenant_id=p_tenant_id AND statement_id=s.id AND id=p_bank_line_id FOR UPDATE;
 IF s.status<>'draft' OR b.id IS NULL OR b.journal_line_id IS NOT NULL OR b.amount IS DISTINCT FROM p_expected_amount THEN RAISE EXCEPTION 'Opération déjà pointée ou modifiée.' USING ERRCODE='40001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=p_counter_account AND is_active AND account_type='general' AND class=CASE WHEN b.amount<0 THEN 6 ELSE 7 END AND left(code,1)=CASE WHEN b.amount<0 THEN '6' ELSE '7' END) THEN RAISE EXCEPTION 'Choisissez un compte général actif de charge ou de produit.';END IF;
 -- Do not generate a second posting if any still available exact amount is in the candidate window.
 IF EXISTS(SELECT 1 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND l.account_code=s.account_code AND e.status='posted' AND e.entry_date<=s.date_to AND abs(e.entry_date-b.operation_date)<=7 AND l.debit-l.credit=b.amount
 AND NOT EXISTS(SELECT 1 FROM public.accounting_bank_statement_lines x WHERE x.tenant_id=l.tenant_id AND x.journal_line_id=l.id)) THEN RAISE EXCEPTION 'Une écriture de même montant existe à proximité. Examinez le pointage manuel.';END IF;
 description:='Opération bancaire : '||btrim(p_reason);
 r:=public.create_manual_journal_entry(p_tenant_id,'BQ',b.operation_date,description,b.reference,jsonb_build_array(
 jsonb_build_object('account_code',s.account_code,'debit',greatest(b.amount,0),'credit',greatest(-b.amount,0),'label',description),
 jsonb_build_object('account_code',p_counter_account,'debit',greatest(-b.amount,0),'credit',greatest(b.amount,0),'label',description)));
 IF NOT coalesce((r->>'success')::boolean,false) THEN RAISE EXCEPTION 'Comptabilisation non confirmée.';END IF;
 SELECT id INTO STRICT lid FROM public.journal_lines WHERE tenant_id=p_tenant_id AND entry_id=(r->>'entry_id')::uuid AND account_code=s.account_code;
 PERFORM public.point_bank_statement_line(p_tenant_id,s.id,b.id,lid);
 RETURN r;
END;$$;
REVOKE ALL ON FUNCTION public.post_missing_bank_operation(uuid,uuid,uuid,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_missing_bank_operation(uuid,uuid,uuid,text,numeric,text) TO authenticated;
