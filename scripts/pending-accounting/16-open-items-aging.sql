-- Phase 3 — échéances comptables explicites, balance âgée des postes ouverts.
-- Do not apply before the grouped release.
CREATE TABLE public.accounting_line_due_dates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 line_id uuid NOT NULL,
 due_on date NOT NULL CHECK(isfinite(due_on)),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid,
 history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(history)='array'),
 UNIQUE(tenant_id,line_id),
 FOREIGN KEY(tenant_id,line_id) REFERENCES public.journal_lines(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE public.accounting_line_due_dates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_line_due_dates FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_line_due_dates TO authenticated;
CREATE POLICY accounting_line_due_dates_read ON public.accounting_line_due_dates FOR SELECT TO authenticated
 USING(tenant_id=public.current_tenant_id() AND public.current_user_can_view_accounting());
CREATE OR REPLACE FUNCTION public.set_accounting_line_due_date(p_tenant_id uuid,p_line_id uuid,p_due_on date,p_reason text,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE l record; old public.accounting_line_due_dates%ROWTYPE; next_revision bigint;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_due_on IS NULL OR NOT isfinite(p_due_on) OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 500 OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'Date, motif et version obligatoires.';END IF;
 SELECT j.entry_date,j.status,x.account_code,x.debit,x.credit INTO l
 FROM public.journal_lines x JOIN public.journal_entries j ON j.tenant_id=x.tenant_id AND j.id=x.entry_id
 WHERE x.tenant_id=p_tenant_id AND x.id=p_line_id FOR UPDATE OF j,x;
 IF NOT FOUND OR l.status<>'posted' OR NOT ((l.account_code LIKE '411%' AND l.debit>l.credit) OR (l.account_code LIKE '401%' AND l.credit>l.debit)) THEN RAISE EXCEPTION 'Échéance réservée aux créances et dettes comptabilisées.';END IF;
 IF p_due_on<l.entry_date OR p_due_on>l.entry_date+3650 THEN RAISE EXCEPTION 'Échéance hors période autorisée.';END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_match_lines m WHERE m.tenant_id=p_tenant_id AND m.line_id=p_line_id AND m.released_at IS NULL) THEN RAISE EXCEPTION 'Une ligne lettrée ne peut pas être modifiée.';END IF;
 SELECT * INTO old FROM public.accounting_line_due_dates WHERE tenant_id=p_tenant_id AND line_id=p_line_id FOR UPDATE;
 IF coalesce(old.revision,0)<>p_revision THEN RAISE EXCEPTION 'Échéance modifiée. Actualisez.' USING ERRCODE='40001';END IF;
 next_revision:=p_revision+1;
 INSERT INTO public.accounting_line_due_dates(tenant_id,line_id,due_on,reason,revision,updated_by)
 VALUES(p_tenant_id,p_line_id,p_due_on,btrim(p_reason),next_revision,auth.uid())
 ON CONFLICT(tenant_id,line_id) DO UPDATE SET due_on=excluded.due_on,reason=excluded.reason,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=now(),
 history=accounting_line_due_dates.history||jsonb_build_array(jsonb_build_object('due_on',accounting_line_due_dates.due_on,'reason',accounting_line_due_dates.reason,'revision',accounting_line_due_dates.revision,'updated_at',accounting_line_due_dates.updated_at,'updated_by',accounting_line_due_dates.updated_by));
 RETURN jsonb_build_object('success',true,'revision',next_revision);
END;$$;
REVOKE ALL ON FUNCTION public.set_accounting_line_due_date(uuid,uuid,date,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_accounting_line_due_date(uuid,uuid,date,text,bigint) TO authenticated;
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','accounting_line_due_dates','direct','tenant_id','operation',94,'delete',false);

CREATE OR REPLACE FUNCTION public.accounting_open_items(p_tenant_id uuid,p_kind text,p_as_of date,p_mode text DEFAULT 'summary',p_account text DEFAULT NULL,p_search text DEFAULT NULL,p_bucket text DEFAULT NULL,p_offset integer DEFAULT 0,p_size integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; prefix text; term text:=lower(btrim(coalesce(p_search,''))); lim int:=least(100,greatest(1,coalesce(p_size,20))); offst int:=greatest(0,coalesce(p_offset,0));
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_kind IS NULL OR p_kind NOT IN ('client','supplier') OR p_mode IS NULL OR p_mode NOT IN ('summary','items') OR p_as_of IS NULL OR NOT isfinite(p_as_of) OR p_as_of>(now() AT TIME ZONE 'Africa/Dakar')::date OR (p_bucket IS NOT NULL AND p_bucket NOT IN ('unknown','current','d30','d60','d90','older','credit')) THEN RAISE EXCEPTION 'Critères invalides.';END IF;
 prefix:=CASE WHEN p_kind='client' THEN '411' ELSE '401' END;
 WITH base AS MATERIALIZED (
  SELECT l.id line_id,l.entry_id,l.account_code,l.account_name,l.third_party_id,e.entry_number,e.entry_date,e.journal_type,coalesce(l.label,e.description,'') label,
   CASE WHEN p_kind='client' THEN l.debit-l.credit ELSE l.credit-l.debit END amount,
   m.group_id
  FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
  LEFT JOIN public.accounting_match_lines m ON m.tenant_id=l.tenant_id AND m.line_id=l.id AND m.released_at IS NULL
  WHERE l.tenant_id=p_tenant_id AND e.status='posted' AND l.account_code LIKE prefix||'%'
 ), complete_groups AS (
  SELECT group_id FROM base WHERE group_id IS NOT NULL GROUP BY group_id HAVING max(entry_date)<=p_as_of AND sum(amount)=0 AND count(DISTINCT account_code)=1
 ), parties AS (
  SELECT id,account_code,name FROM public.customers WHERE tenant_id=p_tenant_id AND p_kind='client'
  UNION ALL SELECT id,account_code,name FROM public.suppliers WHERE tenant_id=p_tenant_id AND p_kind='supplier'
 ), unique_party AS (
  SELECT p.account_code,(array_agg(p.id))[1] id,min(p.name) name FROM parties p JOIN public.accounts a ON a.tenant_id=p_tenant_id AND a.code=p.account_code AND a.account_type='auxiliary' GROUP BY p.account_code HAVING count(*)=1
 ), open_lines AS (
  SELECT b.line_id,b.entry_id,b.account_code,b.entry_number,b.entry_date,b.journal_type,b.label,b.amount,d.due_on,coalesce(d.revision,0) due_revision,
   coalesce(p.id,CASE WHEN b.third_party_id IS NULL THEN u.id END) party_id,
   coalesce(p.name,CASE WHEN b.third_party_id IS NULL THEN u.name END,b.account_name,'Compte non affecté') party_name,
   CASE WHEN p.id IS NULL AND (b.third_party_id IS NOT NULL OR u.id IS NULL) THEN true WHEN p.id IS NOT NULL AND u.id IS NOT NULL AND p.id<>u.id THEN true ELSE false END unassigned,
   b.group_id IS NOT NULL matched,
   CASE WHEN b.amount<0 THEN 'credit' WHEN d.due_on IS NULL THEN 'unknown' WHEN d.due_on>=p_as_of THEN 'current' WHEN p_as_of-d.due_on<=30 THEN 'd30' WHEN p_as_of-d.due_on<=60 THEN 'd60' WHEN p_as_of-d.due_on<=90 THEN 'd90' ELSE 'older' END bucket
  FROM base b LEFT JOIN complete_groups g ON g.group_id=b.group_id
  LEFT JOIN parties p ON p.id=b.third_party_id
  LEFT JOIN unique_party u ON u.account_code=b.account_code
  LEFT JOIN public.accounting_line_due_dates d ON d.tenant_id=p_tenant_id AND d.line_id=b.line_id
  WHERE b.entry_date<=p_as_of AND b.amount<>0 AND g.group_id IS NULL AND (p_account IS NULL OR b.account_code=p_account)
 ), filtered AS MATERIALIZED (
  SELECT * FROM open_lines WHERE (term='' OR strpos(lower(account_code||' '||party_name||' '||entry_number||' '||label),term)>0) AND (p_bucket IS NULL OR bucket=p_bucket)
 ), grouped AS (
  SELECT account_code,party_id,max(party_name) party_name,bool_or(unassigned) unassigned,count(*) items,
   coalesce(sum(amount) FILTER(WHERE bucket='unknown'),0) unknown,
   coalesce(sum(amount) FILTER(WHERE bucket='current'),0) current,
   coalesce(sum(amount) FILTER(WHERE bucket='d30'),0) d30,
   coalesce(sum(amount) FILTER(WHERE bucket='d60'),0) d60,
   coalesce(sum(amount) FILTER(WHERE bucket='d90'),0) d90,
   coalesce(sum(amount) FILTER(WHERE bucket='older'),0) older,
   coalesce(sum(-amount) FILTER(WHERE bucket='credit'),0) credit,
   sum(amount) net
  FROM filtered GROUP BY account_code,party_id
 ), totals AS (
  SELECT coalesce(sum(amount) FILTER(WHERE amount>0),0) gross,coalesce(sum(-amount) FILTER(WHERE amount<0),0) credit,coalesce(sum(amount),0) net,
   coalesce(sum(amount) FILTER(WHERE bucket='unknown'),0) unknown,
   coalesce(sum(amount) FILTER(WHERE bucket IN ('d30','d60','d90','older')),0) overdue,
   count(*) FILTER(WHERE unassigned) unassigned_count FROM filtered
 )
 SELECT jsonb_build_object('totals',(SELECT to_jsonb(t) FROM totals t),
 'count',CASE WHEN p_mode='summary' THEN (SELECT count(*) FROM grouped) ELSE (SELECT count(*) FROM filtered) END,
 'rows',CASE WHEN p_mode='summary' THEN (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.account_code,q.party_id),'[]'::jsonb) FROM (SELECT * FROM grouped ORDER BY account_code,party_id NULLS LAST LIMIT lim OFFSET offst) q)
 ELSE (SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.entry_date,q.entry_number,q.line_id),'[]'::jsonb) FROM (SELECT * FROM filtered ORDER BY entry_date,entry_number,line_id LIMIT lim OFFSET offst) q) END) INTO result;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.accounting_open_items(uuid,text,date,text,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_open_items(uuid,text,date,text,text,text,text,integer,integer) TO authenticated;
