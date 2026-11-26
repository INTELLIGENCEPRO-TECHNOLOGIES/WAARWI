CREATE TABLE public.quote_conversion_stock_trace (
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 sale_id uuid PRIMARY KEY REFERENCES public.sales(id),
 stock_manifest jsonb NOT NULL,
 lot_manifest jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.quote_conversion_stock_trace ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quote_conversion_stock_trace FROM PUBLIC,anon,authenticated;
CREATE INDEX quote_conversion_stock_trace_tenant_idx ON public.quote_conversion_stock_trace(tenant_id);
CREATE OR REPLACE FUNCTION public._guard_converted_sale_reversal(t uuid,sid uuid,p_delete boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s public.sales%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR t IS DISTINCT FROM public.current_tenant_id() OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND tenant_id=t AND is_active IS NOT FALSE) THEN RAISE EXCEPTION 'Accès refusé.' USING ERRCODE='42501';END IF;
 SELECT * INTO s FROM public.sales WHERE id=sid AND tenant_id=t;
 IF NOT FOUND OR public.current_user_can_access_site(s.site_id) IS DISTINCT FROM true OR public._cr_profile_has_permission(auth.uid(),CASE WHEN p_delete THEN 'delete_invoices' ELSE 'edit_invoices' END) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Action sur facture non autorisée.' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':edit:sale:'||sid::text,0));
 IF EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=t AND resource_type='sale' AND resource_key=sid::text AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'La facture est en cours de modification. Demandez sa libération.' USING ERRCODE='55000';END IF;
END $$;
CREATE OR REPLACE FUNCTION public._restore_converted_sale_stock(t uuid,sid uuid,p_action text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE trace public.quote_conversion_stock_trace%ROWTYPE; actual jsonb; actual_lots jsonb; rec record; prev numeric; nextq numeric; sn text; lm record;
BEGIN
 SELECT * INTO trace FROM public.quote_conversion_stock_trace WHERE tenant_id=t AND sale_id=sid FOR UPDATE;
 IF NOT FOUND THEN RETURN false;END IF;
 IF p_action NOT IN ('sale_cancel','sale_delete') THEN RAISE EXCEPTION 'Action de restitution invalide.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid AND reference_type IN ('sale_cancel','sale_delete')) THEN RAISE EXCEPTION 'Une restitution existe déjà pour cette facture.' USING ERRCODE='55000';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_array(article_id,site_id,trim_scale(qty)) ORDER BY article_id,site_id),'[]') INTO actual FROM (SELECT article_id,site_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid AND reference_type='sale' GROUP BY article_id,site_id) x;
 SELECT coalesce(jsonb_agg(jsonb_build_array(lot_id,article_id,site_id,trim_scale(qty)) ORDER BY lot_id,article_id,site_id),'[]') INTO actual_lots FROM (SELECT lot_id,article_id,site_id,sum(quantity) qty FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=sid GROUP BY lot_id,article_id,site_id) x;
 IF actual IS DISTINCT FROM trace.stock_manifest OR actual_lots IS DISTINCT FROM trace.lot_manifest THEN RAISE EXCEPTION 'Historique des sorties de stock ou des lots incohérent. Restitution bloquée.' USING ERRCODE='55000';END IF;
 IF EXISTS(SELECT 1 FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid AND reference_type IN ('sale','invoice_edit') AND (site_id IS NULL OR article_id IS NULL OR public.current_user_can_access_site(site_id) IS DISTINCT FROM true)) THEN RAISE EXCEPTION 'Dépôt historique inaccessible.' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.sale_lot_deductions d LEFT JOIN public.stock_lots l ON l.id=d.lot_id AND l.tenant_id=t AND l.article_id=d.article_id AND l.site_id=d.site_id WHERE d.tenant_id=t AND d.sale_id=sid AND (l.id IS NULL OR d.quantity<=0 OR d.quantity IS NULL)) THEN RAISE EXCEPTION 'Historique des lots incohérent.' USING ERRCODE='55000';END IF;
 IF EXISTS(WITH x AS(SELECT article_id,site_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid AND reference_type IN ('sale','invoice_edit') GROUP BY article_id,site_id),d AS(SELECT article_id,site_id,sum(quantity) qty FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=sid GROUP BY article_id,site_id) SELECT 1 FROM x FULL JOIN d USING(article_id,site_id) WHERE coalesce(x.qty,0)<0 OR (d.qty IS NOT NULL AND d.qty IS DISTINCT FROM x.qty)) THEN RAISE EXCEPTION 'Quantités historiques incohérentes.' USING ERRCODE='55000';END IF;
 SELECT sale_number INTO sn FROM public.sales WHERE tenant_id=t AND id=sid;
 FOR rec IN SELECT article_id,site_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid AND reference_type IN ('sale','invoice_edit') GROUP BY article_id,site_id HAVING sum(quantity)<>0 ORDER BY article_id,site_id LOOP
  SELECT coalesce(quantity,0) INTO prev FROM public.stock_levels WHERE tenant_id=t AND article_id=rec.article_id AND site_id=rec.site_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Stock historique introuvable. Restitution bloquée.' USING ERRCODE='55000';END IF;
  nextq:=prev+rec.qty;
  FOR lm IN SELECT l.id,l.remaining_quantity,l.initial_quantity,(SELECT sum(d.quantity) FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.lot_id=l.id) qty FROM public.stock_lots l WHERE l.tenant_id=t AND l.article_id=rec.article_id AND l.site_id=rec.site_id AND EXISTS(SELECT 1 FROM public.sale_lot_deductions d WHERE d.tenant_id=t AND d.sale_id=sid AND d.lot_id=l.id) ORDER BY l.id FOR UPDATE LOOP
   IF lm.remaining_quantity+lm.qty>lm.initial_quantity THEN RAISE EXCEPTION 'La restitution dépasserait la quantité initiale du lot.' USING ERRCODE='55000';END IF;
   UPDATE public.stock_lots SET remaining_quantity=remaining_quantity+lm.qty WHERE id=lm.id AND tenant_id=t;
  END LOOP;
  UPDATE public.stock_levels SET quantity=nextq,updated_at=now() WHERE tenant_id=t AND article_id=rec.article_id AND site_id=rec.site_id;
  INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(t,rec.article_id,rec.site_id,'adjustment',rec.qty,prev,nextq,p_action,sid,auth.uid(),'Restitution facture '||sn);
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public._guard_converted_sale_reversal(uuid,uuid,boolean),public._restore_converted_sale_stock(uuid,uuid,text) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.cancel_sale(p_sale_id uuid, p_tenant_id uuid, p_cancel_reason text DEFAULT ''::text, p_payment_action text DEFAULT 'none'::text, p_cash_session_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_sale record;
v_user_id uuid := auth.uid();
v_tenant_id uuid := current_tenant_id();
v_deduction record;
v_line record;
v_previous numeric;
v_new numeric;
v_real_paid numeric := 0;
v_credit_paid numeric := 0;
v_ipm record;
v_has_returns boolean;
v_has_accounted boolean;
v_warranty jsonb;
v_refund_amount numeric := 0;
v_session record;
v_old_balance numeric;
v_depot_missing boolean := false;
BEGIN
PERFORM public._cs_assert_sale_usable(p_sale_id);
PERFORM public.assert_tenant_access(p_tenant_id);

IF EXISTS(SELECT 1 FROM public.quotes WHERE tenant_id=p_tenant_id AND converted_sale_id=p_sale_id) THEN PERFORM public._guard_converted_sale_reversal(p_tenant_id,p_sale_id,false);END IF;
SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id FOR UPDATE;
IF v_sale IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
END IF;

-- Idempotence
IF v_sale.deleted_at IS NOT NULL OR v_sale.status='deleted' THEN RETURN jsonb_build_object('success',false,'error','Vente supprimée.');END IF;
IF v_sale.status = 'cancelled' THEN
RETURN jsonb_build_object('success', true, 'already_cancelled', true);
END IF;

IF EXISTS(SELECT 1 FROM public.quotes WHERE tenant_id=v_tenant_id AND converted_sale_id=p_sale_id) AND EXISTS(SELECT 1 FROM public.credit_allocations WHERE tenant_id=v_tenant_id AND (target_id=p_sale_id OR source_id=p_sale_id)) THEN RETURN jsonb_build_object('success',false,'error','Des acomptes ou avoirs sont imputés : utilisez le parcours de désimputation.');END IF;
IF v_sale.accounting_status = 'accounted' OR v_sale.accounting_entry_id IS NOT NULL OR EXISTS(
 SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=v_sale.tenant_id AND j.source_type='sale' AND j.source_id=p_sale_id
) THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée, annulation impossible');
END IF;

SELECT EXISTS(
SELECT 1 FROM sale_returns WHERE sale_id = p_sale_id AND status IN ('pending','approved')
) INTO v_has_returns;
IF v_has_returns THEN
RETURN jsonb_build_object('success', false, 'error', 'Un retour ou avoir existe déjà pour cette vente. Annulation impossible.');
END IF;

SELECT EXISTS(
SELECT 1 FROM sale_payments WHERE sale_id = p_sale_id AND accounting_status = 'accounted'
) INTO v_has_accounted;
IF v_has_accounted THEN
RETURN jsonb_build_object('success', false, 'error', 'Un règlement de cette vente est déjà comptabilisé. Annulation impossible.');
END IF;

SELECT * INTO v_ipm FROM ipm_ventes WHERE sale_id = p_sale_id LIMIT 1;
IF v_ipm IS NOT NULL AND (v_ipm.bordereau_id IS NOT NULL OR v_ipm.statut IS DISTINCT FROM 'en_attente') THEN
RETURN jsonb_build_object('success', false, 'error', 'L''opération IPM de cette vente appartient déjà à un bordereau. Annulation impossible.');
END IF;

IF COALESCE(p_cancel_reason, '') = '' THEN
RETURN jsonb_build_object('success', false, 'error', 'Un motif d''annulation est obligatoire');
END IF;

-- Ventilation des règlements : réel vs crédit
SELECT COALESCE(SUM(
CASE WHEN sp.affects_balance AND COALESCE(pm.payment_type, '') <> 'credit' THEN sp.amount ELSE 0 END
), 0) INTO v_real_paid
FROM sale_payments sp
LEFT JOIN payment_methods pm ON pm.id = sp.payment_method_id
WHERE sp.sale_id = p_sale_id;

SELECT COALESCE(SUM(
CASE WHEN NOT sp.affects_balance OR COALESCE(pm.payment_type, '') = 'credit' THEN sp.amount ELSE 0 END
), 0) INTO v_credit_paid
FROM sale_payments sp
LEFT JOIN payment_methods pm ON pm.id = sp.payment_method_id
WHERE sp.sale_id = p_sale_id;

-- Un règlement réel impose une action de paiement explicite
IF v_real_paid > 0 THEN
IF p_payment_action IS NULL OR p_payment_action NOT IN ('keep_credit','refund_cash') THEN
RETURN jsonb_build_object(
'success', false,
'error', 'Cette vente a été réglée. Précisez le traitement du paiement (conserver en crédit ou rembourser en espèces).',
'requires_payment_action', true,
'real_paid', v_real_paid
);
END IF;

IF p_payment_action='keep_credit' AND v_sale.customer_id IS NULL THEN RETURN jsonb_build_object('success',false,'error','Un client est nécessaire pour conserver un crédit.');END IF;
-- Remboursement espèces : session de caisse ouverte obligatoire AVANT toute modification
IF p_payment_action = 'refund_cash' THEN
IF p_cash_session_id IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', CASE WHEN public._cs_multi_current() THEN 'Ouvrez votre caisse avant d''enregistrer cet encaissement.' ELSE 'Aucune session de caisse ouverte : remboursement impossible.' END, 'requires_open_session', true);
END IF;
SELECT * INTO v_session FROM cash_sessions
WHERE id = p_cash_session_id AND tenant_id = v_tenant_id AND site_id = v_sale.site_id AND status = 'open'
FOR UPDATE;
IF v_session IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'La session de caisse indiquée n''est pas ouverte pour ce point de vente : remboursement impossible.', 'requires_open_session', true);
END IF;
IF public._cs_multi_enabled(v_tenant_id) THEN
PERFORM public._cs_assert_operational(p_cash_session_id, v_tenant_id, v_sale.site_id);
END IF;
END IF;
END IF;

-- Dépôt d'origine indéterminable => blocage (ne pas choisir le magasin principal)
IF NOT EXISTS (SELECT 1 FROM sale_lot_deductions WHERE sale_id = p_sale_id) THEN
SELECT EXISTS(
SELECT 1 FROM sale_items si
LEFT JOIN articles a ON a.id = si.article_id
WHERE si.sale_id = p_sale_id AND si.article_id IS NOT NULL
AND COALESCE(a.track_stock, true) = true
AND COALESCE(si.site_id, v_sale.site_id) IS NULL
) INTO v_depot_missing;
IF v_depot_missing THEN
RETURN jsonb_build_object('success', false, 'error', 'Dépôt d''origine indéterminable pour certains articles : annulation bloquée.');
END IF;
END IF;

-- ===== À partir d'ici : modifications =====

IF v_ipm IS NOT NULL AND v_ipm.statut = 'en_attente' THEN
UPDATE ipm_ventes SET statut = 'annule', updated_at = now() WHERE id = v_ipm.id;
END IF;

BEGIN
IF v_sale.doc_header IS NOT NULL THEN
v_warranty := (v_sale.doc_header)->'warranty';
IF v_warranty IS NOT NULL AND v_warranty <> 'null'::jsonb THEN
UPDATE sales SET doc_header = jsonb_set(COALESCE(doc_header, '{}'::jsonb), '{warranty_cancelled}', 'true'::jsonb, true)
WHERE id = p_sale_id;
END IF;
END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END;

-- Restauration du stock : lots précis, sinon repli stock_levels au dépôt réel
IF NOT public._restore_converted_sale_stock(v_tenant_id,p_sale_id,'sale_cancel') THEN
IF EXISTS (SELECT 1 FROM sale_lot_deductions WHERE sale_id = p_sale_id) THEN
FOR v_deduction IN
SELECT sld.lot_id, sld.article_id, sld.site_id, SUM(sld.quantity) AS quantity,
MAX(sl.remaining_quantity) AS lot_current,
MAX(sl2.quantity) AS stock_current
FROM sale_lot_deductions sld
LEFT JOIN stock_lots sl ON sl.id = sld.lot_id
LEFT JOIN stock_levels sl2 ON sl2.article_id = sld.article_id AND sl2.site_id = sld.site_id
WHERE sld.sale_id = p_sale_id AND sld.tenant_id = v_tenant_id
GROUP BY sld.lot_id, sld.article_id, sld.site_id
LOOP
IF v_deduction.lot_current IS NOT NULL THEN
UPDATE stock_lots SET remaining_quantity = remaining_quantity + v_deduction.quantity
WHERE id = v_deduction.lot_id;
END IF;
IF v_deduction.stock_current IS NOT NULL THEN
v_previous := v_deduction.stock_current;
v_new := v_previous + v_deduction.quantity;
UPDATE stock_levels SET quantity = v_new, updated_at = now()
WHERE article_id = v_deduction.article_id AND site_id = v_deduction.site_id;
INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
VALUES (v_tenant_id, v_deduction.article_id, v_deduction.site_id, 'adjustment',
v_deduction.quantity, v_previous, v_new, 'sale_cancel', p_sale_id, v_user_id,
'Restauration stock - annulation vente ' || v_sale.sale_number);
END IF;
END LOOP;
ELSE
FOR v_line IN
SELECT si.article_id, SUM(si.quantity) AS quantity, COALESCE(si.site_id, v_sale.site_id) AS site_id,
MAX(sl.quantity) AS current_stock,
bool_or(COALESCE(a.track_stock, true)) AS track_stock
FROM sale_items si
LEFT JOIN stock_levels sl ON sl.article_id = si.article_id
AND sl.site_id = COALESCE(si.site_id, v_sale.site_id)
LEFT JOIN articles a ON a.id = si.article_id
WHERE si.sale_id = p_sale_id AND si.article_id IS NOT NULL
GROUP BY si.article_id, COALESCE(si.site_id, v_sale.site_id)
LOOP
IF v_line.track_stock AND v_line.current_stock IS NOT NULL THEN
v_previous := v_line.current_stock;
v_new := v_previous + v_line.quantity;
UPDATE stock_levels SET quantity = v_new, updated_at = now()
WHERE article_id = v_line.article_id AND site_id = v_line.site_id;
INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
VALUES (v_tenant_id, v_line.article_id, v_line.site_id, 'adjustment',
v_line.quantity, v_previous, v_new, 'sale_cancel', p_sale_id, v_user_id,
'Restauration stock - annulation vente ' || v_sale.sale_number);
END IF;
END LOOP;
END IF;

END IF;

-- Remboursement espèces : mouvement de caisse de type refund + neutralisation du crédit
IF v_real_paid > 0 AND p_payment_action = 'refund_cash' THEN
v_refund_amount := v_real_paid;
INSERT INTO cash_movements (tenant_id, cash_session_id, site_id, user_id, kind, amount, reason, note, reference, customer_id)
VALUES (v_tenant_id, p_cash_session_id, v_sale.site_id, v_user_id, 'refund',
v_refund_amount, 'Remboursement client - annulation vente ' || v_sale.sale_number,
p_cancel_reason, 'sale_cancel_' || p_sale_id::text, v_sale.customer_id);
UPDATE cash_sessions SET theoretical_amount = COALESCE(theoretical_amount, 0) - v_refund_amount
WHERE id = p_cash_session_id;

IF v_sale.customer_id IS NOT NULL THEN
SELECT balance INTO v_old_balance FROM customers WHERE id = v_sale.customer_id;
INSERT INTO balance_adjustments (tenant_id, entity_type, entity_id, previous_balance, new_balance, amount, note, kind, user_id)
VALUES (v_tenant_id, 'customer', v_sale.customer_id, COALESCE(v_old_balance,0), COALESCE(v_old_balance,0) + v_refund_amount, v_refund_amount,
'Remboursement espèces - annulation vente ' || v_sale.sale_number, 'cancel_refund', v_user_id);
END IF;
END IF;
-- keep_credit : aucun ajustement (le règlement conservé devient un crédit via le recalcul)
-- vente non réglée : aucun ajustement (l'exclusion de la vente annulée retire la dette)

UPDATE sales
SET status = 'cancelled', cancelled_at = now(), cancelled_by = v_user_id, cancel_reason = p_cancel_reason
WHERE id = p_sale_id;

-- Solde client resynchronisé sur le calcul serveur (source unique de vérité)
IF v_sale.customer_id IS NOT NULL THEN
PERFORM public.recalculate_customer_balance(v_sale.customer_id);
END IF;

RETURN jsonb_build_object(
'success', true,
'sale_number', v_sale.sale_number,
'refund_amount', v_refund_amount,
'real_paid', v_real_paid,
'credit_paid', v_credit_paid,
'payment_action', p_payment_action
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_sale_and_recalculate(p_sale_id uuid, p_tenant_id uuid, p_reason text DEFAULT ''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_sale record;
v_user_id uuid := auth.uid();
v_tenant_id uuid := current_tenant_id();
v_deduction record;
v_line record;
v_previous numeric;
v_new numeric;
v_has_payments boolean;
v_has_returns boolean;
v_has_ipm boolean;
BEGIN
PERFORM public._cs_assert_sale_usable(p_sale_id);
PERFORM public.assert_tenant_access(p_tenant_id);

IF EXISTS(SELECT 1 FROM public.quotes WHERE tenant_id=p_tenant_id AND converted_sale_id=p_sale_id) THEN PERFORM public._guard_converted_sale_reversal(p_tenant_id,p_sale_id,true);END IF;
SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id FOR UPDATE;
IF v_sale IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
END IF;

IF v_sale.deleted_at IS NOT NULL THEN
RETURN jsonb_build_object('success', true, 'restored_total', 0, 'already_deleted', true);
END IF;

IF v_sale.status = 'cancelled' THEN
RETURN jsonb_build_object('success', false, 'error', 'Une facture annulée ne peut pas être supprimée');
END IF;

IF EXISTS(SELECT 1 FROM public.quotes WHERE tenant_id=v_tenant_id AND converted_sale_id=p_sale_id) AND EXISTS(SELECT 1 FROM public.credit_allocations WHERE tenant_id=v_tenant_id AND (target_id=p_sale_id OR source_id=p_sale_id)) THEN RETURN jsonb_build_object('success',false,'error','Des acomptes ou avoirs sont imputés : utilisez le parcours de désimputation.');END IF;
IF v_sale.accounting_status = 'accounted' OR v_sale.accounting_entry_id IS NOT NULL OR EXISTS(
 SELECT 1 FROM public.journal_entries j WHERE j.tenant_id=v_sale.tenant_id AND j.source_type='sale' AND j.source_id=p_sale_id
) THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée, suppression impossible');
END IF;

SELECT EXISTS(SELECT 1 FROM sale_payments WHERE sale_id = p_sale_id) INTO v_has_payments;
IF v_has_payments THEN
RETURN jsonb_build_object('success', false, 'error', 'Cette vente a un règlement. Suppression impossible — utilisez l''annulation.');
END IF;

SELECT EXISTS(SELECT 1 FROM sale_returns WHERE sale_id = p_sale_id) INTO v_has_returns;
IF v_has_returns THEN
RETURN jsonb_build_object('success', false, 'error', 'Un retour ou avoir existe pour cette vente. Suppression impossible.');
END IF;

SELECT EXISTS(SELECT 1 FROM ipm_ventes WHERE sale_id = p_sale_id) INTO v_has_ipm;
IF v_has_ipm THEN
RETURN jsonb_build_object('success', false, 'error', 'Une opération IPM est liée à cette vente. Suppression impossible.');
END IF;

IF COALESCE(btrim(p_reason), '') = '' THEN
RETURN jsonb_build_object('success', false, 'error', 'Un motif de suppression est obligatoire');
END IF;

IF NOT public._restore_converted_sale_stock(v_tenant_id,p_sale_id,'sale_delete') THEN
IF EXISTS (SELECT 1 FROM sale_lot_deductions WHERE sale_id = p_sale_id) THEN
FOR v_deduction IN
SELECT sld.lot_id, sld.article_id, sld.site_id, sld.quantity,
sl.remaining_quantity AS lot_current,
sl2.quantity AS stock_current
FROM sale_lot_deductions sld
LEFT JOIN stock_lots sl ON sl.id = sld.lot_id
LEFT JOIN stock_levels sl2 ON sl2.article_id = sld.article_id AND sl2.site_id = sld.site_id
WHERE sld.sale_id = p_sale_id AND sld.tenant_id = v_tenant_id
LOOP
IF v_deduction.lot_current IS NOT NULL THEN
UPDATE stock_lots SET remaining_quantity = remaining_quantity + v_deduction.quantity
WHERE id = v_deduction.lot_id;
END IF;
IF v_deduction.stock_current IS NOT NULL THEN
v_previous := v_deduction.stock_current;
v_new := v_previous + v_deduction.quantity;
UPDATE stock_levels SET quantity = v_new, updated_at = now()
WHERE article_id = v_deduction.article_id AND site_id = v_deduction.site_id;
INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
VALUES (v_tenant_id, v_deduction.article_id, v_deduction.site_id, 'adjustment',
v_deduction.quantity, v_previous, v_new, 'sale_delete', p_sale_id, v_user_id,
'Restauration stock - suppression vente ' || v_sale.sale_number);
END IF;
END LOOP;
ELSE
FOR v_line IN
SELECT si.article_id, si.quantity, si.site_id,
sl.quantity AS current_stock,
COALESCE(a.track_stock, true) AS track_stock
FROM sale_items si
LEFT JOIN stock_levels sl ON sl.article_id = si.article_id
AND sl.site_id = COALESCE(si.site_id, v_sale.site_id)
LEFT JOIN articles a ON a.id = si.article_id
WHERE si.sale_id = p_sale_id AND si.article_id IS NOT NULL
LOOP
IF v_line.track_stock AND v_line.current_stock IS NOT NULL THEN
v_previous := v_line.current_stock;
v_new := v_previous + v_line.quantity;
UPDATE stock_levels SET quantity = v_new, updated_at = now()
WHERE article_id = v_line.article_id AND site_id = COALESCE(v_line.site_id, v_sale.site_id);
INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
VALUES (v_tenant_id, v_line.article_id, COALESCE(v_line.site_id, v_sale.site_id), 'adjustment',
v_line.quantity, v_previous, v_new, 'sale_delete', p_sale_id, v_user_id,
'Restauration stock - suppression vente ' || v_sale.sale_number);
END IF;
END LOOP;
END IF;

END IF;

INSERT INTO sale_deletion_log (tenant_id, sale_id_snapshot, sale_number, sale_total, reason, user_id, customer_id, site_id, sale_date)
VALUES (v_tenant_id, p_sale_id, v_sale.sale_number, v_sale.total, btrim(p_reason), v_user_id, v_sale.customer_id, v_sale.site_id, v_sale.created_at);

IF v_sale.sale_number IS NULL THEN
DELETE FROM sale_lot_deductions WHERE sale_id = p_sale_id;
DELETE FROM sale_items WHERE sale_id = p_sale_id;
DELETE FROM sales WHERE id = p_sale_id;
ELSE
UPDATE sales
SET status = 'deleted', deleted_at = now(), deleted_by = v_user_id, deletion_reason = btrim(p_reason)
WHERE id = p_sale_id;
END IF;

IF v_sale.customer_id IS NOT NULL THEN
PERFORM public.recalculate_customer_balance(v_sale.customer_id);
END IF;

RETURN jsonb_build_object('success', true, 'restored_total', v_sale.total, 'logical', v_sale.sale_number IS NOT NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_locked_invoice_edit(p_tenant_id uuid, p_sale_id uuid, p_window_id uuid, p_lock_token uuid, p_expected_version text, p_items jsonb, p_customer_id uuid, p_doc_header jsonb, p_representative_id uuid, p_rep_commission jsonb, p_release boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.sales%ROWTYPE;snap jsonb; old_lines jsonb;new_lines jsonb;lines_changed boolean; quantities_changed boolean; total_new numeric; stock_site uuid; site_count integer; rec record; old_costs jsonb; prior_qty numeric; next_qty numeric; cid uuid; lease_result jsonb;
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'sale',p_sale_id::text,p_window_id,p_lock_token);
 PERFORM public._cs_assert_sale_usable(p_sale_id);
 SELECT * INTO s FROM public.sales WHERE tenant_id=p_tenant_id AND id=p_sale_id FOR UPDATE;
 IF NOT FOUND OR s.source IS DISTINCT FROM 'billing' OR s.accounting_status IS DISTINCT FROM 'not_accounted' OR s.status IN ('cancelled','deleted') OR s.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'Cette facture ne peut plus être modifiée.' USING ERRCODE='55000';END IF;
 PERFORM public._document_edit_access(p_tenant_id,'sale',p_sale_id::text);
 PERFORM 1 FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id ORDER BY id FOR UPDATE;
 snap:=public._invoice_edit_snapshot(p_tenant_id,p_sale_id);
 IF p_expected_version IS NULL OR snap->>'version' IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'La facture a changé depuis votre ouverture. Rechargez-la avant de reprendre la saisie.' USING ERRCODE='40001';END IF;
 IF p_doc_header IS NOT NULL AND jsonb_typeof(p_doc_header)<>'object' THEN RAISE EXCEPTION 'Informations de facture invalides.' USING ERRCODE='22023';END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Au moins une ligne valide est nécessaire.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric)
 LEFT JOIN public.articles a ON a.id=x.article_id AND a.tenant_id=p_tenant_id
 WHERE a.id IS NULL OR (a.site_id IS NOT NULL AND public.current_user_can_access_site(a.site_id) IS DISTINCT FROM true) OR x.name IS NULL OR btrim(x.name)='' OR x.quantity IS NULL OR x.quantity<=0 OR x.unit_price IS NULL OR x.unit_price<0 OR coalesce(x.discount,0)<0 OR coalesce(x.discount,0)>x.quantity*x.unit_price OR x.quantity::text IN ('NaN','Infinity','-Infinity') OR x.unit_price::text IN ('NaN','Infinity','-Infinity') OR coalesce(x.discount,0)::text IN ('NaN','Infinity','-Infinity'))
 THEN RAISE EXCEPTION 'Vérifiez les articles, quantités, prix et remises.' USING ERRCODE='22023';END IF;
 IF p_customer_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.customers c WHERE c.id=p_customer_id AND c.tenant_id=p_tenant_id AND (c.site_id IS NULL OR c.site_id=s.site_id OR public.current_user_can_access_site(c.site_id))) THEN RAISE EXCEPTION 'Client indisponible.' USING ERRCODE='42501';END IF;
 IF p_representative_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.sales_representatives r WHERE r.id=p_representative_id AND r.tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Représentant indisponible.' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO old_lines FROM (SELECT jsonb_build_array(article_id,name,trim_scale(quantity),trim_scale(unit_price),trim_scale(coalesce(discount,0))) v FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id) q;
 SELECT coalesce(jsonb_agg(v ORDER BY v::text),'[]') INTO new_lines FROM (SELECT jsonb_build_array(article_id,name,trim_scale(quantity),trim_scale(unit_price),trim_scale(coalesce(discount,0))) v FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric)) q;
 lines_changed:=old_lines IS DISTINCT FROM new_lines;
 IF (s.vat_enabled_at_issue OR s.vat_net_amount IS NOT NULL) AND (lines_changed OR s.customer_id IS DISTINCT FROM p_customer_id) THEN RAISE EXCEPTION 'Utilisez un avoir pour corriger une facture émise avec TVA.' USING ERRCODE='55000';END IF;
 IF (lines_changed OR s.customer_id IS DISTINCT FROM p_customer_id) AND (EXISTS(SELECT 1 FROM public.sale_returns WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id) OR EXISTS(SELECT 1 FROM public.ipm_ventes WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id)) THEN RAISE EXCEPTION 'La facture comporte un retour ou une prise en charge IPM. Utilisez le parcours de correction dédié.' USING ERRCODE='55000';END IF;
 IF s.customer_id IS DISTINCT FROM p_customer_id AND coalesce(s.paid,0)>0 THEN RAISE EXCEPTION 'Le client d’une facture déjà réglée ne peut pas être remplacé directement.' USING ERRCODE='55000';END IF;
 IF lines_changed THEN
  IF EXISTS(SELECT 1 FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id HAVING count(DISTINCT coalesce(purchase_cost,0))>1) THEN RAISE EXCEPTION 'Coûts historiques différents pour un même article. Utilisez un avoir ou un parcours de correction adapté.' USING ERRCODE='55000';END IF;
  IF coalesce(s.discount,0)<>0 OR EXISTS(SELECT 1 FROM public.sale_lot_deductions WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id) OR EXISTS(SELECT 1 FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id AND nullif(imei,'') IS NOT NULL) THEN RAISE EXCEPTION 'Cette facture comporte une remise globale, des lots ou des IMEI. Utilisez un avoir ou un parcours de correction adapté.' USING ERRCODE='55000';END IF;
  SELECT sum(round(quantity*unit_price-coalesce(discount,0),2)) INTO total_new FROM jsonb_to_recordset(p_items) x(article_id uuid,name text,quantity numeric,unit_price numeric,discount numeric);
  IF total_new<coalesce(s.paid,0) OR (total_new>coalesce(s.paid,0) AND p_customer_id IS NULL) THEN RAISE EXCEPTION 'Le nouveau total est incompatible avec les règlements ou le client.' USING ERRCODE='22023';END IF;
  SELECT EXISTS(
   WITH o AS (SELECT article_id,sum(quantity) qty FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id),
   n AS (SELECT article_id,sum(quantity) qty FROM jsonb_to_recordset(p_items) x(article_id uuid,quantity numeric) GROUP BY article_id)
   SELECT 1 FROM o FULL JOIN n USING(article_id) WHERE coalesce(o.qty,0)<>coalesce(n.qty,0)
  ) INTO quantities_changed;
  IF quantities_changed THEN
   IF (SELECT count(*) FROM public.sales WHERE tenant_id=p_tenant_id AND sale_number=s.sale_number)<>1 THEN RAISE EXCEPTION 'Numéro de facture ambigu : origine du stock indéterminée.' USING ERRCODE='55000';END IF;
   -- Resolve the ORIGINAL stock source, not the currently selected depot.
   SELECT count(DISTINCT m.site_id),(array_agg(DISTINCT m.site_id))[1] INTO site_count,stock_site FROM public.stock_movements m
   WHERE m.tenant_id=p_tenant_id AND ((m.reference_type IN ('sale','invoice_edit') AND m.reference_id=p_sale_id) OR (m.reference_id IS NULL AND m.movement_type='sale' AND m.note IN ('Facture '||s.sale_number,'Facture '||s.sale_number||' (credit)','Facture '||s.sale_number||' (devis converti)')));
   IF site_count<>1 OR public.current_user_can_access_site(stock_site) IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.sites WHERE id=stock_site AND tenant_id=p_tenant_id) THEN RAISE EXCEPTION 'Magasin de sortie du stock indéterminé ou inaccessible. Utilisez un avoir.' USING ERRCODE='55000';END IF;
   -- Do not infer historical stock if the original movement is missing or inconsistent.
   IF EXISTS(WITH o AS (SELECT article_id,sum(quantity) qty FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id),m AS (SELECT article_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=p_tenant_id AND site_id=stock_site AND ((reference_type IN ('sale','invoice_edit') AND reference_id=p_sale_id) OR (reference_id IS NULL AND movement_type='sale' AND note IN ('Facture '||s.sale_number,'Facture '||s.sale_number||' (credit)','Facture '||s.sale_number||' (devis converti)'))) GROUP BY article_id) SELECT 1 FROM o FULL JOIN m USING(article_id) LEFT JOIN public.articles a ON a.id=coalesce(o.article_id,m.article_id) AND a.tenant_id=p_tenant_id WHERE coalesce(o.qty,0)<>coalesce(m.qty,0) AND (coalesce(a.track_stock,true) OR m.article_id IS NOT NULL)) THEN RAISE EXCEPTION 'Historique de stock incohérent. Aucune modification n’a été enregistrée.' USING ERRCODE='55000';END IF;
   FOR rec IN WITH o AS (SELECT article_id,sum(quantity) qty FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=p_sale_id GROUP BY article_id),n AS (SELECT article_id,sum(quantity) qty FROM jsonb_to_recordset(p_items) x(article_id uuid,quantity numeric) GROUP BY article_id)
   SELECT coalesce(o.article_id,n.article_id) article_id,coalesce(o.qty,0)-coalesce(n.qty,0) delta FROM o FULL JOIN n USING(article_id) JOIN public.articles a ON a.id=coalesce(o.article_id,n.article_id) AND a.tenant_id=p_tenant_id WHERE coalesce(o.qty,0)<>coalesce(n.qty,0) AND (a.track_stock OR EXISTS(SELECT 1 FROM public.stock_movements m WHERE m.tenant_id=p_tenant_id AND m.article_id=a.id AND m.site_id=stock_site AND ((m.reference_type IN ('sale','invoice_edit') AND m.reference_id=p_sale_id) OR (m.reference_id IS NULL AND m.movement_type='sale' AND m.note IN ('Facture '||s.sale_number,'Facture '||s.sale_number||' (credit)','Facture '||s.sale_number||' (devis converti)'))))) ORDER BY 1 LOOP
    INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(p_tenant_id,rec.article_id,stock_site,0) ON CONFLICT(article_id,site_id) DO NOTHING;
    SELECT coalesce(quantity,0) INTO STRICT prior_qty FROM public.stock_levels WHERE tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=stock_site FOR UPDATE;
    next_qty:=prior_qty+rec.delta;
    IF next_qty<0 AND NOT coalesce((SELECT CASE WHEN stock_location.is_warehouse AND stock_location.parent_site_id IS NOT NULL THEN coalesce(parent.allow_negative_stock,stock_location.allow_negative_stock) ELSE stock_location.allow_negative_stock END FROM public.sites stock_location LEFT JOIN public.sites parent ON parent.id=stock_location.parent_site_id AND parent.tenant_id=stock_location.tenant_id WHERE stock_location.id=stock_site AND stock_location.tenant_id=p_tenant_id),false) THEN RAISE EXCEPTION 'Stock insuffisant dans le magasin de sortie.' USING ERRCODE='55000';END IF;
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
 IF total_new>coalesce(s.paid,0) AND p_customer_id IS NULL THEN RAISE EXCEPTION 'Un client est requis pour une facture à crédit.' USING ERRCODE='22023';END IF;
 UPDATE public.sales SET total=total_new,subtotal=CASE WHEN lines_changed THEN total_new ELSE subtotal END,customer_id=p_customer_id,doc_header=CASE WHEN p_doc_header IS NULL THEN doc_header ELSE coalesce(doc_header,'{}'::jsonb)||p_doc_header END,representative_id=p_representative_id,rep_commission=CASE WHEN NOT lines_changed AND s.representative_id IS NOT DISTINCT FROM p_representative_id THEN s.rep_commission ELSE p_rep_commission END,status=CASE WHEN NOT lines_changed THEN status WHEN coalesce(paid,0)>=total_new THEN 'paid' WHEN coalesce(paid,0)>0 THEN 'partial' ELSE 'validated' END WHERE id=p_sale_id AND tenant_id=p_tenant_id;
 IF lines_changed OR s.customer_id IS DISTINCT FROM p_customer_id THEN
  FOR cid IN SELECT DISTINCT x FROM unnest(ARRAY[s.customer_id,p_customer_id]) x WHERE x IS NOT NULL ORDER BY x LOOP
   PERFORM 1 FROM public.customers WHERE id=cid AND tenant_id=p_tenant_id FOR UPDATE;
   UPDATE public.customers SET balance=coalesce((SELECT sum(total-paid) FROM public.sales WHERE tenant_id=p_tenant_id AND customer_id=cid AND status NOT IN ('cancelled','deleted') AND deleted_at IS NULL),0)+coalesce((SELECT sum(amount) FROM public.balance_adjustments WHERE tenant_id=p_tenant_id AND entity_id=cid AND entity_type='customer'),0) WHERE id=cid AND tenant_id=p_tenant_id;
  END LOOP;
 END IF;
 INSERT INTO public.audit_logs(tenant_id,user_id,action,module,reference_id,old_value,new_value) VALUES(p_tenant_id,auth.uid(),'invoice_edit','billing',p_sale_id,jsonb_build_object('total',s.total,'customer_id',s.customer_id,'representative_id',s.representative_id),jsonb_build_object('total',total_new,'customer_id',p_customer_id,'representative_id',p_representative_id,'lines_changed',lines_changed));
 IF p_release THEN lease_result:=public.document_edit_lease(p_tenant_id,'sale',p_sale_id::text,p_window_id,'release',p_lock_token);END IF;
 RETURN jsonb_build_object('success',true,'new_total',total_new,'version',public._invoice_edit_snapshot(p_tenant_id,p_sale_id)->>'version','lock_released',p_release AND lease_result->>'state' IS DISTINCT FROM 'held');
END $function$;

CREATE OR REPLACE FUNCTION public.convert_quote_atomic(p_tenant_id uuid, p_quote_id uuid, p_window_id uuid, p_lock_token uuid, p_expected_version text, p_stock_site_id uuid, p_cash_session_id uuid, p_payments jsonb, p_lot_assignments jsonb DEFAULT '{}'::jsonb, p_ipm jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE q public.quotes%ROWTYPE; res jsonb; sid uuid; rec record; lot public.stock_lots%ROWTYPE; alloc record; prev numeric; nextq numeric; needed numeric; assigned numeric; method text; neg boolean; rep public.sales_representatives%ROWTYPE; cfg public.rep_commission_settings%ROWTYPE; typ text; base text; rate numeric; fixed numeric; margin numeric; baseval numeric; commission jsonb; gross numeric; realpaid numeric; ben public.ipm_beneficiaires%ROWTYPE; cv public.ipm_conventions%ROWTYPE; day date:=(now() AT TIME ZONE 'Africa/Dakar')::date; eligible numeric; ipm_part numeric; patient numeric; rounding numeric; docs jsonb; hdr jsonb;
BEGIN
 PERFORM public._assert_document_edit_lease(p_tenant_id,'quote',p_quote_id::text,p_window_id,p_lock_token);
 SELECT * INTO STRICT q FROM public.quotes WHERE id=p_quote_id AND tenant_id=p_tenant_id FOR UPDATE;
 IF p_lot_assignments IS NULL OR jsonb_typeof(p_lot_assignments)<>'object' THEN RAISE EXCEPTION 'Sélection de lots invalide.' USING ERRCODE='22023';END IF;
 IF p_ipm IS NOT NULL AND jsonb_typeof(p_ipm)<>'object' THEN RAISE EXCEPTION 'Prise en charge IPM invalide.' USING ERRCODE='22023';END IF;
 SELECT coalesce(settings->>'stock_method','none') INTO method FROM public.tenants WHERE id=p_tenant_id;
 IF method NOT IN ('none','cmup','lot') THEN RAISE EXCEPTION 'Méthode de stock inconnue.' USING ERRCODE='55000';END IF;
 SELECT CASE WHEN s.is_warehouse AND s.parent_site_id IS NOT NULL THEN coalesce(parent.allow_negative_stock,s.allow_negative_stock) ELSE s.allow_negative_stock END INTO neg
 FROM public.sites s LEFT JOIN public.sites parent ON parent.id=s.parent_site_id AND parent.tenant_id=s.tenant_id
 WHERE s.id=p_stock_site_id AND s.tenant_id=p_tenant_id AND s.is_active IS NOT FALSE;
 IF NOT FOUND OR public.current_user_can_access_site(p_stock_site_id) IS DISTINCT FROM true THEN RAISE EXCEPTION 'Dépôt inaccessible.' USING ERRCODE='42501';END IF;
 IF method<>'lot' AND p_lot_assignments<>'{}'::jsonb THEN RAISE EXCEPTION 'Les lots ne sont pas activés.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_each(p_lot_assignments) x WHERE jsonb_typeof(x.value)<>'array' OR NOT EXISTS(SELECT 1 FROM public.quote_items i JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE i.quote_id=q.id AND i.tenant_id=p_tenant_id AND a.id::text=x.key AND coalesce(a.track_stock,true))) THEN RAISE EXCEPTION 'Lot affecté à un article absent du devis ou non suivi.' USING ERRCODE='22023';END IF;
 IF EXISTS(SELECT 1 FROM public.quote_items WHERE quote_id=q.id AND tenant_id=p_tenant_id AND nullif(imei,'') IS NOT NULL) THEN RAISE EXCEPTION 'La conversion de lignes avec IMEI nécessite le parcours de traçabilité dédié.' USING ERRCODE='55000';END IF;
 IF p_cash_session_id IS NOT NULL AND public._cs_multi_enabled(p_tenant_id) THEN PERFORM public._cs_assert_operational(p_cash_session_id,p_tenant_id,q.site_id);END IF;
 -- A registered IPM beneficiary cannot be silently treated as an ordinary customer.
 IF q.customer_id IS NOT NULL AND EXISTS(SELECT 1 FROM public.ipm_beneficiaires b WHERE b.tenant_id=p_tenant_id AND b.customer_id=q.customer_id AND b.statut='actif' AND (b.date_debut_couverture IS NULL OR b.date_debut_couverture<=day) AND (b.date_fin_couverture IS NULL OR b.date_fin_couverture>=day)) THEN
  IF p_ipm IS NULL THEN RAISE EXCEPTION 'Confirmez la prise en charge IPM du client.' USING ERRCODE='55000';END IF;
  SELECT * INTO ben FROM public.ipm_beneficiaires b WHERE b.id=(p_ipm->>'beneficiaire_id')::uuid AND b.tenant_id=p_tenant_id AND b.customer_id=q.customer_id AND b.statut='actif' AND (b.date_debut_couverture IS NULL OR b.date_debut_couverture<=day) AND (b.date_fin_couverture IS NULL OR b.date_fin_couverture>=day) FOR SHARE;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.ipm_organismes o WHERE o.id=ben.organisme_id AND o.tenant_id=p_tenant_id AND o.is_active) THEN RAISE EXCEPTION 'Bénéficiaire ou organisme IPM indisponible.' USING ERRCODE='42501';END IF;
  SELECT * INTO cv FROM public.ipm_conventions c WHERE c.id=ben.convention_id AND c.tenant_id=p_tenant_id AND c.organisme_id=ben.organisme_id AND c.is_active AND (c.date_debut IS NULL OR c.date_debut<=day) AND (c.date_fin IS NULL OR c.date_fin>=day) FOR SHARE;
  IF NOT FOUND OR cv.taux_defaut NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Convention IPM invalide.' USING ERRCODE='55000';END IF;
  IF public._sale_vat_enabled(p_tenant_id,q.site_id) OR coalesce(q.discount,0)<>0 OR cv.plafond_jour IS NOT NULL OR cv.plafond_mois IS NOT NULL OR cv.plafond_annuel IS NOT NULL OR ben.plafond_individuel IS NOT NULL OR (cv.application_plafond='avant_calcul' AND cv.plafond_facture IS NOT NULL) THEN RAISE EXCEPTION 'Cette convention IPM nécessite un contrôle spécifique (TVA, remise ou plafond). Aucune facture créée.' USING ERRCODE='55000';END IF;
  docs:=coalesce(p_ipm->'documents','{}');
  IF ((cv.ordonnance_obligatoire OR cv.numero_ordonnance_obligatoire) AND nullif(btrim(coalesce(docs->>'numero_ordonnance','')),'') IS NULL) OR (cv.medecin_prescripteur_obligatoire AND nullif(btrim(coalesce(docs->>'medecin','')),'') IS NULL) OR ((cv.bon_prise_en_charge_obligatoire OR cv.numero_bon_obligatoire) AND nullif(btrim(coalesce(docs->>'numero_bon','')),'') IS NULL) OR (cv.matricule_obligatoire AND nullif(btrim(coalesce(ben.matricule,'')),'') IS NULL) THEN RAISE EXCEPTION 'Documents IPM obligatoires manquants.' USING ERRCODE='22023';END IF;
  SELECT coalesce(sum(i.total) FILTER(WHERE a.ipm_eligible IS NOT FALSE),0) INTO eligible FROM public.quote_items i JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE i.quote_id=q.id AND i.tenant_id=p_tenant_id;
  IF cv.mode_calcul NOT IN ('total_facture','ligne_par_ligne','articles_eligibles') OR cv.mode_arrondi NOT IN ('round','floor','ceil','round5','round10','round25','round50','round100') THEN RAISE EXCEPTION 'Règle de calcul IPM inconnue.' USING ERRCODE='55000';END IF;
  rounding:=CASE cv.mode_arrondi WHEN 'round5' THEN 5 WHEN 'round10' THEN 10 WHEN 'round25' THEN 25 WHEN 'round50' THEN 50 WHEN 'round100' THEN 100 ELSE 1 END;
  SELECT coalesce(sum(CASE cv.mode_arrondi WHEN 'floor' THEN floor(x) WHEN 'ceil' THEN ceil(x) ELSE round(x/rounding)*rounding END),0) INTO ipm_part FROM (
   SELECT i.total*cv.taux_defaut/100 x FROM public.quote_items i JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE i.quote_id=q.id AND i.tenant_id=p_tenant_id AND a.ipm_eligible IS NOT FALSE AND cv.mode_calcul='ligne_par_ligne'
   UNION ALL SELECT (CASE WHEN cv.mode_calcul='total_facture' THEN q.total ELSE eligible END)*cv.taux_defaut/100 WHERE cv.mode_calcul<>'ligne_par_ligne'
  ) vals;
  ipm_part:=greatest(0,least(q.total,ipm_part,coalesce(nullif(cv.plafond_facture,0),q.total)));patient:=q.total-ipm_part;
  IF (p_ipm->>'expected_part_ipm')::numeric IS DISTINCT FROM ipm_part THEN RAISE EXCEPTION 'La part IPM a changé. Vérifiez la répartition avant la conversion.' USING ERRCODE='40001';END IF;
 ELSIF p_ipm IS NOT NULL THEN RAISE EXCEPTION 'Aucune couverture IPM active pour ce client.' USING ERRCODE='42501';END IF;
 -- Existing checked conversion serializes creation, numbering, initial payment and status.
 -- Its release operation is transactional too: any failure below restores the quote and lease.
 res:=public.convert_checked_quote_to_sale(p_tenant_id,p_quote_id,p_window_id,p_lock_token,p_expected_version,p_stock_site_id,p_cash_session_id,p_payments);
 sid:=(res->>'sale_id')::uuid;
 SELECT total,coalesce(paid,0) INTO gross,realpaid FROM public.sales WHERE id=sid AND tenant_id=p_tenant_id FOR UPDATE;
 IF ben.id IS NOT NULL AND realpaid>patient THEN RAISE EXCEPTION 'Le règlement ou les acomptes dépassent la part du patient.' USING ERRCODE='22023';END IF;
 -- Freeze article and stock source on the invoice; do not deduct untracked services.
 UPDATE public.sale_items SET site_id=p_stock_site_id WHERE tenant_id=p_tenant_id AND sale_id=sid;
 FOR rec IN SELECT i.article_id,sum(i.quantity) qty FROM public.sale_items i JOIN public.articles a ON a.id=i.article_id AND a.tenant_id=p_tenant_id WHERE i.sale_id=sid AND i.tenant_id=p_tenant_id AND coalesce(a.track_stock,true) GROUP BY i.article_id ORDER BY i.article_id LOOP
  INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(p_tenant_id,rec.article_id,p_stock_site_id,0) ON CONFLICT(article_id,site_id) DO NOTHING;
  SELECT coalesce(quantity,0) INTO STRICT prev FROM public.stock_levels WHERE tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=p_stock_site_id FOR UPDATE;
  nextq:=prev-rec.qty;
  IF nextq<0 AND (method='lot' OR neg IS NOT TRUE) THEN RAISE EXCEPTION 'Stock insuffisant dans le dépôt de sortie.' USING ERRCODE='55000';END IF;
  IF method='lot' THEN
   IF NOT (p_lot_assignments ? rec.article_id::text) OR jsonb_array_length(p_lot_assignments->rec.article_id::text)=0 THEN RAISE EXCEPTION 'Sélectionnez les lots pour chaque article suivi.' USING ERRCODE='22023';END IF;
   IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_lot_assignments->rec.article_id::text) x(lot_id uuid,quantity numeric) WHERE lot_id IS NULL OR quantity IS NULL OR quantity<=0 OR quantity::text IN ('NaN','Infinity','-Infinity')) THEN RAISE EXCEPTION 'Quantités de lots invalides.' USING ERRCODE='22023';END IF;
   SELECT sum(quantity) INTO assigned FROM jsonb_to_recordset(p_lot_assignments->rec.article_id::text) x(lot_id uuid,quantity numeric);
   IF assigned IS DISTINCT FROM rec.qty THEN RAISE EXCEPTION 'La quantité affectée aux lots doit correspondre exactement au devis.' USING ERRCODE='22023';END IF;
   needed:=0;
   FOR alloc IN SELECT lot_id,sum(quantity) qty FROM jsonb_to_recordset(p_lot_assignments->rec.article_id::text) x(lot_id uuid,quantity numeric) GROUP BY lot_id ORDER BY lot_id LOOP
    SELECT * INTO lot FROM public.stock_lots WHERE id=alloc.lot_id AND tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=p_stock_site_id FOR UPDATE;
    IF NOT FOUND OR lot.remaining_quantity<alloc.qty OR (lot.expiry_date IS NOT NULL AND lot.expiry_date<day) THEN RAISE EXCEPTION 'Lot insuffisant, périmé ou hors dépôt.' USING ERRCODE='55000';END IF;
    UPDATE public.stock_lots SET remaining_quantity=remaining_quantity-alloc.qty WHERE id=lot.id AND tenant_id=p_tenant_id;
    -- Allocate each consumed lot across the exact invoice lines; repeated article lines share one stock reservation.
    INSERT INTO public.sale_lot_deductions(tenant_id,sale_id,sale_item_id,lot_id,article_id,site_id,quantity)
    WITH ordered AS (SELECT i.id,i.quantity,sum(i.quantity) OVER(ORDER BY i.id ROWS UNBOUNDED PRECEDING) AS end_qty FROM public.sale_items i WHERE i.tenant_id=p_tenant_id AND i.sale_id=sid AND i.article_id=rec.article_id),
    portions AS (SELECT id,greatest(0,least(end_qty,needed+alloc.qty)-greatest(end_qty-quantity,needed)) qty FROM ordered)
    SELECT p_tenant_id,sid,id,lot.id,rec.article_id,p_stock_site_id,qty FROM portions WHERE qty>0;
    needed:=needed+alloc.qty;
   END LOOP;
   UPDATE public.sale_items i SET purchase_cost=c.weighted_cost FROM (
    SELECT d.sale_item_id,sum(d.quantity*l.purchase_price)/sum(d.quantity) weighted_cost FROM public.sale_lot_deductions d JOIN public.stock_lots l ON l.id=d.lot_id AND l.tenant_id=p_tenant_id
    WHERE d.tenant_id=p_tenant_id AND d.sale_id=sid AND d.article_id=rec.article_id GROUP BY d.sale_item_id
   ) c WHERE i.id=c.sale_item_id AND i.tenant_id=p_tenant_id AND i.sale_id=sid;
  END IF;
  UPDATE public.stock_levels SET quantity=nextq,updated_at=now() WHERE tenant_id=p_tenant_id AND article_id=rec.article_id AND site_id=p_stock_site_id;
  INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id,user_id,note) VALUES(p_tenant_id,rec.article_id,p_stock_site_id,'sale',-rec.qty,prev,nextq,'sale',sid,auth.uid(),'Facture '||(res->>'sale_number')||' (devis converti)');
 END LOOP;
 -- Calculate the representative commission from server-side settings and actual historical costs.
 IF q.representative_id IS NOT NULL THEN
  SELECT * INTO rep FROM public.sales_representatives WHERE tenant_id=p_tenant_id AND id=q.representative_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Représentant du devis introuvable.' USING ERRCODE='55000';END IF;
  SELECT * INTO cfg FROM public.rep_commission_settings WHERE tenant_id=p_tenant_id;
  IF cfg.enabled IS TRUE THEN
   typ:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN rep.commission_type ELSE cfg.commission_type END;
   base:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN coalesce(rep.commission_base,cfg.commission_base) ELSE cfg.commission_base END;
   rate:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN coalesce(rep.commission_rate,0) ELSE cfg.rate END;
   fixed:=CASE WHEN rep.commission_override AND rep.commission_type IS NOT NULL THEN coalesce(rep.commission_fixed,0) ELSE cfg.fixed_amount END;
   IF typ NOT IN ('pct_ca','fixe','pct_marge') OR base NOT IN ('ht','ttc','net','marge') OR rate<0 OR fixed<0 THEN RAISE EXCEPTION 'Règle de commission invalide.' USING ERRCODE='55000';END IF;
   SELECT q.total-coalesce(sum(quantity*purchase_cost),0) INTO margin FROM public.sale_items WHERE tenant_id=p_tenant_id AND sale_id=sid;
   baseval:=CASE base WHEN 'marge' THEN margin WHEN 'ttc' THEN gross WHEN 'net' THEN q.total ELSE q.total END;
   commission:=jsonb_build_object('type',typ,'base',base,'rate',rate,'fixed_amount',fixed,'base_amount',round(baseval,2),'amount',round(greatest(0,CASE typ WHEN 'fixe' THEN fixed WHEN 'pct_marge' THEN margin*rate/100 ELSE baseval*rate/100 END),2),'computed_at',now());
  END IF;
 END IF;
 hdr:=CASE WHEN q.doc_header IS NULL THEN NULL ELSE (q.doc_header-'doc_date')||jsonb_build_object('doc_date',day::text) END;
 UPDATE public.sales SET representative_id=q.representative_id,rep_commission=commission,doc_header=hdr,status=CASE WHEN coalesce(paid,0)>=total THEN 'paid' WHEN coalesce(paid,0)>0 THEN 'partial' ELSE 'validated' END WHERE id=sid AND tenant_id=p_tenant_id;
 IF ben.id IS NOT NULL THEN
  INSERT INTO public.ipm_ventes(tenant_id,organisme_id,beneficiaire_id,convention_id,sale_id,date_vente,part_ipm,part_client,montant_total,part_beneficiaire_payee,statut,numero_ordonnance,medecin_prescripteur,numero_bon_pec,taux_prise_en_charge,montant_eligible,montant_non_eligible)
  VALUES(p_tenant_id,ben.organisme_id,ben.id,cv.id,sid,day,ipm_part,patient,gross,least(realpaid,patient),'en_attente',nullif(docs->>'numero_ordonnance',''),nullif(docs->>'medecin',''),nullif(docs->>'numero_bon',''),cv.taux_defaut,eligible,q.total-eligible);
  -- The IPM receivable is not a cash payment; keep sales.paid equal to actual payments/credits.
 END IF;
 IF q.customer_id IS NOT NULL THEN PERFORM public.recalculate_customer_balance(q.customer_id);END IF;
 INSERT INTO public.quote_conversion_stock_trace(tenant_id,sale_id,stock_manifest,lot_manifest)
 SELECT p_tenant_id,sid,(SELECT coalesce(jsonb_agg(jsonb_build_array(article_id,site_id,trim_scale(qty)) ORDER BY article_id,site_id),'[]') FROM (SELECT article_id,site_id,-sum(quantity) qty FROM public.stock_movements WHERE tenant_id=p_tenant_id AND reference_id=sid AND reference_type='sale' GROUP BY article_id,site_id) x),(SELECT coalesce(jsonb_agg(jsonb_build_array(lot_id,article_id,site_id,trim_scale(qty)) ORDER BY lot_id,article_id,site_id),'[]') FROM (SELECT lot_id,article_id,site_id,sum(quantity) qty FROM public.sale_lot_deductions WHERE tenant_id=p_tenant_id AND sale_id=sid GROUP BY lot_id,article_id,site_id) x);
 RETURN res||jsonb_build_object('stock_atomic',true,'part_ipm',ipm_part,'part_client',patient);
END $function$;
