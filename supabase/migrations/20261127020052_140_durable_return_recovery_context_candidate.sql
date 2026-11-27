-- 140 : enrichir le contexte de reprise sans exposer un autre magasin.
CREATE OR REPLACE FUNCTION public.read_active_return_request()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $f$
DECLARE me public.profiles;j public.return_request_journal;v_sale_number text;v_site_name text;
BEGIN
 me:=public._cr_require_caller();
 SELECT * INTO j FROM public.return_request_journal r WHERE r.tenant_id=me.tenant_id AND r.actor_id=me.id AND r.state IN ('pending','succeeded');
 IF NOT FOUND THEN RETURN NULL;END IF;
 IF public.current_user_can_access_site(j.site_id) IS DISTINCT FROM true THEN RETURN jsonb_build_object('request_key',j.request_key,'state',j.state,'access_revoked',true);END IF;
 SELECT s.sale_number INTO v_sale_number FROM public.sales s WHERE s.tenant_id=me.tenant_id AND s.id=j.sale_id AND s.site_id=j.site_id;
 SELECT s.name INTO v_site_name FROM public.sites s WHERE s.tenant_id=me.tenant_id AND s.id=j.site_id;
 RETURN to_jsonb(j)||jsonb_build_object('sale_number',v_sale_number,'site_name',v_site_name);
END $f$;
REVOKE ALL ON FUNCTION public.read_active_return_request() FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.read_active_return_request() TO authenticated;
