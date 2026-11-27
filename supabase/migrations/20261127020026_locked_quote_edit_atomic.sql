ALTER TABLE public.document_edit_leases DROP CONSTRAINT document_edit_leases_resource_type_check;
ALTER TABLE public.document_edit_leases ADD CONSTRAINT document_edit_leases_resource_type_check CHECK(resource_type IN ('accounting_journal','sale','quote'));
CREATE OR REPLACE FUNCTION public._document_edit_access(t uuid, k text, r text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.sales%ROWTYPE; m date;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR t IS DISTINCT FROM public.current_tenant_id() THEN RAISE EXCEPTION 'Accès refusé.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.tenant_id=t AND p.is_active IS NOT FALSE) THEN RAISE EXCEPTION 'Compte utilisateur inactif.' USING ERRCODE='42501'; END IF;
 IF k='accounting_journal' THEN
  PERFORM public._bank_reconciliation_access(t,true);
  IF r IS NULL OR r !~ '^[A-Z]{2,3}:[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Journal ou période invalide.' USING ERRCODE='22023'; END IF;
  m:= (split_part(r,':',2)||'-01')::date;
  IF m<date '2000-01-01' OR m>date_trunc('month',now() AT TIME ZONE 'Africa/Dakar')::date OR NOT public._accounting_journal_allowed(t,split_part(r,':',1),true) THEN RAISE EXCEPTION 'Journal ou période indisponible.' USING ERRCODE='22023';END IF;
 ELSIF k='sale' THEN
  IF r IS NULL OR r !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Document invalide.' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM public.sales WHERE tenant_id=t AND id=r::uuid;
  IF NOT FOUND OR public.current_user_can_access_site(s.site_id) IS DISTINCT FROM true OR public._cr_profile_has_permission(auth.uid(),'edit_invoices') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Accès au document refusé.' USING ERRCODE='42501'; END IF;
  PERFORM public._cs_assert_sale_usable(s.id);
 ELSIF k='quote' THEN
  IF r IS NULL OR r !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Devis invalide.' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.quotes q WHERE q.id=r::uuid AND q.tenant_id=t AND public.current_user_can_access_site(q.site_id) IS TRUE) OR public._cr_profile_has_permission(auth.uid(),'edit_quotes') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Accès au devis refusé.' USING ERRCODE='42501';END IF;
 ELSE RAISE EXCEPTION 'Type de document non pris en charge.' USING ERRCODE='22023';END IF;
END $function$;
CREATE OR REPLACE FUNCTION public._quote_edit_snapshot(t uuid,qid uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('version',encode(sha256(convert_to(jsonb_build_array(to_jsonb(q),coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.quote_items i WHERE i.tenant_id=t AND i.quote_id=qid),'[]'))::text,'UTF8')),'hex'),'quote',to_jsonb(q),'items',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.created_at,i.id) FROM public.quote_items i WHERE i.tenant_id=t AND i.quote_id=qid),'[]'))
 FROM public.quotes q WHERE q.tenant_id=t AND q.id=qid
$$;
CREATE OR REPLACE FUNCTION public.load_locked_quote_edit(p_tenant_id uuid,p_quote_id uuid,p_window_id uuid,p_lock_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'quote',p_quote_id::text,p_window_id,p_lock_token);
 RETURN public._quote_edit_snapshot(p_tenant_id,p_quote_id);
END $$;
CREATE OR REPLACE FUNCTION public.save_locked_quote_edit(p_tenant_id uuid,p_quote_id uuid,p_window_id uuid,p_lock_token uuid,p_expected_version text,p_items jsonb,p_customer_id uuid,p_valid_until date,p_note text,p_doc_header jsonb,p_representative_id uuid,p_release boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.quotes%ROWTYPE; total_new numeric; result jsonb; l jsonb;
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'quote',p_quote_id::text,p_window_id,p_lock_token);
 SELECT * INTO q FROM public.quotes WHERE tenant_id=p_tenant_id AND id=p_quote_id FOR UPDATE;
 IF NOT FOUND OR q.converted_sale_id IS NOT NULL OR q.status NOT IN ('draft','sent') OR q.status IS NULL THEN RAISE EXCEPTION 'Ce devis ne peut plus être modifié.' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.quote_items WHERE tenant_id=p_tenant_id AND quote_id=p_quote_id ORDER BY id FOR UPDATE;
 IF p_expected_version IS NULL OR public._quote_edit_snapshot(p_tenant_id,p_quote_id)->>'version' IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Le devis a changé depuis votre ouverture. Rechargez-le avant de poursuivre.' USING ERRCODE='40001';END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Ajoutez au moins une ligne valide.' USING ERRCODE='22023';END IF;
 IF p_doc_header IS NOT NULL AND jsonb_typeof(p_doc_header)<>'object' THEN RAISE EXCEPTION 'En-tête invalide.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric)
 LEFT JOIN public.articles a ON a.id=x.article_id AND a.tenant_id=p_tenant_id
 WHERE (x.article_id IS NOT NULL AND (a.id IS NULL OR (a.site_id IS NOT NULL AND public.current_user_can_access_site(a.site_id) IS DISTINCT FROM true))) OR x.name IS NULL OR btrim(x.name)='' OR x.quantity IS NULL OR x.quantity<=0 OR x.unit_price IS NULL OR x.unit_price<0 OR coalesce(x.discount,0)<0 OR coalesce(x.discount,0)>x.quantity*x.unit_price OR x.quantity::text IN ('NaN','Infinity','-Infinity') OR x.unit_price::text IN ('NaN','Infinity','-Infinity') OR coalesce(x.discount,0)::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Vérifiez les articles, quantités, prix et remises.' USING ERRCODE='22023';END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.tenant_id=p_tenant_id AND c.id=p_customer_id AND (c.site_id IS NULL OR public.current_user_can_access_site(c.site_id) IS TRUE)) THEN RAISE EXCEPTION 'Client indisponible.' USING ERRCODE='42501';END IF;
 IF p_representative_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_representatives r WHERE r.tenant_id=p_tenant_id AND r.id=p_representative_id) THEN RAISE EXCEPTION 'Représentant indisponible.' USING ERRCODE='42501';END IF;
 IF coalesce(q.discount,0)<>0 OR EXISTS(SELECT 1 FROM public.quote_items WHERE tenant_id=p_tenant_id AND quote_id=p_quote_id AND nullif(imei,'') IS NOT NULL) THEN RAISE EXCEPTION 'Ce devis comporte une remise globale ou un IMEI par ligne. Utilisez le parcours adapté.' USING ERRCODE='55000';END IF;
 SELECT sum(round(quantity*unit_price-coalesce(discount,0),2)) INTO total_new FROM jsonb_to_recordset(p_items) x(quantity numeric,unit_price numeric,discount numeric);
 UPDATE public.quotes SET customer_id=p_customer_id,valid_until=p_valid_until,note=coalesce(p_note,''),representative_id=p_representative_id,doc_header=coalesce(doc_header,'{}')||coalesce(p_doc_header,'{}'),subtotal=total_new,total=total_new,discount=0 WHERE tenant_id=p_tenant_id AND id=p_quote_id;
 DELETE FROM public.quote_items WHERE tenant_id=p_tenant_id AND quote_id=p_quote_id;
 INSERT INTO public.quote_items(tenant_id,quote_id,article_id,name,quantity,unit_price,discount,total)
 SELECT p_tenant_id,p_quote_id,x.article_id,x.name,x.quantity,x.unit_price,coalesce(x.discount,0),round(x.quantity*x.unit_price-coalesce(x.discount,0),2) FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric);
 INSERT INTO public.audit_logs(tenant_id,user_id,action,module,reference_id,old_value,new_value) VALUES(p_tenant_id,auth.uid(),'quote_edit','billing',p_quote_id,jsonb_build_object('total',q.total,'customer_id',q.customer_id,'representative_id',q.representative_id),jsonb_build_object('total',total_new,'customer_id',p_customer_id,'representative_id',p_representative_id));
 result:=public._quote_edit_snapshot(p_tenant_id,p_quote_id);
 IF p_release THEN l:=public.document_edit_lease(p_tenant_id,'quote',p_quote_id::text,p_window_id,'release',p_lock_token);END IF;
 RETURN result||jsonb_build_object('success',true,'lock_released',p_release AND l->>'state' IS DISTINCT FROM 'held');
END $$;
REVOKE ALL ON FUNCTION public._quote_edit_snapshot(uuid,uuid),public.load_locked_quote_edit(uuid,uuid,uuid,uuid),public.save_locked_quote_edit(uuid,uuid,uuid,uuid,text,jsonb,uuid,date,text,jsonb,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.load_locked_quote_edit(uuid,uuid,uuid,uuid),public.save_locked_quote_edit(uuid,uuid,uuid,uuid,text,jsonb,uuid,date,text,jsonb,uuid,boolean) TO authenticated;

