-- Pending: measure on staging before deploying. Do not drop existing indexes.
-- Date-ordered journal access, parent join and account inquiry.
CREATE INDEX idx_acc_entries_tenant_date_piece ON public.journal_entries(tenant_id,entry_date DESC,entry_number DESC,id DESC);
CREATE INDEX idx_acc_lines_tenant_entry ON public.journal_lines(tenant_id,entry_id);
CREATE INDEX idx_acc_lines_tenant_account_entry ON public.journal_lines(tenant_id,account_code,entry_id);
-- Monthly budget retrieval; the existing unique constraint starts with center_id.
CREATE INDEX idx_acc_budget_axis_month ON public.accounting_analytic_budgets(tenant_id,axis_id,month_start);
-- No new redundant index for active matches, statement lines or the account plan.
-- Large exports share one STABLE statement snapshot. Page size remains 100 in the UI.
-- Export >100 rows requires offset zero, at most 5000 rows and at most 5 MiB JSON.
CREATE OR REPLACE FUNCTION public.accounting_period_books(p_tenant_id uuid,p_from date,p_to date,p_mode text DEFAULT 'balance',p_account text DEFAULT NULL,p_search text DEFAULT NULL,p_offset int DEFAULT 0,p_size int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; prior_year int; start_year int; mode_open text; lim int:=least(5000,greatest(1,coalesce(p_size,20))); offst int:=greatest(0,coalesce(p_offset,0)); term text:=lower(btrim(coalesce(p_search,'')));
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_mode IS NULL OR p_mode NOT IN ('balance','ledger') OR p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR extract(year from p_from)<>extract(year from p_to) OR p_to>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Période non future dans un seul exercice requise.';END IF;
 start_year:=extract(year from p_from)::int;
 SELECT max(fiscal_year) INTO prior_year FROM public.accounting_fiscal_years WHERE tenant_id=p_tenant_id AND fiscal_year<start_year;
 mode_open:=CASE WHEN prior_year=start_year-1 THEN 'fiscal' WHEN prior_year IS NOT NULL OR EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=p_tenant_id AND status='posted' AND entry_date<make_date(start_year,1,1)) THEN 'provisional' ELSE 'first' END;
 WITH balances AS MATERIALIZED (
 SELECT * FROM public._accounting_period_balances(p_tenant_id,p_from,p_to) b
 WHERE (p_account IS NULL OR b.account_code=p_account) AND (term='' OR strpos(lower(b.account_code||' '||b.account_name),term)>0)
 ), totals AS (
 SELECT count(*) accounts,coalesce(sum(movement_count),0) movements,
 coalesce(sum(greatest(opening,0)),0) opening_debit,coalesce(sum(greatest(-opening,0)),0) opening_credit,
 coalesce(sum(debit),0) debit,coalesce(sum(credit),0) credit,coalesce(sum(greatest(closing,0)),0) closing_debit,coalesce(sum(greatest(-closing,0)),0) closing_credit,
 count(*) FILTER(WHERE account_class=0) unknown_accounts FROM balances
 ), ledger AS (
 SELECT b.account_code,b.account_name,e.entry_date,e.entry_number,e.journal_type,e.reference,l.label,l.id line_id,e.id entry_id,l.debit,l.credit,
 b.opening+sum(l.debit-l.credit) OVER(PARTITION BY b.account_code ORDER BY e.entry_date,e.entry_number,l.id ROWS UNBOUNDED PRECEDING) running_balance,
 b.opening account_opening,b.debit account_debit,b.credit account_credit,b.closing account_closing
 FROM balances b JOIN public.journal_lines l ON l.tenant_id=p_tenant_id AND l.account_code=b.account_code
 JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE p_mode='ledger' AND e.status='posted' AND e.entry_date BETWEEN p_from AND p_to
 UNION ALL
 SELECT b.account_code,b.account_name,p_from,NULL::text,NULL::text,NULL::text,'Solde d’ouverture — sans mouvement',NULL::uuid,NULL::uuid,0::numeric,0::numeric,b.opening,b.opening,b.debit,b.credit,b.closing
 FROM balances b WHERE p_mode='ledger' AND b.movement_count=0
 )
 SELECT jsonb_build_object('opening_mode',mode_open,'prior_year',prior_year,'from',p_from,'to',p_to,'totals',(SELECT to_jsonb(t) FROM totals t),
 'count',CASE WHEN p_mode='balance' THEN (SELECT count(*) FROM balances) ELSE (SELECT count(*) FROM ledger) END,
 'rows',CASE WHEN p_mode='balance' THEN (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.account_code),'[]'::jsonb) FROM (SELECT * FROM balances ORDER BY account_code LIMIT lim OFFSET offst)x)
 ELSE (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.account_code,x.entry_date,x.entry_number,x.line_id),'[]'::jsonb) FROM (SELECT * FROM ledger ORDER BY account_code,entry_date,entry_number,line_id LIMIT lim OFFSET offst)x) END)
 INTO result;
 IF lim>100 AND (offst<>0 OR (result->>'count')::bigint>lim OR octet_length(result::text)>5242880) THEN
 RAISE EXCEPTION 'Export trop volumineux : réduisez la période ou filtrez les comptes. Aucun fichier partiel généré.' USING ERRCODE='22023';
 END IF;
 RETURN result;
END;$$;

CREATE OR REPLACE FUNCTION public.accounting_analytic_report(p_tenant_id uuid,p_axis_id uuid,p_month date,p_mode text DEFAULT 'summary',p_search text DEFAULT '',p_offset int DEFAULT 0,p_size int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;lim int:=least(5000,greatest(1,coalesce(p_size,20)));offst int:=greatest(0,coalesce(p_offset,0));term text:=lower(btrim(coalesce(p_search,'')));
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_month IS NULL OR NOT isfinite(p_month) OR extract(day FROM p_month)<>1 OR p_mode IS NULL OR p_mode NOT IN ('summary','lines') OR NOT EXISTS(SELECT 1 FROM public.accounting_analytic_axes WHERE tenant_id=p_tenant_id AND id=p_axis_id) THEN RAISE EXCEPTION 'Axe et mois valides requis.';END IF;
 WITH lines AS MATERIALIZED (
 SELECT l.id line_id,e.id entry_id,e.entry_number,e.entry_date,l.account_code,l.account_name,l.label,l.debit-l.credit signed_amount,
 a.shares,coalesce(a.revision,0) revision,a.reason
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 LEFT JOIN public.accounting_analytic_allocations a ON a.tenant_id=l.tenant_id AND a.line_id=l.id AND a.axis_id=p_axis_id
 WHERE l.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date>=p_month AND e.entry_date<(p_month+interval '1 month')::date AND l.account_code ~ '^[678]'
 ), allocated AS (
 SELECT l.account_code,s.center_id,s.amount FROM lines l CROSS JOIN LATERAL public._analytic_split(l.signed_amount,l.shares) s
 UNION ALL SELECT l.account_code,NULL::uuid,l.signed_amount FROM lines l WHERE l.shares IS NULL
 ), actual AS (SELECT center_id,account_code,sum(amount) signed_amount FROM allocated GROUP BY 1,2),
 budgets AS (SELECT center_id,account_code,amount,revision,reason FROM public.accounting_analytic_budgets WHERE tenant_id=p_tenant_id AND axis_id=p_axis_id AND month_start=p_month),
 report AS (
 SELECT coalesce(a.center_id,b.center_id) center_id,coalesce(c.name,'Non ventilé') center_name,coalesce(a.account_code,b.account_code) account_code,
 coalesce(a.signed_amount,0) signed_amount,b.amount budget,coalesce(b.revision,0) budget_revision,b.reason budget_reason
 FROM actual a FULL JOIN budgets b ON a.center_id=b.center_id AND a.account_code=b.account_code
 LEFT JOIN public.accounting_analytic_centers c ON c.tenant_id=p_tenant_id AND c.axis_id=p_axis_id AND c.id=coalesce(a.center_id,b.center_id)
 ), filtered AS (SELECT * FROM report WHERE term='' OR strpos(lower(account_code||' '||center_name),term)>0),
 filtered_lines AS (SELECT * FROM lines WHERE term='' OR strpos(lower(concat_ws(' ',entry_number,account_code,account_name,label)),term)>0)
 SELECT jsonb_build_object('count',CASE WHEN p_mode='summary' THEN (SELECT count(*) FROM filtered) ELSE (SELECT count(*) FROM filtered_lines) END,
 'totals',jsonb_build_object('ledger_signed',(SELECT coalesce(sum(signed_amount),0) FROM lines),'allocated_signed',(SELECT coalesce(sum(amount),0) FROM allocated),'unallocated_lines',(SELECT count(*) FROM lines WHERE shares IS NULL),'total_lines',(SELECT count(*) FROM lines),'unallocated_absolute',(SELECT coalesce(sum(abs(signed_amount)),0) FROM lines WHERE shares IS NULL)),
 'rows',CASE WHEN p_mode='summary' THEN (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.center_name,q.account_code,q.center_id),'[]'::jsonb) FROM (SELECT * FROM filtered ORDER BY center_name,account_code,center_id LIMIT lim OFFSET offst) q)
 ELSE (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.entry_date,q.entry_number,q.line_id),'[]'::jsonb) FROM (SELECT * FROM filtered_lines ORDER BY entry_date,entry_number,line_id LIMIT lim OFFSET offst) q) END) INTO result;
 IF lim>100 AND (offst<>0 OR (result->>'count')::bigint>lim OR octet_length(result::text)>5242880) THEN
 RAISE EXCEPTION 'Export trop volumineux : réduisez la période ou filtrez les comptes. Aucun fichier partiel généré.' USING ERRCODE='22023';
 END IF;
 RETURN result;
END;$$;
