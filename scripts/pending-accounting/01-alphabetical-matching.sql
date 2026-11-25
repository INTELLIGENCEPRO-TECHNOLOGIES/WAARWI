-- Lot en attente de publication. Ne pas appliquer avant autorisation.
-- Codes stables par compte, y compris les groupes délettrés.
CREATE OR REPLACE FUNCTION public._accounting_alpha_code(p_number bigint) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE n bigint:=p_number; result text:='';
BEGIN
 IF n<=0 THEN RAISE EXCEPTION 'Séquence invalide.'; END IF;
 WHILE n>0 LOOP
  n:=n-1;
  result:=chr(65+(n%26)::integer)||result;
  n:=n/26;
 END LOOP;
 RETURN result;
END;
$fn$;
REVOKE ALL ON FUNCTION public._accounting_alpha_code(bigint) FROM PUBLIC,anon,authenticated;
CREATE TABLE public.accounting_match_groups(
 group_id uuid PRIMARY KEY,
 id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 account_code text NOT NULL,
 sequence_no bigint NOT NULL CHECK(sequence_no>0),
 code text NOT NULL CHECK(code ~ '^[A-Z]+$'),
 UNIQUE(tenant_id,account_code,sequence_no),
 UNIQUE(tenant_id,account_code,group_id)
);
ALTER TABLE public.accounting_match_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_match_groups FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_match_groups TO authenticated;
CREATE POLICY accounting_match_groups_read ON public.accounting_match_groups FOR SELECT TO authenticated
 USING(tenant_id=(SELECT public.current_tenant_id()) AND (SELECT public.current_user_can_view_accounting()));
-- Verrouiller les écritures de lettrage pendant l'attribution historique.
LOCK TABLE public.accounting_match_lines IN SHARE ROW EXCLUSIVE MODE;
WITH groups AS (
 SELECT tenant_id,account_code,group_id,min(matched_at) AS first_at
 FROM public.accounting_match_lines GROUP BY tenant_id,account_code,group_id
), numbered AS (
 SELECT *,row_number() OVER(PARTITION BY tenant_id,account_code ORDER BY first_at,group_id) AS seq FROM groups
)
INSERT INTO public.accounting_match_groups(tenant_id,account_code,group_id,sequence_no,code)
SELECT tenant_id,account_code,group_id,seq,public._accounting_alpha_code(seq) FROM numbered;
ALTER TABLE public.accounting_match_lines ADD CONSTRAINT fk_accounting_match_group
 FOREIGN KEY(tenant_id,account_code,group_id) REFERENCES public.accounting_match_groups(tenant_id,account_code,group_id);
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES ('public','accounting_match_groups','direct','tenant_id','operation',69,'delete',false);
-- Les groupes restent stockés même après délettrage pour éviter la réutilisation des codes.
-- Compatibilité des sauvegardes prises avant cette migration : lorsque les
-- lignes de lettrage sont restaurées sans table de groupes, recréer le groupe.
-- Les sauvegardes récentes restaurent les groupes (ordre 69) avant les lignes (71).
CREATE OR REPLACE FUNCTION public._ensure_accounting_match_group() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.accounting_match_groups g WHERE g.tenant_id=NEW.tenant_id AND g.account_code=NEW.account_code AND g.group_id=NEW.group_id) THEN
  PERFORM 1 FROM public.accounts a WHERE a.tenant_id=NEW.tenant_id AND a.code=NEW.account_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Compte de lettrage introuvable.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.accounting_match_groups g WHERE g.tenant_id=NEW.tenant_id AND g.account_code=NEW.account_code AND g.group_id=NEW.group_id) THEN
   INSERT INTO public.accounting_match_groups(tenant_id,account_code,group_id,sequence_no,code)
   SELECT NEW.tenant_id,NEW.account_code,NEW.group_id,coalesce(max(sequence_no),0)+1,public._accounting_alpha_code(coalesce(max(sequence_no),0)+1)
   FROM public.accounting_match_groups WHERE tenant_id=NEW.tenant_id AND account_code=NEW.account_code;
  END IF;
 END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public._ensure_accounting_match_group() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER ensure_accounting_match_group BEFORE INSERT ON public.accounting_match_lines FOR EACH ROW EXECUTE FUNCTION public._ensure_accounting_match_group();


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
 INSERT INTO public.accounting_match_groups(tenant_id,account_code,group_id,sequence_no,code)
 SELECT p_tenant_id,p_account_code,v_group,coalesce(max(sequence_no),0)+1,public._accounting_alpha_code(coalesce(max(sequence_no),0)+1)
 FROM public.accounting_match_groups WHERE tenant_id=p_tenant_id AND account_code=p_account_code;
 INSERT INTO public.accounting_match_lines(tenant_id,line_id,group_id,account_code,matched_by)
 SELECT p_tenant_id,id,v_group,p_account_code,auth.uid() FROM unnest(p_line_ids) id;
 RETURN jsonb_build_object('success',true,'group_id',v_group,'lines',n,'amount',d,'match_code',(SELECT code FROM public.accounting_match_groups WHERE group_id=v_group));
END;
$fn$;
REVOKE ALL ON FUNCTION public.match_accounting_lines(uuid,text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.match_accounting_lines(uuid,text,uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.accounting_account_statement(
 p_tenant_id uuid,p_account_code text,p_date_from date,p_date_to date,p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v_account record; v_result jsonb;
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF p_date_from IS NULL OR p_date_to IS NULL OR NOT isfinite(p_date_from) OR NOT isfinite(p_date_to)
 OR p_date_from>p_date_to OR p_date_to-p_date_from>366 OR p_offset IS NULL OR p_offset<0 THEN
  RAISE EXCEPTION 'Choisissez une période de 367 jours au maximum.' USING ERRCODE='22023';
 END IF;
 -- RLS des comptes et journaux impose le tenant courant et view_accounting.
 SELECT a.code,a.name,a.account_type,a.is_active INTO v_account FROM public.accounts a
 WHERE a.tenant_id=p_tenant_id AND a.code=p_account_code;
 IF NOT FOUND THEN RAISE EXCEPTION 'Compte inaccessible ou introuvable.' USING ERRCODE='42501'; END IF;
 WITH history AS MATERIALIZED (
 SELECT l.id AS line_id,e.id AS entry_id,e.entry_date,e.entry_number,e.journal_type,e.reference,e.description,
 e.source_type,e.source_id,e.status,l.label,m.group_id AS match_group_id,g.code AS match_code,coalesce(l.debit,0) AS debit,coalesce(l.credit,0) AS credit
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 LEFT JOIN public.accounting_match_lines m ON m.tenant_id=l.tenant_id AND m.line_id=l.id AND m.released_at IS NULL
 LEFT JOIN public.accounting_match_groups g ON g.tenant_id=m.tenant_id AND g.group_id=m.group_id AND g.account_code=m.account_code
 WHERE l.tenant_id=p_tenant_id AND l.account_code=v_account.code AND e.status='posted' AND e.entry_date<=p_date_to
 ), opening AS (
 SELECT coalesce(sum(debit-credit),0) AS balance FROM history WHERE entry_date<p_date_from
 ), movements AS MATERIALIZED (
 SELECT h.*,o.balance+sum(h.debit-h.credit) OVER(ORDER BY h.entry_date,h.entry_number,h.line_id ROWS UNBOUNDED PRECEDING) AS running_balance
 FROM history h CROSS JOIN opening o WHERE h.entry_date>=p_date_from
 ), totals AS (
 SELECT count(*) AS row_count,coalesce(sum(debit),0) AS debit,coalesce(sum(credit),0) AS credit FROM movements
 )
 SELECT jsonb_build_object('account',to_jsonb(v_account),'opening_balance',o.balance,'total_debit',t.debit,
 'total_credit',t.credit,'closing_balance',o.balance+t.debit-t.credit,'row_count',t.row_count,
 'rows',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.entry_date,r.entry_number,r.line_id),'[]'::jsonb)
 FROM (SELECT * FROM movements ORDER BY entry_date,entry_number,line_id LIMIT 50 OFFSET p_offset) r))
 INTO v_result FROM opening o CROSS JOIN totals t;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.accounting_account_statement(uuid,text,date,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_account_statement(uuid,text,date,date,integer) TO authenticated;
