-- Phase 8: independent analytical axes. No journal entry is written by these RPCs.
CREATE TABLE public.accounting_analytic_axes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,20}$'),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL,UNIQUE(tenant_id,id),UNIQUE(tenant_id,code));
CREATE TABLE public.accounting_analytic_centers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,axis_id uuid NOT NULL,
 code text NOT NULL CHECK(code ~ '^[A-Z0-9_-]{1,20}$'),name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),created_by uuid NOT NULL,
 UNIQUE(tenant_id,axis_id,id),UNIQUE(tenant_id,axis_id,code),
 FOREIGN KEY(tenant_id,axis_id) REFERENCES public.accounting_analytic_axes(tenant_id,id) ON DELETE CASCADE);
CREATE TABLE public.accounting_analytic_allocations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,axis_id uuid NOT NULL,line_id uuid NOT NULL,
 shares jsonb NOT NULL CHECK(jsonb_typeof(shares)='array' AND jsonb_array_length(shares) BETWEEN 1 AND 100),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid NOT NULL,history jsonb NOT NULL DEFAULT '[]'::jsonb,
 UNIQUE(tenant_id,axis_id,line_id),
 FOREIGN KEY(tenant_id,axis_id) REFERENCES public.accounting_analytic_axes(tenant_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(tenant_id,line_id) REFERENCES public.journal_lines(tenant_id,id) ON DELETE RESTRICT);
CREATE TABLE public.accounting_analytic_budgets(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,axis_id uuid NOT NULL,center_id uuid NOT NULL,
 month_start date NOT NULL CHECK(isfinite(month_start) AND extract(day FROM month_start)=1),
 account_code text NOT NULL CHECK(account_code ~ '^[678]'),amount numeric(18,2) NOT NULL CHECK(amount>=0 AND amount<=90071992547409),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid NOT NULL,history jsonb NOT NULL DEFAULT '[]'::jsonb,
 UNIQUE(tenant_id,axis_id,center_id,month_start,account_code),
 FOREIGN KEY(tenant_id,axis_id,center_id) REFERENCES public.accounting_analytic_centers(tenant_id,axis_id,id) ON DELETE RESTRICT);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['accounting_analytic_axes','accounting_analytic_centers','accounting_analytic_allocations','accounting_analytic_budgets'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
 EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
 EXECUTE format('CREATE POLICY tenant_read ON public.%I FOR SELECT TO authenticated USING (tenant_id=public.current_tenant_id() AND public.current_user_can_view_accounting())',t);
 END LOOP;
END $$;
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory) VALUES
 ('public','accounting_analytic_axes','direct','tenant_id','structure',13,'preserve',false),
 ('public','accounting_analytic_centers','direct','tenant_id','structure',14,'preserve',false),
 ('public','accounting_analytic_budgets','direct','tenant_id','operation',99,'delete',false),
 ('public','accounting_analytic_allocations','direct','tenant_id','operation',100,'delete',false);

CREATE OR REPLACE FUNCTION public.create_accounting_analytic_dimension(p_tenant_id uuid,p_axis_id uuid,p_code text,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;c text:=upper(btrim(p_code));n text:=btrim(p_name);
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF c IS NULL OR c !~ '^[A-Z0-9_-]{1,20}$' OR n IS NULL OR length(n) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Code et intitulé requis.';END IF;
 IF p_axis_id IS NULL THEN
 INSERT INTO public.accounting_analytic_axes(tenant_id,code,name,created_by) VALUES(p_tenant_id,c,n,auth.uid()) RETURNING id INTO v_id;
 ELSE
 INSERT INTO public.accounting_analytic_centers(tenant_id,axis_id,code,name,created_by) VALUES(p_tenant_id,p_axis_id,c,n,auth.uid()) RETURNING id INTO v_id;
 END IF;
 RETURN jsonb_build_object('success',true,'id',v_id);
END;$$;

-- Allocate signed cents by largest remainder. Deterministic tie break by center UUID.
CREATE OR REPLACE FUNCTION public._analytic_split(p_amount numeric,p_shares jsonb)
RETURNS TABLE(center_id uuid,amount numeric) LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 WITH parts AS (SELECT (x->>'center_id')::uuid cid,(x->>'bps')::numeric bps FROM jsonb_array_elements(p_shares) x),
 raw AS (SELECT cid,floor(abs(p_amount)*100*bps/10000) cents,mod(abs(p_amount)*100*bps,10000) remainder FROM parts),
 ranked AS (SELECT *,row_number() OVER(ORDER BY remainder DESC,cid) rn,abs(p_amount)*100-sum(cents) OVER() leftover FROM raw)
 SELECT cid,sign(p_amount)*(cents+CASE WHEN rn<=leftover THEN 1 ELSE 0 END)/100 FROM ranked
$$;
REVOKE ALL ON FUNCTION public._analytic_split(numeric,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.save_accounting_analytic_allocation(p_tenant_id uuid,p_axis_id uuid,p_line_id uuid,p_shares jsonb,p_reason text,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l record;old public.accounting_analytic_allocations%ROWTYPE;v_count int;v_sum bigint;normalized jsonb;dt date;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_revision IS NULL OR p_revision<0 OR jsonb_typeof(p_shares) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Ventilation et justification requises.';END IF;
 IF jsonb_array_length(p_shares) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'De 1 à 100 sections.';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_shares) x WHERE coalesce(x->>'bps','') !~ '^[0-9]{1,5}$' OR coalesce(x->>'center_id','') !~ '^[0-9a-fA-F-]{36}$') THEN RAISE EXCEPTION 'Parts invalides.';END IF;
 SELECT count(*),sum((x->>'bps')::int),jsonb_agg(jsonb_build_object('center_id',(x->>'center_id')::uuid,'bps',(x->>'bps')::int) ORDER BY (x->>'center_id')::uuid) INTO v_count,v_sum,normalized FROM jsonb_array_elements(p_shares) x;
 IF v_sum<>10000 OR (SELECT count(DISTINCT (x->>'center_id')::uuid) FROM jsonb_array_elements(p_shares) x)<>v_count OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_shares) x WHERE (x->>'bps')::int NOT BETWEEN 1 AND 10000 OR NOT EXISTS(SELECT 1 FROM public.accounting_analytic_centers c WHERE c.tenant_id=p_tenant_id AND c.axis_id=p_axis_id AND c.id=(x->>'center_id')::uuid)) THEN RAISE EXCEPTION 'Sections distinctes du même axe, total de 100 % requis.';END IF;
 SELECT e.entry_date INTO dt FROM public.journal_lines x JOIN public.journal_entries e ON e.id=x.entry_id AND e.tenant_id=x.tenant_id WHERE x.tenant_id=p_tenant_id AND x.id=p_line_id;
 IF dt IS NULL THEN RAISE EXCEPTION 'Ligne inconnue.';END IF;
 PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',dt)::date);
 SELECT e.status,e.entry_date,x.account_code,x.debit,x.credit INTO l FROM public.journal_lines x JOIN public.journal_entries e ON e.id=x.entry_id AND e.tenant_id=x.tenant_id WHERE x.tenant_id=p_tenant_id AND x.id=p_line_id FOR UPDATE OF e,x;
 IF NOT FOUND OR l.status IS DISTINCT FROM 'posted' OR l.entry_date IS DISTINCT FROM dt OR l.account_code !~ '^[678]' OR l.debit=l.credit THEN RAISE EXCEPTION 'Ligne de gestion validée requise.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':analytic:'||p_axis_id::text||':'||p_line_id::text,0));
 SELECT * INTO old FROM public.accounting_analytic_allocations WHERE tenant_id=p_tenant_id AND axis_id=p_axis_id AND line_id=p_line_id FOR UPDATE;
 IF coalesce(old.revision,0)<>p_revision THEN RAISE EXCEPTION 'Ventilation modifiée. Actualisez.' USING ERRCODE='40001';END IF;
 INSERT INTO public.accounting_analytic_allocations(tenant_id,axis_id,line_id,shares,reason,updated_by)
 VALUES(p_tenant_id,p_axis_id,p_line_id,normalized,btrim(p_reason),auth.uid())
 ON CONFLICT(tenant_id,axis_id,line_id) DO UPDATE SET shares=excluded.shares,reason=excluded.reason,updated_at=now(),updated_by=excluded.updated_by,revision=accounting_analytic_allocations.revision+1,history=accounting_analytic_allocations.history||jsonb_build_array(jsonb_build_object('shares',accounting_analytic_allocations.shares,'reason',accounting_analytic_allocations.reason,'revision',accounting_analytic_allocations.revision,'updated_at',accounting_analytic_allocations.updated_at,'updated_by',accounting_analytic_allocations.updated_by));
 RETURN jsonb_build_object('success',true,'revision',p_revision+1);
END;$$;

CREATE OR REPLACE FUNCTION public.save_accounting_analytic_budget(p_tenant_id uuid,p_axis_id uuid,p_center_id uuid,p_month date,p_account text,p_amount numeric,p_reason text,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old public.accounting_analytic_budgets%ROWTYPE;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_month IS NULL OR NOT isfinite(p_month) OR extract(day FROM p_month)<>1 OR p_month<date '2000-01-01' OR p_month>date '2099-12-01' OR p_amount IS NULL OR p_amount IN ('NaN','Infinity','-Infinity') OR p_amount<0 OR p_amount>90071992547409 OR round(p_amount,2)<>p_amount OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'Budget invalide.';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=p_account AND is_active AND code ~ '^[678]') THEN RAISE EXCEPTION 'Compte de gestion actif requis.';END IF;
 PERFORM public._assert_accounting_month_open(p_tenant_id,p_month);
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':budget:'||p_center_id::text||':'||p_month::text||':'||p_account,0));
 SELECT * INTO old FROM public.accounting_analytic_budgets WHERE tenant_id=p_tenant_id AND axis_id=p_axis_id AND center_id=p_center_id AND month_start=p_month AND account_code=p_account FOR UPDATE;
 IF coalesce(old.revision,0)<>p_revision THEN RAISE EXCEPTION 'Budget modifié. Actualisez.' USING ERRCODE='40001';END IF;
 INSERT INTO public.accounting_analytic_budgets(tenant_id,axis_id,center_id,month_start,account_code,amount,reason,updated_by)
 VALUES(p_tenant_id,p_axis_id,p_center_id,p_month,p_account,p_amount,btrim(p_reason),auth.uid())
 ON CONFLICT(tenant_id,axis_id,center_id,month_start,account_code) DO UPDATE SET amount=excluded.amount,reason=excluded.reason,revision=accounting_analytic_budgets.revision+1,updated_at=now(),updated_by=excluded.updated_by,history=accounting_analytic_budgets.history||jsonb_build_array(jsonb_build_object('amount',accounting_analytic_budgets.amount,'reason',accounting_analytic_budgets.reason,'revision',accounting_analytic_budgets.revision,'updated_at',accounting_analytic_budgets.updated_at,'updated_by',accounting_analytic_budgets.updated_by));
 RETURN jsonb_build_object('success',true,'revision',p_revision+1);
END;$$;

CREATE OR REPLACE FUNCTION public.accounting_analytic_report(p_tenant_id uuid,p_axis_id uuid,p_month date,p_mode text DEFAULT 'summary',p_search text DEFAULT '',p_offset int DEFAULT 0,p_size int DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;lim int:=least(100,greatest(1,coalesce(p_size,20)));offst int:=greatest(0,coalesce(p_offset,0));term text:=lower(btrim(coalesce(p_search,'')));
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
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.create_accounting_analytic_dimension(uuid,uuid,text,text),public.save_accounting_analytic_allocation(uuid,uuid,uuid,jsonb,text,bigint),public.save_accounting_analytic_budget(uuid,uuid,uuid,date,text,numeric,text,bigint),public.accounting_analytic_report(uuid,uuid,date,text,text,int,int) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_accounting_analytic_dimension(uuid,uuid,text,text),public.save_accounting_analytic_allocation(uuid,uuid,uuid,jsonb,text,bigint),public.save_accounting_analytic_budget(uuid,uuid,uuid,date,text,numeric,text,bigint),public.accounting_analytic_report(uuid,uuid,date,text,text,int,int) TO authenticated;
