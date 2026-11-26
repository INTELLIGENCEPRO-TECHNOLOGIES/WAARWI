-- 138 : registre durable des tentatives de retour. Aucune donnée de paiement ni jeton stocké.
CREATE TABLE public.return_request_journal (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 160),
 flow text NOT NULL CHECK(flow IN ('invoice','pos','supervision')),
 sale_id uuid NOT NULL,
 site_id uuid NOT NULL,
 cash_session_id uuid,
 payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','succeeded','acknowledged','cancelled')),
 result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 finished_at timestamptz,
 PRIMARY KEY(tenant_id,actor_id,request_key),
 CHECK((state IN ('succeeded','acknowledged'))=(result IS NOT NULL)),
 CHECK((flow='invoice')=(cash_session_id IS NULL))
);
ALTER TABLE public.return_request_journal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.return_request_journal FROM PUBLIC,anon,authenticated,service_role;
CREATE UNIQUE INDEX return_request_journal_one_active ON public.return_request_journal(tenant_id,actor_id) WHERE state IN ('pending','succeeded');
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','return_request_journal','direct','tenant_id','operation',99,'delete',false);

CREATE FUNCTION public.stage_return_request(p_key text,p_flow text,p_sale_id uuid,p_site_id uuid,p_session_id uuid,p_items jsonb,p_reason text,p_restock boolean,p_mode text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE me public.profiles;j public.return_request_journal;v_payload jsonb;
BEGIN
 me:=public._cr_require_caller();
 IF p_key IS NULL OR length(btrim(p_key)) NOT BETWEEN 1 AND 160 OR p_flow IS NULL OR p_flow NOT IN ('invoice','pos','supervision') OR p_mode IS NULL OR p_mode NOT IN ('cash','avoir','deferred') OR p_restock IS NULL OR length(coalesce(p_reason,''))>500 OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 OR octet_length(p_items::text)>200000 OR (p_flow='invoice' AND (p_session_id IS NOT NULL OR p_mode='cash')) OR (p_flow<>'invoice' AND p_session_id IS NULL) THEN
 RAISE EXCEPTION 'Demande de retour invalide.' USING ERRCODE='22023';END IF;
 IF NOT coalesce(public._cr_profile_has_permission(me.id,CASE WHEN p_flow='invoice' THEN 'edit_invoices' ELSE 'pos_returns' END),false) OR public.current_user_can_access_site(p_site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Permission de retour requise.' USING ERRCODE='42501';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sales s WHERE s.id=p_sale_id AND s.tenant_id=me.tenant_id AND s.site_id=p_site_id) THEN RAISE EXCEPTION 'Vente inaccessible.' USING ERRCODE='42501';END IF;
 IF p_session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.cash_sessions cs WHERE cs.id=p_session_id AND cs.tenant_id=me.tenant_id AND cs.site_id=p_site_id) THEN RAISE EXCEPTION 'Session inaccessible.' USING ERRCODE='42501';END IF;
 IF p_flow='supervision' AND NOT public._cs_profile_can_supervise_site(me.id,p_site_id) THEN RAISE EXCEPTION 'Supervision inaccessible.' USING ERRCODE='42501';END IF;
 v_payload:=jsonb_build_object('items',p_items,'reason',p_reason,'restock',p_restock,'mode',p_mode);
 PERFORM pg_advisory_xact_lock(hashtextextended(me.tenant_id::text||':return-journal:'||me.id::text,0));
 SELECT * INTO j FROM public.return_request_journal r WHERE r.tenant_id=me.tenant_id AND r.actor_id=me.id AND r.request_key=p_key FOR UPDATE;
 IF FOUND THEN
  IF (j.flow,j.sale_id,j.site_id,j.cash_session_id,j.payload) IS DISTINCT FROM (p_flow,p_sale_id,p_site_id,p_session_id,v_payload) THEN RAISE EXCEPTION 'Référence de retour déjà utilisée.' USING ERRCODE='23505';END IF;
  IF j.state='cancelled' THEN RAISE EXCEPTION 'Demande annulée.' USING ERRCODE='55000';END IF;
  RETURN to_jsonb(j);
 END IF;
 IF EXISTS(SELECT 1 FROM public.return_request_journal r WHERE r.tenant_id=me.tenant_id AND r.actor_id=me.id AND r.state IN ('pending','succeeded')) THEN RAISE EXCEPTION 'Une demande de retour reste à traiter. Reprenez-la avant de créer un autre retour.' USING ERRCODE='55000';END IF;
 INSERT INTO public.return_request_journal(tenant_id,actor_id,request_key,flow,sale_id,site_id,cash_session_id,payload)
 VALUES(me.tenant_id,me.id,p_key,p_flow,p_sale_id,p_site_id,p_session_id,v_payload) RETURNING * INTO j;
 RETURN to_jsonb(j);
END $f$;
CREATE FUNCTION public.read_active_return_request()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE me public.profiles;j public.return_request_journal;
BEGIN
 me:=public._cr_require_caller();
 SELECT * INTO j FROM public.return_request_journal r WHERE r.tenant_id=me.tenant_id AND r.actor_id=me.id AND r.state IN ('pending','succeeded');
 IF NOT FOUND THEN RETURN NULL;END IF;
 -- Ne pas divulguer le contenu si l'accès au magasin a été retiré. L'auteur peut néanmoins annuler une demande non exécutée.
 IF public.current_user_can_access_site(j.site_id) IS DISTINCT FROM true THEN RETURN jsonb_build_object('request_key',j.request_key,'state',j.state,'access_revoked',true);END IF;
 RETURN to_jsonb(j);
END $f$;
CREATE FUNCTION public.execute_return_request(p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE me public.profiles;j public.return_request_journal;res jsonb;v_mode text;
BEGIN
 me:=public._cr_require_caller();
 SELECT * INTO j FROM public.return_request_journal r WHERE r.tenant_id=me.tenant_id AND r.actor_id=me.id AND r.request_key=p_key FOR UPDATE;
 IF NOT FOUND OR public.current_user_can_access_site(j.site_id) IS DISTINCT FROM true OR NOT coalesce(public._cr_profile_has_permission(me.id,CASE WHEN j.flow='invoice' THEN 'edit_invoices' ELSE 'pos_returns' END),false) THEN RAISE EXCEPTION 'Demande de retour inaccessible.' USING ERRCODE='42501';END IF;
 IF j.state='cancelled' THEN RAISE EXCEPTION 'Demande de retour annulée.' USING ERRCODE='55000';END IF;
 IF j.state IN ('succeeded','acknowledged') THEN RETURN j.result;END IF;
 v_mode:=j.payload->>'mode';
 IF j.flow='invoice' THEN
  res:=public.prepare_invoice_return(j.sale_id,j.site_id,j.payload->'items',j.payload->>'reason',(j.payload->>'restock')::boolean,j.request_key,v_mode='avoir');
  IF res->>'id' IS NULL THEN RAISE EXCEPTION 'Retour non confirmé.' USING ERRCODE='55000';END IF;
 ELSIF j.flow='supervision' THEN
  res:=public.cash_supervision_sale_return_v2(j.cash_session_id,j.sale_id,j.payload->'items',j.payload->>'reason',CASE WHEN v_mode='cash' THEN NULL ELSE v_mode END,j.request_key,(j.payload->>'restock')::boolean);
 ELSE
  res:=public.process_sale_return(j.sale_id,j.site_id,j.cash_session_id,j.payload->'items',j.payload->>'reason',v_mode='cash',(j.payload->>'restock')::boolean,j.request_key,CASE WHEN v_mode='avoir' THEN 'avoir' ELSE NULL END);
 END IF;
 IF j.flow<>'invoice' AND (res->>'success' IS DISTINCT FROM 'true' OR res->>'return_id' IS NULL) THEN RAISE EXCEPTION 'Retour non confirmé.' USING ERRCODE='55000';END IF;
 UPDATE public.return_request_journal r SET state='succeeded',result=res,finished_at=clock_timestamp() WHERE r.tenant_id=j.tenant_id AND r.actor_id=j.actor_id AND r.request_key=j.request_key;
 RETURN res;
END $f$;
CREATE FUNCTION public.finish_return_request(p_key text,p_action text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE me public.profiles;j public.return_request_journal;
BEGIN
 me:=public._cr_require_caller();
 SELECT * INTO j FROM public.return_request_journal r WHERE r.tenant_id=me.tenant_id AND r.actor_id=me.id AND r.request_key=p_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Demande inaccessible.' USING ERRCODE='42501';END IF;
 IF p_action='cancel' AND j.state IN ('pending','cancelled') THEN
  UPDATE public.return_request_journal r SET state='cancelled',finished_at=coalesce(finished_at,clock_timestamp()) WHERE r.tenant_id=j.tenant_id AND r.actor_id=j.actor_id AND r.request_key=j.request_key;
  RETURN jsonb_build_object('state','cancelled');
 ELSIF p_action='ack' AND j.state IN ('succeeded','acknowledged') THEN
  UPDATE public.return_request_journal r SET state='acknowledged' WHERE r.tenant_id=j.tenant_id AND r.actor_id=j.actor_id AND r.request_key=j.request_key;
  RETURN jsonb_build_object('state','acknowledged');
 END IF;
 RAISE EXCEPTION 'La demande a changé d’état. Actualisez son résultat.' USING ERRCODE='55000';
END $f$;
REVOKE ALL ON FUNCTION public.stage_return_request(text,text,uuid,uuid,uuid,jsonb,text,boolean,text),public.read_active_return_request(),public.execute_return_request(text),public.finish_return_request(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.stage_return_request(text,text,uuid,uuid,uuid,jsonb,text,boolean,text),public.read_active_return_request(),public.execute_return_request(text),public.finish_return_request(text,text) TO authenticated;
