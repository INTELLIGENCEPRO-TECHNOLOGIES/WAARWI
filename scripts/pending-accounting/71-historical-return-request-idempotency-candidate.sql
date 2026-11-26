-- Candidat : idempotence des retours historiques, sans rendre obligatoire une clé pour les anciens clients.
DO $patch$
DECLARE src text; old_text text; new_text text; n integer;
BEGIN
 src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 old_text:=$old$v_use_lot_trace boolean;$old$;new_text:=$new$v_use_lot_trace boolean;
v_request_hash bytea;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF p_request_id IS NOT NULL THEN
SELECT id INTO v_existing_return_id$old$;new_text:=$new$IF p_request_id IS NOT NULL THEN
IF btrim(p_request_id)='' OR length(p_request_id)>160 THEN RAISE EXCEPTION 'Référence de retour invalide.' USING ERRCODE='22023';END IF;
v_request_hash:=sha256(convert_to(jsonb_build_array(p_sale_id,p_site_id,p_cash_session_id,coalesce(p_reason,'Retour au POS'),coalesce(p_restock,false),v_effective_method,p_items)::text,'UTF8'));
PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text||':return-request:'||p_request_id,0));
SELECT id INTO v_existing_return_id$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF v_existing_return_id IS NOT NULL THEN
RETURN ($old$;new_text:=$new$IF v_existing_return_id IS NOT NULL THEN
IF NOT EXISTS(SELECT 1 FROM public.sale_returns r WHERE r.id=v_existing_return_id AND r.tenant_id=v_tenant_id AND r.sale_id=p_sale_id AND r.site_id=p_site_id AND r.user_id=auth.uid() AND r.cash_session_id=p_cash_session_id AND (r.request_payload_hash IS NULL OR r.request_payload_hash=v_request_hash)) THEN RAISE EXCEPTION 'Référence de retour déjà utilisée.' USING ERRCODE='23505';END IF;
RETURN ($new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$cash_session_id, return_number, total, refund_method, status, reason, restock, request_id$old$;new_text:=$new$cash_session_id, return_number, total, refund_method, status, reason, restock, request_id, request_payload_hash$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$'approved', COALESCE(p_reason, 'Retour au POS'), p_restock, p_request_id$old$;new_text:=$new$'approved', COALESCE(p_reason, 'Retour au POS'), p_restock, p_request_id, v_request_hash$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
END $patch$;
