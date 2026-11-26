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

CREATE OR REPLACE FUNCTION public.register_accounting_asset(p_tenant_id uuid,p_code text,p_name text,p_location text,p_acquisition_line uuid,p_service date,p_months int,p_residual numeric,p_depreciation_account text,p_expense_account text,p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l record; a uuid; entry uuid; d date:=(now() AT TIME ZONE 'Africa/Dakar')::date;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_code IS NULL OR length(btrim(p_code)) NOT BETWEEN 1 AND 40 OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 200 OR length(coalesce(p_location,''))>200 OR p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 1 AND 500 OR p_service IS NULL OR NOT isfinite(p_service) OR p_months IS NULL OR p_months NOT BETWEEN 1 AND 600 OR p_residual IS NULL OR p_residual IN ('NaN','Infinity','-Infinity') OR p_residual<0 OR round(p_residual,2)<>p_residual THEN RAISE EXCEPTION 'Fiche, durée, valeur résiduelle et justificatif requis.';END IF;
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
 'plan',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.period_start),'[]'::jsonb) FROM public._asset_plan(p_tenant_id,p_asset_id) p),
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
REVOKE ALL ON FUNCTION public.register_accounting_asset(uuid,text,text,text,uuid,date,int,numeric,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.accounting_asset_detail(uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.post_accounting_asset_depreciation(uuid,uuid,date,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_accounting_asset(uuid,text,text,text,uuid,date,int,numeric,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_asset_detail(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_accounting_asset_depreciation(uuid,uuid,date,numeric) TO authenticated;
