-- Candidat 113, après 109. Validation des entrées et plafond des remboursements sans TVA.
-- Historique sans lignes de paiement : paid est un plafond conservatoire, pas une preuve du mode de paiement.
CREATE FUNCTION public._nonvat_cash_refund_limit(p_tenant uuid,p_sale uuid,p_exclude_return uuid)
RETURNS numeric LANGUAGE plpgsql STABLE SET search_path TO ''
AS $f$
DECLARE v_paid numeric; v_count bigint; v_cash numeric; v_refunded numeric;
BEGIN
 SELECT greatest(coalesce(s.paid,0),0) INTO STRICT v_paid FROM public.sales s WHERE s.id=p_sale AND s.tenant_id=p_tenant;
 SELECT count(*),coalesce(sum(p.amount) FILTER (WHERE coalesce(p.status,'confirmed')='confirmed' AND m.payment_type='cash' AND p.source_return_id IS NULL),0)
 INTO v_count,v_cash FROM public.sale_payments p LEFT JOIN public.payment_methods m ON m.id=p.payment_method_id AND m.tenant_id=p.tenant_id
 WHERE p.tenant_id=p_tenant AND p.sale_id=p_sale;
 IF v_count=0 THEN v_cash:=v_paid;END IF;
 SELECT coalesce(sum(greatest(CASE WHEN r.status='approved' AND r.refund_method='cash' THEN coalesce(r.total,0) ELSE 0 END,
    coalesce((SELECT sum(c.amount) FROM public.cash_movements c WHERE c.tenant_id=p_tenant AND c.sale_return_id=r.id AND c.kind='refund'),0))),0)
 INTO v_refunded FROM public.sale_returns r WHERE r.tenant_id=p_tenant AND r.sale_id=p_sale AND r.id IS DISTINCT FROM p_exclude_return;
 IF v_cash::text IN ('NaN','Infinity','-Infinity') OR v_refunded::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Montant historique invalide.' USING ERRCODE='55000';END IF;
 RETURN greatest(0,v_cash-v_refunded);
END $f$;
REVOKE ALL ON FUNCTION public._nonvat_cash_refund_limit(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 a:=$a$IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RAISE EXCEPTION 'Aucun article à retourner'; END IF;$a$;b:=$b$IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Sélectionnez les lignes à retourner.' USING ERRCODE='22023';END IF;
IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(sale_item_id uuid,quantity numeric) WHERE x.sale_item_id IS NULL OR x.quantity IS NULL OR x.quantity<=0 OR x.quantity::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Ligne ou quantité de retour invalide.' USING ERRCODE='22023';END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x ? 'lots' AND jsonb_typeof(x->'lots') IS DISTINCT FROM 'array') THEN RAISE EXCEPTION 'Affectation des lots invalide.' USING ERRCODE='22023';END IF;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 113 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id AND tenant_id = v_tenant_id;$a$;b:=$b$SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id AND tenant_id = v_tenant_id FOR UPDATE;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 113 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$IF v_sale.id IS NULL THEN RAISE EXCEPTION 'Vente introuvable ou accès refusé'; END IF;$a$;b:=$b$IF v_sale.id IS NULL OR v_sale.site_id IS DISTINCT FROM p_site_id OR v_sale.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Vente introuvable dans ce magasin ou accès refusé.' USING ERRCODE='42501';END IF;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 113 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$IF v_req_qty <= 0 THEN CONTINUE; END IF;$a$;b:=$b$IF v_req_qty IS NULL OR v_req_qty<=0 OR v_req_qty::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Quantité invalide.' USING ERRCODE='22023';END IF;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 113 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$v_return_value := v_returned_net - v_global_share;$a$;b:=$b$v_return_value := v_returned_net - v_global_share;
IF v_return_value IS NULL OR v_return_value<0 OR v_return_value::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Montant de retour incohérent.' USING ERRCODE='55000';END IF;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 113 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$IF v_effective_method = 'cash' AND v_return_total > 0 THEN$a$;b:=$b$IF v_effective_method = 'cash' AND v_return_total > 0 THEN
IF v_return_total>public._nonvat_cash_refund_limit(v_tenant_id,p_sale_id,v_return_id) THEN RAISE EXCEPTION 'Le remboursement dépasse le montant encaissé disponible. Émettez un avoir.' USING ERRCODE='22023';END IF;
PERFORM 1 FROM public.cash_sessions s WHERE s.id=p_cash_session_id AND s.tenant_id=v_tenant_id AND s.site_id=p_site_id AND s.status='open' AND coalesce(s.theoretical_amount,0)>=v_return_total FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Solde de caisse insuffisant pour le remboursement.' USING ERRCODE='55000';END IF;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 113 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$SET theoretical_amount = GREATEST(0, COALESCE(theoretical_amount, 0) - v_return_total)$a$;b:=$b$SET theoretical_amount = COALESCE(theoretical_amount, 0) - v_return_total$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 113 inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$'total', v_return_total, 'refunded', v_effective_method = 'cash',$a$;b:=$b$'total', v_return_total, 'refunded', v_effective_method = 'cash' AND v_return_total>0,$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 113 inattendue : %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
END $p$;
