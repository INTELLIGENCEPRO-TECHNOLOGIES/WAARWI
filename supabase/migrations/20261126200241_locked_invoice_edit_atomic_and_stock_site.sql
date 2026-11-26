-- Protected invoice editing. Existing creation/payment/return routes are unchanged.
CREATE OR REPLACE FUNCTION public._invoice_edit_snapshot(t uuid,sid uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
 'version',encode(sha256(convert_to(jsonb_build_array(to_jsonb(s),coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.sale_items i WHERE i.tenant_id=t AND i.sale_id=sid),'[]'::jsonb))::text,'UTF8')),'hex'),
 'sale',jsonb_build_object('id',s.id,'customer_id',s.customer_id,'doc_header',s.doc_header,'created_at',s.created_at,'representative_id',s.representative_id,'total',s.total,'paid',s.paid,'status',s.status,'vat_enabled_at_issue',s.vat_enabled_at_issue,'accounting_status',s.accounting_status),
 'items',coalesce((SELECT jsonb_agg(jsonb_build_object('article_id',i.article_id,'name',i.name,'quantity',i.quantity,'unit_price',i.unit_price,'discount',coalesce(i.discount,0),'total',i.total) ORDER BY i.created_at,i.id) FROM public.sale_items i WHERE i.tenant_id=t AND i.sale_id=sid),'[]'::jsonb))
 FROM public.sales s WHERE s.tenant_id=t AND s.id=sid
$$;
CREATE OR REPLACE FUNCTION public.load_locked_invoice_edit(p_tenant_id uuid,p_sale_id uuid,p_window_id uuid,p_lock_token uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'sale',p_sale_id::text,p_window_id,p_lock_token);
 PERFORM public._cs_assert_sale_usable(p_sale_id);
 IF NOT EXISTS(SELECT 1 FROM public.sales WHERE tenant_id=p_tenant_id AND id=p_sale_id AND source='billing' AND accounting_status='not_accounted' AND status NOT IN ('cancelled','deleted') AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Cette facture ne peut plus être modifiée.' USING ERRCODE='55000';END IF;
 RETURN public._invoice_edit_snapshot(p_tenant_id,p_sale_id);
END $$;
CREATE OR REPLACE FUNCTION public.save_locked_invoice_edit(p_tenant_id uuid,p_sale_id uuid,p_window_id uuid,p_lock_token uuid,p_expected_version text,p_items jsonb,p_customer_id uuid,p_doc_header jsonb,p_representative_id uuid,p_rep_commission jsonb,p_release boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sales%ROWTYPE;snap jsonb; old_lines jsonb;new_lines jsonb;lines_changed boolean; quantities_changed boolean; total_new numeric; stock_site uuid; site_count integer; rec record; old_costs jsonb; prior_qty numeric; next_qty numeric; cid uuid; lease_result jsonb;
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'sale',p_sale_id::text,p_window_id,p_lock_token);
 PERFORM public._cs_assert_sale_usable(p_sale_id);
 SELECT * INTO s FROM public.sales WHERE tenant_id=p_tenant_id AND id=p_sale_id FOR UPDATE;
 IF NOT FOUND OR s.source IS DISTINCT FROM 'billing' OR s.accounting_status IS DISTINCT FROM 'not_accounted' OR s.status IN ('cancelled','deleted') OR s.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Cette facture ne peut plus être modifiée.' USING ERRCODE='55000';END IF;
 PERFORM 1 FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id ORDER BY id FOR UPDATE;
 snap:=public._invoice_edit_snapshot(p_tenant_id,p_sale_id);
 IF p_expected_version IS NULL OR snap->>'version' IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'La facture a changé depuis votre ouverture. Rechargez-la avant de reprendre la saisie.' USING ERRCODE='40001';END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Au moins une ligne valide est nécessaire.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric)
 LEFT JOIN public.articles a ON a.id=x.article_id AND a.tenant_id=p_tenant_id
 WHERE a.id IS NULL OR x.name IS NULL OR btrim(x.name)='' OR x.quantity IS NULL OR x.quantity<=0 OR x.unit_price IS NULL OR x.unit_price<0 OR coalesce(x.discount,0)<0 OR coalesce(x.discount,0)>x.quantity*x.unit_price OR x.quantity::text IN ('NaN','Infinity','-Infinity') OR x.unit_price::text IN ('NaN','Infinity','-Infinity') OR coalesce(x.discount,0)::text IN ('NaN','Infinity','-Infinity'))
 THEN RAISE EXCEPTION 'Vérifiez les articles, quantités, prix et remises.' USING ERRCODE='22023';END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=p_customer_id AND c.tenant_id=p_tenant_id AND (c.site_id IS NULL OR c.site_id=s.site_id OR public.current_user_can_access_site(c.site_id))) THEN RAISE EXCEPTION 'Client indisponible.' USING ERRCODE='42501';END IF;
 IF p_representative_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_representatives r WHERE r.id=p_representative_id AND r.tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Représentant indisponible.' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO old_lines FROM (SELECT jsonb_build_array(article_id,name,quantity,unit_price,coalesce(discount,0)) v FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id) q;
 SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO new_lines FROM (SELECT jsonb_build_array(article_id,name,quantity,unit_price,coalesce(discount,0)) v FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric)) q;
 lines_changed:=old_lines IS DISTINCT FROM new_lines;
 IF (s.vat_enabled_at_issue OR s.vat_net_amount IS NOT NULL) AND (lines_changed OR s.customer_id IS DISTINCT FROM p_customer_id) THEN RAISE EXCEPTION 'Utilisez un avoir pour corriger une facture émise avec TVA.' USING ERRCODE='55000';END IF;
 IF (lines_changed OR s.customer_id IS DISTINCT FROM p_customer_id) AND (EXISTS(SELECT 1 FROM public.sale_returns WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id) OR EXISTS(SELECT 1 FROM public.ipm_ventes WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id)) THEN RAISE EXCEPTION 'La facture comporte un retour ou une prise en charge IPM. Utilisez le parcours de correction dédié.' USING ERRCODE='55000';END IF;
 IF s.customer_id IS DISTINCT FROM p_customer_id AND coalesce(s.paid,0)>0 THEN RAISE EXCEPTION 'Le client d’une facture déjà réglée ne peut pas être remplacé directement.' USING ERRCODE='55000';END IF;
 IF lines_changed THEN
  IF coalesce(s.discount,0)<>0 OR EXISTS(SELECT 1 FROM public.sale_lot_deductions WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id) OR EXISTS(SELECT 1 FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id AND nullif(imei,'') IS NOT NULL) THEN RAISE EXCEPTION 'Cette facture comporte une remise globale, des lots ou des IMEI. Utilisez un avoir ou un parcours de correction adapté.' USING ERRCODE='55000';END IF;
  SELECT sum(round(quantity*unit_price-coalesce(discount,0),2)) INTO total_new FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric);
  IF total_new<coalesce(s.paid,0) OR (total_new>coalesce(s.paid,0) AND p_customer_id IS NULL) THEN RAISE EXCEPTION 'Le nouveau total est incompatible avec les règlements ou le client.' USING ERRCODE='22023';END IF;
  SELECT EXISTS(
   WITH o AS (SELECT article_id,sum(quantity) qty FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id),
   n AS (SELECT article_id,sum(quantity) qty FROM jsonb_to_recordset(p_items) x(article_id uuid,quantity numeric) GROUP BY article_id)
   SELECT 1 FROM o FULL JOIN n USING(article_id) WHERE coalesce(o.qty,0)<>coalesce(n.qty,0)
  ) INTO quantities_changed;
  IF quantities_changed THEN
   -- Resolve the ORIGINAL stock source, not the currently selected depot.
   SELECT count(DISTINCT m.site_id),(array_agg(DISTINCT m.site_id))[1] INTO site_count,stock_site FROM public.stock_movements m
   WHERE m.tenant_id=p_tenant_id AND ((m.reference_type='invoice_edit' AND m.reference_id=p_sale_id) OR (m.reference_id IS NULL AND m.movement_type='sale' AND m.note IN ('Facture '||s.sale_number,'Facture '||s.sale_number||' (credit)','Facture '||s.sale_number||' (devis converti)')));
   IF site_count<>1 OR public.current_user_can_access_site(stock_site) IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.sites WHERE id=stock_site AND tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Magasin de sortie du stock indéterminé ou inaccessible. Utilisez un avoir.' USING ERRCODE='55000';END IF;
   -- Do not infer historical stock if the original movement is missing or inconsistent.
   IF EXISTS(WITH o AS (SELECT article_id,sum(quantity) qty FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id),m AS (SELECT article_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=p_tenant_id AND site_id=stock_site AND ((reference_type='invoice_edit' AND reference_id=p_sale_id) OR (reference_id IS NULL AND movement_type='sale' AND note IN ('Facture '||s.sale_number,'Facture '||s.sale_number||' (credit)','Facture '||s.sale_number||' (devis converti)'))) GROUP BY article_id) SELECT 1 FROM o FULL JOIN m USING(article_id) LEFT JOIN public.articles a ON a.id=coalesce(o.article_id,m.article_id) AND a.tenant_id=p_tenant_id WHERE coalesce(o.qty,0)<>coalesce(m.qty,0) AND (coalesce(a.track_stock,true) OR m.article_id IS NOT NULL)) THEN RAISE EXCEPTION 'Historique de stock incohérent. Aucune modification n’a été enregistrée.' USING ERRCODE='55000';END IF;
   FOR rec IN WITH o AS (SELECT article_id,sum(quantity) qty FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id),n AS (SELECT article_id,sum(quantity) qty FROM jsonb_to_recordset(p_items) x(article_id uuid,quantity numeric) GROUP BY article_id)
   SELECT coalesce(o.article_id,n.article_id) article_id,coalesce(o.qty,0)-coalesce(n.qty,0) delta FROM o FULL JOIN n USING(article_id) JOIN public.articles a ON a.id=coalesce(o.article_id,n.article_id) AND a.tenant_id=p_tenant_id WHERE coalesce(o.qty,0)<>coalesce(n.qty,0) AND (a.track_stock OR EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.tenant_id=p_tenant_id AND m.article_id=a.id AND m.site_id=stock_site AND ((m.reference_type='invoice_edit' AND m.reference_id=p_sale_id) OR (m.reference_id IS NULL AND m.movement_type='sale' AND m.note IN ('Facture '||s.sale_number,'Facture '||s.sale_number||' (credit)','Facture '||s.sale_number||' (devis converti)'))))) ORDER BY 1 LOOP
    INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(p_tenant_id,rec.article_id,stock_site,0) ON CONFLICT(article_id,site_id) DO NOTHING;
    SELECT coalesce(quantity,0) INTO STRICT prior_qty FROM public.stock_levels WHERE tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=stock_site FOR UPDATE;
    next_qty:=prior_qty+rec.delta;
    IF next_qty<0 AND NOT coalesce((SELECT allow_negative_stock FROM public.sites WHERE id=stock_site AND tenant_id=p_tenant_id),false) THEN RAISE EXCEPTION 'Stock insuffisant dans le magasin de sortie.' USING ERRCODE='55000';END IF;
    UPDATE public.stock_levels SET quantity=next_qty,updated_at=now() WHERE tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=stock_site;
    INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(p_tenant_id,rec.article_id,stock_site,'adjustment',rec.delta,prior_qty,next_qty,'invoice_edit',p_sale_id,auth.uid(),'Modification facture '||s.sale_number);
   END LOOP;
  END IF;
  SELECT coalesce(jsonb_object_agg(article_id::text,purchase_cost),'{}') INTO old_costs FROM (SELECT DISTINCT ON(article_id) article_id,purchase_cost FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id ORDER BY article_id,created_at,id) q;
  DELETE FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id;
  INSERT INTO public.sale_items(tenant_id,sale_id,site_id,article_id,name,quantity,unit_price,discount,vat_rate,total,purchase_cost)
  SELECT p_tenant_id,p_sale_id,s.site_id,x.article_id,x.name,x.quantity,x.unit_price,coalesce(x.discount,0),0,round(x.quantity*x.unit_price-coalesce(x.discount,0),2),coalesce((old_costs->>x.article_id::text)::numeric,a.purchase_price,0)
  FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric) JOIN public.articles a ON a.id=x.article_id AND a.tenant_id=p_tenant_id;
 ELSE total_new:=s.total;END IF;
 UPDATE public.sales SET total=total_new,subtotal=CASE WHEN lines_changed THEN total_new ELSE subtotal END,customer_id=p_customer_id,doc_header=coalesce(p_doc_header,doc_header),representative_id=p_representative_id,rep_commission=p_rep_commission,status=CASE WHEN NOT lines_changed THEN status WHEN coalesce(paid,0)>=total_new THEN 'paid' WHEN coalesce(paid,0)>0 THEN 'partial' ELSE 'validated' END WHERE id=p_sale_id AND tenant_id=p_tenant_id;
 IF lines_changed OR s.customer_id IS DISTINCT FROM p_customer_id THEN
  FOR cid IN SELECT DISTINCT x FROM unnest(ARRAY[s.customer_id,p_customer_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
   PERFORM 1 FROM public.customers WHERE id=cid AND tenant_id=p_tenant_id FOR UPDATE;
   UPDATE public.customers SET balance=coalesce((SELECT sum(total-paid) FROM public.sales WHERE tenant_id=p_tenant_id AND customer_id=cid AND status NOT IN ('cancelled','deleted') AND deleted_at IS NULL),0)+coalesce((SELECT sum(amount) FROM public.balance_adjustments WHERE tenant_id=p_tenant_id AND entity_id=cid AND entity_type='customer'),0) WHERE id=cid AND tenant_id=p_tenant_id;
  END LOOP;
 END IF;
 INSERT INTO public.audit_logs(tenant_id,user_id,action,module,reference_id,old_value,new_value) VALUES(p_tenant_id,auth.uid(),'invoice_edit','billing',p_sale_id,jsonb_build_object('total',s.total,'customer_id',s.customer_id,'representative_id',s.representative_id),jsonb_build_object('total',total_new,'customer_id',p_customer_id,'representative_id',p_representative_id,'lines_changed',lines_changed));
 IF p_release THEN lease_result:=public.document_edit_lease(p_tenant_id,'sale',p_sale_id::text,p_window_id,'release',p_lock_token);END IF;
 RETURN jsonb_build_object('success',true,'new_total',total_new,'version',public._invoice_edit_snapshot(p_tenant_id,p_sale_id)->>'version','lock_released',p_release AND lease_result->>'state' IS DISTINCT FROM 'held');
END $$;
REVOKE ALL ON FUNCTION public._invoice_edit_snapshot(uuid,uuid),public.load_locked_invoice_edit(uuid,uuid,uuid,uuid),public.save_locked_invoice_edit(uuid,uuid,uuid,uuid,text,jsonb,uuid,jsonb,uuid,jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.load_locked_invoice_edit(uuid,uuid,uuid,uuid),public.save_locked_invoice_edit(uuid,uuid,uuid,uuid,text,jsonb,uuid,jsonb,uuid,jsonb,boolean) TO authenticated;
DO $$ BEGIN IF to_regprocedure('public.update_sale_items_and_totals(uuid,uuid,jsonb,uuid,jsonb)') IS NOT NULL THEN EXECUTE 'REVOKE ALL ON FUNCTION public.update_sale_items_and_totals(uuid,uuid,jsonb,uuid,jsonb) FROM PUBLIC,anon,authenticated';END IF;END $$;

