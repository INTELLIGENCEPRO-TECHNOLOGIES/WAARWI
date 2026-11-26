-- Collaborative edit leases: internal storage, authenticated RPCs only.
CREATE TABLE public.document_edit_leases (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 resource_type text NOT NULL CHECK(resource_type IN ('accounting_journal','sale')),
 resource_key text NOT NULL CHECK(length(resource_key) BETWEEN 1 AND 100),
 owner_id uuid NOT NULL, window_id uuid NOT NULL, token uuid NOT NULL,
 opened_at timestamptz NOT NULL, heartbeat_at timestamptz NOT NULL, activity_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 dirty boolean NOT NULL DEFAULT false,
 requester_id uuid, requester_window uuid, requested_at timestamptz, request_state text CHECK(request_state IN ('pending','declined')),
 PRIMARY KEY(tenant_id,resource_type,resource_key)
);
CREATE TABLE public.document_edit_audit (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 resource_type text NOT NULL, resource_key text NOT NULL, actor_id uuid NOT NULL, previous_owner_id uuid,
 action text NOT NULL CHECK(action IN ('acquire','request','decline','release','transfer','expire','takeover')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX document_edit_audit_tenant_time ON public.document_edit_audit(tenant_id,occurred_at DESC);
ALTER TABLE public.document_edit_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_edit_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.document_edit_leases,public.document_edit_audit FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public._document_edit_access(t uuid,k text,r text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sales%ROWTYPE; m date;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR t IS DISTINCT FROM public.current_tenant_id() THEN RAISE EXCEPTION 'Accès refusé.' USING ERRCODE='42501'; END IF;
 IF k='accounting_journal' THEN
  PERFORM public._bank_reconciliation_access(t,true);
  IF r IS NULL OR r !~ '^[A-Z]{2,3}:[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Journal ou période invalide.' USING ERRCODE='22023'; END IF;
  m:= (split_part(r,':',2)||'-01')::date;
  IF m<date '2000-01-01' OR m>date_trunc('month',now() AT TIME ZONE 'Africa/Dakar')::date OR NOT public._accounting_journal_allowed(t,split_part(r,':',1),true) THEN RAISE EXCEPTION 'Journal ou période indisponible.' USING ERRCODE='22023';END IF;
 ELSIF k='sale' THEN
  IF r IS NULL OR r !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Document invalide.' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM public.sales WHERE tenant_id=t AND id=r::uuid;
  IF NOT FOUND OR NOT public.current_user_can_access_site(s.site_id) OR NOT public._cr_profile_has_permission(auth.uid(),'edit_invoices') THEN RAISE EXCEPTION 'Accès au document refusé.' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Type de document non pris en charge.' USING ERRCODE='22023';END IF;
END $$;

CREATE OR REPLACE FUNCTION public.document_edit_lease(p_tenant_id uuid,p_resource_type text,p_resource_key text,p_window_id uuid,p_action text,p_token uuid DEFAULT NULL,p_active boolean DEFAULT false,p_dirty boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=p_tenant_id;k text:=p_resource_type;r text:=p_resource_key;u uuid:=auth.uid();v public.document_edit_leases%ROWTYPE; n timestamptz; own boolean; requester boolean; evt text; old_owner uuid; owner_name text; request_name text; found_row boolean;
BEGIN
 PERFORM public._document_edit_access(t,k,r);
 IF p_window_id IS NULL OR p_action IS NULL OR p_action NOT IN ('acquire','heartbeat','status','request','decline','release','takeover') THEN RAISE EXCEPTION 'Action de verrouillage invalide.' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':edit:'||k||':'||r,0));
 SELECT * INTO v FROM public.document_edit_leases l WHERE l.tenant_id=t AND l.resource_type=k AND l.resource_key=r FOR UPDATE;
 found_row:=FOUND;n:=clock_timestamp();old_owner:=v.owner_id;
 own:=found_row AND v.owner_id=u AND v.window_id=p_window_id AND v.token=p_token AND v.expires_at>n;
 requester:=found_row AND v.requester_id=u AND v.requester_window=p_window_id;
 IF p_action='acquire' THEN
  IF NOT found_row OR (v.expires_at<=n AND (v.request_state IS DISTINCT FROM 'pending' OR requester OR v.requested_at+interval '120 seconds'<=n)) THEN
   evt:=CASE WHEN found_row THEN 'expire' ELSE 'acquire' END;
   INSERT INTO public.document_edit_leases(tenant_id,resource_type,resource_key,owner_id,window_id,token,opened_at,heartbeat_at,activity_at,expires_at)
   VALUES(t,k,r,u,p_window_id,gen_random_uuid(),n,n,n,n+interval '75 seconds')
   ON CONFLICT(tenant_id,resource_type,resource_key) DO UPDATE SET owner_id=excluded.owner_id,window_id=excluded.window_id,token=excluded.token,opened_at=n,heartbeat_at=n,activity_at=n,expires_at=n+interval '75 seconds',dirty=false,requester_id=NULL,requester_window=NULL,requested_at=NULL,request_state=NULL RETURNING * INTO v;
  END IF;
 ELSIF p_action='heartbeat' THEN
  IF own THEN UPDATE public.document_edit_leases SET heartbeat_at=n,expires_at=n+interval '75 seconds',activity_at=CASE WHEN p_active THEN n ELSE activity_at END,dirty=coalesce(p_dirty,false) WHERE tenant_id=t AND resource_type=k AND resource_key=r RETURNING * INTO v; END IF;
 ELSIF p_action='request' THEN
  IF found_row AND NOT own AND v.expires_at>n AND (v.request_state IS NULL OR v.requested_at+interval '120 seconds'<=n) THEN
   UPDATE public.document_edit_leases SET requester_id=u,requester_window=p_window_id,requested_at=n,request_state='pending' WHERE tenant_id=t AND resource_type=k AND resource_key=r RETURNING * INTO v;evt:='request';
  END IF;
 ELSIF p_action='decline' THEN
  IF own AND v.request_state='pending' THEN UPDATE public.document_edit_leases SET request_state='declined',requested_at=n,activity_at=n WHERE tenant_id=t AND resource_type=k AND resource_key=r RETURNING * INTO v;evt:='decline';END IF;
 ELSIF p_action='release' THEN
  IF own THEN
   IF v.request_state='pending' AND v.requested_at+interval '120 seconds'>n THEN
    UPDATE public.document_edit_leases SET owner_id=v.requester_id,window_id=v.requester_window,token=gen_random_uuid(),opened_at=n,heartbeat_at=n,activity_at=n,expires_at=n+interval '75 seconds',dirty=false,requester_id=NULL,requester_window=NULL,requested_at=NULL,request_state=NULL WHERE tenant_id=t AND resource_type=k AND resource_key=r RETURNING * INTO v;evt:='transfer';
   ELSE DELETE FROM public.document_edit_leases WHERE tenant_id=t AND resource_type=k AND resource_key=r;v:=NULL;evt:='release';END IF;
  END IF;
 ELSIF p_action='takeover' THEN
  IF requester AND v.request_state='pending' AND v.requested_at+interval '60 seconds'<=n AND v.requested_at+interval '120 seconds'>n AND (v.expires_at<=n OR v.activity_at+interval '60 seconds'<=n) THEN
   UPDATE public.document_edit_leases SET owner_id=u,window_id=p_window_id,token=gen_random_uuid(),opened_at=n,heartbeat_at=n,activity_at=n,expires_at=n+interval '75 seconds',dirty=false,requester_id=NULL,requester_window=NULL,requested_at=NULL,request_state=NULL WHERE tenant_id=t AND resource_type=k AND resource_key=r RETURNING * INTO v;evt:='takeover';
  END IF;
 END IF;
 IF evt IS NOT NULL THEN INSERT INTO public.document_edit_audit(tenant_id,resource_type,resource_key,actor_id,previous_owner_id,action) VALUES(t,k,r,u,old_owner,evt);END IF;
 IF v.owner_id IS NULL THEN RETURN jsonb_build_object('state','free','server_now',n); END IF;
 -- The window identifier is unguessable; only the exact authenticated recipient can retrieve its new token.
 own:=v.owner_id=u AND v.window_id=p_window_id AND v.expires_at>n;
 requester:=v.requester_id=u AND v.requester_window=p_window_id;
 SELECT coalesce(nullif(full_name,''),'Utilisateur') INTO owner_name FROM public.profiles WHERE id=v.owner_id AND tenant_id=t;
 SELECT coalesce(nullif(full_name,''),'Utilisateur') INTO request_name FROM public.profiles WHERE id=v.requester_id AND tenant_id=t;
 RETURN jsonb_build_object('state',CASE WHEN own THEN 'held' WHEN v.expires_at<=n THEN 'expired' ELSE 'busy' END,'token',CASE WHEN own THEN v.token ELSE NULL END,'owner_name',coalesce(owner_name,'Utilisateur'),'opened_at',v.opened_at,'expires_at',v.expires_at,'server_now',n,'request_state',CASE WHEN own OR requester THEN v.request_state ELSE NULL END,'requester_name',CASE WHEN own THEN request_name ELSE NULL END,'requested_at',CASE WHEN own OR requester THEN v.requested_at ELSE NULL END,'can_takeover',coalesce(requester AND v.request_state='pending' AND v.requested_at+interval '60 seconds'<=n AND v.requested_at+interval '120 seconds'>n AND (v.expires_at<=n OR v.activity_at+interval '60 seconds'<=n),false));
END $$;

CREATE OR REPLACE FUNCTION public._assert_document_edit_lease(t uuid,k text,r text,w uuid,tok uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v public.document_edit_leases%ROWTYPE;
BEGIN
 PERFORM public._document_edit_access(t,k,r);
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':edit:'||k||':'||r,0));
 SELECT * INTO v FROM public.document_edit_leases WHERE tenant_id=t AND resource_type=k AND resource_key=r FOR UPDATE;
 IF NOT FOUND OR v.owner_id IS DISTINCT FROM auth.uid() OR v.window_id IS DISTINCT FROM w OR v.token IS DISTINCT FROM tok OR v.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'Votre accès en modification a expiré. Reprenez le document avant de l’enregistrer.' USING ERRCODE='55000';END IF;
END $$;

CREATE OR REPLACE FUNCTION public.post_locked_manual_entry(p_tenant_id uuid,p_journal_type text,p_entry_date date,p_description text,p_reference text,p_lines jsonb,p_request_id uuid,p_window_id uuid,p_lock_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'accounting_journal',p_journal_type||':'||to_char(p_entry_date,'YYYY-MM'),p_window_id,p_lock_token);
 RETURN public.create_manual_journal_entry_idempotent(p_tenant_id,p_journal_type,p_entry_date,p_description,p_reference,p_lines,p_request_id);
END $$;
CREATE OR REPLACE FUNCTION public.post_locked_template_occurrence(p_tenant_id uuid,p_template_id uuid,p_due_on date,p_description text,p_reference text,p_lines jsonb,p_window_id uuid,p_lock_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c text;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 SELECT journal_code INTO c FROM public.accounting_entry_templates WHERE tenant_id=p_tenant_id AND id=p_template_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Modèle introuvable.';END IF;
 PERFORM public._assert_document_edit_lease(p_tenant_id,'accounting_journal',c||':'||to_char(p_due_on,'YYYY-MM'),p_window_id,p_lock_token);
 RETURN public.post_accounting_template_occurrence(p_tenant_id,p_template_id,p_due_on,p_description,p_reference,p_lines);
END $$;
REVOKE ALL ON FUNCTION public._document_edit_access(uuid,text,text),public._assert_document_edit_lease(uuid,text,text,uuid,uuid),public.document_edit_lease(uuid,text,text,uuid,text,uuid,boolean,boolean),public.post_locked_manual_entry(uuid,text,date,text,text,jsonb,uuid,uuid,uuid),public.post_locked_template_occurrence(uuid,uuid,date,text,text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.document_edit_lease(uuid,text,text,uuid,text,uuid,boolean,boolean),public.post_locked_manual_entry(uuid,text,date,text,text,jsonb,uuid,uuid,uuid),public.post_locked_template_occurrence(uuid,uuid,date,text,text,jsonb,uuid,uuid) TO authenticated;

