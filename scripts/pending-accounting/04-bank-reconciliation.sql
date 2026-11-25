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
