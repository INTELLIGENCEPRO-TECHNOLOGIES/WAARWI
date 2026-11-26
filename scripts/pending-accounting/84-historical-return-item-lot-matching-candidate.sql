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
