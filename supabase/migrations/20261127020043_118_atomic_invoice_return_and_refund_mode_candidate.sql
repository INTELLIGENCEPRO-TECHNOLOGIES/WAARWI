-- 118 : modes de traitement explicites ; préparation atomique des retours de facturation non IPM.
ALTER TABLE public.sale_returns ADD COLUMN requested_refund_mode text CHECK(requested_refund_mode IN ('cash','avoir','deferred'));
CREATE FUNCTION public._check_return_requested_mode(p_id uuid,p_mode text) RETURNS void LANGUAGE plpgsql SET search_path TO '' AS $f$
DECLARE r public.sale_returns;
BEGIN
 SELECT * INTO STRICT r FROM public.sale_returns WHERE id=p_id FOR UPDATE;
 IF r.requested_refund_mode IS NOT NULL AND r.requested_refund_mode<>p_mode THEN RAISE EXCEPTION 'Référence de retour déjà utilisée pour un autre mode de traitement.' USING ERRCODE='23505';END IF;
 IF r.requested_refund_mode IS NULL THEN UPDATE public.sale_returns SET requested_refund_mode=p_mode WHERE id=p_id;END IF;
END $f$;
REVOKE ALL ON FUNCTION public._check_return_requested_mode(uuid,text) FROM PUBLIC,anon,authenticated,service_role;
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public._protect_vat_return()'::regprocedure);
 a:=$a$  IF (OLD.vat_net_amount, OLD.vat_amount)$a$;b:=$b$  IF OLD.requested_refund_mode IS DISTINCT FROM NEW.requested_refund_mode AND (current_user IN ('anon','authenticated') OR OLD.requested_refund_mode IS NOT NULL) THEN RAISE EXCEPTION 'Mode initial de retour protégé.' USING ERRCODE='42501';END IF;
  IF (OLD.vat_net_amount, OLD.vat_amount)$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public._protect_vat_return() : %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 a:=$a$r.cash_session_id=p_cash_session_id$a$;b:=$b$r.cash_session_id IS NOT DISTINCT FROM p_cash_session_id$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$IF v_session.id IS NULL THEN RAISE EXCEPTION 'Session de caisse invalide ou fermée'; END IF;$a$;b:=$b$IF (p_cash_session_id IS NOT NULL OR v_effective_method='cash') AND v_session.id IS NULL THEN RAISE EXCEPTION 'Session de caisse invalide ou fermée'; END IF;
IF EXISTS(SELECT 1 FROM public.ipm_ventes i WHERE i.tenant_id=v_tenant_id AND i.sale_id=p_sale_id) THEN RAISE EXCEPTION 'Cette vente relève de l’IPM : utilisez le traitement spécifique IPM.' USING ERRCODE='55000';END IF;
IF v_effective_method='avoir' AND v_sale.customer_id IS NULL THEN RAISE EXCEPTION 'Un client est requis pour émettre un avoir.' USING ERRCODE='22023';END IF;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$'approved', COALESCE(p_reason, 'Retour au POS'), p_restock, p_request_id, v_request_hash$a$;b:=$b$CASE WHEN v_effective_method='none' THEN 'pending' ELSE 'approved' END, COALESCE(p_reason, 'Retour au POS'), p_restock, p_request_id, v_request_hash$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$'total', sr.total, 'refunded', sr.refunded_at IS NOT NULL, 'idempotent', true$a$;b:=$b$'total', sr.total, 'refunded', sr.refund_method='cash' AND sr.refunded_at IS NOT NULL, 'refund_method',sr.refund_method,'status',sr.status,'idempotent', true$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$PERFORM public._apply_avoirs_internal(v_sale.customer_id, v_tenant_id);$a$;b:=$b$UPDATE public.sale_returns SET refunded_at=now(),approved_by=auth.uid() WHERE id=v_return_id;
PERFORM public._apply_avoirs_internal(v_sale.customer_id, v_tenant_id);$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$'refund_method', v_effective_method, 'items_count'$a$;b:=$b$'refund_method', v_effective_method, 'status',CASE WHEN v_effective_method='none' THEN 'pending' ELSE 'approved' END, 'items_count'$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 a:=$a$  v_return public.sale_returns;$a$;b:=$b$  v_return public.sale_returns;
  v_mode text:=CASE WHEN p_refund_method='avoir' THEN 'avoir' WHEN p_refund_now AND p_refund_method IS DISTINCT FROM 'deferred' THEN 'cash' ELSE 'deferred' END;
  v_result jsonb;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$    RETURN public._process_sale_return_without_vat(p_sale_id, p_site_id, p_cash_session_id, p_items,
      p_reason, p_refund_now, p_restock, p_request_id, p_refund_method);$a$;b:=$b$    v_result:=public._process_sale_return_without_vat(p_sale_id,p_site_id,p_cash_session_id,p_items,p_reason,v_mode='cash',p_restock,p_request_id,CASE WHEN v_mode='avoir' THEN 'avoir' ELSE NULL END);
    PERFORM public._check_return_requested_mode((v_result->>'return_id')::uuid,v_mode);
    RETURN v_result;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$  IF v_return.status = 'pending' THEN$a$;b:=$b$  PERFORM public._check_return_requested_mode(v_return.id,v_mode);
  IF v_return.status = 'pending' THEN$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$    ELSIF p_refund_now THEN$a$;b:=$b$    ELSIF v_mode='cash' THEN$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$'refunded', v_return.refund_method = 'cash', 'refund_method', v_return.refund_method$a$;b:=$b$'refunded', v_return.refund_method = 'cash' AND v_return.refunded_at IS NOT NULL, 'refund_method', v_return.refund_method,'status',v_return.status$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text) : %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public.prepare_vat_invoice_return(uuid,uuid,jsonb,text,boolean,text,boolean)'::regprocedure);
 a:=$a$  IF p_issue_credit AND v_return.status = 'pending' THEN$a$;b:=$b$  PERFORM public._check_return_requested_mode(v_return.id,CASE WHEN p_issue_credit THEN 'avoir' ELSE 'deferred' END);
  IF p_issue_credit AND v_return.status = 'pending' THEN$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public.prepare_vat_invoice_return(uuid,uuid,jsonb,text,boolean,text,boolean) : %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public.approve_return_as_avoir(uuid)'::regprocedure);
 a:=$a$IF v_ret.status = 'approved' AND v_ret.refund_method IS DISTINCT FROM 'avoir' THEN$a$;b:=$b$IF v_ret.status = 'approved' AND v_ret.refund_method IS DISTINCT FROM 'avoir' AND NOT (v_ret.vat_net_amount IS NULL AND v_ret.refund_method='none' AND v_ret.refunded_at IS NULL) THEN$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public.approve_return_as_avoir(uuid) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$IF v_ret.status = 'approved' THEN$a$;b:=$b$IF v_ret.status = 'approved' AND v_ret.refund_method='avoir' THEN$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public.approve_return_as_avoir(uuid) : %',n;END IF;src:=replace(src,a,b);
 a:=$a$IF v_ret.status <> 'pending' THEN$a$;b:=$b$IF v_ret.status <> 'pending' AND NOT (v_ret.status='approved' AND v_ret.vat_net_amount IS NULL AND v_ret.refund_method='none' AND v_ret.refunded_at IS NULL) THEN$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 118 public.approve_return_as_avoir(uuid) : %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
END $p$;
CREATE FUNCTION public.prepare_invoice_return(p_sale_id uuid,p_site_id uuid,p_items jsonb,p_reason text,p_restock boolean,p_request_id text,p_issue_credit boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE t uuid:=public.current_tenant_id();s public.sales;r public.sale_returns;res jsonb;mode text:=CASE WHEN p_issue_credit THEN 'avoir' ELSE 'deferred' END;
BEGIN
 PERFORM public._cr_require_caller();
 IF NOT coalesce(public._cr_profile_has_permission(auth.uid(),'edit_invoices'),false) OR public.current_user_can_access_site(p_site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Permission de retour sur facture requise.' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL OR btrim(p_request_id)='' OR length(p_request_id)>160 THEN RAISE EXCEPTION 'Référence de retour requise.' USING ERRCODE='22023';END IF;
 SELECT * INTO s FROM public.sales WHERE tenant_id=t AND id=p_sale_id AND site_id=p_site_id AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Facture inaccessible.' USING ERRCODE='42501';END IF;
 IF coalesce(s.vat_enabled_at_issue,false) THEN RETURN public.prepare_vat_invoice_return(p_sale_id,p_site_id,p_items,p_reason,p_restock,p_request_id,p_issue_credit);END IF;
 res:=public._process_sale_return_without_vat(p_sale_id,p_site_id,NULL,p_items,p_reason,false,p_restock,p_request_id,CASE WHEN p_issue_credit THEN 'avoir' ELSE NULL END);
 PERFORM public._check_return_requested_mode((res->>'return_id')::uuid,mode);
 SELECT * INTO STRICT r FROM public.sale_returns WHERE id=(res->>'return_id')::uuid AND tenant_id=t;
 RETURN to_jsonb(r);
END $f$;
REVOKE ALL ON FUNCTION public.prepare_invoice_return(uuid,uuid,jsonb,text,boolean,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_invoice_return(uuid,uuid,jsonb,text,boolean,text,boolean) TO authenticated;
