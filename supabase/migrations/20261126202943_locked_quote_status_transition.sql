CREATE OR REPLACE FUNCTION public.read_quote_action_snapshot(p_tenant_id uuid,p_quote_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._document_edit_access(p_tenant_id,'quote',p_quote_id::text);
 RETURN public._quote_edit_snapshot(p_tenant_id,p_quote_id);
END $$;
CREATE OR REPLACE FUNCTION public.change_locked_quote_status(p_tenant_id uuid,p_quote_id uuid,p_expected_version text,p_status text,p_window_id uuid DEFAULT NULL,p_lock_token uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.quotes%ROWTYPE; w uuid:=coalesce(p_window_id,gen_random_uuid()); tok uuid:=p_lock_token; l jsonb; result jsonb;
BEGIN
 PERFORM public._document_edit_access(p_tenant_id,'quote',p_quote_id::text);
 IF p_window_id IS NULL AND p_lock_token IS NULL THEN
  l:=public.document_edit_lease(p_tenant_id,'quote',p_quote_id::text,w,'acquire');
  IF l->>'state' IS DISTINCT FROM 'held' THEN RAISE EXCEPTION 'Ce devis est en cours d’utilisation. Demandez sa libération avant de changer son statut.' USING ERRCODE='55000';END IF;
  tok:=(l->>'token')::uuid;
 ELSIF p_window_id IS NULL OR p_lock_token IS NULL THEN RAISE EXCEPTION 'Verrou incomplet.' USING ERRCODE='22023';END IF;
 PERFORM public._assert_document_edit_lease(p_tenant_id,'quote',p_quote_id::text,w,tok);
 SELECT * INTO q FROM public.quotes WHERE tenant_id=p_tenant_id AND id=p_quote_id FOR UPDATE;
 PERFORM 1 FROM public.quote_items WHERE tenant_id=p_tenant_id AND quote_id=p_quote_id ORDER BY id FOR UPDATE;
 IF NOT FOUND AND q.id IS NULL THEN RAISE EXCEPTION 'Devis introuvable.' USING ERRCODE='55000';END IF;
 IF p_expected_version IS NULL OR public._quote_edit_snapshot(p_tenant_id,p_quote_id)->>'version' IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Le devis a changé. Rechargez-le avant de changer son statut.' USING ERRCODE='40001';END IF;
 IF q.converted_sale_id IS NOT NULL OR q.status IS NULL OR NOT coalesce((q.status='draft' AND p_status IN ('sent','accepted','rejected')) OR (q.status='sent' AND p_status IN ('accepted','rejected')) OR (q.status='accepted' AND p_status='rejected'),false) THEN RAISE EXCEPTION 'Changement de statut non autorisé.' USING ERRCODE='55000';END IF;
 UPDATE public.quotes SET status=p_status WHERE tenant_id=p_tenant_id AND id=p_quote_id;
 INSERT INTO public.audit_logs(tenant_id,user_id,action,module,reference_id,old_value,new_value) VALUES(p_tenant_id,auth.uid(),'quote_status','billing',p_quote_id,jsonb_build_object('status',q.status),jsonb_build_object('status',p_status));
 result:=public._quote_edit_snapshot(p_tenant_id,p_quote_id);
 IF p_window_id IS NULL OR p_status IN ('accepted','rejected') THEN l:=public.document_edit_lease(p_tenant_id,'quote',p_quote_id::text,w,'release',tok);END IF;
 RETURN result||jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.read_quote_action_snapshot(uuid,uuid),public.change_locked_quote_status(uuid,uuid,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.read_quote_action_snapshot(uuid,uuid),public.change_locked_quote_status(uuid,uuid,text,text,uuid,uuid) TO authenticated;

