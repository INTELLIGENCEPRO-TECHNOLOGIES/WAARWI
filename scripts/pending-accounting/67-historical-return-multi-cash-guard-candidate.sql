-- Candidat : mêmes gardes explicites pour les retours POS sans TVA que pour les retours fiscaux.
-- Le garde n'impose pas de nouvelle règle de retour inter-magasins ; les deux sites doivent être accessibles.
-- Ne pas publier automatiquement ; vérifier sur le schéma complet avant migration.
DO $patch$
DECLARE src text; anchor text:=$old$RETURN public._process_sale_return_without_vat(p_sale_id, p_site_id, p_cash_session_id, p_items,$old$; replacement text;
BEGIN
 src:=pg_get_functiondef('public.process_sale_return(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 IF (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Définition du retour POS inattendue';END IF;
 replacement:=$new$PERFORM public._cr_require_caller();
    IF NOT coalesce(public._cr_profile_has_permission(auth.uid(),'pos_returns'),false) THEN
      RAISE EXCEPTION 'Permission de retour en caisse requise.' USING ERRCODE='42501';
    END IF;
    IF public.current_user_can_access_site(p_site_id) IS DISTINCT FROM true OR NOT EXISTS(
      SELECT 1 FROM public.sales s WHERE s.id=p_sale_id AND s.tenant_id=v_tenant_id AND s.deleted_at IS NULL
        AND public.current_user_can_access_site(s.site_id)
    ) THEN RAISE EXCEPTION 'Vente ou site inaccessible.' USING ERRCODE='42501';END IF;
    IF NOT EXISTS(SELECT 1 FROM public.cash_sessions WHERE id=p_cash_session_id AND tenant_id=v_tenant_id AND site_id=p_site_id AND status='open') THEN
      RAISE EXCEPTION 'Session de caisse invalide ou fermée.';
    END IF;
    IF public._cs_multi_enabled(v_tenant_id) THEN
      PERFORM public._cs_assert_operational(p_cash_session_id,v_tenant_id,p_site_id);
    END IF;
    RETURN public._process_sale_return_without_vat(p_sale_id, p_site_id, p_cash_session_id, p_items,$new$;
 EXECUTE replace(src,anchor,replacement);
END $patch$;
