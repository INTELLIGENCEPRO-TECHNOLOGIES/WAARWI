/*
# Empêcher qu'une correction de solde soit ventilée comme un crédit réutilisable

## Contexte du problème
Quand une facture à crédit jamais payée est annulée, le solde du client est ramené
à zéro par une écriture technique de type `reconciliation` (ou `cancel_reversal`).
Ces écritures sont de simples CORRECTIONS/TRACES : elles ne représentent PAS de
l'argent que le client aurait versé d'avance.

L'ancien moteur de ventilation de crédit considérait TOUTE écriture de solde
négative comme du crédit disponible. Résultat : lors de la création d'une nouvelle
facture, il « réglait » automatiquement celle-ci avec ce crédit imaginaire
(ligne « Règlement par solde créditeur »), alors que le client devait toujours
l'argent. La facture apparaissait payée mais le solde restait dû (incohérence).

## Modifications

### 1. Fonction `_allocate_negative_adjustments_to_invoices` (corrigée)
  - On exclut désormais les écritures de type `reconciliation` et `cancel_reversal`
    de la source de crédit. Seuls les vrais crédits (`manual`, `carryover`, etc.)
    peuvent être ventilés sur les factures impayées.
  - Empêche définitivement qu'une facture soit réglée avec un crédit inexistant.

### 2. Réparation ciblée du cas ALIOUNE SALL / facture F-00037
  - Suppression de la ligne « Règlement par solde créditeur » fantôme (80 000).
  - Remise de la facture F-00037 en statut non payée (paid = 0).
  - Remise à zéro du montant consommé sur l'écriture de réconciliation.
  - Suppression de la trace d'allocation correspondante.
  - Le solde du client reste inchangé (80 000 dû, ce qui est le bon chiffre).

## Notes importantes
1. Aucune donnée financière réelle n'est perdue : on retire uniquement une
   écriture technique erronée générée automatiquement.
2. Le solde du client n'est pas modifié par cette réparation.
*/

-- ============================================================
-- 1. Correction de la cause : exclure les corrections de la ventilation de crédit
-- ============================================================
CREATE OR REPLACE FUNCTION public._allocate_negative_adjustments_to_invoices(p_customer_id uuid, p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_adj record;
  v_sale record;
  v_available numeric;
  v_due numeric;
  v_to_apply numeric;
  v_total_applied numeric := 0;
  v_applied_details jsonb := '[]'::jsonb;
  v_existing boolean;
BEGIN
  -- Lock customer row to prevent concurrent race
  PERFORM 1 FROM public.customers
  WHERE id = p_customer_id AND tenant_id = p_tenant_id
  FOR UPDATE;

  -- Iterate negative balance_adjustments with unused credit (FIFO)
  -- IMPORTANT: exclude 'reconciliation' and 'cancel_reversal' — these are
  -- technical corrections/traces, NOT real reusable customer credit.
  FOR v_adj IN
    SELECT ba.* FROM public.balance_adjustments ba
    WHERE ba.tenant_id = p_tenant_id
      AND ba.entity_type = 'customer'
      AND ba.entity_id = p_customer_id
      AND ba.amount < 0
      AND COALESCE(ba.kind, 'manual') NOT IN ('reconciliation', 'cancel_reversal')
      AND (abs(ba.amount) - COALESCE(ba.amount_used, 0)) > 0
    ORDER BY ba.created_at ASC
    FOR UPDATE
  LOOP
    v_available := abs(v_adj.amount) - COALESCE(v_adj.amount_used, 0);
    IF v_available <= 0 THEN CONTINUE; END IF;

    -- Apply to unpaid invoices (FIFO by creation date)
    -- Status 'validated' = unpaid, 'partial' = partially paid
    FOR v_sale IN
      SELECT s.* FROM public.sales s
      WHERE s.tenant_id = p_tenant_id
        AND s.customer_id = p_customer_id
        AND s.status IN ('validated', 'partial')
        AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
      ORDER BY s.created_at ASC
      FOR UPDATE
    LOOP
      EXIT WHEN v_available <= 0;

      SELECT EXISTS(
        SELECT 1 FROM public.credit_allocations
        WHERE source_id = v_adj.id AND target_id = v_sale.id
          AND source_type = 'negative_adjustment' AND target_type = 'invoice'
      ) INTO v_existing;
      IF v_existing THEN CONTINUE; END IF;

      v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
      IF v_due <= 0 THEN CONTINUE; END IF;

      v_to_apply := LEAST(v_available, v_due);

      INSERT INTO public.sale_payments (
        tenant_id, sale_id, payment_method_id, method_name, amount, reference,
        affects_balance
      ) VALUES (
        p_tenant_id, v_sale.id, NULL,
        'Règlement par solde créditeur', v_to_apply,
        COALESCE(v_adj.note, 'Report de solde'),
        false
      );

      UPDATE public.sales
      SET paid = COALESCE(paid, 0) + v_to_apply,
          status = CASE
            WHEN COALESCE(paid, 0) + v_to_apply >= total THEN 'paid'
            ELSE 'partial'
          END
      WHERE id = v_sale.id;

      UPDATE public.balance_adjustments
      SET amount_used = COALESCE(amount_used, 0) + v_to_apply
      WHERE id = v_adj.id;

      INSERT INTO public.credit_allocations (
        tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
      ) VALUES (
        p_tenant_id, p_customer_id, 'negative_adjustment', v_adj.id, 'invoice', v_sale.id, v_to_apply
      )
      ON CONFLICT ON CONSTRAINT uq_credit_allocation_source_target
      DO UPDATE SET amount = public.credit_allocations.amount + EXCLUDED.amount;

      v_available := v_available - v_to_apply;
      v_total_applied := v_total_applied + v_to_apply;
      v_applied_details := v_applied_details || jsonb_build_object(
        'sale_id', v_sale.id, 'adjustment_id', v_adj.id, 'amount', v_to_apply
      );
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'total_applied', v_total_applied,
    'details', v_applied_details
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._allocate_negative_adjustments_to_invoices(uuid, uuid) FROM authenticated;

-- ============================================================
-- 2. Nettoyage ciblé du cas F-00037 (règlement fantôme)
-- ============================================================
DO $$
DECLARE
  v_sale_id uuid := '290e9daa-42e1-4a3b-8013-841a0707adb0';
  v_adj_id uuid := 'c4946202-bf43-4b92-8470-294d682dbd4d';
BEGIN
  -- Supprimer la ligne d'allocation traçant le crédit fantôme
  DELETE FROM public.credit_allocations
  WHERE source_id = v_adj_id AND target_id = v_sale_id
    AND source_type = 'negative_adjustment';

  -- Supprimer le règlement fantôme (justification, n'affecte pas le solde)
  DELETE FROM public.sale_payments
  WHERE sale_id = v_sale_id
    AND affects_balance = false
    AND method_name = 'Règlement par solde créditeur';

  -- Remettre la facture en statut non payée
  UPDATE public.sales
  SET paid = 0, status = 'validated'
  WHERE id = v_sale_id;

  -- Remettre à zéro le montant consommé sur l'écriture de réconciliation
  UPDATE public.balance_adjustments
  SET amount_used = 0
  WHERE id = v_adj_id;
END $$;
