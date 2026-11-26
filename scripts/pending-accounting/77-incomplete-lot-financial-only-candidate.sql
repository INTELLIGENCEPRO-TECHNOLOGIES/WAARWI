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
