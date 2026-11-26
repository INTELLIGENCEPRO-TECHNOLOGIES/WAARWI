-- Phase 6: one opening convention for balance and ledger; no physical duplicate RAN.
-- Pending grouped release. Single civil year; an unclosed predecessor is explicitly provisional.
CREATE OR REPLACE FUNCTION public._accounting_period_balances(p_tenant_id uuid,p_from date,p_to date)
RETURNS TABLE(account_code text,account_name text,account_class integer,opening numeric,debit numeric,credit numeric,closing numeric,movement_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE anchor date; prior jsonb;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_from>p_to OR extract(year from p_from)<>extract(year from p_to) OR p_to>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Choisissez une période non future dans un seul exercice.' USING ERRCODE='22023';END IF;
 SELECT f.snapshot,make_date(f.fiscal_year+1,1,1) INTO prior,anchor FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year<extract(year from p_from) ORDER BY f.fiscal_year DESC LIMIT 1;
 WITH carry AS (
 SELECT x->>'account_code' code,sum((x->>'balance')::numeric) amount FROM jsonb_array_elements(coalesce(prior->'carry','[]'::jsonb)) x GROUP BY 1
 ), activity AS (
 SELECT l.account_code code,max(l.account_name) historical_name,
 coalesce(sum(l.debit-l.credit) FILTER(WHERE e.entry_date<p_from),0) earlier,
 coalesce(sum(l.debit) FILTER(WHERE e.entry_date>=p_from),0) d,
 coalesce(sum(l.credit) FILTER(WHERE e.entry_date>=p_from),0) c,
 count(*) FILTER(WHERE e.entry_date>=p_from) n
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date<=p_to AND (anchor IS NULL OR e.entry_date>=anchor) GROUP BY l.account_code
 ), combined AS (
 SELECT coalesce(x.code,m.code) code,coalesce(a.name,m.historical_name,'Compte absent') name,coalesce(a.class,0)::int cls,
 coalesce(x.amount,0)+coalesce(m.earlier,0) o,coalesce(m.d,0) d,coalesce(m.c,0) c,coalesce(m.n,0) n
 FROM carry x FULL JOIN activity m ON m.code=x.code LEFT JOIN public.accounts a ON a.tenant_id=p_tenant_id AND a.code=coalesce(x.code,m.code)
 )
 SELECT z.code,z.name,z.cls,z.o,z.d,z.c,z.o+z.d-z.c,z.n FROM combined z WHERE z.o<>0 OR z.n>0 ORDER BY z.code;
END;$$;
REVOKE ALL ON FUNCTION public._accounting_period_balances(uuid,date,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.accounting_period_books(p_tenant_id uuid,p_from date,p_to date,p_mode text DEFAULT 'balance',p_account text DEFAULT NULL,p_search text DEFAULT NULL,p_offset int DEFAULT 0,p_size int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; prior_year int; start_year int; mode_open text; lim int:=least(100,greatest(1,coalesce(p_size,20))); offst int:=greatest(0,coalesce(p_offset,0)); term text:=lower(btrim(coalesce(p_search,'')));
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
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.accounting_period_books(uuid,date,date,text,text,text,int,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_period_books(uuid,date,date,text,text,text,int,int) TO authenticated;
