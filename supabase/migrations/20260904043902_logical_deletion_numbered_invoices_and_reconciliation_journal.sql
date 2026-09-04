/*
# Suppression logique des factures numérotées + journal technique de réconciliation

## Objectif
Rendre la suppression d'une facture conforme aux normes comptables : une pièce
numérotée n'est plus jamais effacée physiquement, mais marquée comme supprimée
(suppression logique) tout en restant consultable. Le solde client est corrigé sans
créer d'écriture financière « réconciliation » : l'écart éventuel est consigné dans
un journal technique séparé, invisible dans le compte client.

## 1. Table sales — colonnes de suppression logique
- `deleted_at` (timestamptz) : date de la suppression logique. NULL = active.
- `deleted_by` (uuid) : auteur de la suppression.
- `deletion_reason` (text) : motif réellement saisi.
- Nouveau statut applicatif `deleted` (aucune contrainte CHECK sur status ; valeur libre).

## 2. Table sale_deletion_log — traçabilité enrichie
Ajout de `customer_id`, `site_id`, `sale_date` (date d'origine de la facture).

## 3. Nouvelle table balance_reconciliation_log (journal technique)
Consigne les écarts de re-synchronisation du solde technique en cache, séparément
des écritures financières. RLS activée, lecture réservée aux membres du tenant.

## 4. recalculate_customer_balance — réécriture
- Exclut désormais les ventes supprimées (`deleted_at IS NULL`) et annulées.
- Ne crée plus d'écriture `reconciliation` dans balance_adjustments : met simplement à
  jour le solde en cache et journalise l'écart dans balance_reconciliation_log.

## 5. delete_sale_and_recalculate — suppression logique
- Pour toute facture numérotée : marque la vente `status='deleted'` + horodatage +
  auteur + motif, restaure le stock une seule fois, conserve la pièce, puis recalcule
  le solde (la dette disparaît, sans ligne « réconciliation »).
- Seuls d'éventuels brouillons sans numéro seraient effacés physiquement.
- Motif obligatoire (plus de valeur codée en dur).

## 6. Rapports & balances — exclusions
- get_tiers_balance (x2), get_customers_report : excluent les ventes supprimées et
  les écritures `reconciliation` / `cancel_reversal` des soldes affichés.
- rpc_paginated_invoices : masque les factures supprimées du journal des ventes.

## Sécurité
Toutes les fonctions restent SECURITY DEFINER (sauf celles déjà STABLE/invoker),
search_path=public, EXECUTE réservé aux rôles déjà en place.
*/

-- 1. Colonnes de suppression logique sur sales
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales' AND column_name='deleted_at') THEN
    ALTER TABLE public.sales ADD COLUMN deleted_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales' AND column_name='deleted_by') THEN
    ALTER TABLE public.sales ADD COLUMN deleted_by uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales' AND column_name='deletion_reason') THEN
    ALTER TABLE public.sales ADD COLUMN deletion_reason text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_deleted_at ON public.sales (tenant_id, deleted_at);

-- 2. Traçabilité enrichie du journal de suppression
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sale_deletion_log' AND column_name='customer_id') THEN
    ALTER TABLE public.sale_deletion_log ADD COLUMN customer_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sale_deletion_log' AND column_name='site_id') THEN
    ALTER TABLE public.sale_deletion_log ADD COLUMN site_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sale_deletion_log' AND column_name='sale_date') THEN
    ALTER TABLE public.sale_deletion_log ADD COLUMN sale_date timestamptz;
  END IF;
END $$;

-- 3. Journal technique de réconciliation (séparé des écritures financières)
CREATE TABLE IF NOT EXISTS public.balance_reconciliation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  previous_balance numeric NOT NULL,
  computed_balance numeric NOT NULL,
  delta numeric NOT NULL,
  note text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.balance_reconciliation_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "recon_log_select_tenant" ON public.balance_reconciliation_log;
CREATE POLICY "recon_log_select_tenant" ON public.balance_reconciliation_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- 4. recalculate_customer_balance : plus d'écriture reconciliation, journal technique
CREATE OR REPLACE FUNCTION public.recalculate_customer_balance(p_customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_stored numeric;
v_computed numeric;
v_delta numeric;
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

-- Ventes réelles : ni annulées, ni supprimées logiquement
SELECT COALESCE(SUM(total), 0)
INTO v_sales FROM public.sales
WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
AND status <> 'cancelled' AND deleted_at IS NULL;

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

-- Exclure reconciliation (technique) ET cancel_reversal (déjà reflété)
SELECT COALESCE(SUM(amount), 0)
INTO v_adjustments FROM public.balance_adjustments
WHERE entity_id = p_customer_id AND tenant_id = v_tenant_id
AND entity_type = 'customer'
AND kind NOT IN ('reconciliation','cancel_reversal');

v_computed := v_sales - v_payments - v_prepays - v_avoirs + v_withdrawals + v_loans + v_adjustments;
v_delta := v_computed - v_stored;

IF v_delta = 0 THEN
RETURN jsonb_build_object('customer_id', p_customer_id, 'stored', v_stored, 'computed', v_computed, 'corrected', false);
END IF;

-- Écart : mise à jour du solde en cache + journal technique séparé (pas d'écriture financière)
UPDATE public.customers SET balance = v_computed
WHERE id = p_customer_id AND tenant_id = v_tenant_id;

INSERT INTO public.balance_reconciliation_log (
tenant_id, customer_id, previous_balance, computed_balance, delta, note, user_id
) VALUES (
v_tenant_id, p_customer_id, v_stored, v_computed, v_delta,
'Resynchronisation technique du solde en cache', auth.uid()
);

RETURN jsonb_build_object('customer_id', p_customer_id, 'stored', v_stored, 'computed', v_computed, 'corrected', true, 'delta', v_delta);
END;
$function$;

-- 5. delete_sale_and_recalculate : suppression logique des factures numérotées
CREATE OR REPLACE FUNCTION public.delete_sale_and_recalculate(
  p_sale_id uuid,
  p_tenant_id uuid,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Idempotence : déjà supprimée logiquement
  IF v_sale.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'restored_total', 0, 'already_deleted', true);
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

  SELECT EXISTS(SELECT 1 FROM cash_movements WHERE reference_id = p_sale_id AND tenant_id = v_tenant_id) INTO v_has_cash;
  IF v_has_cash THEN
    RETURN jsonb_build_object('success', false, 'error', 'Un mouvement de caisse est lié à cette vente. Suppression impossible.');
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Un motif de suppression est obligatoire');
  END IF;

  -- Restauration du stock (une seule fois)
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

  -- Journal de suppression enrichi
  INSERT INTO sale_deletion_log (tenant_id, sale_id_snapshot, sale_number, sale_total, reason, user_id, customer_id, site_id, sale_date)
  VALUES (v_tenant_id, p_sale_id, v_sale.sale_number, v_sale.total, btrim(p_reason), v_user_id, v_sale.customer_id, v_sale.site_id, v_sale.created_at);

  IF v_sale.sale_number IS NULL THEN
    -- Brouillon jamais numéroté : effacement physique autorisé
    DELETE FROM sale_lot_deductions WHERE sale_id = p_sale_id;
    DELETE FROM sale_items WHERE sale_id = p_sale_id;
    DELETE FROM sales WHERE id = p_sale_id;
  ELSE
    -- Facture numérotée : suppression logique, pièce conservée
    UPDATE sales
    SET status = 'deleted', deleted_at = now(), deleted_by = v_user_id, deletion_reason = btrim(p_reason)
    WHERE id = p_sale_id;
  END IF;

  IF v_sale.customer_id IS NOT NULL THEN
    PERFORM public.recalculate_customer_balance(v_sale.customer_id);
  END IF;

  RETURN jsonb_build_object('success', true, 'restored_total', v_sale.total, 'logical', v_sale.sale_number IS NOT NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid, text) TO authenticated;

-- Wrapper 2 arguments : motif désormais obligatoire (plus de valeur codée en dur)
CREATE OR REPLACE FUNCTION public.delete_sale_and_recalculate(
  p_sale_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.delete_sale_and_recalculate(p_sale_id, p_tenant_id, '');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid) TO authenticated;
