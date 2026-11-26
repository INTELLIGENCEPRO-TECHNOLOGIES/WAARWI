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
IF v_sale.vat_enabled_at_issue IS TRUE THEN RAISE EXCEPTION 'Utilisez un avoir pour corriger une facture émise avec TVA.';END IF;
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
IF v_ipm.id IS NOT NULL AND (v_ipm.bordereau_id IS NOT NULL OR v_ipm.statut IS DISTINCT FROM 'en_attente') THEN
RETURN jsonb_build_object('success', false, 'error', 'L''opération IPM de cette vente appartient déjà à un bordereau. Annulation impossible.');
END IF;

IF COALESCE(btrim(p_cancel_reason), '') = '' THEN
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

IF v_ipm.id IS NOT NULL AND v_ipm.statut = 'en_attente' THEN
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
