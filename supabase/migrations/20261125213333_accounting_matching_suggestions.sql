-- Propositions déterministes : uniquement pièces commerciales effectivement reliées
-- et groupes complets, non lettrés et strictement équilibrés.
CREATE OR REPLACE FUNCTION public.accounting_matching_suggestions(p_tenant_id uuid,p_account_code text,p_date_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE v_party uuid; n int; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id() OR NOT public.current_user_can_manage_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant_id AND enabled_modules ? 'accounting') THEN RAISE EXCEPTION 'Module comptable non activé.' USING ERRCODE='42501'; END IF;
 IF p_date_to IS NULL OR NOT isfinite(p_date_to) THEN RAISE EXCEPTION 'Date de fin invalide.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=p_account_code AND account_type='auxiliary' AND class=4) THEN RAISE EXCEPTION 'Compte auxiliaire obligatoire.'; END IF;
 IF p_account_code LIKE '411%' THEN
  SELECT count(*),(array_agg(id))[1] INTO n,v_party FROM public.customers WHERE tenant_id=p_tenant_id AND account_code=p_account_code;
 ELSIF p_account_code LIKE '401%' THEN
  SELECT count(*),(array_agg(id))[1] INTO n,v_party FROM public.suppliers WHERE tenant_id=p_tenant_id AND account_code=p_account_code;
 ELSE RAISE EXCEPTION 'Compte client ou fournisseur obligatoire.';
 END IF;
 IF n<>1 THEN RAISE EXCEPTION 'Compte non associé à un tiers unique.'; END IF;
 WITH linked AS MATERIALIZED (
 SELECT l.id,e.entry_date,e.entry_number,e.source_type,l.debit,l.credit,l.third_party_id,
 CASE WHEN e.source_type='sale' THEN s.id WHEN e.source_type='payment' THEN p.sale_id WHEN e.source_type='sale_return' THEN r.sale_id WHEN e.source_type='purchase' THEN o.id WHEN e.source_type='supplier_payment' THEN sp.order_id END root,
 m.id IS NOT NULL AS already_matched
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 LEFT JOIN public.sales s ON e.source_type='sale' AND s.id=e.source_id AND s.tenant_id=e.tenant_id AND s.accounting_entry_id=e.id AND s.customer_id=v_party AND s.deleted_at IS NULL AND s.status IS DISTINCT FROM 'cancelled'
 LEFT JOIN public.sale_payments p ON e.source_type='payment' AND p.id=e.source_id AND p.tenant_id=e.tenant_id AND p.accounting_entry_id=e.id
 LEFT JOIN public.sale_returns r ON e.source_type='sale_return' AND r.id=e.source_id AND r.tenant_id=e.tenant_id AND r.customer_id=v_party
 LEFT JOIN public.supplier_orders o ON e.source_type='purchase' AND o.id=e.source_id AND o.tenant_id=e.tenant_id AND o.accounting_entry_id=e.id AND o.supplier_id=v_party AND o.status='received'
 LEFT JOIN public.supplier_payments sp ON e.source_type='supplier_payment' AND sp.id=e.source_id AND sp.tenant_id=e.tenant_id AND sp.accounting_entry_id=e.id AND sp.supplier_id=v_party
 LEFT JOIN public.accounting_match_lines m ON m.tenant_id=l.tenant_id AND m.line_id=l.id AND m.released_at IS NULL
 WHERE l.tenant_id=p_tenant_id AND l.account_code=p_account_code AND e.status='posted'
 AND e.entry_date<=p_date_to
 AND ((p_account_code LIKE '411%' AND e.source_type IN ('sale','payment','sale_return')) OR (p_account_code LIKE '401%' AND e.source_type IN ('purchase','supplier_payment')))
 ), proposals AS (
 SELECT root,min(entry_date) first_date,max(entry_date) last_date,sum(debit) amount,
 array_agg(id ORDER BY entry_date,entry_number,id) line_ids,
 array_agg(entry_number ORDER BY entry_date,entry_number,id) entries,
 max(entry_number) FILTER(WHERE source_type IN ('sale','purchase')) root_piece
 FROM linked WHERE root IS NOT NULL GROUP BY root
 HAVING count(*) BETWEEN 2 AND 100
 AND count(*) FILTER(WHERE source_type IN ('sale','purchase'))=1
 AND sum(debit)=sum(credit) AND sum(debit)>0
 AND NOT bool_or(already_matched)
 AND count(*) FILTER(WHERE third_party_id IS NOT NULL AND third_party_id IS DISTINCT FROM v_party)=0
 )
 SELECT jsonb_build_object('total',(SELECT count(*) FROM proposals),'rows',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.first_date,x.root),'[]'::jsonb))
 INTO v_result FROM (SELECT * FROM proposals ORDER BY first_date,root LIMIT 25) x;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.accounting_matching_suggestions(uuid,text,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_matching_suggestions(uuid,text,date) TO authenticated;

CREATE OR REPLACE FUNCTION public.match_accounting_lines(p_tenant_id uuid,p_account_code text,p_line_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 v_group uuid:=gen_random_uuid(); n int; d numeric; c numeric; party_count int; wrong_party int; v_party uuid; v_count int;
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id() OR NOT public.current_user_can_manage_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant_id AND enabled_modules ? 'accounting') THEN RAISE EXCEPTION 'Module comptable non activé.' USING ERRCODE='42501'; END IF;
 IF coalesce(cardinality(p_line_ids),0) NOT BETWEEN 2 AND 100 OR (SELECT count(DISTINCT id) FROM unnest(p_line_ids) id)<>cardinality(p_line_ids) THEN
  RAISE EXCEPTION 'Sélectionnez entre 2 et 100 lignes distinctes.';
 END IF;
 PERFORM 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=p_account_code AND a.class=4 AND a.account_type='auxiliary' FOR UPDATE;
 IF NOT FOUND OR (p_account_code NOT LIKE '401%' AND p_account_code NOT LIKE '411%') THEN RAISE EXCEPTION 'Lettrage réservé aux comptes auxiliaires clients et fournisseurs.'; END IF;
 IF p_account_code LIKE '411%' THEN
  SELECT count(*),(array_agg(id))[1] INTO v_count,v_party FROM public.customers WHERE tenant_id=p_tenant_id AND account_code=p_account_code;
 ELSE
  SELECT count(*),(array_agg(id))[1] INTO v_count,v_party FROM public.suppliers WHERE tenant_id=p_tenant_id AND account_code=p_account_code;
 END IF;
 IF v_count<>1 THEN RAISE EXCEPTION 'Compte auxiliaire non associé à un tiers unique.'; END IF;
 -- Verrouiller les écritures parentes avant les lignes pour stabiliser leur statut.
 PERFORM 1 FROM public.journal_entries e WHERE e.tenant_id=p_tenant_id AND e.id IN (SELECT l.entry_id FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.id=ANY(p_line_ids)) ORDER BY e.id FOR UPDATE;
 PERFORM 1 FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.id=ANY(p_line_ids) ORDER BY l.id FOR UPDATE;
 SELECT count(*),coalesce(sum(l.debit),0),coalesce(sum(l.credit),0),count(DISTINCT l.third_party_id),count(*) FILTER(WHERE l.third_party_id IS NOT NULL AND l.third_party_id IS DISTINCT FROM v_party)
 INTO n,d,c,party_count,wrong_party
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND l.account_code=p_account_code AND l.id=ANY(p_line_ids) AND e.status='posted';
 IF n<>cardinality(p_line_ids) OR party_count>1 OR wrong_party>0 THEN RAISE EXCEPTION 'Sélection incohérente : compte, tiers ou écriture non validée.'; END IF;
 IF d<=0 OR d IS DISTINCT FROM c OR d IN ('NaN'::numeric,'Infinity'::numeric) THEN RAISE EXCEPTION 'Lettrage refusé : les débits et crédits doivent être strictement égaux.'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_match_lines m WHERE m.tenant_id=p_tenant_id AND m.line_id=ANY(p_line_ids) AND m.released_at IS NULL) THEN RAISE EXCEPTION 'Une des lignes est déjà lettrée.'; END IF;
 INSERT INTO public.accounting_match_lines(tenant_id,line_id,group_id,account_code,matched_by)
 SELECT p_tenant_id,id,v_group,p_account_code,auth.uid() FROM unnest(p_line_ids) id;
 RETURN jsonb_build_object('success',true,'group_id',v_group,'lines',n,'amount',d);
END;
$fn$;
REVOKE ALL ON FUNCTION public.match_accounting_lines(uuid,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.match_accounting_lines(uuid,text,uuid[]) TO authenticated;
