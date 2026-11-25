-- Lot en attente de publication. Exercices civils, arrêtés annuels et RAN non dupliqués.
-- Le journal demeure continu : les RAN sont des soldes d'ouverture certifiés,
-- non des mouvements supplémentaires. Les comptes de gestion repartent à zéro.
CREATE TABLE public.accounting_fiscal_years(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 fiscal_year integer NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 2099),
 closed_at timestamptz NOT NULL DEFAULT now(),closed_by uuid NOT NULL,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 500),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 UNIQUE(tenant_id,fiscal_year)
);
ALTER TABLE public.accounting_fiscal_years ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_fiscal_years FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_fiscal_years TO authenticated;
CREATE POLICY fiscal_years_read ON public.accounting_fiscal_years FOR SELECT TO authenticated
 USING(tenant_id=(SELECT public.current_tenant_id()) AND (SELECT public.current_user_can_view_accounting()));
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES ('public','accounting_fiscal_years','direct','tenant_id','operation',91,'delete',false);

-- Protection en profondeur : un exercice arrêté ne peut pas être rouvert par
-- disparition d'un verrou mensuel. Le contrôle existant reste en vigueur.
CREATE OR REPLACE FUNCTION public._assert_accounting_month_open(p_tenant_id uuid,p_month_start date)
RETURNS void LANGUAGE plpgsql SET search_path=''
AS $f$
DECLARE v_closed_at timestamptz;
BEGIN
 SELECT c.closed_at INTO v_closed_at FROM public.accounting_month_closures c
 WHERE c.tenant_id=p_tenant_id AND c.month_start=p_month_start FOR SHARE;
 IF NOT FOUND THEN
  INSERT INTO public.accounting_month_closures(tenant_id,month_start) VALUES(p_tenant_id,p_month_start) ON CONFLICT(tenant_id,month_start) DO NOTHING;
  SELECT c.closed_at INTO v_closed_at FROM public.accounting_month_closures c WHERE c.tenant_id=p_tenant_id AND c.month_start=p_month_start FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La période a changé pendant la transaction. Réessayez.' USING ERRCODE='40001'; END IF;
 END IF;
 IF v_closed_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year=extract(year FROM p_month_start)) THEN
  RAISE EXCEPTION 'La période comptable de % est clôturée.',to_char(p_month_start,'MM/YYYY') USING ERRCODE='55000';
 END IF;
END;$f$;

-- Calcul interne commun : RAN précédent + mouvements de l'exercice.
CREATE OR REPLACE FUNCTION public._fiscal_year_snapshot(p_tenant_id uuid,p_year integer,p_profit_code text,p_loss_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE start_date date;end_date date; prior jsonb; prior_missing boolean; v_result numeric; v_entries bigint;v_inconsistent bigint;v_duplicate bigint;v_unposted bigint;v_closed int;v_months jsonb;v_rows jsonb;v_carry jsonb;v_unsupported bigint;v_missing_accounts bigint;v_debit numeric;v_credit numeric;v_carry_debit numeric;v_carry_credit numeric;v_open_debit numeric;v_open_credit numeric;v_result_account text;v_result_valid boolean;
BEGIN
 IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2099 THEN RAISE EXCEPTION 'Exercice invalide.' USING ERRCODE='22023'; END IF;
 start_date:=make_date(p_year,1,1);end_date:=make_date(p_year,12,31);
 SELECT snapshot INTO prior FROM public.accounting_fiscal_years WHERE tenant_id=p_tenant_id AND fiscal_year=p_year-1;
 prior_missing:=prior IS NULL AND (EXISTS(SELECT 1 FROM public.journal_entries e WHERE e.tenant_id=p_tenant_id AND e.entry_date<start_date) OR EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year<p_year));
 SELECT count(*) FILTER(WHERE closed_at IS NOT NULL) INTO v_closed FROM public.accounting_month_closures WHERE tenant_id=p_tenant_id AND month_start BETWEEN start_date AND end_date;
 SELECT jsonb_agg(jsonb_build_object('month',m.d::date,'closed',c.closed_at IS NOT NULL,'closed_at',c.closed_at) ORDER BY m.d) INTO v_months
 FROM generate_series(start_date::timestamp,end_date::timestamp,interval '1 month') m(d) LEFT JOIN public.accounting_month_closures c ON c.tenant_id=p_tenant_id AND c.month_start=m.d::date;
 WITH checks AS (
 SELECT e.id,e.total_debit,e.total_credit,e.is_balanced,count(l.id) n,coalesce(sum(l.debit),0) d,coalesce(sum(l.credit),0) c
 FROM public.journal_entries e LEFT JOIN public.journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
 WHERE e.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date BETWEEN start_date AND end_date GROUP BY e.id,e.total_debit,e.total_credit,e.is_balanced
 )
 SELECT count(*),count(*) FILTER(WHERE n<2 OR d<=0 OR d IN ('NaN'::numeric,'Infinity'::numeric) OR d IS DISTINCT FROM c OR d IS DISTINCT FROM total_debit OR c IS DISTINCT FROM total_credit OR is_balanced IS DISTINCT FROM true) INTO v_entries,v_inconsistent FROM checks;
 SELECT count(*) INTO v_unposted FROM public.journal_entries WHERE tenant_id=p_tenant_id AND entry_date BETWEEN start_date AND end_date AND status IS DISTINCT FROM 'posted' AND status IS DISTINCT FROM 'cancelled';
 SELECT count(*) INTO v_duplicate FROM (SELECT source_type,source_id FROM public.journal_entries WHERE tenant_id=p_tenant_id AND status='posted' AND source_id IS NOT NULL AND entry_date BETWEEN start_date AND end_date GROUP BY 1,2 HAVING count(*)>1) x;
 WITH opening AS (
 SELECT x->>'account_code' code,(x->>'balance')::numeric amount,(x->>'account_class')::int prior_class
 FROM jsonb_array_elements(coalesce(prior->'carry','[]'::jsonb)) x
 ), moves AS (
 SELECT l.account_code code,coalesce(sum(l.debit),0) debit,coalesce(sum(l.credit),0) credit
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date BETWEEN start_date AND end_date GROUP BY l.account_code
 ), combined AS (
 SELECT coalesce(o.code,m.code) account_code,a.name account_name,a.class account_class,coalesce(o.amount,0) opening,
 coalesce(m.debit,0) debit,coalesce(m.credit,0) credit,
 coalesce(o.amount,0)+coalesce(m.debit,0)-coalesce(m.credit,0) balance,
 (a.code IS NULL OR (o.prior_class IS NOT NULL AND a.class IS DISTINCT FROM o.prior_class)) inconsistent_account
 FROM opening o FULL JOIN moves m ON m.code=o.code LEFT JOIN public.accounts a ON a.tenant_id=p_tenant_id AND a.code=coalesce(o.code,m.code)
 )
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY account_code),'[]'::jsonb),
 coalesce(sum(credit-debit) FILTER(WHERE account_class BETWEEN 6 AND 8),0),
 count(*) FILTER(WHERE account_class IS NULL OR account_class NOT BETWEEN 1 AND 8),
 count(*) FILTER(WHERE inconsistent_account),
 coalesce(sum(debit),0),coalesce(sum(credit),0),
 coalesce(sum(greatest(opening,0)),0),coalesce(sum(greatest(-opening,0)),0)
 INTO v_rows,v_result,v_unsupported,v_missing_accounts,v_debit,v_credit,v_open_debit,v_open_credit FROM combined x;
 v_result_account:=CASE WHEN v_result>0 THEN p_profit_code WHEN v_result<0 THEN p_loss_code ELSE NULL END;
 v_result_valid:=v_result=0 OR EXISTS(SELECT 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=v_result_account AND a.class=1 AND a.is_active AND (CASE WHEN v_result>0 THEN a.code LIKE '131%' ELSE a.code LIKE '139%' END));
 WITH carry AS (
 SELECT x->>'account_code' account_code,(x->>'balance')::numeric balance FROM jsonb_array_elements(v_rows) x WHERE (x->>'account_class')::int BETWEEN 1 AND 5
 UNION ALL SELECT v_result_account,-v_result WHERE v_result<>0 AND v_result_valid
 ), grouped AS (
 SELECT c.account_code,a.name account_name,a.class account_class,sum(c.balance) balance FROM carry c JOIN public.accounts a ON a.tenant_id=p_tenant_id AND a.code=c.account_code GROUP BY c.account_code,a.name,a.class HAVING sum(c.balance)<>0
 )
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY account_code),'[]'::jsonb),coalesce(sum(greatest(balance,0)),0),coalesce(sum(greatest(-balance,0)),0) INTO v_carry,v_carry_debit,v_carry_credit FROM grouped x;
 RETURN jsonb_build_object('year',p_year,'date_from',start_date,'date_to',end_date,'closed_months',v_closed,'months',v_months,'entries',v_entries,
 'prior_missing',prior_missing,'inconsistent_entries',v_inconsistent,'duplicate_sources',v_duplicate,'unposted_entries',v_unposted,
 'unsupported_accounts',v_unsupported,'inconsistent_accounts',v_missing_accounts,'result_account_valid',v_result_valid,'profit_code',p_profit_code,'loss_code',p_loss_code,
 'result_account',v_result_account,'result',v_result,'movement_debit',v_debit,'movement_credit',v_credit,'opening_debit',v_open_debit,'opening_credit',v_open_credit,
 'carry_debit',v_carry_debit,'carry_credit',v_carry_credit,'rows',v_rows,'carry',v_carry,
 'blocked',prior_missing OR v_closed<>12 OR v_inconsistent>0 OR v_duplicate>0 OR v_unposted>0 OR v_unsupported>0 OR v_missing_accounts>0 OR NOT v_result_valid OR v_debit<>v_credit OR v_open_debit<>v_open_credit OR v_carry_debit<>v_carry_credit OR end_date>=(now() AT TIME ZONE 'Africa/Dakar')::date);
END;$f$;
REVOKE ALL ON FUNCTION public._fiscal_year_snapshot(uuid,integer,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.preview_fiscal_year(p_tenant_id uuid,p_year integer,p_profit_code text DEFAULT '1310000',p_loss_code text DEFAULT '1390000')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v jsonb; f public.accounting_fiscal_years%ROWTYPE;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 SELECT * INTO f FROM public.accounting_fiscal_years WHERE tenant_id=p_tenant_id AND fiscal_year=p_year;
 IF FOUND THEN RETURN jsonb_build_object('closed',true,'closed_at',f.closed_at,'note',f.note,'snapshot',f.snapshot); END IF;
 v:=public._fiscal_year_snapshot(p_tenant_id,p_year,p_profit_code,p_loss_code);
 RETURN jsonb_build_object('closed',false,'snapshot',v,'review_token',md5(v::text));
END;$f$;
REVOKE ALL ON FUNCTION public.preview_fiscal_year(uuid,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_fiscal_year(uuid,integer,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_fiscal_year(p_tenant_id uuid,p_year integer,p_profit_code text,p_loss_code text,p_review_token text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v jsonb; f public.accounting_fiscal_years%ROWTYPE;start_date date;end_date date;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2099 THEN RAISE EXCEPTION 'Exercice invalide.'; END IF;
 IF nullif(btrim(p_note),'') IS NULL OR length(btrim(p_note))>500 THEN RAISE EXCEPTION 'Note de clôture obligatoire (500 caractères maximum).'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Relancez la clôture dans une nouvelle transaction.' USING ERRCODE='40001'; END IF;
 start_date:=make_date(p_year,1,1);end_date:=make_date(p_year,12,31);
 -- Sérialiser les clôtures annuelles par tenant, puis verrouiller les mois.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':fiscal-close',0));
 SELECT * INTO f FROM public.accounting_fiscal_years WHERE tenant_id=p_tenant_id AND fiscal_year=p_year;
 IF FOUND THEN RETURN jsonb_build_object('success',true,'already_closed',true,'snapshot',f.snapshot,'closed_at',f.closed_at); END IF;
 PERFORM 1 FROM public.accounting_month_closures WHERE tenant_id=p_tenant_id AND month_start BETWEEN start_date AND end_date ORDER BY month_start FOR UPDATE;
 v:=public._fiscal_year_snapshot(p_tenant_id,p_year,p_profit_code,p_loss_code);
 IF (v->>'blocked')::boolean THEN RAISE EXCEPTION 'Clôture refusée : exercice non terminé, mois ouverts ou contrôles non satisfaits.' USING ERRCODE='55000'; END IF;
 IF p_review_token IS DISTINCT FROM md5(v::text) THEN RAISE EXCEPTION 'Les contrôles ont changé : actualisez l’arrêté.' USING ERRCODE='55000'; END IF;
 INSERT INTO public.accounting_fiscal_years(tenant_id,fiscal_year,closed_by,note,snapshot) VALUES(p_tenant_id,p_year,auth.uid(),btrim(p_note),v) RETURNING * INTO f;
 RETURN jsonb_build_object('success',true,'closed_at',f.closed_at,'snapshot',v);
END;$f$;
REVOKE ALL ON FUNCTION public.close_fiscal_year(uuid,integer,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(uuid,integer,text,text,text,text) TO authenticated;

-- Intégration des soldes d'ouverture dans l'interrogation par exercice.
CREATE OR REPLACE FUNCTION public.accounting_account_statement(
 p_tenant_id uuid,p_account_code text,p_date_from date,p_date_to date,p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v_account record; v_result jsonb; v_prior jsonb; v_year_start date; v_carry numeric:=0; v_mode text:='continuous';
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF p_date_from IS NULL OR p_date_to IS NULL OR NOT isfinite(p_date_from) OR NOT isfinite(p_date_to)
 OR p_date_from>p_date_to OR p_date_to-p_date_from>366 OR p_offset IS NULL OR p_offset<0 THEN
  RAISE EXCEPTION 'Choisissez une période de 367 jours au maximum.' USING ERRCODE='22023';
 END IF;
 -- RLS des comptes et journaux impose le tenant courant et view_accounting.
 SELECT a.code,a.name,a.account_type,a.is_active INTO v_account FROM public.accounts a
 WHERE a.tenant_id=p_tenant_id AND a.code=p_account_code;
 IF NOT FOUND THEN RAISE EXCEPTION 'Compte inaccessible ou introuvable.' USING ERRCODE='42501'; END IF;
 v_year_start:=date_trunc('year',p_date_from)::date;
 IF extract(year FROM p_date_from)=extract(year FROM p_date_to) THEN
  SELECT f.snapshot INTO v_prior FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year=extract(year FROM p_date_from)-1;
  IF v_prior IS NOT NULL THEN
   SELECT coalesce(sum((x->>'balance')::numeric),0) INTO v_carry FROM jsonb_array_elements(v_prior->'carry') x WHERE x->>'account_code'=p_account_code;
   v_mode:='fiscal';
  END IF;
 ELSIF EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year BETWEEN extract(year FROM p_date_from)-1 AND extract(year FROM p_date_to)-1) THEN
  RAISE EXCEPTION 'Sélectionnez une période dans un seul exercice pour consulter les reports certifiés.' USING ERRCODE='22023';
 END IF;
 WITH history AS MATERIALIZED (
 SELECT l.id AS line_id,e.id AS entry_id,e.entry_date,e.entry_number,e.journal_type,e.reference,e.description,
 e.source_type,e.source_id,e.status,l.label,m.group_id AS match_group_id,g.code AS match_code,coalesce(l.debit,0) AS debit,coalesce(l.credit,0) AS credit
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 LEFT JOIN public.accounting_match_lines m ON m.tenant_id=l.tenant_id AND m.line_id=l.id AND m.released_at IS NULL
 LEFT JOIN public.accounting_match_groups g ON g.tenant_id=m.tenant_id AND g.group_id=m.group_id AND g.account_code=m.account_code
 WHERE l.tenant_id=p_tenant_id AND l.account_code=v_account.code AND e.status='posted' AND e.entry_date<=p_date_to AND (v_mode='continuous' OR e.entry_date>=v_year_start)
 ), opening AS (
 SELECT v_carry+coalesce(sum(debit-credit),0) AS balance FROM history WHERE entry_date<p_date_from
 ), movements AS MATERIALIZED (
 SELECT h.*,o.balance+sum(h.debit-h.credit) OVER(ORDER BY h.entry_date,h.entry_number,h.line_id ROWS UNBOUNDED PRECEDING) AS running_balance
 FROM history h CROSS JOIN opening o WHERE h.entry_date>=p_date_from
 ), totals AS (
 SELECT count(*) AS row_count,coalesce(sum(debit),0) AS debit,coalesce(sum(credit),0) AS credit FROM movements
 )
 SELECT jsonb_build_object('account',to_jsonb(v_account),'opening_mode',v_mode,'opening_balance',o.balance,'total_debit',t.debit,
 'total_credit',t.credit,'closing_balance',o.balance+t.debit-t.credit,'row_count',t.row_count,
 'rows',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.entry_date,r.entry_number,r.line_id),'[]'::jsonb)
 FROM (SELECT * FROM movements ORDER BY entry_date,entry_number,line_id LIMIT 50 OFFSET p_offset) r))
 INTO v_result FROM opening o CROSS JOIN totals t;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.accounting_account_statement(uuid,text,date,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_account_statement(uuid,text,date,date,integer) TO authenticated;
