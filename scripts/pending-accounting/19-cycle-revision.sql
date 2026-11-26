-- Phase 4. Pending grouped release. Revision is a workpaper, not a closing or certification.
CREATE TABLE public.accounting_cycle_reviews(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 month_start date NOT NULL CHECK(isfinite(month_start) AND extract(day FROM month_start)=1),
 cycle text NOT NULL CHECK(cycle IN ('integrity','financing','assets','stock','customers','suppliers','tax_social','treasury','income_expense','other')),
 status text NOT NULL CHECK(status IN ('in_progress','reviewed','observations')),
 checklist jsonb NOT NULL CHECK(jsonb_typeof(checklist)='object'),
 note text NOT NULL CHECK(length(note)<=4000),
 evidence text NOT NULL CHECK(length(evidence)<=2000),
 review_token text NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid NOT NULL,
 history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(history)='array'),
 UNIQUE(tenant_id,month_start,cycle)
);
ALTER TABLE public.accounting_cycle_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_cycle_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_cycle_reviews TO authenticated;
CREATE POLICY accounting_cycle_reviews_read ON public.accounting_cycle_reviews FOR SELECT TO authenticated
 USING(tenant_id=public.current_tenant_id() AND public.current_user_can_view_accounting());
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','accounting_cycle_reviews','direct','tenant_id','operation',96,'delete',false);

CREATE OR REPLACE FUNCTION public.accounting_revision_report(p_tenant_id uuid,p_month_start date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE last_day date; stop_day date; controls jsonb; core jsonb; token text;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_month_start IS NULL OR NOT isfinite(p_month_start) OR extract(day FROM p_month_start)<>1
 OR p_month_start<(date '2000-01-01') OR p_month_start>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Mois de révision invalide.';END IF;
 last_day:=(p_month_start+interval '1 month')::date-1;
 stop_day:=least(last_day,(now() AT TIME ZONE 'Africa/Dakar')::date);
 controls:=public.accounting_period_controls(p_tenant_id,p_month_start,stop_day);
 WITH entries AS MATERIALIZED (
  SELECT e.* FROM public.journal_entries e WHERE e.tenant_id=p_tenant_id AND e.entry_date BETWEEN p_month_start AND stop_day
 ), lines AS MATERIALIZED (
  SELECT l.*,e.entry_date,e.entry_number,e.status,e.source_type,
    CASE WHEN l.account_code LIKE '401%' OR l.account_code LIKE '40%' THEN 'suppliers'
    WHEN l.account_code LIKE '41%' THEN 'customers'
    WHEN l.account_code LIKE '4%' AND left(l.account_code,2) IN ('42','43','44') THEN 'tax_social'
    WHEN l.account_code LIKE '1%' THEN 'financing'
    WHEN l.account_code LIKE '2%' THEN 'assets'
    WHEN l.account_code LIKE '3%' THEN 'stock'
    WHEN l.account_code LIKE '5%' THEN 'treasury'
    WHEN l.account_code ~ '^[678]' THEN 'income_expense' ELSE 'other' END cycle,
    a.is_active account_active,a.id account_id
  FROM entries e JOIN public.journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
  LEFT JOIN public.accounts a ON a.tenant_id=l.tenant_id AND a.code=l.account_code
 ), cycles(cycle) AS (VALUES ('integrity'),('financing'),('assets'),('stock'),('customers'),('suppliers'),('tax_social'),('treasury'),('income_expense'),('other')),
 movements AS (
  SELECT c.cycle,count(l.id) FILTER(WHERE l.status='posted') lines,
    count(DISTINCT l.entry_id) FILTER(WHERE l.status='posted') pieces,
    coalesce(sum(l.debit) FILTER(WHERE l.status='posted'),0) debit,
    coalesce(sum(l.credit) FILTER(WHERE l.status='posted'),0) credit,
    count(l.id) FILTER(WHERE l.status='posted' AND (l.account_id IS NULL OR l.account_active IS NOT TRUE)) inactive_lines,
    count(l.id) FILTER(WHERE l.status='posted' AND ((l.debit>0 AND l.credit>0) OR l.debit<0 OR l.credit<0 OR (l.debit=0 AND l.credit=0))) abnormal_lines
  FROM cycles c LEFT JOIN lines l ON c.cycle=l.cycle OR c.cycle='integrity' GROUP BY c.cycle
 ), unassigned AS (
  SELECT count(*) FILTER(WHERE l.account_code LIKE '411%' AND c.id IS NULL) clients,
    count(*) FILTER(WHERE l.account_code LIKE '401%' AND s.id IS NULL) suppliers
  FROM lines l LEFT JOIN public.customers c ON c.tenant_id=l.tenant_id AND c.id=l.third_party_id
  LEFT JOIN public.suppliers s ON s.tenant_id=l.tenant_id AND s.id=l.third_party_id WHERE l.status='posted'
 ), bank AS (
  SELECT count(*) FILTER(WHERE b.status='final') finalized,count(*) FILTER(WHERE b.status='draft') draft
  FROM public.accounting_bank_statements b WHERE b.tenant_id=p_tenant_id AND b.date_from<=stop_day AND b.date_to>=p_month_start
 ), pending AS (
  SELECT count(*) FILTER(WHERE e.status IS DISTINCT FROM 'posted' AND e.status IS DISTINCT FROM 'cancelled') n FROM entries e
 ), anomalies AS (
 SELECT l.id,l.entry_id,l.entry_number,l.entry_date,l.account_code,l.cycle,l.debit,l.credit,
 CASE WHEN l.account_id IS NULL THEN 'Compte absent'
 WHEN l.account_active IS NOT TRUE THEN 'Compte inactif'
 WHEN (l.debit>0 AND l.credit>0) OR l.debit<0 OR l.credit<0 OR (l.debit=0 AND l.credit=0) THEN 'Montants de ligne incohérents'
 WHEN l.account_code LIKE '411%' AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.tenant_id=l.tenant_id AND c.id=l.third_party_id) THEN 'Tiers client non identifié'
 WHEN l.account_code LIKE '401%' AND NOT EXISTS(SELECT 1 FROM public.suppliers s WHERE s.tenant_id=l.tenant_id AND s.id=l.third_party_id) THEN 'Tiers fournisseur non identifié' END reason
 FROM lines l WHERE l.status='posted'
 ), fingerprints AS (
  SELECT
   (SELECT md5(coalesce(string_agg(md5(to_jsonb(e)::text),'' ORDER BY e.id),'')) FROM entries e) entries_hash,
   (SELECT md5(coalesce(string_agg(md5(to_jsonb(l)::text),'' ORDER BY l.id),'')) FROM lines l) lines_hash,
   (SELECT md5(coalesce(string_agg(md5(to_jsonb(m)::text),'' ORDER BY m.id),'')) FROM public.accounting_match_lines m JOIN lines l ON l.id=m.line_id AND l.tenant_id=m.tenant_id) matching_hash,
   (SELECT md5(coalesce(string_agg(md5(to_jsonb(b)::text),'' ORDER BY b.id),'')) FROM public.accounting_bank_statements b WHERE b.tenant_id=p_tenant_id AND b.date_from<=stop_day AND b.date_to>=p_month_start) bank_hash
 )
 SELECT jsonb_build_object('month',p_month_start,'through',stop_day,'period_finished',last_day<(now() AT TIME ZONE 'Africa/Dakar')::date,
 'controls',controls,'cycles',(SELECT jsonb_agg(to_jsonb(m) ORDER BY m.cycle) FROM movements m),
 'unassigned',(SELECT to_jsonb(u) FROM unassigned u),'bank',(SELECT to_jsonb(b) FROM bank b),'pending',(SELECT n FROM pending),
 'fingerprints',(SELECT to_jsonb(f) FROM fingerprints f),
 'anomaly_count',(SELECT count(*) FROM anomalies WHERE reason IS NOT NULL),
 'anomalies',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date,x.entry_number,x.id),'[]'::jsonb) FROM (SELECT * FROM anomalies WHERE reason IS NOT NULL ORDER BY entry_date,entry_number,id LIMIT 30) x),
 'blocking',coalesce((controls->'journal'->>'inconsistent_entries')::bigint,0)+coalesce((controls->'journal'->>'duplicate_sources')::bigint,0)+coalesce((controls->'accounts'->>'inconsistent_accounts')::bigint,0)+(SELECT n FROM pending)+(SELECT abnormal_lines FROM movements WHERE cycle='integrity'))
 INTO core;
 token:=md5(core::text);
 RETURN core||jsonb_build_object('token',token,'reviews',coalesce((SELECT jsonb_agg(jsonb_build_object('cycle',r.cycle,'status',r.status,'checklist',r.checklist,'note',r.note,'evidence',r.evidence,'revision',r.revision,'updated_at',r.updated_at,'updated_by',r.updated_by,'stale',r.review_token<>token) ORDER BY r.cycle) FROM public.accounting_cycle_reviews r WHERE r.tenant_id=p_tenant_id AND r.month_start=p_month_start),'[]'::jsonb));
END;$$;
REVOKE ALL ON FUNCTION public.accounting_revision_report(uuid,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_revision_report(uuid,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_accounting_cycle_review(p_tenant_id uuid,p_month_start date,p_cycle text,p_status text,p_checklist jsonb,p_note text,p_evidence text,p_token text,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE report jsonb; old public.accounting_cycle_reviews%ROWTYPE; required text[]; k text; n text:=btrim(coalesce(p_note,'')); ev text:=btrim(coalesce(p_evidence,''));
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 required:=CASE p_cycle WHEN 'integrity' THEN ARRAY['journal','balance','sources']
 WHEN 'financing' THEN ARRAY['capital','loans','opening'] WHEN 'assets' THEN ARRAY['register','depreciation','disposals']
 WHEN 'stock' THEN ARRAY['inventory','valuation','variation'] WHEN 'customers' THEN ARRAY['reconcile','aging','impairment']
 WHEN 'suppliers' THEN ARRAY['reconcile','cutoff','aging'] WHEN 'tax_social' THEN ARRAY['tax','social','declarations']
 WHEN 'treasury' THEN ARRAY['bank','cash','transfers'] WHEN 'income_expense' THEN ARRAY['cutoff','classification','support']
 WHEN 'other' THEN ARRAY['classification','support','regularize'] ELSE NULL END;
 IF required IS NULL OR p_status IS NULL OR p_status NOT IN ('in_progress','reviewed','observations') OR p_checklist IS NULL OR jsonb_typeof(p_checklist)<>'object'
 OR length(n)>4000 OR length(ev)>2000 OR p_revision IS NULL OR p_revision<0 THEN RAISE EXCEPTION 'Dossier invalide.';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each_text(p_checklist) x WHERE NOT(x.key=ANY(required)) OR x.value NOT IN ('done','na','todo') OR x.value IS NULL) THEN RAISE EXCEPTION 'Contrôles invalides.';END IF;
 IF p_status<>'in_progress' THEN
  FOREACH k IN ARRAY required LOOP IF coalesce(p_checklist->>k,'todo') NOT IN ('done','na') THEN RAISE EXCEPTION 'Terminez ou justifiez chaque contrôle.';END IF;END LOOP;
  IF n='' OR ev='' THEN RAISE EXCEPTION 'Conclusion et références justificatives obligatoires.';END IF;
 END IF;
 IF p_month_start IS NULL OR NOT isfinite(p_month_start) OR extract(day FROM p_month_start)<>1 THEN RAISE EXCEPTION 'Mois invalide.';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':revision:'||p_month_start::text||':'||p_cycle,0));
 report:=public.accounting_revision_report(p_tenant_id,p_month_start);
 IF p_token IS DISTINCT FROM report->>'token' THEN RAISE EXCEPTION 'Données modifiées. Actualisez les contrôles.' USING ERRCODE='40001';END IF;
 IF p_status<>'in_progress' AND NOT (report->>'period_finished')::boolean THEN RAISE EXCEPTION 'Le mois est encore en cours.';END IF;
 IF p_status='reviewed' AND ((report->>'blocking')::bigint>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(report->'cycles') x WHERE x->>'cycle'=p_cycle AND (x->>'inactive_lines')::bigint>0) OR (p_cycle='customers' AND (report->'unassigned'->>'clients')::bigint>0) OR (p_cycle='suppliers' AND (report->'unassigned'->>'suppliers')::bigint>0) OR (p_cycle='treasury' AND EXISTS(SELECT 1 FROM jsonb_array_elements(report->'controls'->'coverage') x WHERE x->>'family' IN ('cash','vault') AND ((x->>'missing')::bigint+(x->>'invalid')::bigint+(x->>'date_differences')::bigint)>0))) THEN RAISE EXCEPTION 'Des incohérences bloquantes subsistent. Documentez les observations.';END IF;
 SELECT * INTO old FROM public.accounting_cycle_reviews WHERE tenant_id=p_tenant_id AND month_start=p_month_start AND cycle=p_cycle FOR UPDATE;
 IF coalesce(old.revision,0)<>p_revision THEN RAISE EXCEPTION 'Dossier modifié. Actualisez.' USING ERRCODE='40001';END IF;
 INSERT INTO public.accounting_cycle_reviews(tenant_id,month_start,cycle,status,checklist,note,evidence,review_token,snapshot,updated_by)
 VALUES(p_tenant_id,p_month_start,p_cycle,p_status,p_checklist,n,ev,p_token,report-'reviews',auth.uid())
 ON CONFLICT(tenant_id,month_start,cycle) DO UPDATE SET status=excluded.status,checklist=excluded.checklist,note=excluded.note,evidence=excluded.evidence,review_token=excluded.review_token,snapshot=excluded.snapshot,updated_by=excluded.updated_by,updated_at=now(),revision=accounting_cycle_reviews.revision+1,
 history=accounting_cycle_reviews.history||jsonb_build_array(jsonb_build_object('status',accounting_cycle_reviews.status,'checklist',accounting_cycle_reviews.checklist,'note',accounting_cycle_reviews.note,'evidence',accounting_cycle_reviews.evidence,'review_token',accounting_cycle_reviews.review_token,'snapshot',accounting_cycle_reviews.snapshot,'revision',accounting_cycle_reviews.revision,'updated_at',accounting_cycle_reviews.updated_at,'updated_by',accounting_cycle_reviews.updated_by));
 RETURN jsonb_build_object('success',true,'revision',p_revision+1);
END;$$;
REVOKE ALL ON FUNCTION public.save_accounting_cycle_review(uuid,date,text,text,jsonb,text,text,text,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_accounting_cycle_review(uuid,date,text,text,jsonb,text,text,text,bigint) TO authenticated;

-- Full anomaly list, independently paginated by cycle.
CREATE OR REPLACE FUNCTION public.accounting_revision_anomalies(p_tenant_id uuid,p_month_start date,p_cycle text,p_offset integer DEFAULT 0,p_size integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE stop_day date; result jsonb; lim int:=greatest(1,least(100,coalesce(p_size,20))); offst int:=greatest(0,coalesce(p_offset,0));
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_month_start IS NULL OR NOT isfinite(p_month_start) OR extract(day FROM p_month_start)<>1 OR p_month_start<date '2000-01-01' OR p_month_start>(now() AT TIME ZONE 'Africa/Dakar')::date OR p_cycle IS NULL OR p_cycle NOT IN ('integrity','financing','assets','stock','customers','suppliers','tax_social','treasury','income_expense','other') THEN RAISE EXCEPTION 'Critères invalides.';END IF;
 stop_day:=least((p_month_start+interval '1 month')::date-1,(now() AT TIME ZONE 'Africa/Dakar')::date);
 WITH entries AS MATERIALIZED (
  SELECT e.* FROM public.journal_entries e WHERE e.tenant_id=p_tenant_id AND e.entry_date BETWEEN p_month_start AND stop_day
 ), lines AS MATERIALIZED (
  SELECT l.*,e.entry_date,e.entry_number,e.status,e.source_type,
    CASE WHEN l.account_code LIKE '401%' OR l.account_code LIKE '40%' THEN 'suppliers'
    WHEN l.account_code LIKE '41%' THEN 'customers'
    WHEN l.account_code LIKE '4%' AND left(l.account_code,2) IN ('42','43','44') THEN 'tax_social'
    WHEN l.account_code LIKE '1%' THEN 'financing'
    WHEN l.account_code LIKE '2%' THEN 'assets'
    WHEN l.account_code LIKE '3%' THEN 'stock'
    WHEN l.account_code LIKE '5%' THEN 'treasury'
    WHEN l.account_code ~ '^[678]' THEN 'income_expense' ELSE 'other' END cycle,
    a.is_active account_active,a.id account_id
  FROM entries e JOIN public.journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
  LEFT JOIN public.accounts a ON a.tenant_id=l.tenant_id AND a.code=l.account_code
 ), anomalies AS (
 SELECT l.id,l.entry_id,l.entry_number,l.entry_date,l.account_code,l.cycle,l.debit,l.credit,
 CASE WHEN l.account_id IS NULL THEN 'Compte absent'
 WHEN l.account_active IS NOT TRUE THEN 'Compte inactif'
 WHEN (l.debit>0 AND l.credit>0) OR l.debit<0 OR l.credit<0 OR (l.debit=0 AND l.credit=0) THEN 'Montants de ligne incohérents'
 WHEN l.account_code LIKE '411%' AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.tenant_id=l.tenant_id AND c.id=l.third_party_id) THEN 'Tiers client non identifié'
 WHEN l.account_code LIKE '401%' AND NOT EXISTS(SELECT 1 FROM public.suppliers s WHERE s.tenant_id=l.tenant_id AND s.id=l.third_party_id) THEN 'Tiers fournisseur non identifié' END reason
 FROM lines l WHERE l.status='posted'

 ), filtered AS MATERIALIZED (SELECT * FROM anomalies a WHERE a.reason IS NOT NULL AND (p_cycle='integrity' OR a.cycle=p_cycle))
 SELECT jsonb_build_object('count',(SELECT count(*) FROM filtered),'rows',(SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.entry_date,q.entry_number,q.id),'[]'::jsonb) FROM (SELECT * FROM filtered ORDER BY entry_date,entry_number,id LIMIT lim OFFSET offst) q)) INTO result;
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.accounting_revision_anomalies(uuid,date,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_revision_anomalies(uuid,date,text,integer,integer) TO authenticated;
