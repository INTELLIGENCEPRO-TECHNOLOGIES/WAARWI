-- Candidat 82 : retour supervisé, mode de restitution explicite et requête liée à son contenu.
CREATE FUNCTION public.cash_supervision_sale_return_v2(p_session_id uuid,p_sale_id uuid,p_items jsonb,p_reason text,p_refund_method text,p_idempotency_key text,p_restock boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE ctx jsonb;res jsonb;t uuid:=public.current_tenant_id();v_site uuid;original_session uuid;request_hash text;
BEGIN
 IF p_restock IS NULL OR p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Retour invalide.' USING ERRCODE='22023';END IF;
 IF NOT p_restock AND (p_reason IS NULL OR length(btrim(p_reason))<8 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_items) x WHERE x ? 'lots' AND x->'lots'<>'[]'::jsonb)) THEN RAISE EXCEPTION 'Motif obligatoire et aucune affectation pour un retour financier.' USING ERRCODE='22023';END IF;
 request_hash:=encode(sha256(convert_to(jsonb_build_array(p_sale_id,p_items,p_reason,p_refund_method,p_restock)::text,'UTF8')),'hex');
 ctx:=public._cs_supervision_begin(p_session_id,'sale_return',ARRAY['pos_returns'],p_idempotency_key);
 IF (ctx->>'replayed')::boolean THEN
  IF ctx->'result'->>'request_hash' IS DISTINCT FROM request_hash THEN RAISE EXCEPTION 'Référence de retour déjà utilisée pour une autre opération.' USING ERRCODE='23505';END IF;
  RETURN (ctx->'result')||jsonb_build_object('replayed',true);
 END IF;
 v_site:=(ctx->>'site_id')::uuid;
 SELECT s.cash_session_id INTO original_session FROM public.sales s WHERE s.id=p_sale_id AND s.tenant_id=t AND s.site_id=v_site AND s.deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Vente introuvable dans ce magasin.' USING ERRCODE='42501';END IF;
 res:=public.process_sale_return(p_sale_id,v_site,p_session_id,p_items,p_reason,true,p_restock,'sup:'||(ctx->>'key'),p_refund_method);
 RETURN public._cs_supervision_end(p_session_id,'sale_return',ctx,coalesce(res,'{}')||jsonb_build_object('sale_id',p_sale_id,'original_session_id',original_session,'request_hash',request_hash,'restock',p_restock));
END $f$;
REVOKE ALL ON FUNCTION public.cash_supervision_sale_return_v2(uuid,uuid,jsonb,text,text,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.cash_supervision_sale_return_v2(uuid,uuid,jsonb,text,text,text,boolean) TO authenticated;
