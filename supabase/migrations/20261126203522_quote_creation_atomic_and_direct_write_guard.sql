ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS creation_request_id uuid, ADD COLUMN IF NOT EXISTS creation_request_hash bytea;
CREATE UNIQUE INDEX IF NOT EXISTS uq_quotes_creation_request ON public.quotes(tenant_id,creation_request_id) WHERE creation_request_id IS NOT NULL;
ALTER TABLE public.quotes ADD CONSTRAINT quotes_creation_request_pair CHECK((creation_request_id IS NULL)=(creation_request_hash IS NULL));
CREATE OR REPLACE FUNCTION public.create_quote_atomic(p_tenant_id uuid,p_site_id uuid,p_customer_id uuid,p_valid_until date,p_note text,p_doc_header jsonb,p_representative_id uuid,p_items jsonb,p_request_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q public.quotes%ROWTYPE; u uuid:=auth.uid(); h bytea; total_new numeric; num bigint; qid uuid;
BEGIN
 IF u IS NULL OR p_tenant_id IS NULL OR public.current_tenant_id() IS DISTINCT FROM p_tenant_id OR public._cr_profile_has_permission(u,'create_quotes') IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=u AND tenant_id=p_tenant_id AND is_active IS NOT FALSE) THEN RAISE EXCEPTION 'Création de devis non autorisée.' USING ERRCODE='42501';END IF;
 IF p_site_id IS NULL OR public.current_user_can_access_site(p_site_id) IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.sites WHERE id=p_site_id AND tenant_id=p_tenant_id AND is_active IS NOT FALSE) THEN RAISE EXCEPTION 'Magasin indisponible.' USING ERRCODE='42501';END IF;
 IF p_request_id IS NULL THEN RAISE EXCEPTION 'Identifiant de création obligatoire.' USING ERRCODE='22023';END IF;
 h:=sha256(convert_to(jsonb_build_array(p_site_id,p_customer_id,p_valid_until,coalesce(p_note,''),p_doc_header,p_representative_id,p_items)::text,'UTF8'));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':quote-create:'||p_request_id::text,0));
 SELECT * INTO q FROM public.quotes WHERE tenant_id=p_tenant_id AND creation_request_id=p_request_id FOR UPDATE;
 IF FOUND THEN
  IF q.user_id IS DISTINCT FROM u OR q.creation_request_hash IS DISTINCT FROM h THEN RAISE EXCEPTION 'Cette demande de création correspond à un autre devis. Vérifiez son résultat avant de poursuivre.' USING ERRCODE='55000';END IF;
  RETURN public._quote_edit_snapshot(p_tenant_id,q.id)||jsonb_build_object('success',true,'already_created',true);
 END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Ajoutez au moins une ligne valide.' USING ERRCODE='22023';END IF;
 IF p_doc_header IS NOT NULL AND jsonb_typeof(p_doc_header)<>'object' THEN RAISE EXCEPTION 'En-tête invalide.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric)
 LEFT JOIN public.articles a ON a.id=x.article_id AND a.tenant_id=p_tenant_id
 WHERE (x.article_id IS NOT NULL AND (a.id IS NULL OR (a.site_id IS NOT NULL AND public.current_user_can_access_site(a.site_id) IS DISTINCT FROM true))) OR x.name IS NULL OR btrim(x.name)='' OR x.quantity IS NULL OR x.quantity<=0 OR x.unit_price IS NULL OR x.unit_price<0 OR coalesce(x.discount,0)<0 OR coalesce(x.discount,0)>x.quantity*x.unit_price OR x.quantity::text IN ('NaN','Infinity','-Infinity') OR x.unit_price::text IN ('NaN','Infinity','-Infinity') OR coalesce(x.discount,0)::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Vérifiez les articles, quantités, prix et remises.' USING ERRCODE='22023';END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.tenant_id=p_tenant_id AND c.id=p_customer_id AND (c.site_id IS NULL OR public.current_user_can_access_site(c.site_id) IS TRUE)) THEN RAISE EXCEPTION 'Client indisponible.' USING ERRCODE='42501';END IF;
 IF p_representative_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_representatives r WHERE r.tenant_id=p_tenant_id AND r.id=p_representative_id) THEN RAISE EXCEPTION 'Représentant indisponible.' USING ERRCODE='42501';END IF;
 SELECT sum(round(quantity*unit_price-coalesce(discount,0),2)) INTO total_new FROM jsonb_to_recordset(p_items) x(quantity numeric,unit_price numeric,discount numeric);
 INSERT INTO public.tenant_doc_counters(tenant_id,doc_kind,last_number) VALUES(p_tenant_id,'quote',1) ON CONFLICT(tenant_id,doc_kind) DO UPDATE SET last_number=public.tenant_doc_counters.last_number+1 RETURNING last_number INTO num;
 INSERT INTO public.quotes(tenant_id,site_id,customer_id,user_id,quote_number,subtotal,discount,total,status,valid_until,note,doc_header,representative_id,creation_request_id,creation_request_hash)
 VALUES(p_tenant_id,p_site_id,p_customer_id,u,'DEV-'||lpad(num::text,greatest(5,length(num::text)),'0'),total_new,0,total_new,'draft',p_valid_until,coalesce(p_note,''),p_doc_header,p_representative_id,p_request_id,h) RETURNING id INTO qid;
 INSERT INTO public.quote_items(tenant_id,quote_id,article_id,name,quantity,unit_price,discount,total)
 SELECT p_tenant_id,qid,x.article_id,x.name,x.quantity,x.unit_price,coalesce(x.discount,0),round(x.quantity*x.unit_price-coalesce(x.discount,0),2) FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric);
 INSERT INTO public.audit_logs(tenant_id,user_id,action,module,reference_id,new_value) VALUES(p_tenant_id,u,'quote_create','billing',qid,jsonb_build_object('total',total_new,'customer_id',p_customer_id));
 RETURN public._quote_edit_snapshot(p_tenant_id,qid)||jsonb_build_object('success',true,'already_created',false);
END $$;
REVOKE ALL ON FUNCTION public.create_quote_atomic(uuid,uuid,uuid,date,text,jsonb,uuid,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_quote_atomic(uuid,uuid,uuid,date,text,jsonb,uuid,jsonb,uuid) TO authenticated;
-- All application quote mutations now go through checked transactional RPCs.
REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public.quotes,public.quote_items FROM PUBLIC,anon,authenticated;

