-- Conversion guard: serialize against the same quote lease and reject stale/duplicate requests.
-- The legacy stock/IPM follow-up is not part of this migration; release gate stays closed.
CREATE OR REPLACE FUNCTION public.convert_checked_quote_to_sale(p_tenant_id uuid,p_quote_id uuid,p_window_id uuid,p_lock_token uuid,p_expected_version text,p_stock_site_id uuid,p_cash_session_id uuid,p_payments jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.quotes%ROWTYPE; ss public.cash_sessions%ROWTYPE; pm public.payment_methods%ROWTYPE; el jsonb; expected numeric; paid numeric:=0; amount numeric; normalized jsonb; lines jsonb; subtotal numeric; result jsonb; sid uuid; existing_number text;
BEGIN
 PERFORM public._document_edit_access(p_tenant_id,'quote',p_quote_id::text);
 IF public._cr_profile_has_permission(auth.uid(),'edit_invoices') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Conversion en facture non autorisée.' USING ERRCODE='42501';END IF;
 PERFORM public._assert_document_edit_lease(p_tenant_id,'quote',p_quote_id::text,p_window_id,p_lock_token);
 SELECT * INTO q FROM public.quotes WHERE tenant_id=p_tenant_id AND id=p_quote_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Devis introuvable.' USING ERRCODE='55000';END IF;
 IF q.converted_sale_id IS NOT NULL OR q.status='converted' THEN
  SELECT sale_number INTO existing_number FROM public.sales WHERE tenant_id=p_tenant_id AND id=q.converted_sale_id;
  RAISE EXCEPTION 'Devis déjà converti%.',CASE WHEN existing_number IS NULL THEN '' ELSE ' en facture '||existing_number END USING ERRCODE='55000';
 END IF;
 IF q.status IS DISTINCT FROM 'accepted' THEN RAISE EXCEPTION 'Seul un devis accepté peut être converti.' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.quote_items WHERE tenant_id=p_tenant_id AND quote_id=p_quote_id ORDER BY id FOR UPDATE;
 IF p_expected_version IS NULL OR public._quote_edit_snapshot(p_tenant_id,p_quote_id)->>'version' IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Le devis a changé. Rechargez-le avant la conversion.' USING ERRCODE='40001';END IF;
 IF p_stock_site_id IS NULL OR public.current_user_can_access_site(p_stock_site_id) IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.sites WHERE tenant_id=p_tenant_id AND id=p_stock_site_id AND is_active IS NOT FALSE) OR public.resolve_root_site_id(p_stock_site_id) IS DISTINCT FROM public.resolve_root_site_id(q.site_id) THEN RAISE EXCEPTION 'Dépôt de sortie incompatible avec le magasin du devis.' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sites WHERE id=q.site_id AND tenant_id=p_tenant_id AND is_active IS NOT FALSE) THEN RAISE EXCEPTION 'Magasin du devis indisponible.' USING ERRCODE='42501';END IF;
 IF q.customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=q.customer_id AND c.tenant_id=p_tenant_id AND (c.site_id IS NULL OR public.current_user_can_access_site(c.site_id) IS TRUE)) THEN RAISE EXCEPTION 'Client indisponible.' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.quote_items i LEFT JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE i.quote_id=p_quote_id AND (i.tenant_id IS DISTINCT FROM p_tenant_id OR a.id IS NULL OR (a.site_id IS NOT NULL AND public.current_user_can_access_site(a.site_id) IS DISTINCT FROM true) OR i.quantity<=0 OR i.unit_price<0 OR coalesce(i.discount,0)<0 OR coalesce(i.discount,0)>i.quantity*i.unit_price OR i.quantity::text IN ('NaN','Infinity','-Infinity') OR i.unit_price::text IN ('NaN','Infinity','-Infinity') OR coalesce(i.discount,0)::text IN ('NaN','Infinity','-Infinity') OR round(i.quantity*i.unit_price-coalesce(i.discount,0),2) IS DISTINCT FROM round(i.total,2))) THEN RAISE EXCEPTION 'Les lignes du devis sont incomplètes ou incohérentes.' USING ERRCODE='22023';END IF;
 SELECT jsonb_agg(jsonb_build_object('article_id',article_id,'quantity',quantity,'unit_price',unit_price,'discount',coalesce(discount,0)) ORDER BY id),sum(total) INTO lines,subtotal FROM public.quote_items WHERE tenant_id=p_tenant_id AND quote_id=p_quote_id;
 IF lines IS NULL OR round(subtotal,2) IS DISTINCT FROM round(q.subtotal,2) OR coalesce(q.discount,0)<0 OR coalesce(q.discount,0)>subtotal OR round(subtotal-coalesce(q.discount,0),2) IS DISTINCT FROM round(q.total,2) THEN RAISE EXCEPTION 'Totaux du devis incohérents.' USING ERRCODE='22023';END IF;
 IF p_payments IS NULL OR jsonb_typeof(p_payments)<>'array' OR jsonb_array_length(p_payments) NOT BETWEEN 1 AND 51 OR jsonb_typeof(p_payments->0->'expected_ttc') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Montant TTC à confirmer.' USING ERRCODE='22023';END IF;
 expected:=(p_payments->0->>'expected_ttc')::numeric;
 IF expected<0 OR expected::text IN ('NaN','Infinity','-Infinity') OR expected<>round(expected,2) THEN RAISE EXCEPTION 'Montant TTC invalide.' USING ERRCODE='22023';END IF;
 PERFORM public._sale_total_for_issue(p_tenant_id,q.site_id,lines,coalesce(q.discount,0),q.total,expected);
 normalized:=jsonb_build_array(jsonb_build_object('expected_ttc',expected));
 FOR el IN SELECT value FROM jsonb_array_elements(p_payments-0) LOOP
  IF jsonb_typeof(el->'amount') IS DISTINCT FROM 'number' OR jsonb_typeof(el->'payment_method_id') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'Règlement invalide.' USING ERRCODE='22023';END IF;
  amount:=(el->>'amount')::numeric;
  IF amount<=0 OR amount<>round(amount,2) OR amount::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Montant de règlement invalide.' USING ERRCODE='22023';END IF;
  SELECT * INTO pm FROM public.payment_methods WHERE tenant_id=p_tenant_id AND id=(el->>'payment_method_id')::uuid AND is_active IS TRUE;
  IF NOT FOUND OR pm.payment_type='credit' OR upper(coalesce(pm.code,''))='CREDIT' THEN RAISE EXCEPTION 'Mode de règlement indisponible.' USING ERRCODE='22023';END IF;
  paid:=paid+amount;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('payment_method_id',pm.id,'method_name',pm.name,'amount',amount,'reference',left(coalesce(el->>'reference',''),500)));
 END LOOP;
 IF paid>expected OR (paid<expected AND q.customer_id IS NULL) THEN RAISE EXCEPTION 'Montant réglé ou client incompatible avec la facture.' USING ERRCODE='22023';END IF;
 IF paid>0 AND p_cash_session_id IS NULL THEN RAISE EXCEPTION 'Ouvrez une caisse avant d’encaisser cette facture.' USING ERRCODE='55000';END IF;
 IF p_cash_session_id IS NOT NULL THEN
  SELECT * INTO ss FROM public.cash_sessions WHERE tenant_id=p_tenant_id AND id=p_cash_session_id AND site_id=q.site_id FOR UPDATE;
  IF NOT FOUND OR ss.status IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'Session de caisse fermée ou incompatible.' USING ERRCODE='55000';END IF;
  IF ss.user_id IS DISTINCT FROM auth.uid() AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND tenant_id=p_tenant_id AND role IN ('admin','super_admin','manager')) AND public.is_tenant_owner() IS DISTINCT FROM true THEN RAISE EXCEPTION 'Session d’un autre utilisateur.' USING ERRCODE='42501';END IF;
 END IF;
 -- Refuse issuing fiscal documents in an incomplete test schema.
 IF public._sale_vat_enabled(p_tenant_id,q.site_id) AND NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.sales'::regclass AND tgname='finish_sale_vat' AND tgenabled<>'D') THEN RAISE EXCEPTION 'Moteur de TVA incomplet dans cet environnement.' USING ERRCODE='55000';END IF;
 result:=public.convert_quote_to_sale(p_quote_id,q.site_id,p_cash_session_id,normalized);
 sid:=(result->>'sale_id')::uuid;
 IF sid IS NULL OR NOT EXISTS(SELECT 1 FROM public.quotes WHERE tenant_id=p_tenant_id AND id=p_quote_id AND status='converted' AND converted_sale_id=sid) OR NOT EXISTS(SELECT 1 FROM public.sales WHERE tenant_id=p_tenant_id AND id=sid AND site_id=q.site_id) THEN RAISE EXCEPTION 'Conversion incomplète.' USING ERRCODE='55000';END IF;
 INSERT INTO public.audit_logs(tenant_id,user_id,action,module,reference_id,old_value,new_value) VALUES(p_tenant_id,auth.uid(),'quote_convert','billing',p_quote_id,jsonb_build_object('status',q.status),jsonb_build_object('sale_id',sid,'sale_number',result->>'sale_number','stock_site_id',p_stock_site_id));
 PERFORM public.document_edit_lease(p_tenant_id,'quote',p_quote_id::text,p_window_id,'release',p_lock_token);
 RETURN result||jsonb_build_object('success',true);
END $$;
REVOKE ALL ON FUNCTION public.convert_quote_to_sale(uuid,uuid,uuid,jsonb),public.convert_checked_quote_to_sale(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.convert_checked_quote_to_sale(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb) TO authenticated;

