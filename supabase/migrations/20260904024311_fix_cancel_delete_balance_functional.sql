/*
# Correction fonctionnelle : annulation / suppression de factures et solde client

Cette migration corrige, pour TOUS les tenants, la logique serveur d'annulation et
de suppression des factures ainsi que le calcul du solde client. Elle ne touche
aux données d'aucun tenant (aucun UPDATE de masse) ; seules les fonctions sont
réécrites.

## 1. Table balance_adjustments
- La contrainte CHECK sur `kind` accepte désormais deux valeurs supplémentaires :
  - `cancel_reversal` : contre-passation d'annulation, conservée comme trace visible
    mais JAMAIS comptée dans le solde (le solde exclut déjà les ventes annulées).
  - `cancel_refund` : neutralisation du crédit lorsqu'un remboursement espèces a
    effectivement quitté la caisse (compté dans le solde).

## 2. recalculate_customer_balance
- Les ajustements de type `cancel_reversal` sont désormais exclus de la somme, au
  même titre que `reconciliation`, afin qu'une contre-passation d'annulation ne soit
  jamais comptée deux fois (une fois par l'exclusion de la vente annulée, une fois
  par l'ajustement).

## 3. cancel_sale (version 5 arguments) — réécriture
- Verrou de la vente (FOR UPDATE), idempotence (2e appel = aucun nouvel effet).
- Une vente réglée en espèces EXIGE une action de paiement explicite
  (`keep_credit` ou `refund_cash`). Sinon l'annulation est refusée.
- `refund_cash` : vérifie AVANT toute modification qu'une session de caisse OUVERTE
  existe pour le bon tenant + point de vente ; refuse entièrement sinon. Le
  mouvement de caisse créé est de type `refund` (jamais `expense`).
- `keep_credit` : le montant réellement encaissé reste en crédit client, une seule
  fois, sans mouvement de caisse supplémentaire.
- Vente à crédit non réglée : seule la dette est annulée (solde net 0).
- Restauration du stock à partir des lots réellement utilisés (sale_lot_deductions),
  sinon repli sur stock_levels au dépôt réel de la vente. Si le dépôt d'origine est
  indéterminable, l'annulation est BLOQUÉE.
- Le solde client est resynchronisé via recalculate_customer_balance (source unique).

## 4. cancel_sale (version 2 arguments) — sécurisée
- Refuse désormais l'annulation d'une vente ayant reçu un règlement réel : le
  traitement du paiement doit être précisé via la version à 5 arguments.

## 5. delete_sale_and_recalculate — durcissement
- Bloque en plus si un mouvement de caisse est lié à la vente.
- Retire la dette de la vente du compte client (recalcul du solde après suppression).
- Reste entièrement atomique et journalisé (sale_deletion_log).

## Sécurité
- Fonctions SECURITY DEFINER, search_path = public, EXECUTE réservé à authenticated.
*/

-- 1. Étendre les types d'ajustement autorisés
ALTER TABLE balance_adjustments DROP CONSTRAINT IF EXISTS balance_adjustments_kind_check;
ALTER TABLE balance_adjustments ADD CONSTRAINT balance_adjustments_kind_check
  CHECK (kind = ANY (ARRAY['manual','carryover','reconciliation','cancel_reversal','cancel_refund']));

-- 2. recalculate_customer_balance : exclure cancel_reversal de la somme
CREATE OR REPLACE FUNCTION public.recalculate_customer_balance(p_customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_stored numeric;
v_computed numeric;
v_delta numeric;
v_adj_id uuid;
v_sales numeric;
v_payments numeric;
v_prepays numeric;
v_avoirs numeric;
v_withdrawals numeric;
v_loans numeric;
v_adjustments numeric;
BEGIN
v_tenant_id := public.current_tenant_id();
IF v_tenant_id IS NULL THEN
SELECT tenant_id INTO v_tenant_id FROM public.customers WHERE id = p_customer_id LIMIT 1;
END IF;
IF v_tenant_id IS NULL THEN
RAISE EXCEPTION 'Client introuvable: %', p_customer_id;
END IF;

SELECT balance INTO v_stored FROM public.customers
WHERE id = p_customer_id AND tenant_id = v_tenant_id
FOR UPDATE;

IF v_stored IS NULL THEN v_stored := 0; END IF;

SELECT COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0)
INTO v_sales FROM public.sales
WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id;

SELECT COALESCE(SUM(sp.amount), 0)
INTO v_payments FROM public.sale_payments sp
JOIN public.sales s ON s.id = sp.sale_id
WHERE s.customer_id = p_customer_id AND s.tenant_id = v_tenant_id
AND COALESCE(sp.affects_balance, true) = true;

SELECT COALESCE(SUM(amount), 0)
INTO v_prepays FROM public.customer_prepayments
WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id;

SELECT COALESCE(SUM(total), 0)
INTO v_avoirs FROM public.sale_returns
WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
AND status = 'approved' AND refund_method = 'avoir';

SELECT COALESCE(SUM(amount), 0)
INTO v_withdrawals FROM public.cash_movements
WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
AND kind = 'customer_withdrawal';

SELECT COALESCE(SUM(amount), 0)
INTO v_loans FROM public.cash_movements
WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
AND kind = 'customer_loan';

-- Exclure reconciliation (audit) ET cancel_reversal (contre-passation déjà
-- reflétée par l'exclusion des ventes annulées) pour éviter tout double comptage.
SELECT COALESCE(SUM(amount), 0)
INTO v_adjustments FROM public.balance_adjustments
WHERE entity_id = p_customer_id AND tenant_id = v_tenant_id
AND entity_type = 'customer'
AND kind NOT IN ('reconciliation','cancel_reversal');

v_computed := v_sales - v_payments - v_prepays - v_avoirs + v_withdrawals + v_loans + v_adjustments;
v_delta := v_computed - v_stored;

IF v_delta = 0 THEN
RETURN jsonb_build_object(
'customer_id', p_customer_id,
'stored', v_stored,
'computed', v_computed,
'corrected', false
);
END IF;

INSERT INTO public.balance_adjustments (
id, tenant_id, entity_type, entity_id,
previous_balance, new_balance, amount, note, kind, user_id
) VALUES (
gen_random_uuid(), v_tenant_id, 'customer', p_customer_id,
v_stored, v_computed, v_delta,
'Réconciliation automatique (ancien: ' || v_stored || ', calculé: ' || v_computed || ')',
'reconciliation', auth.uid()
) RETURNING id INTO v_adj_id;

UPDATE public.customers SET balance = v_computed
WHERE id = p_customer_id AND tenant_id = v_tenant_id;

RETURN jsonb_build_object(
'customer_id', p_customer_id,
'stored', v_stored,
'computed', v_computed,
'corrected', true,
'adjustment_id', v_adj_id,
'delta', v_delta
);
END;
$function$;

-- 3. cancel_sale (5 arguments) — réécriture
CREATE OR REPLACE FUNCTION public.cancel_sale(
  p_sale_id uuid,
  p_tenant_id uuid,
  p_cancel_reason text DEFAULT ''::text,
  p_payment_action text DEFAULT 'none'::text,
  p_cash_session_id uuid DEFAULT NULL::uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
PERFORM public.assert_tenant_access(p_tenant_id);

SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id FOR UPDATE;
IF v_sale IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
END IF;

-- Idempotence
IF v_sale.status = 'cancelled' THEN
RETURN jsonb_build_object('success', true, 'already_cancelled', true);
END IF;

IF v_sale.accounting_status = 'accounted' THEN
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
IF v_ipm IS NOT NULL AND v_ipm.bordereau_id IS NOT NULL THEN
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
IF p_payment_action NOT IN ('keep_credit','refund_cash') THEN
RETURN jsonb_build_object(
'success', false,
'error', 'Cette vente a été réglée. Précisez le traitement du paiement (conserver en crédit ou rembourser en espèces).',
'requires_payment_action', true,
'real_paid', v_real_paid
);
END IF;

-- Remboursement espèces : session de caisse ouverte obligatoire AVANT toute modification
IF p_payment_action = 'refund_cash' THEN
IF p_cash_session_id IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Aucune session de caisse ouverte : remboursement impossible.', 'requires_open_session', true);
END IF;
SELECT * INTO v_session FROM cash_sessions
WHERE id = p_cash_session_id AND tenant_id = v_tenant_id AND site_id = v_sale.site_id AND status = 'open'
FOR UPDATE;
IF v_session IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'La session de caisse indiquée n''est pas ouverte pour ce point de vente : remboursement impossible.', 'requires_open_session', true);
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

-- 4. cancel_sale (2 arguments) — sécurisée : refuse les ventes réglées
CREATE OR REPLACE FUNCTION public.cancel_sale(p_sale_id uuid, p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid := current_tenant_id();
v_real numeric := 0;
BEGIN
PERFORM public.assert_tenant_access(p_tenant_id);
SELECT COALESCE(SUM(
CASE WHEN sp.affects_balance AND COALESCE(pm.payment_type, '') <> 'credit' THEN sp.amount ELSE 0 END
), 0) INTO v_real
FROM sale_payments sp
LEFT JOIN payment_methods pm ON pm.id = sp.payment_method_id
WHERE sp.sale_id = p_sale_id;

IF v_real > 0 THEN
RETURN jsonb_build_object(
'success', false,
'error', 'Cette vente a été réglée : précisez le traitement du paiement (conserver en crédit ou rembourser en espèces).',
'requires_payment_action', true
);
END IF;

RETURN public.cancel_sale(p_sale_id, p_tenant_id, 'Annulation', 'none', NULL);
END;
$function$;

-- 5. delete_sale_and_recalculate (3 arguments) — durcissement
CREATE OR REPLACE FUNCTION public.delete_sale_and_recalculate(p_sale_id uuid, p_tenant_id uuid, p_reason text DEFAULT ''::text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
v_has_cash boolean;
BEGIN
PERFORM public.assert_tenant_access(p_tenant_id);

SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id FOR UPDATE;
IF v_sale IS NULL THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
END IF;

IF v_sale.status = 'cancelled' THEN
RETURN jsonb_build_object('success', false, 'error', 'Une facture annulée ne peut pas être supprimée');
END IF;

IF v_sale.accounting_status = 'accounted' THEN
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

-- Garde supplémentaire : mouvement de caisse lié à la vente
SELECT EXISTS(
SELECT 1 FROM cash_movements
WHERE tenant_id = v_tenant_id AND reference = 'sale_cancel_' || p_sale_id::text
) INTO v_has_cash;
IF v_has_cash THEN
RETURN jsonb_build_object('success', false, 'error', 'Un mouvement de caisse est lié à cette vente. Suppression impossible.');
END IF;

IF COALESCE(p_reason, '') = '' THEN
RETURN jsonb_build_object('success', false, 'error', 'Un motif de suppression est obligatoire');
END IF;

-- Restauration du stock
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
v_deduction.quantity, v_previous, v_new, 'sale_delete', p_sale_id, v_user_id,
'Restauration stock - suppression vente ' || v_sale.sale_number);
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
v_line.quantity, v_previous, v_new, 'sale_delete', p_sale_id, v_user_id,
'Restauration stock - suppression vente ' || v_sale.sale_number);
END IF;
END LOOP;
END IF;

-- Journal de suppression (conserve le numéro, jamais réutilisé)
INSERT INTO sale_deletion_log (tenant_id, sale_id_snapshot, sale_number, sale_total, reason, user_id)
VALUES (v_tenant_id, p_sale_id, v_sale.sale_number, v_sale.total, p_reason, v_user_id);

-- Suppression atomique
DELETE FROM sale_lot_deductions WHERE sale_id = p_sale_id;
DELETE FROM sale_items WHERE sale_id = p_sale_id;
DELETE FROM sale_payments WHERE sale_id = p_sale_id;
DELETE FROM sales WHERE id = p_sale_id;

-- Retire la dette de la vente du compte client
IF v_sale.customer_id IS NOT NULL THEN
PERFORM public.recalculate_customer_balance(v_sale.customer_id);
END IF;

RETURN jsonb_build_object('success', true, 'restored_total', v_sale.total, 'sale_number', v_sale.sale_number);
END;
$function$;

-- Droits d'exécution
REVOKE ALL ON FUNCTION public.recalculate_customer_balance(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.recalculate_customer_balance(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_sale(uuid, uuid, text, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, uuid, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_sale(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid, text) TO authenticated;
