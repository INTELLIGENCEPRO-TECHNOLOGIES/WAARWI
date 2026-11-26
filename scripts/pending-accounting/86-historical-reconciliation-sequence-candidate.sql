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
