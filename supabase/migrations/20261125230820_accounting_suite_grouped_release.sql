SET LOCAL lock_timeout='8s';

-- 01-alphabetical-matching.sql
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


-- 02-manual-entry-reversal.sql
-- Lot en attente de publication. Extourne des écritures manuelles validées.
-- Les pièces commerciales nécessitent un avoir/une correction du document source.
-- Pas de modification du statut ni des lignes originales.
CREATE UNIQUE INDEX uq_accounting_manual_reversal ON public.journal_entries(tenant_id,source_id)
 WHERE source_type='reversal' AND source_id IS NOT NULL;
ALTER TABLE public.journal_entries ADD COLUMN reversal_reason text;

CREATE OR REPLACE FUNCTION public.reverse_manual_accounting_entry(
 p_tenant_id uuid,p_entry_id uuid,p_date date,p_reason text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE
 o public.journal_entries%ROWTYPE;
 prev public.journal_entries%ROWTYPE;
 v_id uuid; v_piece text; v_d numeric; v_c numeric; v_count int;
 v_reason text:=nullif(btrim(p_reason),'');
BEGIN
 IF auth.uid() IS NULL OR p_tenant_id IS NULL OR p_tenant_id IS DISTINCT FROM public.current_tenant_id() OR NOT public.current_user_can_manage_accounting() THEN
  RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tenants t WHERE t.id=p_tenant_id AND t.enabled_modules ? 'accounting') THEN RAISE EXCEPTION 'Module comptable non activé.' USING ERRCODE='42501'; END IF;
 IF v_reason IS NULL OR length(v_reason)>500 THEN RAISE EXCEPTION 'Motif d’extourne obligatoire (500 caractères maximum).'; END IF;
 SELECT * INTO o FROM public.journal_entries e WHERE e.tenant_id=p_tenant_id AND e.id=p_entry_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Écriture introuvable.'; END IF;
 IF o.source_type IS DISTINCT FROM 'manual' OR o.status IS DISTINCT FROM 'posted' THEN
  RAISE EXCEPTION 'Extourne réservée aux écritures manuelles validées. Corrigez les pièces commerciales depuis leur module d’origine.';
 END IF;
 IF p_date IS NULL OR NOT isfinite(p_date) OR p_date<o.entry_date OR p_date>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Date d’extourne invalide : elle doit être comprise entre la date d’origine et aujourd’hui.'; END IF;
 IF extract(year FROM p_date)<>extract(year FROM CURRENT_DATE) THEN RAISE EXCEPTION 'Choisissez une date dans l’exercice courant : numérotation des exercices antérieurs non disponible.'; END IF;
 SELECT * INTO prev FROM public.journal_entries WHERE tenant_id=p_tenant_id AND source_type='reversal' AND source_id=o.id;
 IF FOUND THEN
  IF prev.status='posted' AND prev.entry_date=p_date AND prev.reversal_reason=v_reason THEN
   RETURN jsonb_build_object('success',true,'entry_id',prev.id,'piece_number',prev.entry_number,'already_reversed',true);
  END IF;
  RAISE EXCEPTION 'Cette écriture possède déjà une extourne : %.',prev.entry_number;
 END IF;
 -- Les opérations de lettrage verrouillent également l'écriture parente avant ses lignes.
 PERFORM 1 FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.entry_id=o.id ORDER BY l.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.journal_lines l JOIN public.accounting_match_lines m ON m.tenant_id=l.tenant_id AND m.line_id=l.id AND m.released_at IS NULL WHERE l.tenant_id=p_tenant_id AND l.entry_id=o.id) THEN
  RAISE EXCEPTION 'Délettrez les lignes de cette écriture avant de l’extourner.';
 END IF;
 SELECT count(*),coalesce(sum(debit),0),coalesce(sum(credit),0) INTO v_count,v_d,v_c FROM public.journal_lines WHERE tenant_id=p_tenant_id AND entry_id=o.id;
 IF v_count<2 OR v_d<=0 OR v_d IS DISTINCT FROM v_c OR v_d IS DISTINCT FROM o.total_debit OR v_c IS DISTINCT FROM o.total_credit OR v_d IN ('NaN'::numeric,'Infinity'::numeric) THEN
  RAISE EXCEPTION 'L’écriture d’origine doit être équilibrée et ses totaux cohérents.';
 END IF;
 PERFORM public._assert_accounting_month_open(p_tenant_id,date_trunc('month',p_date)::date);
 v_piece:=public.next_accounting_piece_number(p_tenant_id,o.journal_type);
 INSERT INTO public.journal_entries(tenant_id,entry_number,journal_type,entry_date,reference,description,total_debit,total_credit,is_balanced,source_type,source_id,status,posted_at,posted_by,reversal_reason)
 VALUES(p_tenant_id,v_piece,o.journal_type,p_date,o.entry_number,'Extourne de '||o.entry_number||' : '||v_reason,v_c,v_d,true,'reversal',o.id,'posted',now(),auth.uid(),v_reason)
 RETURNING id INTO v_id;
 INSERT INTO public.journal_lines(tenant_id,entry_id,account_code,account_name,debit,credit,label,third_party_id)
 SELECT p_tenant_id,v_id,l.account_code,l.account_name,l.credit,l.debit,'Extourne : '||coalesce(nullif(l.label,''),o.entry_number),l.third_party_id
 FROM public.journal_lines l WHERE l.tenant_id=p_tenant_id AND l.entry_id=o.id ORDER BY l.id;
 RETURN jsonb_build_object('success',true,'entry_id',v_id,'piece_number',v_piece,'original_piece',o.entry_number,'total',v_d);
END;
$fn$;
REVOKE ALL ON FUNCTION public.reverse_manual_accounting_entry(uuid,uuid,date,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reverse_manual_accounting_entry(uuid,uuid,date,text) TO authenticated;

-- Protection des écritures manuelles extournées et des contrepassations.
-- Bloque les modifications ordinaires. Aucun droit DELETE n'est accordé aux
-- utilisateurs applicatifs sur les journaux ; conserver les procédures de purge/restauration
-- administratives existantes sans introduire un contournement par paramètre de session.
CREATE OR REPLACE FUNCTION public._guard_manual_reversal_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE protected boolean;
BEGIN
 protected:=OLD.source_type='reversal' OR EXISTS(
 SELECT 1 FROM public.journal_entries r WHERE r.tenant_id=OLD.tenant_id AND r.source_type='reversal' AND r.source_id=OLD.id);
 IF protected THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Écriture extournée : modification interdite.'; END IF;
 END IF;
 RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public._guard_manual_reversal_entry() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_manual_reversal_entry BEFORE UPDATE ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public._guard_manual_reversal_entry();

-- La contrepassation est créée dans la même transaction que ses lignes.
-- Les lignes d'une extourne ne peuvent ensuite être modifiées par UPDATE.
CREATE OR REPLACE FUNCTION public._guard_manual_reversal_line() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
BEGIN
 IF EXISTS(SELECT 1 FROM public.journal_entries e WHERE e.tenant_id=OLD.tenant_id AND e.id=OLD.entry_id AND
 (e.source_type='reversal' OR EXISTS(SELECT 1 FROM public.journal_entries r WHERE r.tenant_id=e.tenant_id AND r.source_type='reversal' AND r.source_id=e.id))) THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Ligne d’une écriture extournée : modification interdite.'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$fn$;
REVOKE ALL ON FUNCTION public._guard_manual_reversal_line() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_manual_reversal_line BEFORE UPDATE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public._guard_manual_reversal_line();


-- 04-bank-reconciliation.sql
-- Lot en attente : rapprochement bancaire / mobile money, pointage 1:1.
-- Aucun mouvement de trésorerie ni écriture comptable n'est créé.
CREATE TABLE public.accounting_bank_statements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 account_code text NOT NULL, reference text NOT NULL, date_from date NOT NULL, date_to date NOT NULL,
 opening_balance numeric(18,2) NOT NULL, closing_balance numeric(18,2) NOT NULL,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','final','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), created_by uuid NOT NULL,
 finalized_at timestamptz, finalized_by uuid, final_snapshot jsonb,
 cancelled_at timestamptz,cancelled_by uuid,cancel_reason text,
 UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,account_code) REFERENCES public.accounts(tenant_id,code),
 CHECK(date_from<=date_to AND date_to-date_from<=366)
);
CREATE UNIQUE INDEX uq_bank_active_reference ON public.accounting_bank_statements(tenant_id,account_code,lower(btrim(reference))) WHERE status<>'cancelled';
CREATE UNIQUE INDEX uq_bank_one_draft ON public.accounting_bank_statements(tenant_id,account_code) WHERE status='draft';
CREATE INDEX idx_bank_statement_period ON public.accounting_bank_statements(tenant_id,account_code,date_to);
CREATE TABLE public.accounting_bank_statement_lines (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,statement_id uuid NOT NULL,
 position integer NOT NULL, operation_date date NOT NULL, reference text NOT NULL DEFAULT '',label text NOT NULL,
 amount numeric(18,2) NOT NULL CHECK(amount<>0),
 journal_line_id uuid,matched_at timestamptz,matched_by uuid,match_history jsonb NOT NULL DEFAULT '[]'::jsonb,
 FOREIGN KEY(tenant_id,statement_id) REFERENCES public.accounting_bank_statements(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,journal_line_id) REFERENCES public.journal_lines(tenant_id,id),
 UNIQUE(statement_id,position)
);
CREATE UNIQUE INDEX uq_bank_pointed_line ON public.accounting_bank_statement_lines(tenant_id,journal_line_id) WHERE journal_line_id IS NOT NULL;
ALTER TABLE public.accounting_bank_statements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.accounting_bank_statement_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_bank_statements,public.accounting_bank_statement_lines FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_bank_statements,public.accounting_bank_statement_lines TO authenticated;
CREATE POLICY bank_statements_read ON public.accounting_bank_statements FOR SELECT TO authenticated USING(tenant_id=(SELECT public.current_tenant_id()) AND (SELECT public.current_user_can_view_accounting()));
CREATE POLICY bank_lines_read ON public.accounting_bank_statement_lines FOR SELECT TO authenticated USING(tenant_id=(SELECT public.current_tenant_id()) AND (SELECT public.current_user_can_view_accounting()));
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory) VALUES
 ('public','accounting_bank_statements','direct','tenant_id','operation',72,'delete',false),
 ('public','accounting_bank_statement_lines','direct','tenant_id','operation',73,'delete',false);

CREATE OR REPLACE FUNCTION public._bank_reconciliation_access(p_tenant uuid,p_manage boolean)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
 IF auth.uid() IS NULL OR p_tenant IS NULL OR p_tenant IS DISTINCT FROM public.current_tenant_id()
 OR NOT public.current_user_can_view_accounting()
 OR (p_manage AND NOT public.current_user_can_manage_accounting())
 OR NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=p_tenant AND enabled_modules ? 'accounting')
 THEN RAISE EXCEPTION 'Accès refusé à la comptabilité.' USING ERRCODE='42501'; END IF;
END;$f$;
REVOKE ALL ON FUNCTION public._bank_reconciliation_access(uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_bank_statement(p_tenant_id uuid,p_account_code text,p_reference text,p_from date,p_to date,p_opening numeric,p_closing numeric,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE prev public.accounting_bank_statements%ROWTYPE; v_id uuid; r jsonb; idx int:=0; v_sum numeric:=0; v_amount numeric; v_date date;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 PERFORM 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=p_account_code AND class=5 AND (code LIKE '52%' OR code LIKE '53%' OR code LIKE '55%') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Choisissez un compte bancaire ou de monnaie électronique.'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR NOT isfinite(p_from) OR NOT isfinite(p_to) OR p_to<p_from OR p_to-p_from>366 OR p_to>(now() AT TIME ZONE 'Africa/Dakar')::date THEN RAISE EXCEPTION 'Période de relevé invalide.'; END IF;
 IF nullif(btrim(p_reference),'') IS NULL OR length(btrim(p_reference))>120 THEN RAISE EXCEPTION 'Référence du relevé obligatoire.'; END IF;
 IF p_opening IS NULL OR p_closing IS NULL OR p_opening IN ('NaN','Infinity','-Infinity') OR p_closing IN ('NaN','Infinity','-Infinity') OR p_opening<>round(p_opening,2) OR p_closing<>round(p_closing,2) THEN RAISE EXCEPTION 'Soldes de relevé invalides.'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Lignes de relevé invalides.'; END IF;
 IF jsonb_array_length(p_rows)>500 THEN RAISE EXCEPTION 'Maximum 500 lignes par relevé.'; END IF;
 IF EXISTS(SELECT 1 FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND account_code=p_account_code AND status='draft') THEN RAISE EXCEPTION 'Terminez ou annulez le relevé en cours.'; END IF;
 SELECT * INTO prev FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND account_code=p_account_code AND status='final' ORDER BY date_to DESC LIMIT 1;
 IF FOUND THEN
  IF p_from<>prev.date_to+1 OR p_opening IS DISTINCT FROM prev.closing_balance THEN RAISE EXCEPTION 'Le relevé doit suivre le précédent sans interruption et reprendre son solde final.'; END IF;
 ELSE
  IF p_opening IS DISTINCT FROM (SELECT coalesce(sum(coalesce(l.debit,0)-coalesce(l.credit,0)),0) FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id WHERE l.tenant_id=p_tenant_id AND l.account_code=p_account_code AND e.status='posted' AND e.entry_date<p_from) THEN RAISE EXCEPTION 'Premier relevé : le solde initial bancaire doit correspondre au solde comptable antérieur. Choisissez une date de départ déjà rapprochée.'; END IF;
 END IF;
 INSERT INTO public.accounting_bank_statements(tenant_id,account_code,reference,date_from,date_to,opening_balance,closing_balance,created_by)
 VALUES(p_tenant_id,p_account_code,btrim(p_reference),p_from,p_to,p_opening,p_closing,auth.uid()) RETURNING id INTO v_id;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  idx:=idx+1;
  IF jsonb_typeof(r->'amount') IS DISTINCT FROM 'number' OR nullif(btrim(r->>'label'),'') IS NULL OR length(r->>'label')>500 OR length(coalesce(r->>'reference',''))>120 THEN RAISE EXCEPTION 'Ligne % invalide.',idx; END IF;
  v_amount:=(r->>'amount')::numeric;v_date:=(r->>'date')::date;
  IF v_date IS NULL OR NOT isfinite(v_date) OR v_date NOT BETWEEN p_from AND p_to OR v_amount=0 OR v_amount<>round(v_amount,2) THEN RAISE EXCEPTION 'Date ou montant invalide à la ligne %.',idx; END IF;
  v_sum:=v_sum+v_amount;
  INSERT INTO public.accounting_bank_statement_lines(tenant_id,statement_id,position,operation_date,reference,label,amount)
  VALUES(p_tenant_id,v_id,idx,v_date,coalesce(r->>'reference',''),btrim(r->>'label'),v_amount);
 END LOOP;
 IF p_opening+v_sum IS DISTINCT FROM p_closing THEN RAISE EXCEPTION 'Le solde initial + les mouvements du relevé ne correspond pas au solde final.'; END IF;
 RETURN jsonb_build_object('success',true,'id',v_id);
END;$f$;
REVOKE ALL ON FUNCTION public.create_bank_statement(uuid,text,text,date,date,numeric,numeric,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_bank_statement(uuid,text,text,date,date,numeric,numeric,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.bank_statement_report(p_tenant_id uuid,p_statement_id uuid,p_offset integer DEFAULT 0)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE s public.accounting_bank_statements%ROWTYPE; anchor date; initial numeric; book numeric; pending numeric; bank_pending int; bank_pending_amount numeric; v_rows jsonb; v_count int; first_book numeric;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_offset IS NULL OR p_offset<0 THEN RAISE EXCEPTION 'Page invalide.'; END IF;
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relevé introuvable.'; END IF;
 SELECT date_from,opening_balance INTO anchor,initial FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND account_code=s.account_code AND status<>'cancelled' AND date_from<=s.date_from ORDER BY date_from LIMIT 1;
 anchor:=coalesce(anchor,s.date_from);initial:=coalesce(initial,s.opening_balance);
 SELECT coalesce(sum(coalesce(l.debit,0)-coalesce(l.credit,0)),0),coalesce(sum(coalesce(l.debit,0)-coalesce(l.credit,0)) FILTER(WHERE e.entry_date<anchor),0) INTO book,first_book
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND l.account_code=s.account_code AND e.status='posted' AND e.entry_date<=s.date_to;
 WITH unpointed AS MATERIALIZED (
 SELECT l.id,e.entry_date,e.entry_number,l.label,e.reference,l.debit,l.credit,coalesce(l.debit,0)-coalesce(l.credit,0) AS amount
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND l.account_code=s.account_code AND e.status='posted' AND e.entry_date BETWEEN anchor AND s.date_to
 AND NOT EXISTS(SELECT 1 FROM public.accounting_bank_statement_lines b JOIN public.accounting_bank_statements h ON h.tenant_id=b.tenant_id AND h.id=b.statement_id
 WHERE b.tenant_id=l.tenant_id AND b.journal_line_id=l.id AND h.status<>'cancelled' AND h.date_to<=s.date_to)
 )
 SELECT coalesce(sum(amount),0),count(*),(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date,x.entry_number,x.id),'[]'::jsonb) FROM (SELECT * FROM unpointed ORDER BY entry_date,entry_number,id LIMIT 50 OFFSET p_offset) x)
 INTO pending,v_count,v_rows FROM unpointed;
 SELECT count(*),coalesce(sum(amount),0) INTO bank_pending,bank_pending_amount FROM public.accounting_bank_statement_lines WHERE tenant_id=p_tenant_id AND statement_id=s.id AND journal_line_id IS NULL;
 RETURN jsonb_build_object('statement',to_jsonb(s),'book_balance',book,'unpointed_amount',pending,'adjusted_book',book-pending,
 'difference',book-pending-s.closing_balance,'opening_drift',first_book-initial,'bank_pending_count',bank_pending,'bank_pending_amount',bank_pending_amount,
 'book_pending_count',v_count,'book_rows',v_rows,
 'bank_rows',(SELECT coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object('matched_piece',e.entry_number,'matched_date',e.entry_date) ORDER BY b.position),'[]'::jsonb) FROM public.accounting_bank_statement_lines b LEFT JOIN public.journal_lines l ON l.tenant_id=b.tenant_id AND l.id=b.journal_line_id LEFT JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id WHERE b.tenant_id=p_tenant_id AND b.statement_id=s.id));
END;$f$;
REVOKE ALL ON FUNCTION public.bank_statement_report(uuid,uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.bank_statement_report(uuid,uuid,integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.point_bank_statement_line(p_tenant_id uuid,p_statement_id uuid,p_bank_line_id uuid,p_journal_line_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE s public.accounting_bank_statements%ROWTYPE;b public.accounting_bank_statement_lines%ROWTYPE;l public.journal_lines%ROWTYPE;e public.journal_entries%ROWTYPE;anchor date;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relevé introuvable.'; END IF;
 PERFORM 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=s.account_code FOR UPDATE;
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id FOR UPDATE;
 IF s.status<>'draft' THEN RAISE EXCEPTION 'Seul un relevé en cours est modifiable.'; END IF;
 SELECT * INTO b FROM public.accounting_bank_statement_lines WHERE tenant_id=p_tenant_id AND statement_id=s.id AND id=p_bank_line_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ligne bancaire introuvable.'; END IF;
 IF p_journal_line_id IS NULL THEN
  IF b.journal_line_id IS NULL THEN RAISE EXCEPTION 'Ligne non pointée.'; END IF;
 ELSE
  IF b.journal_line_id IS NOT NULL THEN RAISE EXCEPTION 'Ligne bancaire déjà pointée.'; END IF;
  SELECT * INTO l FROM public.journal_lines WHERE tenant_id=p_tenant_id AND id=p_journal_line_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ligne comptable introuvable.'; END IF;
  SELECT * INTO e FROM public.journal_entries WHERE tenant_id=p_tenant_id AND id=l.entry_id FOR UPDATE;
  SELECT * INTO l FROM public.journal_lines WHERE tenant_id=p_tenant_id AND id=p_journal_line_id FOR UPDATE;
  SELECT min(date_from) INTO anchor FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND account_code=s.account_code AND status<>'cancelled';
  IF l.id IS NULL OR e.id IS NULL OR l.entry_id IS DISTINCT FROM e.id OR l.account_code IS DISTINCT FROM s.account_code OR e.status IS DISTINCT FROM 'posted' OR e.entry_date IS NULL OR anchor IS NULL OR e.entry_date NOT BETWEEN anchor AND s.date_to OR coalesce(l.debit,0)-coalesce(l.credit,0) IS DISTINCT FROM b.amount THEN RAISE EXCEPTION 'Compte, date, sens ou montant non concordant.'; END IF;
  IF EXISTS(SELECT 1 FROM public.accounting_bank_statement_lines WHERE tenant_id=p_tenant_id AND journal_line_id=l.id) THEN RAISE EXCEPTION 'Écriture déjà pointée.'; END IF;
 END IF;
 UPDATE public.accounting_bank_statement_lines SET journal_line_id=p_journal_line_id,matched_at=CASE WHEN p_journal_line_id IS NULL THEN NULL ELSE now() END,matched_by=CASE WHEN p_journal_line_id IS NULL THEN NULL ELSE auth.uid() END,
 match_history=match_history||jsonb_build_array(jsonb_build_object('action',CASE WHEN p_journal_line_id IS NULL THEN 'unpoint' ELSE 'point' END,'at',now(),'by',auth.uid(),'journal_line_id',coalesce(p_journal_line_id,b.journal_line_id)))
 WHERE id=b.id AND tenant_id=p_tenant_id;
 RETURN jsonb_build_object('success',true);
END;$f$;
REVOKE ALL ON FUNCTION public.point_bank_statement_line(uuid,uuid,uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.point_bank_statement_line(uuid,uuid,uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.finish_bank_statement(p_tenant_id uuid,p_statement_id uuid,p_cancel_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE s public.accounting_bank_statements%ROWTYPE;r jsonb;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Relevé introuvable.'; END IF;
 PERFORM 1 FROM public.accounts WHERE tenant_id=p_tenant_id AND code=s.account_code FOR UPDATE;
 SELECT * INTO s FROM public.accounting_bank_statements WHERE tenant_id=p_tenant_id AND id=p_statement_id FOR UPDATE;
 IF s.status<>'draft' THEN RAISE EXCEPTION 'Seul un relevé en cours est modifiable.'; END IF;
 IF p_cancel_reason IS NOT NULL THEN
  IF nullif(btrim(p_cancel_reason),'') IS NULL OR length(p_cancel_reason)>500 THEN RAISE EXCEPTION 'Motif d’annulation obligatoire.'; END IF;
  UPDATE public.accounting_bank_statement_lines SET match_history=match_history||jsonb_build_array(jsonb_build_object('action','cancel','at',now(),'by',auth.uid(),'journal_line_id',journal_line_id)),journal_line_id=NULL,matched_at=NULL,matched_by=NULL WHERE tenant_id=p_tenant_id AND statement_id=s.id AND journal_line_id IS NOT NULL;
  UPDATE public.accounting_bank_statements SET status='cancelled',cancelled_at=now(),cancelled_by=auth.uid(),cancel_reason=btrim(p_cancel_reason) WHERE tenant_id=p_tenant_id AND id=s.id;
 ELSE
  r:=public.bank_statement_report(p_tenant_id,s.id,0);
  IF (r->>'bank_pending_count')::int<>0 OR (r->>'difference')::numeric<>0 OR (r->>'opening_drift')::numeric<>0 THEN RAISE EXCEPTION 'Rapprochement incomplet : lignes bancaires non pointées ou écart non nul.'; END IF;
  UPDATE public.accounting_bank_statements SET status='final',finalized_at=now(),finalized_by=auth.uid(),final_snapshot=r-'statement'-'bank_rows'-'book_rows' WHERE tenant_id=p_tenant_id AND id=s.id;
 END IF;
 RETURN jsonb_build_object('success',true);
END;$f$;
REVOKE ALL ON FUNCTION public.finish_bank_statement(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.finish_bank_statement(uuid,uuid,text) TO authenticated;

-- Une ligne pointée reste liée à une écriture valide et de même montant.
CREATE OR REPLACE FUNCTION public._guard_bank_pointed_line() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
 IF EXISTS(SELECT 1 FROM public.accounting_bank_statement_lines b WHERE b.tenant_id=OLD.tenant_id AND b.journal_line_id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Écriture pointée : suppression interdite.'; END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.entry_id IS DISTINCT FROM OLD.entry_id OR NEW.account_code IS DISTINCT FROM OLD.account_code OR NEW.debit IS DISTINCT FROM OLD.debit OR NEW.credit IS DISTINCT FROM OLD.credit THEN RAISE EXCEPTION 'Écriture pointée : correction interdite.'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END;$f$;
REVOKE ALL ON FUNCTION public._guard_bank_pointed_line() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_bank_pointed_line BEFORE UPDATE OR DELETE ON public.journal_lines FOR EACH ROW EXECUTE FUNCTION public._guard_bank_pointed_line();
CREATE OR REPLACE FUNCTION public._guard_bank_pointed_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
BEGIN
 IF (NEW.status IS DISTINCT FROM OLD.status OR NEW.entry_date IS DISTINCT FROM OLD.entry_date) AND EXISTS(SELECT 1 FROM public.journal_lines l JOIN public.accounting_bank_statement_lines b ON b.tenant_id=l.tenant_id AND b.journal_line_id=l.id WHERE l.tenant_id=OLD.tenant_id AND l.entry_id=OLD.id) THEN RAISE EXCEPTION 'Écriture pointée : date ou statut non modifiable.'; END IF;
 RETURN NEW;
END;$f$;
REVOKE ALL ON FUNCTION public._guard_bank_pointed_entry() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER guard_bank_pointed_entry BEFORE UPDATE OF status,entry_date ON public.journal_entries FOR EACH ROW EXECUTE FUNCTION public._guard_bank_pointed_entry();


-- 06-fiscal-year-close.sql
-- Lot en attente de publication. Exercices civils, arrêtés annuels et RAN non dupliqués.
-- Le journal demeure continu : les RAN sont des soldes d'ouverture certifiés,
-- non des mouvements supplémentaires. Les comptes de gestion repartent à zéro.
CREATE TABLE public.accounting_fiscal_years(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 fiscal_year integer NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 2099),
 closed_at timestamptz NOT NULL DEFAULT now(),closed_by uuid NOT NULL,
 note text NOT NULL CHECK(length(btrim(note)) BETWEEN 1 AND 500),
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 UNIQUE(tenant_id,fiscal_year)
);
ALTER TABLE public.accounting_fiscal_years ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_fiscal_years FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_fiscal_years TO authenticated;
CREATE POLICY fiscal_years_read ON public.accounting_fiscal_years FOR SELECT TO authenticated
 USING(tenant_id=(SELECT public.current_tenant_id()) AND (SELECT public.current_user_can_view_accounting()));
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES ('public','accounting_fiscal_years','direct','tenant_id','operation',91,'delete',false);

-- Protection en profondeur : un exercice arrêté ne peut pas être rouvert par
-- disparition d'un verrou mensuel. Le contrôle existant reste en vigueur.
CREATE OR REPLACE FUNCTION public._assert_accounting_month_open(p_tenant_id uuid,p_month_start date)
RETURNS void LANGUAGE plpgsql SET search_path=''
AS $f$
DECLARE v_closed_at timestamptz;
BEGIN
 SELECT c.closed_at INTO v_closed_at FROM public.accounting_month_closures c
 WHERE c.tenant_id=p_tenant_id AND c.month_start=p_month_start FOR SHARE;
 IF NOT FOUND THEN
  INSERT INTO public.accounting_month_closures(tenant_id,month_start) VALUES(p_tenant_id,p_month_start) ON CONFLICT(tenant_id,month_start) DO NOTHING;
  SELECT c.closed_at INTO v_closed_at FROM public.accounting_month_closures c WHERE c.tenant_id=p_tenant_id AND c.month_start=p_month_start FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'La période a changé pendant la transaction. Réessayez.' USING ERRCODE='40001'; END IF;
 END IF;
 IF v_closed_at IS NOT NULL OR EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year>=extract(year FROM p_month_start)) THEN
  RAISE EXCEPTION 'La période comptable de % est clôturée.',to_char(p_month_start,'MM/YYYY') USING ERRCODE='55000';
 END IF;
END;$f$;

-- Calcul interne commun : RAN précédent + mouvements de l'exercice.
CREATE OR REPLACE FUNCTION public._fiscal_year_snapshot(p_tenant_id uuid,p_year integer,p_profit_code text,p_loss_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE start_date date;end_date date; prior jsonb; prior_missing boolean; v_result numeric; v_entries bigint;v_inconsistent bigint;v_duplicate bigint;v_unposted bigint;v_closed int;v_months jsonb;v_rows jsonb;v_carry jsonb;v_unsupported bigint;v_missing_accounts bigint;v_debit numeric;v_credit numeric;v_carry_debit numeric;v_carry_credit numeric;v_open_debit numeric;v_open_credit numeric;v_result_account text;v_result_valid boolean;
BEGIN
 IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2099 THEN RAISE EXCEPTION 'Exercice invalide.' USING ERRCODE='22023'; END IF;
 start_date:=make_date(p_year,1,1);end_date:=make_date(p_year,12,31);
 SELECT snapshot INTO prior FROM public.accounting_fiscal_years WHERE tenant_id=p_tenant_id AND fiscal_year=p_year-1;
 prior_missing:=EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year>p_year) OR (prior IS NULL AND (EXISTS(SELECT 1 FROM public.journal_entries e WHERE e.tenant_id=p_tenant_id AND e.entry_date<start_date) OR EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year<p_year)));
 SELECT count(*) FILTER(WHERE closed_at IS NOT NULL) INTO v_closed FROM public.accounting_month_closures WHERE tenant_id=p_tenant_id AND month_start BETWEEN start_date AND end_date;
 SELECT jsonb_agg(jsonb_build_object('month',m.d::date,'closed',c.closed_at IS NOT NULL,'closed_at',c.closed_at) ORDER BY m.d) INTO v_months
 FROM generate_series(start_date::timestamp,end_date::timestamp,interval '1 month') m(d) LEFT JOIN public.accounting_month_closures c ON c.tenant_id=p_tenant_id AND c.month_start=m.d::date;
 WITH checks AS (
 SELECT e.id,e.total_debit,e.total_credit,e.is_balanced,count(l.id) n,coalesce(sum(l.debit),0) d,coalesce(sum(l.credit),0) c
 FROM public.journal_entries e LEFT JOIN public.journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
 WHERE e.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date BETWEEN start_date AND end_date GROUP BY e.id,e.total_debit,e.total_credit,e.is_balanced
 )
 SELECT count(*),count(*) FILTER(WHERE n<2 OR d<=0 OR d IN ('NaN'::numeric,'Infinity'::numeric) OR d IS DISTINCT FROM c OR d IS DISTINCT FROM total_debit OR c IS DISTINCT FROM total_credit OR is_balanced IS DISTINCT FROM true) INTO v_entries,v_inconsistent FROM checks;
 SELECT count(*) INTO v_unposted FROM public.journal_entries WHERE tenant_id=p_tenant_id AND entry_date BETWEEN start_date AND end_date AND status IS DISTINCT FROM 'posted' AND status IS DISTINCT FROM 'cancelled';
 SELECT count(*) INTO v_duplicate FROM (SELECT source_type,source_id FROM public.journal_entries WHERE tenant_id=p_tenant_id AND status='posted' AND source_id IS NOT NULL AND entry_date BETWEEN start_date AND end_date GROUP BY 1,2 HAVING count(*)>1) x;
 WITH opening AS (
 SELECT x->>'account_code' code,(x->>'balance')::numeric amount,(x->>'account_class')::int prior_class
 FROM jsonb_array_elements(coalesce(prior->'carry','[]'::jsonb)) x
 ), moves AS (
 SELECT l.account_code code,coalesce(sum(l.debit),0) debit,coalesce(sum(l.credit),0) credit
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 WHERE l.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date BETWEEN start_date AND end_date GROUP BY l.account_code
 ), combined AS (
 SELECT coalesce(o.code,m.code) account_code,a.name account_name,a.class account_class,coalesce(o.amount,0) opening,
 coalesce(m.debit,0) debit,coalesce(m.credit,0) credit,
 coalesce(o.amount,0)+coalesce(m.debit,0)-coalesce(m.credit,0) balance,
 (a.code IS NULL OR (o.prior_class IS NOT NULL AND a.class IS DISTINCT FROM o.prior_class)) inconsistent_account
 FROM opening o FULL JOIN moves m ON m.code=o.code LEFT JOIN public.accounts a ON a.tenant_id=p_tenant_id AND a.code=coalesce(o.code,m.code)
 )
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY account_code),'[]'::jsonb),
 coalesce(sum(credit-debit) FILTER(WHERE account_class BETWEEN 6 AND 8),0),
 count(*) FILTER(WHERE account_class IS NULL OR account_class NOT BETWEEN 1 AND 8),
 count(*) FILTER(WHERE inconsistent_account),
 coalesce(sum(debit),0),coalesce(sum(credit),0),
 coalesce(sum(greatest(opening,0)),0),coalesce(sum(greatest(-opening,0)),0)
 INTO v_rows,v_result,v_unsupported,v_missing_accounts,v_debit,v_credit,v_open_debit,v_open_credit FROM combined x;
 v_result_account:=CASE WHEN v_result>0 THEN p_profit_code WHEN v_result<0 THEN p_loss_code ELSE NULL END;
 v_result_valid:=v_result=0 OR EXISTS(SELECT 1 FROM public.accounts a WHERE a.tenant_id=p_tenant_id AND a.code=v_result_account AND a.class=1 AND a.is_active AND (CASE WHEN v_result>0 THEN a.code LIKE '131%' ELSE a.code LIKE '139%' END));
 WITH carry AS (
 SELECT x->>'account_code' account_code,(x->>'balance')::numeric balance FROM jsonb_array_elements(v_rows) x WHERE (x->>'account_class')::int BETWEEN 1 AND 5
 UNION ALL SELECT v_result_account,-v_result WHERE v_result<>0 AND v_result_valid
 ), grouped AS (
 SELECT c.account_code,a.name account_name,a.class account_class,sum(c.balance) balance FROM carry c JOIN public.accounts a ON a.tenant_id=p_tenant_id AND a.code=c.account_code GROUP BY c.account_code,a.name,a.class HAVING sum(c.balance)<>0
 )
 SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY account_code),'[]'::jsonb),coalesce(sum(greatest(balance,0)),0),coalesce(sum(greatest(-balance,0)),0) INTO v_carry,v_carry_debit,v_carry_credit FROM grouped x;
 RETURN jsonb_build_object('year',p_year,'date_from',start_date,'date_to',end_date,'closed_months',v_closed,'months',v_months,'entries',v_entries,
 'prior_missing',prior_missing,'inconsistent_entries',v_inconsistent,'duplicate_sources',v_duplicate,'unposted_entries',v_unposted,
 'unsupported_accounts',v_unsupported,'inconsistent_accounts',v_missing_accounts,'result_account_valid',v_result_valid,'profit_code',p_profit_code,'loss_code',p_loss_code,
 'result_account',v_result_account,'result',v_result,'movement_debit',v_debit,'movement_credit',v_credit,'opening_debit',v_open_debit,'opening_credit',v_open_credit,
 'carry_debit',v_carry_debit,'carry_credit',v_carry_credit,'rows',v_rows,'carry',v_carry,
 'blocked',prior_missing OR v_closed<>12 OR v_inconsistent>0 OR v_duplicate>0 OR v_unposted>0 OR v_unsupported>0 OR v_missing_accounts>0 OR NOT v_result_valid OR v_debit<>v_credit OR v_open_debit<>v_open_credit OR v_carry_debit<>v_carry_credit OR end_date>=(now() AT TIME ZONE 'Africa/Dakar')::date);
END;$f$;
REVOKE ALL ON FUNCTION public._fiscal_year_snapshot(uuid,integer,text,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.preview_fiscal_year(p_tenant_id uuid,p_year integer,p_profit_code text DEFAULT '1310000',p_loss_code text DEFAULT '1390000')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v jsonb; f public.accounting_fiscal_years%ROWTYPE;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 SELECT * INTO f FROM public.accounting_fiscal_years WHERE tenant_id=p_tenant_id AND fiscal_year=p_year;
 IF FOUND THEN RETURN jsonb_build_object('closed',true,'closed_at',f.closed_at,'note',f.note,'snapshot',f.snapshot); END IF;
 v:=public._fiscal_year_snapshot(p_tenant_id,p_year,p_profit_code,p_loss_code);
 RETURN jsonb_build_object('closed',false,'snapshot',v,'review_token',md5(v::text));
END;$f$;
REVOKE ALL ON FUNCTION public.preview_fiscal_year(uuid,integer,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.preview_fiscal_year(uuid,integer,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_fiscal_year(p_tenant_id uuid,p_year integer,p_profit_code text,p_loss_code text,p_review_token text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v jsonb; f public.accounting_fiscal_years%ROWTYPE;start_date date;end_date date;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2099 THEN RAISE EXCEPTION 'Exercice invalide.'; END IF;
 IF nullif(btrim(p_note),'') IS NULL OR length(btrim(p_note))>500 THEN RAISE EXCEPTION 'Note de clôture obligatoire (500 caractères maximum).'; END IF;
 IF current_setting('transaction_isolation')<>'read committed' THEN RAISE EXCEPTION 'Relancez la clôture dans une nouvelle transaction.' USING ERRCODE='40001'; END IF;
 start_date:=make_date(p_year,1,1);end_date:=make_date(p_year,12,31);
 -- Sérialiser les clôtures annuelles par tenant, puis verrouiller les mois.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':fiscal-close',0));
 SELECT * INTO f FROM public.accounting_fiscal_years WHERE tenant_id=p_tenant_id AND fiscal_year=p_year;
 IF FOUND THEN RETURN jsonb_build_object('success',true,'already_closed',true,'snapshot',f.snapshot,'closed_at',f.closed_at); END IF;
 PERFORM 1 FROM public.accounting_month_closures WHERE tenant_id=p_tenant_id AND month_start BETWEEN start_date AND end_date ORDER BY month_start FOR UPDATE;
 v:=public._fiscal_year_snapshot(p_tenant_id,p_year,p_profit_code,p_loss_code);
 IF (v->>'blocked')::boolean THEN RAISE EXCEPTION 'Clôture refusée : exercice non terminé, mois ouverts ou contrôles non satisfaits.' USING ERRCODE='55000'; END IF;
 IF p_review_token IS DISTINCT FROM md5(v::text) THEN RAISE EXCEPTION 'Les contrôles ont changé : actualisez l’arrêté.' USING ERRCODE='55000'; END IF;
 INSERT INTO public.accounting_fiscal_years(tenant_id,fiscal_year,closed_by,note,snapshot) VALUES(p_tenant_id,p_year,auth.uid(),btrim(p_note),v) RETURNING * INTO f;
 RETURN jsonb_build_object('success',true,'closed_at',f.closed_at,'snapshot',v);
END;$f$;
REVOKE ALL ON FUNCTION public.close_fiscal_year(uuid,integer,text,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_fiscal_year(uuid,integer,text,text,text,text) TO authenticated;

-- Intégration des soldes d'ouverture dans l'interrogation par exercice.
CREATE OR REPLACE FUNCTION public.accounting_account_statement(
 p_tenant_id uuid,p_account_code text,p_date_from date,p_date_to date,p_offset integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=''
AS $fn$
DECLARE v_account record; v_result jsonb; v_prior jsonb; v_year_start date; v_carry numeric:=0; v_mode text:='continuous';
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
 v_year_start:=date_trunc('year',p_date_from)::date;
 IF extract(year FROM p_date_from)=extract(year FROM p_date_to) THEN
  SELECT f.snapshot INTO v_prior FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year=extract(year FROM p_date_from)-1;
  IF v_prior IS NOT NULL THEN
   SELECT coalesce(sum((x->>'balance')::numeric),0) INTO v_carry FROM jsonb_array_elements(v_prior->'carry') x WHERE x->>'account_code'=p_account_code;
   v_mode:='fiscal';
  END IF;
 ELSIF EXISTS(SELECT 1 FROM public.accounting_fiscal_years f WHERE f.tenant_id=p_tenant_id AND f.fiscal_year BETWEEN extract(year FROM p_date_from)-1 AND extract(year FROM p_date_to)-1) THEN
  RAISE EXCEPTION 'Sélectionnez une période dans un seul exercice pour consulter les reports certifiés.' USING ERRCODE='22023';
 END IF;
 WITH history AS MATERIALIZED (
 SELECT l.id AS line_id,e.id AS entry_id,e.entry_date,e.entry_number,e.journal_type,e.reference,e.description,
 e.source_type,e.source_id,e.status,l.label,m.group_id AS match_group_id,g.code AS match_code,coalesce(l.debit,0) AS debit,coalesce(l.credit,0) AS credit
 FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
 LEFT JOIN public.accounting_match_lines m ON m.tenant_id=l.tenant_id AND m.line_id=l.id AND m.released_at IS NULL
 LEFT JOIN public.accounting_match_groups g ON g.tenant_id=m.tenant_id AND g.group_id=m.group_id AND g.account_code=m.account_code
 WHERE l.tenant_id=p_tenant_id AND l.account_code=v_account.code AND e.status='posted' AND e.entry_date<=p_date_to AND (v_mode='continuous' OR e.entry_date>=v_year_start)
 ), opening AS (
 SELECT v_carry+coalesce(sum(debit-credit),0) AS balance FROM history WHERE entry_date<p_date_from
 ), movements AS MATERIALIZED (
 SELECT h.*,o.balance+sum(h.debit-h.credit) OVER(ORDER BY h.entry_date,h.entry_number,h.line_id ROWS UNBOUNDED PRECEDING) AS running_balance
 FROM history h CROSS JOIN opening o WHERE h.entry_date>=p_date_from
 ), totals AS (
 SELECT count(*) AS row_count,coalesce(sum(debit),0) AS debit,coalesce(sum(credit),0) AS credit FROM movements
 )
 SELECT jsonb_build_object('account',to_jsonb(v_account),'opening_mode',v_mode,'opening_balance',o.balance,'total_debit',t.debit,
 'total_credit',t.credit,'closing_balance',o.balance+t.debit-t.credit,'row_count',t.row_count,
 'rows',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.entry_date,r.entry_number,r.line_id),'[]'::jsonb)
 FROM (SELECT * FROM movements ORDER BY entry_date,entry_number,line_id LIMIT 50 OFFSET p_offset) r))
 INTO v_result FROM opening o CROSS JOIN totals t;
 RETURN v_result;
END;
$fn$;
REVOKE ALL ON FUNCTION public.accounting_account_statement(uuid,text,date,date,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_account_statement(uuid,text,date,date,integer) TO authenticated;


-- 08-financial-cash-flow-working.sql
-- Lot en attente. Analyse directe des flux, préparatoire au tableau SYSCOHADA.
-- Aucune affectation automatique des écritures à contreparties ambiguës.
CREATE OR REPLACE FUNCTION public.accounting_cash_flow_working(p_tenant_id uuid,p_year integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=''
AS $f$
DECLARE v_from date;v_to date;v_opening numeric;v_closing numeric;v_prior jsonb;v_prior_missing boolean;v_data jsonb;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,false);
 IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2099 THEN RAISE EXCEPTION 'Exercice invalide.' USING ERRCODE='22023';END IF;
 v_from:=make_date(p_year,1,1);v_to:=make_date(p_year,12,31);
 SELECT snapshot INTO v_prior FROM public.accounting_fiscal_years WHERE tenant_id=p_tenant_id AND fiscal_year=p_year-1;
 v_prior_missing:=v_prior IS NULL AND EXISTS(SELECT 1 FROM public.journal_entries WHERE tenant_id=p_tenant_id AND entry_date<v_from AND status='posted');
 IF v_prior IS NOT NULL THEN
  SELECT coalesce(sum((x->>'balance')::numeric),0) INTO v_opening FROM jsonb_array_elements(v_prior->'carry') x WHERE (x->>'account_class')::int=5 AND x->>'account_code' ~ '^5[1234567]';
 ELSE
  SELECT coalesce(sum(l.debit-l.credit),0) INTO v_opening FROM public.journal_lines l JOIN public.journal_entries e ON e.tenant_id=l.tenant_id AND e.id=l.entry_id
  WHERE l.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date<v_from AND l.account_code ~ '^5[1234567]';
 END IF;
 WITH base AS MATERIALIZED (
  SELECT e.id,e.entry_date,e.entry_number,e.description,l.account_code,coalesce(l.debit,0)-coalesce(l.credit,0) delta,
  CASE WHEN l.account_code ~ '^5[1234567]' THEN 'cash'
   WHEN l.account_code ~ '^(2[0-7]|48[15])' THEN 'investment'
   WHEN l.account_code ~ '^(10|16|17|18)' THEN 'financing'
   WHEN l.account_code ~ '^(40|41|42|43|44|60|61|62|63|64|65|66|70|71|72|73|74|75)' THEN 'operating'
   ELSE 'unknown' END category
  FROM public.journal_entries e JOIN public.journal_lines l ON l.tenant_id=e.tenant_id AND l.entry_id=e.id
  WHERE e.tenant_id=p_tenant_id AND e.status='posted' AND e.entry_date BETWEEN v_from AND v_to
 ), grouped AS (
  SELECT id,entry_date,entry_number,description,coalesce(sum(delta) FILTER(WHERE category='cash'),0) amount,
  count(*) FILTER(WHERE category='cash') cash_count,
  count(DISTINCT category) FILTER(WHERE category<>'cash' AND delta<>0) categories,
  max(category) FILTER(WHERE category<>'cash' AND delta<>0) counterparty,
  coalesce(sum(delta),0) check_net
  FROM base GROUP BY id,entry_date,entry_number,description
 ), classified AS MATERIALIZED (
  SELECT id,entry_date,entry_number,description,amount,
   CASE WHEN check_net<>0 THEN 'unknown' WHEN amount=0 THEN 'internal_or_zero'
    WHEN categories=1 AND counterparty IN ('operating','investment','financing') THEN counterparty ELSE 'unknown' END category
  FROM grouped WHERE cash_count>0
 ), total AS (
  SELECT coalesce(sum(amount) FILTER(WHERE category='operating'),0) operating,
  coalesce(sum(amount) FILTER(WHERE category='investment'),0) investment,
  coalesce(sum(amount) FILTER(WHERE category='financing'),0) financing,
  coalesce(sum(amount) FILTER(WHERE category='unknown'),0) unknown,
  count(*) FILTER(WHERE category='unknown') unknown_count,
  coalesce(sum(amount),0) variation
  FROM classified
 )
 SELECT jsonb_build_object('opening',v_opening,'closing',v_opening+t.variation,'variation',t.variation,
 'operating',t.operating,'investment',t.investment,'financing',t.financing,'unknown',t.unknown,'unknown_count',t.unknown_count,
 'prior_missing',v_prior_missing,'unknown_rows',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.entry_date,x.entry_number,x.id),'[]'::jsonb) FROM(SELECT * FROM classified WHERE category='unknown' ORDER BY entry_date,entry_number,id LIMIT 100)x))
 INTO v_data FROM total t;
 RETURN v_data;
END;$f$;
REVOKE ALL ON FUNCTION public.accounting_cash_flow_working(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.accounting_cash_flow_working(uuid,integer) TO authenticated;


-- 09-financial-workpapers.sql
-- Lot en attente : dossier de préparation des états financiers, pas une certification.
CREATE TABLE public.accounting_financial_workpapers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
 fiscal_year integer NOT NULL CHECK(fiscal_year BETWEEN 2000 AND 2099),
 flow_inputs jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(flow_inputs)='object'),
 flow_justifications jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(flow_justifications)='object'),
 annexes jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(annexes)='object'),
 revision bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid NOT NULL,
 UNIQUE(tenant_id,fiscal_year)
);
ALTER TABLE public.accounting_financial_workpapers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_financial_workpapers FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.accounting_financial_workpapers TO authenticated;
CREATE POLICY financial_workpapers_read ON public.accounting_financial_workpapers FOR SELECT TO authenticated USING(tenant_id=(SELECT public.current_tenant_id()) AND (SELECT public.current_user_can_view_accounting()));
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES('public','accounting_financial_workpapers','direct','tenant_id','operation',92,'delete',false);
CREATE OR REPLACE FUNCTION public.save_financial_workpaper(p_tenant_id uuid,p_year integer,p_expected_revision bigint,p_inputs jsonb,p_justifications jsonb,p_annexes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $f$
DECLARE old_row public.accounting_financial_workpapers%ROWTYPE;r record;v_amount numeric;new_revision bigint;
BEGIN
 PERFORM public._bank_reconciliation_access(p_tenant_id,true);
 IF p_year IS NULL OR p_year NOT BETWEEN 2000 AND 2099 OR p_expected_revision IS NULL OR p_expected_revision<0 THEN RAISE EXCEPTION 'Exercice ou version invalide.';END IF;
 IF jsonb_typeof(p_inputs) IS DISTINCT FROM 'object' OR jsonb_typeof(p_justifications) IS DISTINCT FROM 'object' OR jsonb_typeof(p_annexes) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Dossier invalide.';END IF;
 FOR r IN SELECT * FROM jsonb_each(p_inputs) LOOP
  IF r.key NOT IN ('FA','FB','FC','FD','FE','FF','FG','FH','FI','FJ','FK','FL','FM','FN','FO','FP','FQ') OR jsonb_typeof(r.value)<>'number' THEN RAISE EXCEPTION 'Rubrique de flux invalide.';END IF;
  v_amount:=(r.value#>>'{}')::numeric;
  IF abs(v_amount)>90071992547409 OR v_amount<>round(v_amount,2) THEN RAISE EXCEPTION 'Montant hors limites.';END IF;
  IF (r.key IN ('FF','FG','FH','FM','FN','FQ') AND v_amount>0) OR (r.key IN ('FI','FJ','FK','FL','FO','FP') AND v_amount<0) THEN RAISE EXCEPTION 'Sens du flux invalide : %.',r.key;END IF;
  IF nullif(btrim(p_justifications->>r.key),'') IS NULL THEN RAISE EXCEPTION 'Justification obligatoire : %.',r.key;END IF;
 END LOOP;
 FOR r IN SELECT * FROM jsonb_each(p_justifications) LOOP
  IF NOT (p_inputs ? r.key) OR jsonb_typeof(r.value)<>'string' OR length(r.value#>>'{}')>1000 THEN RAISE EXCEPTION 'Justification invalide.';END IF;
 END LOOP;
 FOR r IN SELECT * FROM jsonb_each(p_annexes) LOOP
  IF r.key NOT IN ('methods','inventory','assets','receivables','debts','equity','commitments','tax','events','other') OR jsonb_typeof(r.value)<>'string' OR length(r.value#>>'{}')>10000 THEN RAISE EXCEPTION 'Note annexe invalide.';END IF;
 END LOOP;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':financial-workpaper:'||p_year::text,0));
 SELECT * INTO old_row FROM public.accounting_financial_workpapers WHERE tenant_id=p_tenant_id AND fiscal_year=p_year FOR UPDATE;
 IF coalesce(old_row.revision,0)<>p_expected_revision THEN RAISE EXCEPTION 'Le dossier a été modifié. Actualisez avant de sauvegarder.' USING ERRCODE='40001';END IF;
 INSERT INTO public.accounting_financial_workpapers(tenant_id,fiscal_year,flow_inputs,flow_justifications,annexes,updated_by)
 VALUES(p_tenant_id,p_year,p_inputs,p_justifications,p_annexes,auth.uid())
 ON CONFLICT(tenant_id,fiscal_year) DO UPDATE SET flow_inputs=excluded.flow_inputs,flow_justifications=excluded.flow_justifications,annexes=excluded.annexes,updated_at=now(),updated_by=auth.uid(),revision=public.accounting_financial_workpapers.revision+1
 RETURNING revision INTO new_revision;
 RETURN jsonb_build_object('success',true,'revision',new_revision);
END;$f$;
REVOKE ALL ON FUNCTION public.save_financial_workpaper(uuid,integer,bigint,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_financial_workpaper(uuid,integer,bigint,jsonb,jsonb,jsonb) TO authenticated;


-- 11-backup-registry.sql
-- Register accounting locks, preserving platform subscription history.
ALTER TABLE public.accounting_month_closures ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory,exclusion_reason) VALUES
 ('public','accounting_month_closures','direct','tenant_id','operation',95,'delete',false,NULL),
 ('public','tenant_subscription_payments','excluded','tenant_id','platform',0,'preserve',false,'Platform-managed payment records; not tenant operational data.');
CREATE OR REPLACE FUNCTION public.br_restore_backup(p_backup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_backup record;
v_preflight jsonb;
v_safety_result jsonb;
v_safety_backup_id uuid;
v_rec record;
v_table_data jsonb;
v_inserted_counts jsonb := '{}'::jsonb;
v_deleted_counts jsonb := '{}'::jsonb;
v_count integer;
v_lock_key bigint;
v_col text;
v_nulled_data jsonb;
v_elem jsonb;
v_all_deferred text[];
v_insert_cols text[];
v_col_list text;
v_payload_keys text[];
v_dropped_indexes text[] := '{}';
v_idx record;
BEGIN
PERFORM public._br_assert_destructive_available();
SELECT p.tenant_id INTO v_tenant_id FROM profiles p WHERE p.id = auth.uid();
IF v_tenant_id IS NULL THEN
RAISE EXCEPTION 'BR-001: No tenant context for current user';
END IF;

v_lock_key := ('x' || left(replace(v_tenant_id::text, '-', ''), 15))::bit(64)::bigint;
IF NOT pg_try_advisory_xact_lock(v_lock_key) THEN
RAISE EXCEPTION 'BR-010: Another backup/restore operation is in progress for this tenant';
END IF;

SELECT * INTO v_backup FROM tenant_backups WHERE id = p_backup_id;
IF NOT FOUND THEN
RAISE EXCEPTION 'BR-003: Backup % does not exist', p_backup_id;
END IF;
IF v_backup.tenant_id != v_tenant_id THEN
RAISE EXCEPTION 'BR-004: Backup belongs to a different tenant';
END IF;

-- Never silently discard a certified closure when restoring an old backup.
IF (NOT (v_backup.payload ? 'accounting_month_closures') AND EXISTS(SELECT 1 FROM public.accounting_month_closures WHERE tenant_id=v_tenant_id AND closed_at IS NOT NULL))
OR (NOT (v_backup.payload ? 'accounting_fiscal_years') AND EXISTS(SELECT 1 FROM public.accounting_fiscal_years WHERE tenant_id=v_tenant_id)) THEN
 RAISE EXCEPTION 'Cette sauvegarde antérieure ne contient pas les clôtures comptables. Restauration refusée.';
END IF;
v_preflight := br_preflight_restore(p_backup_id);
IF NOT (v_preflight->>'viable')::boolean THEN
RAISE EXCEPTION 'BR-005: Preflight failed: %', v_preflight->'issues';
END IF;

v_safety_result := br_create_backup('Pre-restore safety backup', 'safety');
v_safety_backup_id := (v_safety_result->>'backup_id')::uuid;
IF v_safety_backup_id IS NULL THEN
RAISE EXCEPTION 'BR-006: Failed to create safety backup';
END IF;
IF NOT EXISTS (
SELECT 1 FROM tenant_backups WHERE id = v_safety_backup_id AND status = 'verified'::br_backup_status
) THEN
RAISE EXCEPTION 'BR-007: Safety backup failed verification';
END IF;

-- DELETE in reverse restore_order
FOR v_rec IN
SELECT r.schema_name, r.table_name, r.tenant_link, r.tenant_id_column, r.parent_table
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded'
AND EXISTS (
SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r'
)
ORDER BY r.restore_order DESC, r.table_name DESC
LOOP
IF v_rec.tenant_link = 'direct' THEN
EXECUTE format('DELETE FROM %I.%I WHERE %I = $1',
v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
) USING v_tenant_id;
ELSIF v_rec.tenant_link = 'indirect' THEN
EXECUTE format(
'DELETE FROM %I.%I WHERE wholesaler_id IN (SELECT id FROM %I.%I WHERE tenant_id = $1)',
v_rec.schema_name, v_rec.table_name,
v_rec.schema_name, v_rec.parent_table
) USING v_tenant_id;
END IF;
GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted_counts := v_deleted_counts || jsonb_build_object(v_rec.table_name, v_count);
END LOOP;

-- Pre-INSERT: drop partial unique indexes that reference self-ref columns
-- These indexes become overly broad when self-ref columns are temporarily NULLed
FOR v_idx IN
SELECT i.indexname, i.indexdef, i.schemaname
FROM pg_indexes i
JOIN _br_table_registry r
ON r.schema_name = i.schemaname AND r.table_name = i.tablename
JOIN pg_index pi
ON pi.indexrelid = (quote_ident(i.schemaname) || '.' || quote_ident(i.indexname))::regclass
WHERE r.self_ref_columns IS NOT NULL
AND array_length(r.self_ref_columns, 1) > 0
AND pi.indisunique
AND pi.indpred IS NOT NULL
AND EXISTS (
SELECT 1 FROM unnest(r.self_ref_columns) AS sc
WHERE i.indexdef ILIKE '%' || sc || '%'
)
LOOP
EXECUTE format('DROP INDEX %I.%I', v_idx.schemaname, v_idx.indexname);
v_dropped_indexes := v_dropped_indexes || v_idx.indexdef;
END LOOP;

-- INSERT in forward restore_order — first pass
FOR v_rec IN
SELECT r.schema_name, r.table_name, r.tenant_link, r.restore_order,
r.self_ref_columns, r.deferred_fk_columns
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded'
AND (v_backup.payload ? r.table_name)
AND EXISTS (
SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r'
)
ORDER BY r.restore_order, r.table_name
LOOP
-- Journal restoration creates open month placeholders; restore the actual
-- saved monthly locks after journal lines and before the integrity check.
IF v_rec.table_name='accounting_month_closures' AND v_rec.schema_name='public' THEN
 DELETE FROM public.accounting_month_closures WHERE tenant_id=v_tenant_id AND closed_at IS NULL;
END IF;
v_table_data := v_backup.payload->v_rec.table_name;
v_count := 0;

IF jsonb_array_length(coalesce(v_table_data, '[]'::jsonb)) > 0 THEN
v_all_deferred := coalesce(v_rec.self_ref_columns, '{}') || coalesce(v_rec.deferred_fk_columns, '{}');

-- Get payload keys from first row
SELECT array_agg(k) INTO v_payload_keys FROM jsonb_object_keys(v_table_data->0) AS k;

-- Build insertable column list (excludes generated + deferred)
v_insert_cols := _br_insertable_columns(v_rec.schema_name, v_rec.table_name, v_payload_keys, v_all_deferred);

IF array_length(v_insert_cols, 1) IS NULL OR array_length(v_insert_cols, 1) = 0 THEN
CONTINUE;
END IF;

v_col_list := (SELECT string_agg(format('%I', c), ', ') FROM unnest(v_insert_cols) AS c);

EXECUTE format(
'INSERT INTO %I.%I (%s) SELECT %s FROM jsonb_populate_recordset(null::%I.%I, $1)',
v_rec.schema_name, v_rec.table_name, v_col_list, v_col_list,
v_rec.schema_name, v_rec.table_name
) USING v_table_data;

GET DIAGNOSTICS v_count = ROW_COUNT;
END IF;

v_inserted_counts := v_inserted_counts || jsonb_build_object(v_rec.table_name, v_count);
END LOOP;

-- Second pass: restore self_ref + deferred FK columns
FOR v_rec IN
SELECT r.schema_name, r.table_name, r.self_ref_columns, r.deferred_fk_columns
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded'
AND (v_backup.payload ? r.table_name)
AND (
(r.self_ref_columns IS NOT NULL AND array_length(r.self_ref_columns, 1) > 0)
OR (r.deferred_fk_columns IS NOT NULL AND array_length(r.deferred_fk_columns, 1) > 0)
)
ORDER BY r.restore_order, r.table_name
LOOP
v_table_data := v_backup.payload->v_rec.table_name;
v_all_deferred := coalesce(v_rec.self_ref_columns, '{}') || coalesce(v_rec.deferred_fk_columns, '{}');

FOR v_elem IN SELECT * FROM jsonb_array_elements(v_table_data)
LOOP
FOREACH v_col IN ARRAY v_all_deferred LOOP
IF v_elem->>v_col IS NOT NULL THEN
EXECUTE format(
'UPDATE %I.%I SET %I = ($1->>%L)::uuid WHERE id = ($1->>''id'')::uuid',
v_rec.schema_name, v_rec.table_name, v_col, v_col
) USING v_elem;
END IF;
END LOOP;
END LOOP;
END LOOP;

-- Post pass-2: recreate the dropped partial unique indexes
FOR i IN 1..coalesce(array_length(v_dropped_indexes, 1), 0) LOOP
EXECUTE v_dropped_indexes[i];
END LOOP;

-- Integrity verification
FOR v_rec IN
SELECT r.schema_name, r.table_name, r.tenant_link, r.tenant_id_column, r.parent_table
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded'
AND (v_backup.payload ? r.table_name)
AND EXISTS (
SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = r.schema_name AND c.relname = r.table_name AND c.relkind = 'r'
)
ORDER BY r.restore_order
LOOP
IF v_rec.tenant_link = 'direct' THEN
EXECUTE format('SELECT count(*)::integer FROM %I.%I WHERE %I = $1',
v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
) INTO v_count USING v_tenant_id;
ELSIF v_rec.tenant_link = 'indirect' THEN
EXECUTE format(
'SELECT count(*)::integer FROM %I.%I WHERE wholesaler_id IN (SELECT id FROM %I.%I WHERE tenant_id = $1)',
v_rec.schema_name, v_rec.table_name,
v_rec.schema_name, v_rec.parent_table
) INTO v_count USING v_tenant_id;
END IF;

IF v_count != coalesce((v_backup.row_counts->>v_rec.table_name)::integer, 0) THEN
RAISE EXCEPTION 'BR-008: Integrity check failed for %. Expected % rows, found %',
v_rec.table_name,
coalesce(v_backup.row_counts->>v_rec.table_name, '0'),
v_count;
END IF;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'backup_id', p_backup_id,
'safety_backup_id', v_safety_backup_id,
'deleted_counts', v_deleted_counts,
'inserted_counts', v_inserted_counts,
'integrity_verified', true,
'dropped_indexes_recreated', array_length(v_dropped_indexes, 1),
'restored_at', now()
);
END;
$function$
;


DO $verify$ BEGIN IF (SELECT count(*) FROM public.accounting_match_lines l LEFT JOIN public.accounting_match_groups g ON g.group_id=l.group_id WHERE g.group_id IS NULL)<>0 THEN RAISE EXCEPTION 'Lettrage incomplet';END IF;IF (public.br_check_schema_drift()->>'drift_detected')::boolean THEN RAISE EXCEPTION 'Registre incomplet';END IF;IF public._accounting_alpha_code(27)<>'AA' THEN RAISE EXCEPTION 'Séquence invalide';END IF;END $verify$;
