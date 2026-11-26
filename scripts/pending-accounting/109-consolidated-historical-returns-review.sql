-- Assemblage de recette, NON migration. Source figée 00c1c480. Ne jamais exécuter en production.

-- ===== 64-historical-return-lot-compatibility-candidate.sql (blob 88024d07b0bb20090829481da10ab68d468650ee) =====
-- Candidat de correction. Recette isolée exclusivement. Ne pas publier automatiquement.
-- Les définitions existantes sont contrôlées avant toute substitution.
DO $patch$
DECLARE src text; old_text text; new_text text; n integer;
BEGIN
 src:=pg_get_functiondef('public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean)'::regprocedure);
 old_text:=$old$prior_unmapped numeric; prior_physical numeric;$old$; new_text:=$new$prior_unmapped numeric; prior_physical numeric; v_has_trace boolean; v_source_count integer; v_source uuid;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$SELECT * INTO STRICT tr FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=sid;$old$; new_text:=$new$SELECT * INTO tr FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=sid;
 v_has_trace:=FOUND;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF actual IS DISTINCT FROM tr.stock_manifest OR lots IS DISTINCT FROM tr.lot_manifest THEN$old$; new_text:=$new$IF v_has_trace AND (actual IS DISTINCT FROM tr.stock_manifest OR lots IS DISTINCT FROM tr.lot_manifest) THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tr.stock_manifest) x$old$; new_text:=$new$IF v_has_trace AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(tr.stock_manifest) x$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN$old$; new_text:=$new$IF NOT v_has_trace THEN
  SELECT count(DISTINCT d.site_id), (array_agg(DISTINCT d.site_id))[1] INTO v_source_count,v_source FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id;
  IF v_source_count<>1 OR v_source IS NULL OR EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id AND d.article_id IS DISTINCT FROM si.article_id) THEN RAISE EXCEPTION 'Origine historique des lots à rapprocher.' USING ERRCODE='55000';END IF;
  si.site_id:=v_source;
 END IF;
 IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
 src:=pg_get_functiondef('public.read_fiscal_return_lots(uuid)'::regprocedure);
 old_text:=$old$IF s.vat_net_amount IS NULL OR NOT EXISTS(SELECT 1 FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=p_sale_id) THEN RETURN '{}'::jsonb;END IF;$old$; new_text:=$new$PERFORM public._cs_assert_sale_usable(p_sale_id);
 IF NOT EXISTS(SELECT 1 FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=p_sale_id) AND NOT EXISTS(SELECT 1 FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=p_sale_id AND sale_item_id IS NOT NULL) THEN RETURN '{}'::jsonb;END IF;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public.read_fiscal_return_lots(uuid): %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
 src:=pg_get_functiondef('public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid)'::regprocedure);
 old_text:=$old$IF v_traced THEN$old$; new_text:=$new$IF v_traced OR EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id=v_item.id) THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>2 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF p_restock AND v_traced THEN$old$; new_text:=$new$IF p_restock AND (v_traced OR EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id IS NOT NULL)) THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid): %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
 src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 old_text:=$old$v_return_value numeric;$old$; new_text:=$new$v_return_value numeric;
v_return_item uuid;
v_alloc jsonb;
v_use_lot_trace boolean;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$v_return_value
);$old$; new_text:=$new$v_return_value
) RETURNING id INTO v_return_item;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF p_restock AND v_si.article_id IS NOT NULL THEN$old$; new_text:=$new$v_alloc:=v_item->'lots';
v_use_lot_trace:=EXISTS(SELECT 1 FROM public.quote_conversion_stock_trace tr WHERE tr.tenant_id=v_tenant_id AND tr.sale_id=p_sale_id) OR EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id=v_si.id);
IF v_use_lot_trace THEN
 PERFORM public._allocate_traced_fiscal_return(v_tenant_id,p_sale_id,v_return_id,v_return_item,v_alloc,coalesce(p_restock,false));
 UPDATE public.sale_return_items ri SET purchase_cost=a.cost FROM (SELECT sum(x.purchase_price*x.quantity)/nullif(sum(x.quantity),0) cost FROM public.sale_return_lot_allocations x WHERE x.tenant_id=v_tenant_id AND x.return_item_id=v_return_item HAVING sum(x.quantity)>0) a WHERE ri.id=v_return_item AND ri.tenant_id=v_tenant_id;
ELSIF v_alloc IS NOT NULL AND v_alloc<>'[]'::jsonb THEN RAISE EXCEPTION 'Aucun lot vérifiable pour cette ligne.' USING ERRCODE='22023';
ELSIF p_restock AND v_si.article_id IS NOT NULL THEN$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction inattendue pour public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
END $patch$;


-- ===== 67-historical-return-multi-cash-guard-candidate.sql (blob 1f521169b7fabf705a8b0e14f76d5208f07a8fd3) =====
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


-- ===== 68-backup-return-lot-registry-candidate.sql (blob 64794a55bcad9fd71ccabeac7ea8474825793cc1) =====
-- Candidat : registre des retours/lots et protection du préflight v2.
-- Les archives antérieures restent lisibles si aucune donnée de ces tables ne serait perdue.
-- Aucun déverrouillage de la restauration ; le moteur complet doit être recetté séparément.
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES ('public','quote_conversion_stock_trace','direct','tenant_id','operation',85,'delete',false),
 ('public','sale_return_lot_allocations','direct','tenant_id','operation',96,'delete',false)
ON CONFLICT(schema_name,table_name) DO NOTHING;
DO $patch$
DECLARE src text; anchor text:=$old$SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$old$; replacement text;
BEGIN
 IF (SELECT count(*) FROM public._br_table_registry WHERE schema_name='public' AND table_name IN ('quote_conversion_stock_trace','sale_return_lot_allocations') AND tenant_link='direct' AND tenant_id_column='tenant_id' AND category='operation' AND reset_behavior='delete' AND is_mandatory=false AND restore_order=CASE table_name WHEN 'quote_conversion_stock_trace' THEN 85 ELSE 96 END)<>2 THEN RAISE EXCEPTION 'Registre de sauvegarde incohérent';END IF;
 src:=pg_get_functiondef('public.br_preflight_restore(uuid)'::regprocedure);
 IF (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Définition préflight inattendue';END IF;
 replacement:=$new$-- Ne pas effacer silencieusement les affectations historiques.
FOR v_rec IN SELECT r.schema_name,r.table_name,r.tenant_id_column FROM public._br_table_registry r
 WHERE r.schema_name='public' AND r.tenant_link='direct'
 AND r.table_name IN ('quote_conversion_stock_trace','sale_return_lot_allocations')
 AND jsonb_typeof(v_backup.payload->r.table_name) IS DISTINCT FROM 'array'
LOOP
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',v_rec.schema_name,v_rec.table_name,v_rec.tenant_id_column) INTO v_has_accounting_rows USING v_tenant_id;
 IF v_has_accounting_rows THEN
  v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','RETURN_TRACE_MISSING','severity','fatal','table',v_rec.table_name,'message','Sauvegarde incompatible : traçabilité des retours existante absente du fichier.'));
 END IF;
END LOOP;
SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$new$;
 EXECUTE replace(src,anchor,replacement);
END $patch$;


-- ===== 71-historical-return-request-idempotency-candidate.sql (blob e2df7261b965244de63270de21758a4b7a059865) =====
-- Candidat : idempotence des retours historiques, sans rendre obligatoire une clé pour les anciens clients.
DO $patch$
DECLARE src text; old_text text; new_text text; n integer;
BEGIN
 src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 old_text:=$old$v_use_lot_trace boolean;$old$;new_text:=$new$v_use_lot_trace boolean;
v_request_hash bytea;$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF p_request_id IS NOT NULL THEN
SELECT id INTO v_existing_return_id$old$;new_text:=$new$IF p_request_id IS NOT NULL THEN
IF btrim(p_request_id)='' OR length(p_request_id)>160 THEN RAISE EXCEPTION 'Référence de retour invalide.' USING ERRCODE='22023';END IF;
v_request_hash:=sha256(convert_to(jsonb_build_array(p_sale_id,p_site_id,p_cash_session_id,coalesce(p_reason,'Retour au POS'),coalesce(p_restock,false),v_effective_method,p_items)::text,'UTF8'));
PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text||':return-request:'||p_request_id,0));
SELECT id INTO v_existing_return_id$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$IF v_existing_return_id IS NOT NULL THEN
RETURN ($old$;new_text:=$new$IF v_existing_return_id IS NOT NULL THEN
IF NOT EXISTS(SELECT 1 FROM public.sale_returns r WHERE r.id=v_existing_return_id AND r.tenant_id=v_tenant_id AND r.sale_id=p_sale_id AND r.site_id=p_site_id AND r.user_id=auth.uid() AND r.cash_session_id=p_cash_session_id AND (r.request_payload_hash IS NULL OR r.request_payload_hash=v_request_hash)) THEN RAISE EXCEPTION 'Référence de retour déjà utilisée.' USING ERRCODE='23505';END IF;
RETURN ($new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$cash_session_id, return_number, total, refund_method, status, reason, restock, request_id$old$;new_text:=$new$cash_session_id, return_number, total, refund_method, status, reason, restock, request_id, request_payload_hash$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 old_text:=$old$'approved', COALESCE(p_reason, 'Retour au POS'), p_restock, p_request_id$old$;new_text:=$new$'approved', COALESCE(p_reason, 'Retour au POS'), p_restock, p_request_id, v_request_hash$new$;
 n:=(length(src)-length(replace(src,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre de retour historique inattendue : %',n;END IF;
 src:=replace(src,old_text,new_text);
 EXECUTE src;
END $patch$;


-- ===== 73-incomplete-historical-return-candidate.sql (blob 205bc47178ae3418cec0a3149f5a16e0fb92d0cb) =====
-- Candidat à tester exclusivement sur la branche isolée, après 64/67/71.
CREATE OR REPLACE FUNCTION public._historical_return_lot_deductions(t uuid,sid uuid,li uuid)
RETURNS SETOF public.sale_lot_deductions LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $f$
 SELECT d.* FROM public.sale_lot_deductions d
 JOIN public.sale_items i ON i.tenant_id=t AND i.sale_id=sid AND i.id=li AND i.article_id=d.article_id
 WHERE d.tenant_id=t AND d.sale_id=sid AND
 (d.sale_item_id=li OR (d.sale_item_id IS NULL AND (i.site_id IS NULL OR i.site_id=d.site_id)
 AND (SELECT count(*) FROM public.sale_items z WHERE z.tenant_id=t AND z.sale_id=sid AND z.article_id=d.article_id)=1))
$f$;
REVOKE ALL ON FUNCTION public._historical_return_lot_deductions(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public._historical_return_stock_site(t uuid,sid uuid,li uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $f$
DECLARE i public.sale_items; s public.sales; n int; source uuid;
BEGIN
 SELECT * INTO STRICT i FROM public.sale_items WHERE tenant_id=t AND sale_id=sid AND id=li;
 SELECT * INTO STRICT s FROM public.sales WHERE tenant_id=t AND id=sid;
 IF EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.article_id=i.article_id AND d.sale_item_id IS NULL) THEN
 RAISE EXCEPTION 'Sorties de lots historiques sans ligne certaine : rapprochement nécessaire.' USING ERRCODE='55000';END IF;
 SELECT count(DISTINCT m.site_id),(array_agg(DISTINCT m.site_id))[1] INTO n,source FROM public.stock_movements m
 WHERE m.tenant_id=t AND m.reference_id=sid AND m.reference_type='sale' AND m.article_id=i.article_id AND m.quantity<0;
 IF i.site_id IS NOT NULL THEN source:=i.site_id;
 ELSIF n>1 THEN RAISE EXCEPTION 'Plusieurs dépôts historiques possibles.' USING ERRCODE='55000';
 ELSIF n=0 THEN source:=s.site_id;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sites st WHERE st.tenant_id=t AND st.id=source) OR public.current_user_can_access_site(source) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Dépôt historique inaccessible.' USING ERRCODE='42501';END IF;
 RETURN source;
END $f$;
REVOKE ALL ON FUNCTION public._historical_return_stock_site(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
DO $patch$
DECLARE src text; a text; b text; n integer;
BEGIN
src:=pg_get_functiondef('public._return_lot_options(uuid,uuid)'::regprocedure);
a:=$old$FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_item_id=line_id$old$;b:=$new$FROM public._historical_return_lot_deductions(t,(SELECT si.sale_id FROM public.sale_items si WHERE si.id=line_id AND si.tenant_id=t),line_id) d$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _return_lot_options(uuid,uuid): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public.read_fiscal_return_lots(uuid)'::regprocedure);
a:=$old$AND sale_item_id IS NOT NULL) THEN RETURN '{}'::jsonb;END IF;$old$;b:=$new$) THEN RETURN '{}'::jsonb;END IF;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique read_fiscal_return_lots(uuid): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean)'::regprocedure);
a:=$old$FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id;$old$;b:=$new$FROM public._historical_return_lot_deductions(t,sid,si.id) d;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
a:=$old$FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id=si.id) IS DISTINCT$old$;b:=$new$FROM public._historical_return_lot_deductions(t,sid,si.id) d) IS DISTINCT$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid)'::regprocedure);
a:=$old$EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id=v_item.id)$old$;b:=$new$EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(v_tenant_id,p_sale_id,v_item.id))$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>2 THEN RAISE EXCEPTION 'Ancre historique _prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid): %',n;END IF;src:=replace(src,a,b);
a:=$old$PERFORM public.adjust_stock(v_item.article, p_site_id, v_item.quantity, 'return_customer', 'Retour ' || v_result.return_number);$old$;b:=$new$PERFORM public.adjust_stock(v_item.article, public._historical_return_stock_site(v_tenant_id,p_sale_id,v_item.id), v_item.quantity, 'return_customer', 'Retour ' || v_result.return_number);$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
a:=$old$v_request_hash bytea;$old$;b:=$new$v_request_hash bytea;
v_stock_site uuid;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=v_tenant_id AND d.sale_id=p_sale_id AND d.sale_item_id=v_si.id)$old$;b:=$new$EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(v_tenant_id,p_sale_id,v_si.id))$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$IF v_track THEN
SELECT COALESCE(sl.quantity, 0)$old$;b:=$new$IF v_track THEN
v_stock_site:=public._historical_return_stock_site(v_tenant_id,p_sale_id,v_si.id);
SELECT COALESCE(sl.quantity, 0)$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$FROM public.stock_levels sl WHERE sl.article_id = v_si.article_id AND sl.site_id = p_site_id;$old$;b:=$new$FROM public.stock_levels sl WHERE sl.tenant_id=v_tenant_id AND sl.article_id=v_si.article_id AND sl.site_id=v_stock_site FOR UPDATE;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$VALUES (v_tenant_id, v_si.article_id, p_site_id, 0);$old$;b:=$new$VALUES (v_tenant_id,v_si.article_id,v_stock_site,0);$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$WHERE article_id = v_si.article_id AND site_id = p_site_id;$old$;b:=$new$WHERE tenant_id=v_tenant_id AND article_id=v_si.article_id AND site_id=v_stock_site;$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
a:=$old$v_tenant_id, v_si.article_id, p_site_id, 'return_customer', v_req_qty,$old$;b:=$new$v_tenant_id,v_si.article_id,v_stock_site,'return_customer',v_req_qty,$new$; n:=(length(src)-length(replace(src,a,'')))/length(a); IF n<>1 THEN RAISE EXCEPTION 'Ancre historique _process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text): %',n;END IF;src:=replace(src,a,b);
EXECUTE src;
END $patch$;


-- ===== 77-incomplete-lot-financial-only-candidate.sql (blob fe405684f184ec3bc4be1dcf39fffa9409353c36) =====
-- Candidat après 64/67/71/73 : un retour financier explicite sans allocation ne doit pas inventer des lots.
-- Ne relâche pas les contrôles de restitution physique ni les contrôles des conversions tracées.
DO $patch$
DECLARE src text;a text;b text;n integer;
BEGIN
 src:=pg_get_functiondef('public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean)'::regprocedure);
 a:=$old$IF NOT v_has_trace THEN
  SELECT count(DISTINCT d.site_id),$old$;
 b:=$new$IF NOT v_has_trace AND NOT p_restock AND (p_alloc IS NULL OR p_alloc='[]'::jsonb) AND (
  (SELECT coalesce(sum(d.quantity),0) FROM public._historical_return_lot_deductions(t,sid,si.id) d) IS DISTINCT FROM si.quantity
  OR (SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,sid,si.id) d)<>1
 ) THEN RETURN;END IF;
 IF NOT v_has_trace THEN
  SELECT count(DISTINCT d.site_id),$new$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction historique inattendue : %',n;END IF;
 EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid)'::regprocedure);
 a:=$old$IF v_alloc IS NULL OR v_alloc='[]' THEN
        v_options:=$old$;
 b:=$new$IF (v_alloc IS NULL OR v_alloc='[]') AND (v_traced OR p_restock OR (
        (SELECT coalesce(sum(d.quantity),0) FROM public._historical_return_lot_deductions(v_tenant_id,p_sale_id,v_item.id) d) =
        (SELECT si.quantity FROM public.sale_items si WHERE si.id=v_item.id AND si.tenant_id=v_tenant_id)
        AND (SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(v_tenant_id,p_sale_id,v_item.id) d)=1
      )) THEN
        v_options:=$new$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre de correction fiscale inattendue : %',n;END IF;
 EXECUTE replace(src,a,b);
END $patch$;


-- ===== 80-historical-sale-lot-matching-candidate.sql (blob acd4468910f71da4742cf279ff0d15de76d5c16a) =====
-- Candidat 80 : rapprochement documenté des sorties historiques existantes, sans mouvement de stock.
-- Après 64/67/68/71/73/77. Exclusivement recette isolée.
CREATE TABLE public.historical_sale_lot_matches(
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 deduction_id uuid NOT NULL REFERENCES public.sale_lot_deductions(id),
 sale_item_id uuid NOT NULL REFERENCES public.sale_items(id),
 quantity numeric NOT NULL CHECK(quantity>0 AND quantity::text NOT IN ('NaN','Infinity','-Infinity')),
 evidence text NOT NULL CHECK(length(btrim(evidence)) BETWEEN 8 AND 1000),
 actor_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(deduction_id,sale_item_id)
);
CREATE INDEX historical_sale_lot_matches_tenant_line_idx ON public.historical_sale_lot_matches(tenant_id,sale_item_id);
ALTER TABLE public.historical_sale_lot_matches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.historical_sale_lot_matches FROM PUBLIC,anon,authenticated,service_role;
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','historical_sale_lot_matches','direct','tenant_id','operation',86,'delete',false);
-- Read/save authorisation: active tenant admin and actual site access.
CREATE FUNCTION public._historical_match_context(p_sale_id uuid,p_article_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE t uuid:=public.current_tenant_id();s public.sales;
BEGIN
 PERFORM public._cr_require_caller();
 IF NOT coalesce(public._cr_profile_is_tenant_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Rapprochement réservé aux administrateurs.' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM public.sales WHERE tenant_id=t AND id=p_sale_id AND deleted_at IS NULL AND status NOT IN ('cancelled');
 IF NOT FOUND OR public.current_user_can_access_site(s.site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Vente inaccessible.' USING ERRCODE='42501';END IF;
 PERFORM public._cs_assert_sale_usable(p_sale_id);
 IF NOT EXISTS(SELECT 1 FROM public.sale_items WHERE tenant_id=t AND sale_id=p_sale_id AND article_id=p_article_id)
 OR EXISTS(SELECT 1 FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=p_sale_id) THEN RAISE EXCEPTION 'Vente historique non éligible.' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND d.article_id=p_article_id AND public.current_user_can_access_site(d.site_id) IS DISTINCT FROM true)
 OR EXISTS(SELECT 1 FROM public.sale_items i WHERE i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id AND i.site_id IS NOT NULL AND public.current_user_can_access_site(i.site_id) IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Dépôt inaccessible.' USING ERRCODE='42501';END IF;
 RETURN t;
END $f$;
REVOKE ALL ON FUNCTION public._historical_match_context(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.read_historical_sale_lot_match(p_sale_id uuid,p_article_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE t uuid:=public._historical_match_context(p_sale_id,p_article_id);
BEGIN
 RETURN jsonb_build_object(
 'lines',(SELECT coalesce(jsonb_agg(jsonb_build_object('sale_item_id',i.id,'name',i.name,'quantity',i.quantity,'site_id',i.site_id,'linked_quantity',(SELECT coalesce(sum(d.quantity),0) FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND d.sale_item_id=i.id)) ORDER BY i.id),'[]') FROM public.sale_items i WHERE i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id),
 'deductions',(SELECT coalesce(jsonb_agg(jsonb_build_object('deduction_id',d.id,'lot_id',d.lot_id,'batch_number',l.batch_number,'site_id',d.site_id,'site_name',st.name,'quantity',d.quantity) ORDER BY d.id),'[]') FROM public.sale_lot_deductions d JOIN public.stock_lots l ON l.id=d.lot_id AND l.tenant_id=t AND l.article_id=p_article_id AND l.site_id=d.site_id JOIN public.sites st ON st.id=d.site_id AND st.tenant_id=t WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND d.article_id=p_article_id AND d.sale_item_id IS NULL),
 'matches',(SELECT coalesce(jsonb_agg(jsonb_build_object('deduction_id',m.deduction_id,'sale_item_id',m.sale_item_id,'quantity',m.quantity) ORDER BY m.deduction_id,m.sale_item_id),'[]') FROM public.historical_sale_lot_matches m JOIN public.sale_lot_deductions d ON d.id=m.deduction_id AND d.tenant_id=t WHERE m.tenant_id=t AND d.sale_id=p_sale_id AND d.article_id=p_article_id),
 'prior_returns',EXISTS(SELECT 1 FROM public.sale_return_items ri JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t WHERE ri.tenant_id=t AND r.sale_id=p_sale_id AND ri.article_id=p_article_id AND r.status IN ('pending','approved')));
END $f$;
REVOKE ALL ON FUNCTION public.read_historical_sale_lot_match(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_historical_sale_lot_match(uuid,uuid) TO authenticated;
CREATE FUNCTION public.save_historical_sale_lot_match(p_sale_id uuid,p_article_id uuid,p_matches jsonb,p_evidence text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE t uuid:=public._historical_match_context(p_sale_id,p_article_id); n int;
BEGIN
 IF jsonb_typeof(p_matches) IS DISTINCT FROM 'array' OR jsonb_array_length(p_matches) NOT BETWEEN 1 AND 500
 OR p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 8 AND 1000 THEN RAISE EXCEPTION 'Affectations et référence de preuve obligatoires.' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':edit:sale:'||p_sale_id::text,0));
 PERFORM 1 FROM public.sale_items i WHERE i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id ORDER BY i.id FOR UPDATE;
 PERFORM 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND d.article_id=p_article_id ORDER BY d.id FOR UPDATE;
 PERFORM public._historical_match_context(p_sale_id,p_article_id);
 IF EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=t AND resource_type='sale' AND resource_key=p_sale_id::text AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Vente en cours de modification.' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.historical_sale_lot_matches m JOIN public.sale_lot_deductions d ON d.id=m.deduction_id AND d.tenant_id=t WHERE m.tenant_id=t AND d.sale_id=p_sale_id AND d.article_id=p_article_id) THEN
  IF (SELECT coalesce(jsonb_agg(jsonb_build_array(m.deduction_id,m.sale_item_id,trim_scale(m.quantity)) ORDER BY m.deduction_id,m.sale_item_id),'[]') FROM public.historical_sale_lot_matches m JOIN public.sale_lot_deductions d ON d.id=m.deduction_id AND d.tenant_id=t WHERE m.tenant_id=t AND d.sale_id=p_sale_id AND d.article_id=p_article_id AND m.evidence=btrim(p_evidence)) =
  (SELECT coalesce(jsonb_agg(jsonb_build_array(x.deduction_id,x.sale_item_id,trim_scale(x.quantity)) ORDER BY x.deduction_id,x.sale_item_id),'[]') FROM jsonb_to_recordset(p_matches) x(deduction_id uuid,sale_item_id uuid,quantity numeric)) THEN
   RETURN jsonb_build_object('success',true,'idempotent',true);
  END IF;
  RAISE EXCEPTION 'Rapprochement déjà enregistré ; correction contrôlée nécessaire.' USING ERRCODE='55000';
 END IF;
 IF EXISTS(SELECT 1 FROM public.sale_return_items ri JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t WHERE ri.tenant_id=t AND r.sale_id=p_sale_id AND ri.article_id=p_article_id AND r.status IN ('pending','approved')) THEN RAISE EXCEPTION 'Retours antérieurs à rapprocher avant cette opération.' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_matches) x(deduction_id uuid,sale_item_id uuid,quantity numeric)
 LEFT JOIN public.sale_lot_deductions d ON d.id=x.deduction_id AND d.tenant_id=t AND d.sale_id=p_sale_id AND d.article_id=p_article_id AND d.sale_item_id IS NULL
 LEFT JOIN public.sale_items i ON i.id=x.sale_item_id AND i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id
 LEFT JOIN public.stock_lots l ON l.id=d.lot_id AND l.tenant_id=t AND l.article_id=p_article_id AND l.site_id=d.site_id
 WHERE d.id IS NULL OR i.id IS NULL OR l.id IS NULL OR x.quantity IS NULL OR x.quantity<=0 OR x.quantity::text IN ('NaN','Infinity','-Infinity') OR (i.site_id IS NOT NULL AND i.site_id<>d.site_id))
 OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_matches) x(deduction_id uuid,sale_item_id uuid,quantity numeric) GROUP BY x.deduction_id,x.sale_item_id HAVING count(*)>1) THEN RAISE EXCEPTION 'Affectation invalide, lot ou ligne étrangère.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND d.article_id=p_article_id AND d.sale_item_id IS NULL AND d.quantity IS DISTINCT FROM
 (SELECT sum(x.quantity) FROM jsonb_to_recordset(p_matches) x(deduction_id uuid,sale_item_id uuid,quantity numeric) WHERE x.deduction_id=d.id))
 THEN RAISE EXCEPTION 'Toutes les sorties orphelines doivent être affectées exactement.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.sale_items i WHERE i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id AND i.quantity IS DISTINCT FROM
 (SELECT coalesce(sum(d.quantity),0) FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND d.sale_item_id=i.id)
 + (SELECT coalesce(sum(x.quantity),0) FROM jsonb_to_recordset(p_matches) x(deduction_id uuid,sale_item_id uuid,quantity numeric) WHERE x.sale_item_id=i.id))
 THEN RAISE EXCEPTION 'Quantités affectées différentes des quantités vendues.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.sale_items i CROSS JOIN LATERAL (
 SELECT d.site_id FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND d.sale_item_id=i.id
 UNION SELECT d.site_id FROM jsonb_to_recordset(p_matches) x(deduction_id uuid,sale_item_id uuid,quantity numeric) JOIN public.sale_lot_deductions d ON d.id=x.deduction_id WHERE x.sale_item_id=i.id
 ) a WHERE i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id GROUP BY i.id HAVING count(DISTINCT a.site_id)>1)
 THEN RAISE EXCEPTION 'Une ligne répartie sur plusieurs dépôts nécessite un rapprochement dédié.' USING ERRCODE='55000';END IF;
 INSERT INTO public.historical_sale_lot_matches(tenant_id,deduction_id,sale_item_id,quantity,evidence,actor_id)
 SELECT t,x.deduction_id,x.sale_item_id,x.quantity,btrim(p_evidence),auth.uid() FROM jsonb_to_recordset(p_matches) x(deduction_id uuid,sale_item_id uuid,quantity numeric);
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO public.audit_logs(tenant_id,user_id,action,module,reference_id,new_value)
 VALUES(t,auth.uid(),'historical_sale_lots_matched','stock',p_sale_id,jsonb_build_object('article_id',p_article_id,'evidence',btrim(p_evidence),'matches',p_matches));
 RETURN jsonb_build_object('success',true,'count',n,'idempotent',false);
END $f$;
REVOKE ALL ON FUNCTION public.save_historical_sale_lot_match(uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_historical_sale_lot_match(uuid,uuid,jsonb,text) TO authenticated;
-- Association virtuelle : les sorties originales ne sont jamais modifiées.
CREATE OR REPLACE FUNCTION public._historical_return_lot_deductions(t uuid,sid uuid,li uuid)
RETURNS SETOF public.sale_lot_deductions LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO ''
AS $f$
 SELECT d.* FROM public.sale_lot_deductions d JOIN public.sale_items i ON i.tenant_id=t AND i.sale_id=sid AND i.id=li AND i.article_id=d.article_id
 WHERE d.tenant_id=t AND d.sale_id=sid AND (d.sale_item_id=li OR (d.sale_item_id IS NULL AND (i.site_id IS NULL OR i.site_id=d.site_id)
 AND NOT EXISTS(SELECT 1 FROM public.historical_sale_lot_matches m WHERE m.tenant_id=t AND m.deduction_id=d.id)
 AND (SELECT count(*) FROM public.sale_items z WHERE z.tenant_id=t AND z.sale_id=sid AND z.article_id=d.article_id)=1))
 UNION ALL
 SELECT d.id,d.tenant_id,d.sale_id,m.sale_item_id,d.lot_id,d.article_id,d.site_id,m.quantity,d.created_at
 FROM public.historical_sale_lot_matches m JOIN public.sale_lot_deductions d ON d.id=m.deduction_id AND d.tenant_id=t AND d.sale_id=sid AND d.sale_item_id IS NULL
 JOIN public.sale_items i ON i.id=m.sale_item_id AND i.tenant_id=t AND i.sale_id=sid AND i.article_id=d.article_id
 WHERE m.tenant_id=t AND m.sale_item_id=li AND (i.site_id IS NULL OR i.site_id=d.site_id)
$f$;
REVOKE ALL ON FUNCTION public._historical_return_lot_deductions(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
-- Même protection de préflight que les affectations de retour.
DO $p$
DECLARE src text; a text:=$a$'quote_conversion_stock_trace','sale_return_lot_allocations'$a$;n int;
BEGIN
 src:=pg_get_functiondef('public.br_preflight_restore(uuid)'::regprocedure);
 n:=(length(src)-length(replace(src,a,'')))/length(a);
 IF n<>1 THEN RAISE EXCEPTION 'Ancre préflight rapprochement inattendue : %',n;END IF;
 EXECUTE replace(src,a,$b$'quote_conversion_stock_trace','sale_return_lot_allocations','historical_sale_lot_matches'$b$);
END $p$;


-- ===== 82-supervised-return-explicit-mode-candidate.sql (blob 3a7756d68e53720d5b217f3f9f1afd496420fd52) =====
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


-- ===== 84-historical-return-item-lot-matching-candidate.sql (blob 889471a480f6a1d7e53165922a29a1f86bfb30e4) =====
-- Candidat : rapprocher les lots d'un retour historique déjà traité, sans le rembourser ni le restocker.
-- L'administrateur doit disposer de preuves ; si le stock physique n'a pas déjà été régularisé,
-- utiliser un inventaire/ajustement de stock contrôlé avant de confirmer le rapprochement.
ALTER TABLE public.sale_return_lot_allocations ADD COLUMN reconciliation_evidence text, ADD COLUMN reconciled_by uuid, ADD COLUMN reconciled_at timestamptz;
CREATE FUNCTION public.save_historical_return_lot_match(p_return_item_id uuid,p_lots jsonb,p_evidence text,p_physical_verified boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE t uuid:=public.current_tenant_id();ri public.sale_return_items;r public.sale_returns;i public.sale_items;options jsonb;used numeric; x record;n int;
BEGIN
 PERFORM public._cr_require_caller();
 IF NOT coalesce(public._cr_profile_is_tenant_admin(auth.uid()),false) THEN RAISE EXCEPTION 'Rapprochement réservé aux administrateurs.' USING ERRCODE='42501';END IF;
 SELECT * INTO ri FROM public.sale_return_items WHERE id=p_return_item_id AND tenant_id=t;
 IF NOT FOUND OR ri.sale_item_id IS NULL THEN RAISE EXCEPTION 'Ligne de retour inaccessible.' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM public.sale_returns WHERE id=ri.return_id AND tenant_id=t;
 IF NOT FOUND OR public.current_user_can_access_site(r.site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Retour inaccessible.' USING ERRCODE='42501';END IF;
 PERFORM public._historical_match_context(r.sale_id,ri.article_id);
 PERFORM public._cs_assert_return_usable(r.id);
 IF r.status IS DISTINCT FROM 'approved' OR r.restock IS NULL OR ri.quantity<=0 THEN RAISE EXCEPTION 'Retour non éligible au rapprochement.' USING ERRCODE='55000';END IF;
 IF p_evidence IS NULL OR length(btrim(p_evidence)) NOT BETWEEN 8 AND 1000 OR jsonb_typeof(p_lots) IS DISTINCT FROM 'array' OR jsonb_array_length(p_lots) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Lots et justificatif obligatoires.' USING ERRCODE='22023';END IF;
 IF r.restock AND p_physical_verified IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirmez les mouvements physiques déjà vérifiés ; aucun nouveau stock ne sera créé.' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':edit:sale:'||r.sale_id::text,0));
 SELECT * INTO STRICT i FROM public.sale_items WHERE id=ri.sale_item_id AND tenant_id=t AND sale_id=r.sale_id AND article_id=ri.article_id FOR UPDATE;
 SELECT * INTO STRICT ri FROM public.sale_return_items WHERE id=p_return_item_id AND tenant_id=t FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=t AND resource_type='sale' AND resource_key=r.sale_id::text AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Vente en cours de modification.' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.sale_return_lot_allocations a WHERE a.tenant_id=t AND a.return_item_id=ri.id) THEN
  IF (SELECT jsonb_agg(jsonb_build_array(a.lot_id,trim_scale(a.quantity)) ORDER BY a.lot_id) FROM public.sale_return_lot_allocations a WHERE a.tenant_id=t AND a.return_item_id=ri.id AND a.reconciliation_evidence=btrim(p_evidence)) =
   (SELECT jsonb_agg(jsonb_build_array(z.lot_id,trim_scale(z.quantity)) ORDER BY z.lot_id) FROM jsonb_to_recordset(p_lots) z(lot_id uuid,quantity numeric)) THEN RETURN jsonb_build_object('success',true,'idempotent',true);END IF;
  RAISE EXCEPTION 'Ce retour possède déjà une affectation.' USING ERRCODE='55000';
 END IF;
 IF (SELECT sum(d.quantity) FROM public._historical_return_lot_deductions(t,r.sale_id,i.id) d) IS DISTINCT FROM i.quantity OR (SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,r.sale_id,i.id) d)<>1 THEN RAISE EXCEPTION 'Rapprochez d’abord les sorties historiques de la vente.' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_lots) z(lot_id uuid,quantity numeric) WHERE z.lot_id IS NULL OR z.quantity IS NULL OR z.quantity<=0 OR z.quantity::text IN ('NaN','Infinity','-Infinity'))
 OR EXISTS(SELECT 1 FROM jsonb_to_recordset(p_lots) z(lot_id uuid,quantity numeric) GROUP BY z.lot_id HAVING count(*)>1)
 OR (SELECT sum(z.quantity) FROM jsonb_to_recordset(p_lots) z(lot_id uuid,quantity numeric)) IS DISTINCT FROM ri.quantity THEN RAISE EXCEPTION 'Quantités de rapprochement invalides.' USING ERRCODE='22023';END IF;
 options:=public._return_lot_options(t,i.id);
 FOR x IN SELECT * FROM jsonb_to_recordset(p_lots) z(lot_id uuid,quantity numeric) ORDER BY z.lot_id LOOP
  SELECT (v->>'available')::numeric INTO used FROM jsonb_array_elements(options) v WHERE v->>'lot_id'=x.lot_id::text;
  IF NOT FOUND OR used<x.quantity THEN RAISE EXCEPTION 'Lot étranger ou quantité déjà affectée.' USING ERRCODE='22023';END IF;
  IF NOT EXISTS(SELECT 1 FROM public.stock_lots l WHERE l.id=x.lot_id AND l.tenant_id=t AND l.article_id=i.article_id AND public.current_user_can_access_site(l.site_id)) THEN RAISE EXCEPTION 'Lot inaccessible.' USING ERRCODE='42501';END IF;
 END LOOP;
 INSERT INTO public.sale_return_lot_allocations(tenant_id,return_item_id,sale_item_id,lot_id,quantity,restocked,purchase_price,reconciliation_evidence,reconciled_by,reconciled_at)
 SELECT t,ri.id,i.id,z.lot_id,z.quantity,r.restock,public._return_lot_snapshot_cost(t,r.sale_id,i.id,z.lot_id,ri.purchase_cost),btrim(p_evidence),auth.uid(),now()
 FROM jsonb_to_recordset(p_lots) z(lot_id uuid,quantity numeric);
 GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO public.audit_logs(tenant_id,user_id,action,module,reference_id,new_value) VALUES(t,auth.uid(),'historical_return_lots_matched','stock',r.id,jsonb_build_object('return_item_id',ri.id,'evidence',btrim(p_evidence),'physical_verified',p_physical_verified,'lots',p_lots));
 RETURN jsonb_build_object('success',true,'idempotent',false,'count',n);
END $f$;
REVOKE ALL ON FUNCTION public.save_historical_return_lot_match(uuid,jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_historical_return_lot_match(uuid,jsonb,text,boolean) TO authenticated;


-- ===== 86-historical-reconciliation-sequence-candidate.sql (blob b72f7c28a3f0d8114a384c7f4fe71b9b17df3b7e) =====
-- Candidat 86 : ordre de rapprochement historique (vente, puis anciens retours).
-- Ne pas empêcher la résolution de la vente parce qu'un ancien retour existe déjà.
-- Les affectations de retours existantes doivent rester compatibles avec les nouvelles associations.
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public.save_historical_sale_lot_match(uuid,uuid,jsonb,text)'::regprocedure);
 a:=$a$IF EXISTS(SELECT 1 FROM public.sale_return_items ri JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t WHERE ri.tenant_id=t AND r.sale_id=p_sale_id AND ri.article_id=p_article_id AND r.status IN ('pending','approved')) THEN RAISE EXCEPTION 'Retours antérieurs à rapprocher avant cette opération.' USING ERRCODE='55000';END IF;$a$;
 b:=$b$IF EXISTS(SELECT 1 FROM public.sale_return_items ri JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t WHERE ri.tenant_id=t AND r.sale_id=p_sale_id AND ri.article_id=p_article_id AND r.status='pending') THEN RAISE EXCEPTION 'Terminez ou annulez les retours en attente avant le rapprochement.' USING ERRCODE='55000';END IF;$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre retours historiques inattendue : %',n;END IF;src:=replace(src,a,b);
 a:=$a$GET DIAGNOSTICS n=ROW_COUNT;
 INSERT INTO public.audit_logs$a$;
 b:=$b$GET DIAGNOSTICS n=ROW_COUNT;
 IF EXISTS(
 SELECT 1 FROM public.sale_return_lot_allocations a
 JOIN public.sale_items i ON i.id=a.sale_item_id AND i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id
 JOIN public.sale_return_items ri ON ri.id=a.return_item_id AND ri.tenant_id=t
 JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t AND r.status IN ('pending','approved')
 WHERE a.tenant_id=t GROUP BY a.sale_item_id,a.lot_id
 HAVING sum(a.quantity)>(SELECT coalesce(sum(d.quantity),0) FROM public._historical_return_lot_deductions(t,p_sale_id,a.sale_item_id) d WHERE d.lot_id=a.lot_id)
 ) THEN RAISE EXCEPTION 'Les affectations des anciens retours contredisent ce rapprochement.' USING ERRCODE='55000';END IF;
 INSERT INTO public.audit_logs$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre rapprochement historique inattendue : %',n;END IF;EXECUTE replace(src,a,b);
 -- Pour un historique sans trace de conversion, tout ancien retour multi-lots non affecté
 -- doit être rapproché avant une nouvelle restitution physique, même si le retour était financier.
 src:=pg_get_functiondef('public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean)'::regprocedure);
 a:=$a$ELSIF prior_physical>0 AND p_restock THEN$a$;
 b:=$b$ELSIF (prior_physical>0 OR (NOT v_has_trace AND prior_unmapped>0)) AND p_restock THEN$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre ancien retour non affecté inattendue : %',n;END IF;EXECUTE replace(src,a,b);
END $p$;
-- Lecture administrateur des anciens retours approuvés encore à rapprocher.
CREATE FUNCTION public.read_historical_return_lot_matches(p_sale_id uuid,p_article_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE t uuid:=public._historical_match_context(p_sale_id,p_article_id);
BEGIN
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('return_item_id',ri.id,'return_number',r.return_number,'created_at',r.created_at,'name',ri.name,'quantity',ri.quantity,'restock',r.restock,'lots',public._return_lot_options(t,i.id),'source_complete',((SELECT coalesce(sum(d.quantity),0) FROM public._historical_return_lot_deductions(t,p_sale_id,i.id) d)=i.quantity AND (SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,p_sale_id,i.id) d)=1)) ORDER BY r.created_at,ri.id)
 FROM public.sale_return_items ri JOIN public.sale_returns r ON r.id=ri.return_id AND r.tenant_id=t AND r.sale_id=p_sale_id AND r.status='approved'
 JOIN public.sale_items i ON i.id=ri.sale_item_id AND i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id
 WHERE ri.tenant_id=t AND ri.article_id=p_article_id AND public.current_user_can_access_site(r.site_id)
 AND NOT EXISTS(SELECT 1 FROM public.sale_return_lot_allocations a WHERE a.tenant_id=t AND a.return_item_id=ri.id)),'[]');
END $f$;
REVOKE ALL ON FUNCTION public.read_historical_return_lot_matches(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.read_historical_return_lot_matches(uuid,uuid) TO authenticated;


-- ===== 90-historical-multi-site-return-candidate.sql (blob a5a648c1bc15a646f0c3a51c85861571c354b793) =====
-- Candidat 90 : restitution par lot et dépôt réellement débités, historique uniquement.
-- Après 64/67/68/71/73/77/80/84/86. Aucun déploiement.
DO $p$
DECLARE src text;a text;b text;n integer;
BEGIN
 src:=pg_get_functiondef('public._allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean)'::regprocedure);
 a:=$a$v_source_count<>1 OR v_source IS NULL$a$;b:=$b$v_source_count<1 OR v_source IS NULL$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$si.site_id:=v_source;
 END IF;
 IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN$a$;b:=$b$si.site_id:=v_source;
  IF EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(t,sid,si.id) d WHERE public.current_user_can_access_site(d.site_id) IS DISTINCT FROM true) THEN RAISE EXCEPTION 'Un dépôt historique est inaccessible.' USING ERRCODE='42501';END IF;
 END IF;
 IF public.current_user_can_access_site(si.site_id) IS DISTINCT FROM true THEN$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$   FOR rec IN SELECT a.lot_id,sum(a.quantity) quantity FROM jsonb_to_recordset(chosen) a(lot_id uuid,quantity numeric) GROUP BY a.lot_id ORDER BY a.lot_id LOOP$a$;b:=$b$   IF NOT v_has_trace AND p_restock THEN
    PERFORM 1 FROM public.stock_levels sl WHERE sl.tenant_id=t AND sl.article_id=si.article_id AND EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(t,sid,si.id) d WHERE d.site_id=sl.site_id) ORDER BY sl.article_id,sl.site_id FOR UPDATE;
   END IF;
   FOR rec IN SELECT a.lot_id,sum(a.quantity) quantity FROM jsonb_to_recordset(chosen) a(lot_id uuid,quantity numeric) GROUP BY a.lot_id ORDER BY a.lot_id LOOP$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$l.article_id=si.article_id AND l.site_id=si.site_id;$a$;b:=$b$l.article_id=si.article_id AND ((v_has_trace AND l.site_id=si.site_id) OR (NOT v_has_trace AND EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(t,sid,si.id) d WHERE d.lot_id=l.id AND d.site_id=l.site_id)));$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$UPDATE public.stock_lots SET remaining_quantity=remaining_quantity+rec.quantity WHERE id=rec.lot_id AND tenant_id=t AND article_id=si.article_id AND site_id=si.site_id AND remaining_quantity+rec.quantity<=initial_quantity;$a$;b:=$b$UPDATE public.stock_lots l SET remaining_quantity=l.remaining_quantity+rec.quantity WHERE l.id=rec.lot_id AND l.tenant_id=t AND l.article_id=si.article_id AND ((v_has_trace AND l.site_id=si.site_id) OR (NOT v_has_trace AND EXISTS(SELECT 1 FROM public._historical_return_lot_deductions(t,sid,si.id) d WHERE d.lot_id=l.id AND d.site_id=l.site_id))) AND l.remaining_quantity+rec.quantity<=l.initial_quantity;$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 a:=$a$ IF NOT p_restock THEN RETURN;END IF;
 SELECT quantity INTO prev$a$;b:=$b$ IF NOT p_restock THEN RETURN;END IF;
 IF NOT v_has_trace AND jsonb_array_length(options)>0 THEN
  FOR rec IN SELECT l.site_id,sum(a.quantity) quantity FROM public.sale_return_lot_allocations a JOIN public.stock_lots l ON l.id=a.lot_id AND l.tenant_id=t WHERE a.tenant_id=t AND a.return_item_id=riid AND a.restocked GROUP BY l.site_id ORDER BY l.site_id LOOP
   SELECT sl.quantity INTO prev FROM public.stock_levels sl WHERE sl.tenant_id=t AND sl.article_id=si.article_id AND sl.site_id=rec.site_id FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Stock historique introuvable.' USING ERRCODE='55000';END IF;
   UPDATE public.stock_levels SET quantity=prev+rec.quantity,updated_at=now() WHERE tenant_id=t AND article_id=si.article_id AND site_id=rec.site_id;
   INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(t,si.article_id,rec.site_id,'return_customer',rec.quantity,prev,prev+rec.quantity,'sale_return',rid,auth.uid(),'Retour historique sur vente '||sid::text);
  END LOOP;
  RETURN;
 END IF;
 SELECT quantity INTO prev$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts _allocate_traced_fiscal_return(uuid,uuid,uuid,uuid,jsonb,boolean): %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public.save_historical_sale_lot_match(uuid,uuid,jsonb,text)'::regprocedure);
 a:=$a$ IF EXISTS(SELECT 1 FROM public.sale_items i CROSS JOIN LATERAL (
 SELECT d.site_id FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=p_sale_id AND d.sale_item_id=i.id
 UNION SELECT d.site_id FROM jsonb_to_recordset(p_matches) x(deduction_id uuid,sale_item_id uuid,quantity numeric) JOIN public.sale_lot_deductions d ON d.id=x.deduction_id WHERE x.sale_item_id=i.id
 ) a WHERE i.tenant_id=t AND i.sale_id=p_sale_id AND i.article_id=p_article_id GROUP BY i.id HAVING count(DISTINCT a.site_id)>1)
 THEN RAISE EXCEPTION 'Une ligne répartie sur plusieurs dépôts nécessite un rapprochement dédié.' USING ERRCODE='55000';END IF;$a$;b:=$b$ -- Les lignes sans site explicite peuvent être réparties sur les dépôts documentés.$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts save_historical_sale_lot_match(uuid,uuid,jsonb,text): %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public.save_historical_return_lot_match(uuid,jsonb,text,boolean)'::regprocedure);
 a:=$a$(SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,r.sale_id,i.id) d)<>1$a$;b:=$b$(SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,r.sale_id,i.id) d)<1$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts save_historical_return_lot_match(uuid,jsonb,text,boolean): %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
 src:=pg_get_functiondef('public.read_historical_return_lot_matches(uuid,uuid)'::regprocedure);
 a:=$a$(SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,p_sale_id,i.id) d)=1$a$;b:=$b$(SELECT count(DISTINCT d.site_id) FROM public._historical_return_lot_deductions(t,p_sale_id,i.id) d)>=1$b$;n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre multi-dépôts read_historical_return_lot_matches(uuid,uuid): %',n;END IF;src:=replace(src,a,b);
 EXECUTE src;
END $p$;


-- ===== 93-historical-reversal-stock-and-match-guards-candidate.sql (blob a97bba9e06eeefe4c4720b7ef8ebeec454701f37) =====
-- Candidat 93 : annulation/suppression historique, regroupement par article/dépôt, verrous et protection des rapprochements.
-- Recette uniquement après 64/67/68/71/73/80. Le moteur de restauration des conversions tracées est conservé.
CREATE FUNCTION public._restore_historical_sale_stock(t uuid,sid uuid,p_kind text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $f$
DECLARE art record; d record; z record; plan jsonb:='[]'; prior numeric; expected numeric; lot_qty numeric; movement_qty numeric;
BEGIN
 IF p_kind NOT IN ('sale_cancel','sale_delete') THEN RAISE EXCEPTION 'Type de restauration invalide.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.sale_lot_deductions sd LEFT JOIN public.sale_items si ON si.tenant_id=t AND si.sale_id=sid AND si.article_id=sd.article_id WHERE sd.tenant_id=t AND sd.sale_id=sid AND (si.id IS NULL OR sd.quantity<=0 OR sd.quantity::text IN ('NaN','Infinity','-Infinity'))) THEN RAISE EXCEPTION 'Sortie historique incohérente.' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND NOT EXISTS(SELECT 1 FROM public.sale_items i WHERE i.tenant_id=t AND i.sale_id=sid AND i.article_id=m.article_id)) THEN RAISE EXCEPTION 'Mouvement sans article de vente.' USING ERRCODE='55000';END IF;
 FOR art IN SELECT si.article_id,sum(si.quantity) quantity,bool_or(coalesce(a.track_stock,false)) tracked
  FROM public.sale_items si LEFT JOIN public.articles a ON a.id=si.article_id AND a.tenant_id=t
  WHERE si.tenant_id=t AND si.sale_id=sid AND si.article_id IS NOT NULL GROUP BY si.article_id ORDER BY si.article_id LOOP
  expected:=art.quantity;
  SELECT coalesce(sum(sd.quantity),0) INTO lot_qty FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid AND sd.article_id=art.article_id;
  SELECT coalesce(-sum(m.quantity),0) INTO movement_qty FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id;
  IF NOT art.tracked AND lot_qty=0 AND movement_qty=0 THEN CONTINUE;END IF;
  IF expected<=0 OR expected::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Quantité historique invalide.' USING ERRCODE='55000';END IF;
  IF lot_qty>0 AND lot_qty<>expected THEN RAISE EXCEPTION 'Sorties de lots partielles : rapprochement requis avant annulation ou suppression.' USING ERRCODE='55000';END IF;
  IF EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id) THEN
   IF movement_qty<>expected OR EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id AND m.quantity>=0) THEN RAISE EXCEPTION 'Mouvements historiques incomplets ou contradictoires.' USING ERRCODE='55000';END IF;
   IF lot_qty>0 AND EXISTS(
     SELECT 1 FROM (SELECT m.site_id,-sum(m.quantity) qty FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id GROUP BY m.site_id) m
     FULL JOIN (SELECT sd.site_id,sum(sd.quantity) qty FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid AND sd.article_id=art.article_id GROUP BY sd.site_id) l USING(site_id)
     WHERE m.qty IS DISTINCT FROM l.qty) THEN RAISE EXCEPTION 'Lots et mouvements historiques incompatibles.' USING ERRCODE='55000';END IF;
   FOR z IN SELECT m.site_id,-sum(m.quantity) qty FROM public.stock_movements m WHERE m.tenant_id=t AND m.reference_type='sale' AND m.reference_id=sid AND m.article_id=art.article_id GROUP BY m.site_id LOOP
    plan:=plan||jsonb_build_array(jsonb_build_object('article_id',art.article_id,'site_id',z.site_id,'quantity',z.qty));
   END LOOP;
  ELSIF lot_qty>0 THEN
   FOR z IN SELECT sd.site_id,sum(sd.quantity) qty FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid AND sd.article_id=art.article_id GROUP BY sd.site_id LOOP
    plan:=plan||jsonb_build_array(jsonb_build_object('article_id',art.article_id,'site_id',z.site_id,'quantity',z.qty));
   END LOOP;
  ELSE
   FOR z IN SELECT public._historical_return_stock_site(t,sid,si.id) site_id,si.quantity qty FROM public.sale_items si WHERE si.tenant_id=t AND si.sale_id=sid AND si.article_id=art.article_id LOOP
    plan:=plan||jsonb_build_array(jsonb_build_object('article_id',art.article_id,'site_id',z.site_id,'quantity',z.qty));
   END LOOP;
  END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(plan) p(article_id uuid,site_id uuid,quantity numeric)
 LEFT JOIN public.sites st ON st.id=p.site_id AND st.tenant_id=t
 LEFT JOIN public.stock_levels sl ON sl.tenant_id=t AND sl.article_id=p.article_id AND sl.site_id=p.site_id
 WHERE st.id IS NULL OR sl.article_id IS NULL OR public.current_user_can_access_site(p.site_id) IS DISTINCT FROM true OR p.quantity<=0)
 THEN RAISE EXCEPTION 'Stock ou dépôt historique introuvable ou inaccessible.' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.stock_levels sl WHERE sl.tenant_id=t AND EXISTS(SELECT 1 FROM jsonb_to_recordset(plan) p(article_id uuid,site_id uuid,quantity numeric) WHERE p.article_id=sl.article_id AND p.site_id=sl.site_id) ORDER BY sl.article_id,sl.site_id FOR UPDATE;
 PERFORM 1 FROM public.stock_lots l WHERE l.tenant_id=t AND EXISTS(SELECT 1 FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid AND sd.lot_id=l.id) ORDER BY l.article_id,l.site_id,l.id FOR UPDATE;
 FOR d IN SELECT sd.lot_id,sd.article_id,sd.site_id,sum(sd.quantity) qty FROM public.sale_lot_deductions sd WHERE sd.tenant_id=t AND sd.sale_id=sid GROUP BY sd.lot_id,sd.article_id,sd.site_id ORDER BY sd.article_id,sd.site_id,sd.lot_id LOOP
  UPDATE public.stock_lots l SET remaining_quantity=l.remaining_quantity+d.qty WHERE l.id=d.lot_id AND l.tenant_id=t AND l.article_id=d.article_id AND l.site_id=d.site_id AND l.remaining_quantity+d.qty<=l.initial_quantity;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lot historique incohérent.' USING ERRCODE='55000';END IF;
 END LOOP;
 FOR z IN SELECT p.article_id,p.site_id,sum(p.quantity) qty FROM jsonb_to_recordset(plan) p(article_id uuid,site_id uuid,quantity numeric) GROUP BY p.article_id,p.site_id ORDER BY p.article_id,p.site_id LOOP
  SELECT sl.quantity INTO STRICT prior FROM public.stock_levels sl WHERE sl.tenant_id=t AND sl.article_id=z.article_id AND sl.site_id=z.site_id FOR UPDATE;
  UPDATE public.stock_levels SET quantity=prior+z.qty,updated_at=now() WHERE tenant_id=t AND article_id=z.article_id AND site_id=z.site_id;
  INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note)
  VALUES(t,z.article_id,z.site_id,'adjustment',z.qty,prior,prior+z.qty,p_kind,sid,auth.uid(),'Restauration historique '||sid::text);
 END LOOP;
END $f$;
REVOKE ALL ON FUNCTION public._restore_historical_sale_stock(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public._guard_historical_matched_sale_rows()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $f$
DECLARE t uuid;s uuid;a uuid;new_t uuid;new_s uuid;new_a uuid;
BEGIN
 IF TG_OP='UPDATE' AND to_jsonb(OLD) IS NOT DISTINCT FROM to_jsonb(NEW) THEN RETURN NEW;END IF;
 IF TG_OP<>'INSERT' THEN t:=OLD.tenant_id;s:=OLD.sale_id;a:=OLD.article_id;END IF;
 IF TG_OP<>'DELETE' THEN new_t:=NEW.tenant_id;new_s:=NEW.sale_id;new_a:=NEW.article_id;END IF;
 IF EXISTS(SELECT 1 FROM public.historical_sale_lot_matches m JOIN public.sale_lot_deductions d ON d.id=m.deduction_id AND d.tenant_id=m.tenant_id WHERE (d.tenant_id=t AND d.sale_id=s AND d.article_id=a) OR (d.tenant_id=new_t AND d.sale_id=new_s AND d.article_id=new_a)) THEN
  RAISE EXCEPTION 'Historique rapproché : les lignes et sorties d’origine ne peuvent plus être réécrites. Utilisez le parcours de correction.' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public._guard_historical_matched_sale_rows() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER trg_historical_matched_sale_item BEFORE INSERT OR UPDATE OR DELETE ON public.sale_items FOR EACH ROW EXECUTE FUNCTION public._guard_historical_matched_sale_rows();
CREATE TRIGGER trg_historical_matched_deduction BEFORE INSERT OR UPDATE OR DELETE ON public.sale_lot_deductions FOR EACH ROW EXECUTE FUNCTION public._guard_historical_matched_sale_rows();
DO $p$
DECLARE src text; fn text; a text;b text;n int; start_at int;end_at int;kind text;tail text;
BEGIN
 FOREACH fn IN ARRAY ARRAY['cancel_sale(uuid,uuid,text,text,uuid)','delete_sale_and_recalculate(uuid,uuid,text)'] LOOP
  src:=pg_get_functiondef(('public.'||fn)::regprocedure);
  a:=$a$PERFORM public.assert_tenant_access(p_tenant_id);$a$;
  b:=$b$PERFORM public.assert_tenant_access(p_tenant_id);
PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':edit:sale:'||p_sale_id::text,0));
IF EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=p_tenant_id AND resource_type='sale' AND resource_key=p_sale_id::text AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Vente en cours de modification.' USING ERRCODE='55000';END IF;$b$;
  n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre annulation/suppression : %',fn;END IF;src:=replace(src,a,b);
  IF fn LIKE 'cancel_sale%' THEN kind:='sale_cancel';tail:=E'END IF;\n\n-- Remboursement espèces : mouvement de caisse';ELSE kind:='sale_delete';tail:=E'END IF;\n\nINSERT INTO sale_deletion_log';END IF;
  a:='IF NOT public._restore_converted_sale_stock(v_tenant_id,p_sale_id,'||quote_literal(kind)||') THEN';
  start_at:=position(a in src);end_at:=position(tail in src);
  IF start_at=0 OR end_at<=start_at THEN RAISE EXCEPTION 'Bloc restauration inattendu : %',fn;END IF;
  b:=a||E'\n PERFORM public._restore_historical_sale_stock(v_tenant_id,p_sale_id,'||quote_literal(kind)||E');\n';
  src:=substring(src from 1 for start_at-1)||b||substring(src from end_at);
  IF kind='sale_delete' THEN
   a:=$a$IF v_sale.status = 'cancelled' THEN$a$;
   b:=$b$IF v_sale.sale_number IS NULL AND EXISTS(SELECT 1 FROM public.historical_sale_lot_matches m JOIN public.sale_lot_deductions d ON d.id=m.deduction_id AND d.tenant_id=m.tenant_id WHERE m.tenant_id=v_tenant_id AND d.sale_id=p_sale_id) THEN RETURN jsonb_build_object('success',false,'error','Historique rapproché : utilisez une annulation conservant les justificatifs.');END IF;
IF v_sale.status = 'cancelled' THEN$b$;
   n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre suppression physique inattendue';END IF;src:=replace(src,a,b);
  END IF;
  EXECUTE src;
 END LOOP;
 src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 a:=$a$IF p_request_id IS NOT NULL THEN
IF btrim(p_request_id)=''$a$;
 b:=$b$PERFORM pg_advisory_xact_lock(hashtextextended(v_tenant_id::text||':edit:sale:'||p_sale_id::text,0));
IF EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=v_tenant_id AND resource_type='sale' AND resource_key=p_sale_id::text AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'Vente en cours de modification.' USING ERRCODE='55000';END IF;
IF p_request_id IS NOT NULL THEN
IF btrim(p_request_id)=''$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre verrou retour historique inattendue';END IF;EXECUTE replace(src,a,b);
END $p$;

