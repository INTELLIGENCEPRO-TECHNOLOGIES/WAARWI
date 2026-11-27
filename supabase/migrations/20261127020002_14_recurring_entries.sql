-- Phase 2 : échéances mensuelles avec validation explicite et traçabilité.
-- Apply after 13-entry-templates.sql.
ALTER TABLE public.accounting_entry_templates
 ADD COLUMN next_due_on date,
 ADD COLUMN monthly_day smallint CHECK(monthly_day BETWEEN 1 AND 31),
 ADD CONSTRAINT accounting_template_schedule_pair CHECK((next_due_on IS NULL)=(monthly_day IS NULL));

CREATE TABLE public.accounting_template_occurrences(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 template_id uuid NOT NULL,
 due_on date NOT NULL CHECK(isfinite(due_on)),
 entry_id uuid NOT NULL,
 request_payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 created_by uuid,
 UNIQUE(tenant_id,template_id,due_on),
 UNIQUE(tenant_id,entry_id),
 FOREIGN KEY(tenant_id,template_id) REFERENCES public.accounting_entry_templates(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,entry_id) REFERENCES public.journal_entries(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE public.accounting_template_occurrences ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_template_occurrences FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_template_occurrences TO authenticated;
CREATE POLICY accounting_template_occurrences_read ON public.accounting_template_occurrences FOR SELECT TO authenticated USING(tenant_id=public.current_tenant_id() AND public.current_user_can_view_accounting());

CREATE OR REPLACE FUNCTION public.schedule_accounting_entry_template(p_tenant_id uuid,p_template_id uuid,p_first_due date,p_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_first_due IS NULL OR NOT isfinite(p_first_due) OR p_first_due<date_trunc('year',now() AT TIME ZONE 'Africa/Dakar')::date OR p_first_due>(now() AT TIME ZONE 'Africa/Dakar')::date+366 THEN RAISE EXCEPTION 'Choisissez une échéance dans l’exercice courant ou les 366 prochains jours.';END IF;
 UPDATE public.accounting_entry_templates SET next_due_on=p_first_due,monthly_day=extract(day from p_first_due)::smallint,revision=revision+1,updated_at=now(),updated_by=auth.uid()
 WHERE tenant_id=p_tenant_id AND id=p_template_id AND revision=p_revision AND is_active AND next_due_on IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modèle absent, déjà planifié ou modifié. Actualisez.' USING ERRCODE='40001';END IF;
 RETURN jsonb_build_object('success',true,'next_due_on',p_first_due);
END;$$;

CREATE OR REPLACE FUNCTION public.post_accounting_template_occurrence(p_tenant_id uuid,p_template_id uuid,p_due_on date,p_description text,p_reference text,p_lines jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.accounting_entry_templates%ROWTYPE; prior public.accounting_template_occurrences%ROWTYPE; payload jsonb; result jsonb; next_month date; last_day int; next_due date; piece text;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_due_on IS NULL OR NOT isfinite(p_due_on) THEN RAISE EXCEPTION 'Échéance obligatoire.';END IF;
 SELECT * INTO t FROM public.accounting_entry_templates WHERE tenant_id=p_tenant_id AND id=p_template_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modèle introuvable.';END IF;
 payload:=jsonb_build_object('description',btrim(p_description),'reference',coalesce(p_reference,''),'lines',p_lines);
 SELECT * INTO prior FROM public.accounting_template_occurrences WHERE tenant_id=p_tenant_id AND template_id=t.id AND due_on=p_due_on;
 IF FOUND THEN
  IF prior.request_payload IS DISTINCT FROM payload THEN RAISE EXCEPTION 'Cette échéance a déjà été comptabilisée avec un autre contenu.';END IF;
  SELECT entry_number INTO STRICT piece FROM public.journal_entries WHERE tenant_id=p_tenant_id AND id=prior.entry_id;
  RETURN jsonb_build_object('success',true,'entry_id',prior.entry_id,'piece_number',piece,'already_posted',true,'next_due_on',t.next_due_on);
 END IF;
 IF NOT t.is_active OR t.next_due_on IS DISTINCT FROM p_due_on OR t.monthly_day IS NULL THEN RAISE EXCEPTION 'Échéance inactive ou modifiée. Rechargez le modèle.';END IF;
 IF p_due_on>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Échéance future : validation impossible.';END IF;
 -- Same validation, permissions, account locks, open period and numbering as standard manual entries.
 result:=public.create_manual_journal_entry(p_tenant_id,t.journal_code,p_due_on,p_description,p_reference,p_lines);
 IF NOT coalesce((result->>'success')::boolean,false) THEN RAISE EXCEPTION 'Écriture non validée.';END IF;
 INSERT INTO public.accounting_template_occurrences(tenant_id,template_id,due_on,entry_id,request_payload,created_by)
 VALUES(p_tenant_id,t.id,p_due_on,(result->>'entry_id')::uuid,payload,auth.uid());
 next_month:=(date_trunc('month',p_due_on)+interval '1 month')::date;
 last_day:=extract(day from (next_month+interval '1 month - 1 day'))::int;
 next_due:=next_month+(least(t.monthly_day::int,last_day)-1);
 UPDATE public.accounting_entry_templates SET next_due_on=next_due,revision=revision+1,updated_at=now(),updated_by=auth.uid() WHERE tenant_id=p_tenant_id AND id=t.id;
 RETURN result||jsonb_build_object('next_due_on',next_due);
END;$$;
REVOKE ALL ON FUNCTION public.schedule_accounting_entry_template(uuid,uuid,date,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.post_accounting_template_occurrence(uuid,uuid,date,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_accounting_entry_template(uuid,uuid,date,bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.post_accounting_template_occurrence(uuid,uuid,date,text,text,jsonb) TO authenticated;
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','accounting_template_occurrences','direct','tenant_id','operation',93,'delete',false);
