-- Candidat 115 après 109/113 : protéger le remboursement différé et harmoniser les contrôles fiscaux.
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public.process_return_as_cash(uuid,uuid)'::regprocedure);
 a:=$a$v_tenant_id := current_tenant_id();$a$;b:=$b$PERFORM public._cr_require_caller();
IF NOT (coalesce(public._cr_profile_has_permission(auth.uid(),'edit_invoices'),false) OR coalesce(public._cr_profile_has_permission(auth.uid(),'pos_returns'),false)) THEN RAISE EXCEPTION 'Permission de remboursement requise.' USING ERRCODE='42501';END IF;
v_tenant_id := current_tenant_id();$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 115 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$IF v_ret.id IS NULL THEN RAISE EXCEPTION 'Retour introuvable'; END IF;$a$;b:=$b$IF v_ret.id IS NULL OR public.current_user_can_access_site(v_ret.site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Retour inaccessible.' USING ERRCODE='42501';END IF;
IF v_ret.sale_id IS NULL THEN RAISE EXCEPTION 'Rapprochez le retour de sa vente d’origine avant remboursement.' USING ERRCODE='55000';END IF;
PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text||':edit:sale:'||v_ret.sale_id::text,0));
SELECT * INTO STRICT v_origin_sale FROM public.sales WHERE id=v_ret.sale_id AND tenant_id=v_tenant_id FOR UPDATE;
SELECT * INTO STRICT v_ret FROM public.sale_returns WHERE id=p_return_id AND tenant_id=v_tenant_id FOR UPDATE;
IF v_ret.sale_id IS DISTINCT FROM v_origin_sale.id OR v_origin_sale.site_id IS DISTINCT FROM v_ret.site_id OR public.current_user_can_access_site(v_ret.site_id) IS DISTINCT FROM true OR v_origin_sale.deleted_at IS NOT NULL OR v_origin_sale.status='cancelled' THEN RAISE EXCEPTION 'Vente ou retour inaccessible.' USING ERRCODE='42501';END IF;
IF v_ret.refunded_at IS NOT NULL OR (v_ret.status='approved' AND v_ret.refund_method='avoir') THEN RAISE EXCEPTION 'Ce retour est déjà traité.' USING ERRCODE='55000';END IF;
IF v_ret.total IS NULL OR v_ret.total<=0 OR v_ret.total::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Montant de remboursement invalide.' USING ERRCODE='22023';END IF;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 115 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$IF v_already_refunded >= COALESCE(v_ret.total, 0) THEN$a$;b:=$b$IF v_already_refunded > 0 THEN$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 115 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$WHERE p.tenant_id = v_tenant_id AND p.sale_id = v_origin_sale.id AND m.payment_type = 'cash';$a$;b:=$b$WHERE p.tenant_id = v_tenant_id AND p.sale_id = v_origin_sale.id AND m.payment_type = 'cash' AND coalesce(p.status,'confirmed')='confirmed' AND p.source_return_id IS NULL;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 115 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$-- Record cash movement if session is available$a$;b:=$b$IF v_ret.vat_net_amount IS NULL AND v_ret.total>public._nonvat_cash_refund_limit(v_tenant_id,v_ret.sale_id,v_ret.id) THEN
 RAISE EXCEPTION 'Le remboursement dépasse le montant encaissé disponible. Émettez un avoir.' USING ERRCODE='22023';
END IF;
PERFORM 1 FROM public.cash_sessions s WHERE s.id=p_session_id AND s.tenant_id=v_tenant_id AND s.site_id=v_ret.site_id AND s.status='open' AND coalesce(s.theoretical_amount,0)>=v_ret.total FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Caisse fermée, inaccessible ou solde insuffisant pour le remboursement.' USING ERRCODE='55000';END IF;
-- Record cash movement if session is available$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 115 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$CASE WHEN v_multi OR v_ret.vat_net_amount IS NOT NULL THEN auth.uid() END$a$;b:=$b$auth.uid()$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 115 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$SET theoretical_amount = GREATEST(0, COALESCE(theoretical_amount, 0) - v_ret.total)$a$;b:=$b$SET theoretical_amount = COALESCE(theoretical_amount, 0) - v_ret.total$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 115 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$approved_by = CASE WHEN v_ret.vat_net_amount IS NOT NULL THEN auth.uid() ELSE approved_by END$a$;b:=$b$approved_by = auth.uid()$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 115 inattendue : %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
END $p$;
