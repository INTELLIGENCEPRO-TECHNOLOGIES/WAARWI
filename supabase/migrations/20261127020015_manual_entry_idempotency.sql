ALTER TABLE public.journal_entries ADD COLUMN IF NOT EXISTS manual_request_id uuid, ADD COLUMN IF NOT EXISTS manual_request_hash bytea;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_manual_request_pair_ck CHECK ((manual_request_id IS NULL AND manual_request_hash IS NULL) OR (manual_request_id IS NOT NULL AND manual_request_hash IS NOT NULL AND octet_length(manual_request_hash)=32 AND source_type IS NOT DISTINCT FROM 'manual'));
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_manual_request_uq ON public.journal_entries(tenant_id,manual_request_id) WHERE manual_request_id IS NOT NULL;
CREATE OR REPLACE FUNCTION public.create_manual_journal_entry_idempotent(p_tenant_id uuid,p_journal_type text,p_entry_date date,p_description text,p_reference text,p_lines jsonb,p_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $fn$
DECLARE v_hash bytea; v_existing public.journal_entries%ROWTYPE; v_result jsonb; v_entry_id uuid;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identifiant de demande obligatoire.' USING ERRCODE='22023'; END IF;
 v_hash:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_array(p_journal_type,p_entry_date,p_description,p_reference,p_lines)::text,'UTF8'));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':manual-request:'||p_request_id::text,0));
 SELECT * INTO v_existing FROM public.journal_entries WHERE tenant_id=p_tenant_id AND manual_request_id=p_request_id;
 IF FOUND THEN
   IF v_existing.posted_by IS DISTINCT FROM auth.uid() OR v_existing.manual_request_hash IS DISTINCT FROM v_hash THEN
     RAISE EXCEPTION 'Identifiant de demande déjà utilisé pour une autre saisie.' USING ERRCODE='22023';
   END IF;
   RETURN jsonb_build_object('success',true,'entry_id',v_existing.id,'piece_number',v_existing.entry_number,'journal',v_existing.journal_type,'total',v_existing.total_debit,'already_posted',true);
 END IF;
 v_result:=public.create_manual_journal_entry(p_tenant_id,p_journal_type,p_entry_date,p_description,p_reference,p_lines);
 IF NOT coalesce((v_result->>'success')::boolean,false) THEN RETURN v_result; END IF;
 v_entry_id:=(v_result->>'entry_id')::uuid;
 UPDATE public.journal_entries SET manual_request_id=p_request_id,manual_request_hash=v_hash WHERE id=v_entry_id AND tenant_id=p_tenant_id AND source_type='manual' AND posted_by=auth.uid();
 IF NOT FOUND THEN RAISE EXCEPTION 'Enregistrement de la demande impossible.'; END IF;
 RETURN v_result||jsonb_build_object('already_posted',false);
END;$fn$;
REVOKE ALL ON FUNCTION public.create_manual_journal_entry_idempotent(uuid,text,date,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_journal_entry_idempotent(uuid,text,date,text,text,jsonb,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.create_manual_journal_entry(uuid,text,date,text,text,jsonb) FROM PUBLIC,anon,authenticated;

