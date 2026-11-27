-- Post and transfer in the same transaction: no other holder can save between these two operations.
CREATE OR REPLACE FUNCTION public.post_locked_manual_entry_and_release(p_tenant_id uuid,p_journal_type text,p_entry_date date,p_description text,p_reference text,p_lines jsonb,p_request_id uuid,p_window_id uuid,p_lock_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb; l jsonb;
BEGIN
 v:=public.post_locked_manual_entry(p_tenant_id,p_journal_type,p_entry_date,p_description,p_reference,p_lines,p_request_id,p_window_id,p_lock_token);
 IF (v->>'success')::boolean IS TRUE THEN
  l:=public.document_edit_lease(p_tenant_id,'accounting_journal',p_journal_type||':'||to_char(p_entry_date,'YYYY-MM'),p_window_id,'release',p_lock_token);
  v:=v||jsonb_build_object('lock_released',l->>'state' IS DISTINCT FROM 'held');
 END IF;
 RETURN v;
END $$;
CREATE OR REPLACE FUNCTION public.post_locked_template_and_release(p_tenant_id uuid,p_template_id uuid,p_due_on date,p_description text,p_reference text,p_lines jsonb,p_window_id uuid,p_lock_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb;l jsonb;c text;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 SELECT journal_code INTO c FROM public.accounting_entry_templates WHERE tenant_id=p_tenant_id AND id=p_template_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modèle introuvable.';END IF;
 v:=public.post_locked_template_occurrence(p_tenant_id,p_template_id,p_due_on,p_description,p_reference,p_lines,p_window_id,p_lock_token);
 IF (v->>'success')::boolean IS TRUE THEN
  l:=public.document_edit_lease(p_tenant_id,'accounting_journal',c||':'||to_char(p_due_on,'YYYY-MM'),p_window_id,'release',p_lock_token);
  v:=v||jsonb_build_object('lock_released',l->>'state' IS DISTINCT FROM 'held');
 END IF;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.post_locked_manual_entry_and_release(uuid,text,date,text,text,jsonb,uuid,uuid,uuid),public.post_locked_template_and_release(uuid,uuid,date,text,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.post_locked_manual_entry_and_release(uuid,text,date,text,text,jsonb,uuid,uuid,uuid),public.post_locked_template_and_release(uuid,uuid,date,text,text,jsonb,uuid,uuid) TO authenticated;

