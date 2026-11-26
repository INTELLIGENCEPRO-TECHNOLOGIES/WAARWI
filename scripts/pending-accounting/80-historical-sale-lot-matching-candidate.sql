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
