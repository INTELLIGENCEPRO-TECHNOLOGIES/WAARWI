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
