-- Phase 7: linked new depreciable assets. Pending grouped release.
-- One whole posted acquisition line per asset; no legacy depreciation import in this version.
CREATE TABLE public.accounting_fixed_assets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 code text NOT NULL CHECK(length(btrim(code)) BETWEEN 1 AND 40),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 location text NOT NULL DEFAULT '' CHECK(length(location)<=200),
 acquisition_line_id uuid NOT NULL,
 acquisition_date date NOT NULL,
 service_date date NOT NULL,
 life_months integer NOT NULL CHECK(life_months BETWEEN 1 AND 600),
 cost numeric(18,2) NOT NULL CHECK(cost>0 AND cost<='90071992547409'::numeric),
 residual numeric(18,2) NOT NULL CHECK(residual>=0 AND residual<cost),
 asset_account text NOT NULL CHECK(asset_account ~ '^2[1234]'),
 depreciation_account text NOT NULL CHECK(depreciation_account ~ '^28[1234]'),
 expense_account text NOT NULL CHECK(expense_account ~ '^681[23]'),
 evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 1 AND 500),
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 disposed_on date,
 disposal_kind text CHECK(disposal_kind IN ('scrap','sale')),
 disposal_entry_id uuid,
 sale_line_id uuid,
 disposal_reason text,
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,code),UNIQUE(tenant_id,acquisition_line_id),UNIQUE(tenant_id,sale_line_id),UNIQUE(tenant_id,disposal_entry_id),
 FOREIGN KEY(tenant_id,acquisition_line_id) REFERENCES public.journal_lines(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,sale_line_id) REFERENCES public.journal_lines(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,disposal_entry_id) REFERENCES public.journal_entries(tenant_id,id) ON DELETE RESTRICT,
 CHECK(isfinite(acquisition_date) AND isfinite(service_date) AND service_date>=acquisition_date),
 CHECK((disposed_on IS NULL AND disposal_entry_id IS NULL AND disposal_kind IS NULL AND disposal_reason IS NULL AND sale_line_id IS NULL)
 OR (disposed_on IS NOT NULL AND disposal_entry_id IS NOT NULL AND disposal_kind IS NOT NULL AND disposal_reason IS NOT NULL AND (disposal_kind='sale')=(sale_line_id IS NOT NULL)))
);
CREATE TABLE public.accounting_asset_depreciations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 asset_id uuid NOT NULL,
 period_start date NOT NULL CHECK(extract(day FROM period_start)=1),
 through_date date NOT NULL CHECK(through_date>=period_start AND through_date<(period_start+interval '1 month')::date),
 amount numeric(18,2) NOT NULL CHECK(amount>0),
 entry_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid NOT NULL,
 UNIQUE(tenant_id,asset_id,period_start),UNIQUE(tenant_id,entry_id),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES public.accounting_fixed_assets(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,entry_id) REFERENCES public.journal_entries(tenant_id,id) ON DELETE RESTRICT
);
ALTER TABLE public.accounting_fixed_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_asset_depreciations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_fixed_assets,public.accounting_asset_depreciations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_fixed_assets,public.accounting_asset_depreciations TO authenticated;
CREATE POLICY accounting_fixed_assets_read ON public.accounting_fixed_assets FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND public.current_user_can_view_accounting());
CREATE POLICY accounting_asset_depreciations_read ON public.accounting_asset_depreciations FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND public.current_user_can_view_accounting());
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','accounting_fixed_assets','direct','tenant_id','operation',97,'delete',false),
('public','accounting_asset_depreciations','direct','tenant_id','operation',98,'delete',false);

-- Cumulative linear depreciation, inclusive through date, exact decimal arithmetic.
CREATE OR REPLACE FUNCTION public._asset_linear_cumulative(p_cost numeric,p_residual numeric,p_service date,p_months int,p_through date)
RETURNS numeric LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT round((p_cost-p_residual)*greatest(0,least((p_service+make_interval(months=>p_months))::date-p_service,p_through+1-p_service))::numeric/((p_service+make_interval(months=>p_months))::date-p_service),2)
$$;
REVOKE ALL ON FUNCTION public._asset_linear_cumulative(numeric,numeric,date,int,date) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.register_accounting_asset(p_tenant_id uuid,p_code text,p_name text,p_location text,p_acquisition_line uuid,p_service date,p_months int,p_residual numeric,p_depreciation_account text,p_expense_account text,p_evidence text,p_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l record; a uuid; entry uuid; d date:=(now() AT TIME ZONE 'Africa/Dakar')::date;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_confirmed IS DISTINCT FROM true OR p_code IS NULL OR length(btrim(p_code)) NOT BETWEEN 1 AND 40 OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR length(coalesce(p_location,''))>200 OR p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 1 AND 500 OR p_service IS NULL OR NOT isfinite(p_service) OR p_months IS NULL OR p_months NOT BETWEEN 1 AND 600 OR p_residual IS NULL OR p_residual IN ('NaN','Infinity','-Infinity') OR p_residual<0 OR round(p_residual,2)<>p_residual THEN RAISE EXCEPTION 'Fiche, durée, valeur résiduelle et justificatif requis.';END IF;
 IF p_service>d OR p_service<date_trunc('year',d)::date THEN RAISE EXCEPTION 'Cette première version accepte les mises en service de l’exercice courant.';END IF;
 SELECT x.entry_id INTO entry FROM public.journal_lines x WHERE x.tenant_id=p_tenant_id AND x.id=p_acquisition_line;
 PERFORM 1 FROM public.journal_entries WHERE tenant_id=p_tenant_id AND id=entry FOR UPDATE;
 SELECT x.id,x.account_code,x.debit,x.credit,e.entry_date,e.status,e.source_type INTO l FROM public.journal_lines x JOIN public.journal_entries e ON e.tenant_id=x.tenant_id AND e.id=x.entry_id WHERE x.tenant_id=p_tenant_id AND x.id=p_acquisition_line FOR UPDATE OF x;
 IF NOT FOUND OR l.status<>'posted' OR l.source_type='reversal' OR l.account_code !~ '^2[1234]' OR l.debit<=0 OR l.credit<>0 OR l.debit IN ('NaN','Infinity') OR l.debit<=p_residual OR p_service<l.entry_date THEN RAISE EXCEPTION 'Ligne d’acquisition débitée, validée et non extournée requise.';END IF;
 IF EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=p_tenant_id AND source_type='reversal' AND source_id=entry) THEN RAISE EXCEPTION 'Acquisition extournée.';END IF;
 IF p_depreciation_account IS NULL OR p_expense_account IS NULL OR left(p_depreciation_account,3)<>'28'||substr(l.account_code,2,1) OR left(p_expense_account,4)<>CASE WHEN l.account_code LIKE '21%' THEN '6812' ELSE '6813' END THEN RAISE EXCEPTION 'Comptes d’amortissement ou de dotation incompatibles.';END IF;
 PERFORM 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code IN(l.account_code,p_depreciation_account,p_expense_account) ORDER BY code FOR SHARE;
 IF (SELECT count(*) FROM public.accounts WHERE tenant_id=p_tenant_id AND is_active AND account_type='general' AND ((code IN(l.account_code,p_depreciation_account) AND class=2) OR (code=p_expense_account AND class=6)))<>3 THEN RAISE EXCEPTION 'Les trois comptes généraux actifs doivent exister.';END IF;
 INSERT INTO public.accounting_fixed_assets(tenant_id,code,name,location,acquisition_line_id,acquisition_date,service_date,life_months,cost,residual,asset_account,depreciation_account,expense_account,evidence,created_by)
 VALUES(p_tenant_id,upper(btrim(p_code)),btrim(p_name),btrim(coalesce(p_location,'')),p_acquisition_line,l.entry_date,p_service,p_months,l.debit,p_residual,l.account_code,p_depreciation_account,p_expense_account,btrim(p_evidence),auth.uid()) RETURNING id INTO a;
 RETURN jsonb_build_object('success',true,'id',a);
END;$$;

CREATE OR REPLACE FUNCTION public._asset_plan(p_tenant_id uuid,p_asset_id uuid,p_stop date DEFAULT NULL)
RETURNS TABLE(period_start date,through_date date,amount numeric,cumulative numeric,entry_id uuid,posted_amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 WITH a AS (SELECT * FROM public.accounting_fixed_assets WHERE tenant_id=p_tenant_id AND id=p_asset_id),
 bounds AS (SELECT a.*,least((service_date+make_interval(months=>life_months))::date-1,coalesce(disposed_on,'infinity'::date),coalesce(p_stop,'infinity'::date)) last_day FROM a),
 months AS (SELECT b.*,g.m::date period,least((g.m+interval '1 month')::date-1,b.last_day) ending FROM bounds b CROSS JOIN LATERAL generate_series(date_trunc('month',b.service_date::timestamp),date_trunc('month',b.last_day::timestamp),interval '1 month') g(m)),
 calc AS (SELECT m.period,m.ending,public._asset_linear_cumulative(m.cost,m.residual,m.service_date,m.life_months,m.ending) cumul,
 public._asset_linear_cumulative(m.cost,m.residual,m.service_date,m.life_months,m.period-1) opening FROM months m)
 SELECT c.period,c.ending,c.cumul-c.opening,c.cumul,d.entry_id,d.amount FROM calc c LEFT JOIN public.accounting_asset_depreciations d ON d.tenant_id=p_tenant_id AND d.asset_id=p_asset_id AND d.period_start=c.period ORDER BY c.period
$$;
REVOKE ALL ON FUNCTION public._asset_plan(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.accounting_asset_detail(p_tenant_id uuid,p_asset_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounting_fixed_assets%ROWTYPE; result jsonb;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 SELECT * INTO a FROM public.accounting_fixed_assets WHERE tenant_id=p_tenant_id AND id=p_asset_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Immobilisation introuvable.';END IF;
 SELECT jsonb_build_object('asset',to_jsonb(a),'acquisition_entry_id',(SELECT entry_id FROM public.journal_lines WHERE tenant_id=p_tenant_id AND id=a.acquisition_line_id),
 'acquisition_piece',(SELECT e.entry_number FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id WHERE l.tenant_id=p_tenant_id AND l.id=a.acquisition_line_id),
 'disposal_piece',(SELECT entry_number FROM public.journal_entries WHERE tenant_id=p_tenant_id AND id=a.disposal_entry_id),
 'sale_piece',(SELECT e.entry_number FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id WHERE l.tenant_id=p_tenant_id AND l.id=a.sale_line_id),
 'sale_entry_id',(SELECT entry_id FROM public.journal_lines WHERE tenant_id=p_tenant_id AND id=a.sale_line_id),
 'plan',(SELECT coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('entry_number',e.entry_number) ORDER BY p.period_start),'[]'::jsonb) FROM public._asset_plan(p_tenant_id,p_asset_id) p LEFT JOIN public.journal_entries e ON e.tenant_id=p_tenant_id AND e.id=p.entry_id),
 'posted',coalesce((SELECT sum(d.amount) FROM public.accounting_asset_depreciations d WHERE d.tenant_id=p_tenant_id AND d.asset_id=p_asset_id),0)) INTO result;
 RETURN result;
END;$$;

CREATE OR REPLACE FUNCTION public.post_accounting_asset_depreciation(p_tenant_id uuid,p_asset_id uuid,p_period date,p_expected numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounting_fixed_assets%ROWTYPE; p record; r jsonb;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':journal:OD',0));
 SELECT * INTO a FROM public.accounting_fixed_assets WHERE tenant_id=p_tenant_id AND id=p_asset_id FOR UPDATE;
 IF NOT FOUND OR a.disposed_on IS NOT NULL THEN RAISE EXCEPTION 'Immobilisation active requise.';END IF;
 SELECT * INTO p FROM public._asset_plan(p_tenant_id,p_asset_id) x WHERE x.entry_id IS NULL AND x.amount>0 ORDER BY x.period_start LIMIT 1;
 IF NOT FOUND OR p.period_start IS DISTINCT FROM p_period OR p.amount IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Échéance différente ou déjà traitée. Actualisez.' USING ERRCODE='40001';END IF;
 IF p.through_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Attendez la fin de la période.';END IF;
 r:=public.create_manual_journal_entry(p_tenant_id,'OD',p.through_date,'Dotation amortissement '+a.code,a.code,jsonb_build_array(
 jsonb_build_object('account_code',a.expense_account,'debit',p.amount,'credit',0,'label',a.name),
 jsonb_build_object('account_code',a.depreciation_account,'debit',0,'credit',p.amount,'label',a.name)));
 IF NOT coalesce((r->>'success')::boolean,false) THEN RAISE EXCEPTION 'Dotation non validée.';END IF;
 INSERT INTO public.accounting_asset_depreciations(tenant_id,asset_id,period_start,through_date,amount,entry_id,created_by)
 VALUES(p_tenant_id,p_asset_id,p.period_start,p.through_date,p.amount,(r->>'entry_id')::uuid,auth.uid());
 RETURN r;
END;$$;
REVOKE ALL ON FUNCTION public.register_accounting_asset(uuid,text,text,text,uuid,date,int,numeric,text,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.accounting_asset_detail(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.post_accounting_asset_depreciation(uuid,uuid,date,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_accounting_asset(uuid,text,text,text,uuid,date,int,numeric,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_asset_detail(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_accounting_asset_depreciation(uuid,uuid,date,numeric) TO authenticated;

-- Search only actual posted acquisition or proceeds lines; unique IDs are retained.
CREATE OR REPLACE FUNCTION public.accounting_asset_source_lines(p_tenant_id uuid,p_kind text,p_search text DEFAULT '',p_offset int DEFAULT 0,p_size int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; term text:=lower(btrim(coalesce(p_search,'')));lim int:=least(100,greatest(1,coalesce(p_size,20)));offst int:=greatest(0,coalesce(p_offset,0));
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_kind IS NULL OR p_kind NOT IN ('acquisition','sale') THEN RAISE EXCEPTION 'Type de pièce invalide.';END IF;
 WITH candidates AS MATERIALIZED (
 SELECT l.id line_id,e.id entry_id,e.entry_number,e.entry_date,l.account_code,l.account_name,l.label,e.reference,CASE WHEN p_kind='acquisition' THEN l.debit ELSE l.credit END amount
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND e.status='posted' AND e.source_type IS DISTINCT FROM 'reversal'
 AND NOT EXISTS(SELECT 1 FROM public.journal_entries z WHERE z.tenant_id=e.tenant_id AND z.source_type='reversal' AND z.source_id=e.id)
 AND ((p_kind='acquisition' AND l.account_code ~ '^2[1234]' AND l.debit>0 AND l.credit=0 AND NOT EXISTS(SELECT 1 FROM public.accounting_fixed_assets a WHERE a.tenant_id=p_tenant_id AND a.acquisition_line_id=l.id))
 OR (p_kind='sale' AND l.account_code ~ '^(82|754)' AND l.credit>0 AND l.debit=0 AND NOT EXISTS(SELECT 1 FROM public.accounting_fixed_assets a WHERE a.tenant_id=p_tenant_id AND a.sale_line_id=l.id)))
 AND (term='' OR strpos(lower(concat_ws(' ',e.entry_number,e.reference,l.account_code,l.label)),term)>0)
 )
 SELECT jsonb_build_object('count',(SELECT count(*) FROM candidates),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date DESC,x.entry_number,x.line_id),'[]'::jsonb) FROM (SELECT * FROM candidates ORDER BY entry_date DESC,entry_number,line_id LIMIT lim OFFSET offst)x)) INTO result;
 RETURN result;
END;$$;
CREATE OR REPLACE FUNCTION public.accounting_asset_register(p_tenant_id uuid,p_search text DEFAULT '',p_status text DEFAULT 'all',p_offset int DEFAULT 0,p_size int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; term text:=lower(btrim(coalesce(p_search,'')));lim int:=least(100,greatest(1,coalesce(p_size,20)));offst int:=greatest(0,coalesce(p_offset,0));
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_status IS NULL OR p_status NOT IN ('all','active','disposed') THEN RAISE EXCEPTION 'État invalide.';END IF;
 WITH amounts AS (
 SELECT asset_id,sum(amount) posted FROM public.accounting_asset_depreciations WHERE tenant_id=p_tenant_id GROUP BY asset_id
 ), rows AS MATERIALIZED (
 SELECT a.*,coalesce(d.posted,0) posted,a.cost-coalesce(d.posted,0) net,
 greatest(0,public._asset_linear_cumulative(a.cost,a.residual,a.service_date,a.life_months,least(coalesce(a.disposed_on,'infinity'::date),(now() AT TIME ZONE 'Africa/Dakar')::date))-coalesce(d.posted,0)) accrued_not_posted
 FROM public.accounting_fixed_assets a LEFT JOIN amounts d ON d.asset_id=a.id
 WHERE a.tenant_id=p_tenant_id AND (p_status='all' OR (p_status='active' AND a.disposed_on IS NULL) OR (p_status='disposed' AND a.disposed_on IS NOT NULL))
 AND (term='' OR strpos(lower(concat_ws(' ',a.code,a.name,a.location,a.asset_account)),term)>0)
 ), totals AS (SELECT count(*) assets,coalesce(sum(cost) FILTER(WHERE disposed_on IS NULL),0) gross,coalesce(sum(posted) FILTER(WHERE disposed_on IS NULL),0) depreciation,coalesce(sum(net) FILTER(WHERE disposed_on IS NULL),0) net,coalesce(sum(accrued_not_posted) FILTER(WHERE disposed_on IS NULL),0) accrued FROM rows)
 SELECT jsonb_build_object('count',(SELECT count(*) FROM rows),'totals',(SELECT to_jsonb(t) FROM totals t),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.code,x.id),'[]'::jsonb) FROM (SELECT * FROM rows ORDER BY code,id LIMIT lim OFFSET offst)x)) INTO result;
 RETURN result;
END;$$;

-- Disposal: complementary depreciation + derecognition, in one transaction.
-- Sale proceeds (and taxes, if applicable) are posted separately before selection.
-- No automatic impairment reversal, component splitting, exchange or lease treatment.
CREATE OR REPLACE FUNCTION public.dispose_accounting_asset(p_tenant_id uuid,p_asset_id uuid,p_date date,p_kind text,p_value_account text,p_sale_line uuid,p_reason text,p_expected_net numeric,p_confirmed boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounting_fixed_assets%ROWTYPE; p record; prior numeric; target numeric; delta numeric; net numeric; dep jsonb; outp jsonb; rows jsonb; sale record; sale_entry uuid;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_confirmed IS DISTINCT FROM true OR p_date IS NULL OR NOT isfinite(p_date) OR p_date>(now() AT TIME ZONE 'Africa/Dakar')::date OR extract(year FROM p_date)<>extract(year FROM CURRENT_DATE) OR p_kind IS NULL OR p_kind NOT IN ('sale','scrap') OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Date, type et justification obligatoires.';END IF;
 IF (p_kind='sale') IS DISTINCT FROM (p_sale_line IS NOT NULL) THEN RAISE EXCEPTION 'La cession nécessite la ligne de produit déjà comptabilisée.';END IF;
 IF p_value_account IS NULL OR p_value_account !~ '^(81|654)' THEN RAISE EXCEPTION 'Compte de valeur comptable 81 ou 654 requis.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':journal:OD',0));
 SELECT * INTO a FROM public.accounting_fixed_assets WHERE tenant_id=p_tenant_id AND id=p_asset_id FOR UPDATE;
 IF NOT FOUND OR a.disposed_on IS NOT NULL OR p_date<a.service_date THEN RAISE EXCEPTION 'Bien actif et date postérieure à la mise en service requis.';END IF;
 IF p_kind='sale' THEN
  SELECT l.entry_id INTO sale_entry FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.id=p_sale_line;
  PERFORM 1 FROM public.journal_entries WHERE tenant_id=p_tenant_id AND id=sale_entry FOR UPDATE;
  SELECT l.account_code,l.credit,l.debit,e.entry_date,e.status,e.source_type INTO sale FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id WHERE l.tenant_id=p_tenant_id AND l.id=p_sale_line FOR UPDATE OF l;
  IF NOT FOUND OR sale.status<>'posted' OR sale.source_type='reversal' OR sale.entry_date<>p_date OR sale.credit<=0 OR sale.debit<>0 OR (p_value_account LIKE '81%' AND sale.account_code NOT LIKE '82%') OR (p_value_account LIKE '654%' AND sale.account_code NOT LIKE '754%') OR EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=p_tenant_id AND source_type='reversal' AND source_id=sale_entry) OR EXISTS(SELECT 1 FROM public.accounting_fixed_assets WHERE tenant_id=p_tenant_id AND sale_line_id=p_sale_line) THEN RAISE EXCEPTION 'Produit de cession incompatible, déjà lié ou extourné.';END IF;
 END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_asset_depreciations WHERE tenant_id=p_tenant_id AND asset_id=a.id AND through_date>p_date) THEN RAISE EXCEPTION 'Des dotations sont postérieures à la sortie.';END IF;
 IF EXISTS(SELECT 1 FROM public._asset_plan(p_tenant_id,a.id,p_date) x WHERE x.period_start<date_trunc('month',p_date)::date AND x.amount>0 AND x.entry_id IS NULL) THEN RAISE EXCEPTION 'Comptabilisez les échéances antérieures avant la sortie.';END IF;
 SELECT coalesce(sum(amount),0) INTO prior FROM public.accounting_asset_depreciations WHERE tenant_id=p_tenant_id AND asset_id=a.id;
 target:=public._asset_linear_cumulative(a.cost,a.residual,a.service_date,a.life_months,p_date);delta:=target-prior;net:=a.cost-target;
 IF delta<0 OR net IS DISTINCT FROM p_expected_net THEN RAISE EXCEPTION 'Valeur nette modifiée. Actualisez.' USING ERRCODE='40001';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=p_value_account AND is_active AND account_type='general' AND class=CASE WHEN p_value_account LIKE '81%' THEN 8 ELSE 6 END) THEN RAISE EXCEPTION 'Compte de sortie actif requis.';END IF;
 IF delta>0 THEN
  SELECT * INTO p FROM public._asset_plan(p_tenant_id,a.id,p_date) x WHERE x.period_start=date_trunc('month',p_date)::date;
  IF NOT FOUND OR p.entry_id IS NOT NULL OR p.amount IS DISTINCT FROM delta THEN RAISE EXCEPTION 'Plan de sortie incohérent.';END IF;
  dep:=public.create_manual_journal_entry(p_tenant_id,'OD',p_date,'Dotation complémentaire '+a.code,a.code,jsonb_build_array(jsonb_build_object('account_code',a.expense_account,'debit',delta,'credit',0,'label',a.name),jsonb_build_object('account_code',a.depreciation_account,'debit',0,'credit',delta,'label',a.name)));
  IF NOT coalesce((dep->>'success')::boolean,false) THEN RAISE EXCEPTION 'Dotation complémentaire non validée.';END IF;
  INSERT INTO public.accounting_asset_depreciations(tenant_id,asset_id,period_start,through_date,amount,entry_id,created_by) VALUES(p_tenant_id,a.id,p.period_start,p.through_date,delta,(dep->>'entry_id')::uuid,auth.uid());
 END IF;
 rows:=jsonb_build_array(jsonb_build_object('account_code',a.asset_account,'debit',0,'credit',a.cost,'label',a.name));
 IF target>0 THEN rows:=rows||jsonb_build_array(jsonb_build_object('account_code',a.depreciation_account,'debit',target,'credit',0,'label',a.name));END IF;
 IF net>0 THEN rows:=rows||jsonb_build_array(jsonb_build_object('account_code',p_value_account,'debit',net,'credit',0,'label',a.name));END IF;
 outp:=public.create_manual_journal_entry(p_tenant_id,'OD',p_date,'Sortie immobilisation '+a.code,a.code,rows);
 IF NOT coalesce((outp->>'success')::boolean,false) THEN RAISE EXCEPTION 'Sortie non validée.';END IF;
 UPDATE public.accounting_fixed_assets SET disposed_on=p_date,disposal_kind=p_kind,disposal_entry_id=(outp->>'entry_id')::uuid,sale_line_id=p_sale_line,disposal_reason=btrim(p_reason) WHERE tenant_id=p_tenant_id AND id=a.id;
 RETURN outp||jsonb_build_object('net',net,'complementary_depreciation',delta,'depreciation_entry_id',dep->>'entry_id');
END;$$;
REVOKE ALL ON FUNCTION public.accounting_asset_source_lines(uuid,text,text,int,int) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.accounting_asset_register(uuid,text,text,int,int) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dispose_accounting_asset(uuid,uuid,date,text,text,uuid,text,numeric,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_asset_source_lines(uuid,text,text,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_asset_register(uuid,text,text,int,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.dispose_accounting_asset(uuid,uuid,date,text,text,uuid,text,numeric,boolean) TO authenticated;

-- Generic extourne must not break the asset register. Dedicated corrections are a separate scope.
CREATE OR REPLACE FUNCTION public.reverse_manual_accounting_entry(p_tenant_id uuid, p_entry_id uuid, p_date date, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
 o public.journal_entries%ROWTYPE;
 prev public.journal_entries%ROWTYPE;
 v_id uuid; v_piece text; v_d numeric; v_c numeric; v_count int;
 v_reason text:=nullif(btrim(p_reason),'');
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id() OR NOT public.current_user_can_manage_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.enabled_modules ? 'accounting') THEN RAISE EXCEPTION 'Module comptable non activé.' USING ERRCODE='42501'; END IF;
 IF v_reason IS NULL OR length(v_reason)>500 THEN RAISE EXCEPTION 'Motif d’extourne obligatoire (500 caractères maximum).'; END IF;
 SELECT * INTO o FROM public.journal_entries e WHERE e.tenant_id=p_tenant_id AND e.id=p_entry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Écriture introuvable.'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_fixed_assets a LEFT JOIN public.journal_lines l ON l.tenant_id=a.tenant_id AND l.id IN(a.acquisition_line_id,a.sale_line_id) WHERE a.tenant_id=p_tenant_id AND (l.entry_id=o.id OR a.disposal_entry_id=o.id))
 OR EXISTS(SELECT 1 FROM public.accounting_asset_depreciations d WHERE d.tenant_id=p_tenant_id AND d.entry_id=o.id) THEN RAISE EXCEPTION 'Cette pièce est liée au registre des immobilisations. Correction spécialisée requise.';END IF;
 IF o.source_type IS DISTINCT FROM 'manual' OR o.status IS DISTINCT FROM 'posted' THEN
  RAISE EXCEPTION 'Extourne réservée aux écritures manuelles validées. Corrigez les pièces commerciales depuis leur module d’origine.';
 END IF;
 IF p_date IS NULL OR NOT isfinite(p_date) OR p_date<o.entry_date OR p_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Date d’extourne invalide : elle doit être comprise entre la date d’origine et aujourd’hui.'; END IF;
 IF extract(year FROM p_date)<>extract(year FROM CURRENT_DATE) THEN RAISE EXCEPTION 'Choisissez une date dans l’exercice courant : numérotation des exercices antérieurs non disponible.'; END IF;
 SELECT * INTO prev FROM public.journal_entries WHERE tenant_id=p_tenant_id AND source_type='reversal' AND source_id=o.id;
 IF FOUND THEN
  IF prev.status='posted' AND prev.entry_date=p_date AND prev.reversal_reason=v_reason THEN
   RETURN jsonb_build_object('success',true,'entry_id',prev.id,'piece_number',prev.entry_number,'already_reversed',true);
  END IF;
  RAISE EXCEPTION 'Cette écriture possède déjà une extourne : %.',prev.entry_number;
 END IF;
 -- Les opérations de lettrage verrouillent également l'écriture parente avant ses lignes.
 PERFORM 1 FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.entry_id=o.id ORDER BY l.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.journal_lines l JOIN public.accounting_match_lines m ON m.tenant_id=l.tenant_id AND m.line_id=l.id AND m.released_at IS NULL WHERE l.tenant_id=p_tenant_id AND l.entry_id=o.id) THEN
  RAISE EXCEPTION 'Délettrez les lignes de cette écriture avant de l’extourner.';
 END IF;
 SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0) INTO v_count,v_d,v_c FROM public.journal_lines WHERE tenant_id=p_tenant_id AND entry_id=o.id;
 IF v_count<2 OR v_d<=0 OR v_d IS DISTINCT FROM v_c OR v_d IS DISTINCT FROM o.total_debit OR v_c IS DISTINCT FROM o.total_credit OR v_d IN ('NaN'::numeric,'Infinity'::numeric) THEN
  RAISE EXCEPTION 'L’écriture d’origine doit être équilibrée et ses totaux cohérents.';
 END IF;
 PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',p_date)::date);
 v_piece:=public.next_accounting_piece_number(p_tenant_id,o.journal_type);
 INSERT INTO public.journal_entries(tenant_id,entry_number,journal_type,entry_date,reference,description,total_debit,total_credit,is_balanced,source_type,source_id,status,posted_at,posted_by,reversal_reason)
 VALUES(p_tenant_id,v_piece,o.journal_type,p_date,o.entry_number,'Extourne de '||o.entry_number||' : '||v_reason,v_c,v_d,true,'reversal',o.id,'posted',now(),auth.uid(),v_reason)
 RETURNING id INTO v_id;
 INSERT INTO public.journal_lines(tenant_id,entry_id,account_code,account_name,debit,credit,label,third_party_id)
 SELECT p_tenant_id,v_id,l.account_code,l.account_name,l.credit,l.debit,'Extourne : '||coalesce(nullif(l.label,''),o.entry_number),l.third_party_id
 FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.entry_id=o.id ORDER BY l.id;
 RETURN jsonb_build_object('success',true,'entry_id',v_id,'piece_number',v_piece,'original_piece',o.entry_number,'total',v_d);
END;
$function$

;

CREATE OR REPLACE FUNCTION public.preview_accounting_asset_disposal(p_tenant_id uuid,p_asset_id uuid,p_date date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.accounting_fixed_assets%ROWTYPE; posted numeric; target numeric; missing int; later int;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 SELECT * INTO a FROM public.accounting_fixed_assets WHERE tenant_id=p_tenant_id AND id=p_asset_id;
 IF NOT FOUND OR a.disposed_on IS NOT NULL OR p_date IS NULL OR NOT isfinite(p_date) OR p_date<a.service_date OR p_date>(now() AT TIME ZONE 'Africa/Dakar')::date OR extract(year FROM p_date)<>extract(year FROM CURRENT_DATE) THEN RAISE EXCEPTION 'Date de sortie ou immobilisation invalide.';END IF;
 SELECT coalesce(sum(amount),0),count(*) FILTER(WHERE through_date>p_date) INTO posted,later FROM public.accounting_asset_depreciations WHERE tenant_id=p_tenant_id AND asset_id=a.id;
 SELECT count(*) INTO missing FROM public._asset_plan(p_tenant_id,a.id,p_date) p WHERE p.period_start<date_trunc('month',p_date)::date AND p.amount>0 AND p.entry_id IS NULL;
 target:=public._asset_linear_cumulative(a.cost,a.residual,a.service_date,a.life_months,p_date);
 RETURN jsonb_build_object('date',p_date,'posted',posted,'cumulative',target,'complement',target-posted,'net',a.cost-target,'missing_prior',missing,'blocked',missing>0 OR later>0 OR posted>target);
END;$$;
REVOKE ALL ON FUNCTION public.preview_accounting_asset_disposal(uuid,uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preview_accounting_asset_disposal(uuid,uuid,date) TO authenticated;

-- Comparison with ledger balances: unmatched amounts require review, not auto-adjustment.
-- Non-depreciable assets and legacy/unregistered assets may legitimately explain differences.
CREATE OR REPLACE FUNCTION public.accounting_asset_reconciliation(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE dt date:=(now() AT TIME ZONE 'Africa/Dakar')::date; result jsonb;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 WITH dep AS (SELECT d.asset_id,sum(d.amount) amount FROM public.accounting_asset_depreciations d WHERE d.tenant_id=p_tenant_id GROUP BY d.asset_id),
 reg AS (
 SELECT a.asset_account code,a.cost amount FROM public.accounting_fixed_assets a WHERE a.tenant_id=p_tenant_id AND a.disposed_on IS NULL
 UNION ALL
 SELECT a.depreciation_account,-coalesce(d.amount,0) FROM public.accounting_fixed_assets a LEFT JOIN dep d ON d.asset_id=a.id WHERE a.tenant_id=p_tenant_id AND a.disposed_on IS NULL
 ), grouped AS (SELECT code,sum(amount) amount FROM reg GROUP BY code),
 books AS (SELECT b.account_code,b.account_name,b.closing FROM public._accounting_period_balances(p_tenant_id,date_trunc('year',dt)::date,dt) b WHERE b.account_code ~ '^(2[1234]|28[1234])'),
 combined AS (SELECT coalesce(b.account_code,g.code) code,coalesce(b.account_name,a.name,'Compte absent') name,coalesce(g.amount,0) registered,coalesce(b.closing,0) ledger,coalesce(b.closing,0)-coalesce(g.amount,0) difference
 FROM books b FULL JOIN grouped g ON g.code=b.account_code LEFT JOIN public.accounts a ON a.tenant_id=p_tenant_id AND a.code=coalesce(b.account_code,g.code))
 SELECT jsonb_build_object('as_of',dt,'rows',coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.code),'[]'::jsonb),'difference_count',count(*) FILTER(WHERE c.difference<>0)) INTO result FROM combined c;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.accounting_asset_reconciliation(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_asset_reconciliation(uuid) TO authenticated;
