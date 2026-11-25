-- Lot en attente. Analyse directe des flux, préparatoire au tableau SYSCOHADA.
-- Aucune affectation automatique des écritures à contreparties ambiguës.
CREATE OR REPLACE FUNCTION public.accounting_cash_flow_working(p_tenant_id uuid,p_year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_from date;v_to date;v_opening numeric;v_closing numeric;v_prior jsonb;v_prior_missing boolean;v_data jsonb;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2099 THEN RAISE EXCEPTION 'Exercice invalide.' USING ERRCODE='22023';END IF;
 v_from:=make_date(p_year,1,1);v_to:=make_date(p_year,12,31);
 SELECT snapshot INTO v_prior FROM public.accounting_fiscal_years WHERE tenant_id=p_tenant_id AND fiscal_year=p_year-1;
 v_prior_missing:=v_prior IS NULL AND EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=p_tenant_id AND entry_date<v_from AND status='posted');
 IF v_prior IS NOT NULL THEN
  SELECT coalesce(sum((x->>'balance')::numeric),0) INTO v_opening FROM jsonb_array_elements(v_prior->'carry') x WHERE (x->>'account_class')::int=5 AND x->>'account_code' ~ '^5[1234567]';
 ELSE
  SELECT coalesce(sum(l.debit-l.credit),0) INTO v_opening FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
  WHERE l.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date<v_from AND l.account_code ~ '^5[1234567]';
 END IF;
 WITH base AS MATERIALIZED (
  SELECT e.id,e.entry_date,e.entry_number,e.description,l.account_code,coalesce(l.debit,0)-coalesce(l.credit,0) delta,
  CASE WHEN l.account_code ~ '^5[1234567]' THEN 'cash'
   WHEN l.account_code ~ '^(2[0-7]|48[15])' THEN 'investment'
   WHEN l.account_code ~ '^(10|16|17|18)' THEN 'financing'
   WHEN l.account_code ~ '^(40|41|42|43|44|60|61|62|63|64|65|66|70|71|72|73|74|75)' THEN 'operating'
   ELSE 'unknown' END category
  FROM public.journal_entries e JOIN public.journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
  WHERE e.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date BETWEEN v_from AND v_to
 ), grouped AS (
  SELECT id,entry_date,entry_number,description,coalesce(sum(delta) FILTER(WHERE category='cash'),0) amount,
  count(*) FILTER(WHERE category='cash') cash_count,
  count(DISTINCT category) FILTER(WHERE category<>'cash' AND delta<>0) categories,
  max(category) FILTER(WHERE category<>'cash' AND delta<>0) counterparty,
  coalesce(sum(delta),0) check_net
  FROM base GROUP BY id,entry_date,entry_number,description
 ), classified AS MATERIALIZED (
  SELECT id,entry_date,entry_number,description,amount,
   CASE WHEN check_net<>0 THEN 'unknown' WHEN amount=0 THEN 'internal_or_zero'
    WHEN categories=1 AND counterparty IN ('operating','investment','financing') THEN counterparty ELSE 'unknown' END category
  FROM grouped WHERE cash_count>0
 ), total AS (
  SELECT coalesce(sum(amount) FILTER(WHERE category='operating'),0) operating,
  coalesce(sum(amount) FILTER(WHERE category='investment'),0) investment,
  coalesce(sum(amount) FILTER(WHERE category='financing'),0) financing,
  coalesce(sum(amount) FILTER(WHERE category='unknown'),0) unknown,
  count(*) FILTER(WHERE category='unknown') unknown_count,
  coalesce(sum(amount),0) variation
  FROM classified
 )
 SELECT jsonb_build_object('opening',v_opening,'closing',v_opening+t.variation,'variation',t.variation,
 'operating',t.operating,'investment',t.investment,'financing',t.financing,'unknown',t.unknown,'unknown_count',t.unknown_count,
 'prior_missing',v_prior_missing,'unknown_rows',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date,x.entry_number,x.id),'[]'::jsonb) FROM(SELECT * FROM classified WHERE category='unknown' ORDER BY entry_date,entry_number,id LIMIT 100)x))
 INTO v_data FROM total t;
 RETURN v_data;
END;$f$;
REVOKE ALL ON FUNCTION public.accounting_cash_flow_working(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_cash_flow_working(uuid,integer) TO authenticated;
