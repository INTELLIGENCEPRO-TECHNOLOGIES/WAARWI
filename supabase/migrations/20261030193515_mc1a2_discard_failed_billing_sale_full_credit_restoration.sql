/*
# MC1-A.2 — Nettoyage sécurisé des factures échouées : restitution intégrale des crédits

## Contexte
`discard_failed_billing_sale(uuid)` (créée en MC1-A.1) supprime une facture de facturation
dont l'enregistrement a échoué (lignes ou règlements). À la création, le trigger
`sales_apply_prepayments` peut déjà avoir imputé automatiquement sur cette facture :
- des acomptes (`customer_prepayments.amount_used`, allocation `prepay`) ;
- des soldes créditeurs (`balance_adjustments.amount_used`, allocation `negative_adjustment`) ;
et, si une imputation d'avoirs a lieu en parallèle, des avoirs (`sale_returns.credit_used`, allocation `avoir`).

## Défauts corrigés (seule cette fonction est remplacée)
1. Les allocations de type `avoir` étaient refusées : elles sont désormais restituées
   exactement sur `sale_returns.credit_used`.
2. La restitution utilisait `GREATEST(0, …)`, qui masquait silencieusement une incohérence :
   toute restitution impossible à l'identique lève maintenant une erreur et annule tout.
3. Aucune vérification que les règlements automatiques de la facture (affects_balance=false)
   correspondaient exactement aux allocations : l'égalité des totaux est désormais exigée.
4. Les sources de crédit n'étaient pas verrouillées explicitement : verrouillage FOR UPDATE
   du client, de la facture, des allocations puis de chaque source (ordre client → facture,
   identique aux moteurs d'imputation).
5. Garde-fous supplémentaires : refus si une écriture comptable référence la facture,
   si un devis converti ou une commande en ligne y est lié.

## Inchangé
- Signature, retour jsonb, SECURITY DEFINER, search_path, propriétaire, privilèges
  (EXECUTE : authenticated, service_role ; pas PUBLIC ni anon).
- Conditions d'éligibilité (créateur, < 15 min, source billing, non supprimée, site accessible,
  non comptabilisée, aucun règlement réel, aucun stock/lot/retour/IPM).
- Aucun mouvement de caisse, théorique, stock, lot, écriture comptable ni solde client modifié :
  le solde client stocké n'a pas encore intégré la facture à ce stade du parcours.
- Aucune allocation ciblant une autre facture n'est touchée.

## Sécurité
Aucune table, policy ou grant modifié en dehors du ré-énoncé des privilèges de cette fonction.
*/

CREATE OR REPLACE FUNCTION public.discard_failed_billing_sale(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_customer uuid;
  v_sale record;
  v_alloc record;
  v_alloc_total numeric := 0;
  v_auto_pay_total numeric := 0;
  v_rows int;
  v_restored jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  v_tenant := current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Aucun tenant courant';
  END IF;

  SELECT customer_id INTO v_customer
  FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable';
  END IF;

  IF v_customer IS NOT NULL THEN
    PERFORM 1 FROM customers WHERE id = v_customer AND tenant_id = v_tenant FOR UPDATE;
  END IF;

  SELECT id, tenant_id, site_id, source, user_id, created_at, sale_number, customer_id,
         accounting_status, accounting_entry_id, deleted_at
  INTO v_sale
  FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'Facture introuvable';
  END IF;
  IF v_sale.customer_id IS DISTINCT FROM v_customer THEN
    RAISE EXCEPTION 'La facture a été modifiée pendant l''opération, veuillez réessayer';
  END IF;
  IF v_sale.source IS DISTINCT FROM 'billing'
     OR v_sale.user_id IS DISTINCT FROM v_uid
     OR v_sale.created_at < now() - interval '15 minutes'
     OR v_sale.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cette facture ne peut pas être annulée automatiquement';
  END IF;
  IF NOT current_user_can_access_site(v_sale.site_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce site';
  END IF;
  IF v_sale.accounting_entry_id IS NOT NULL
     OR COALESCE(v_sale.accounting_status, 'not_accounted') <> 'not_accounted'
     OR EXISTS (SELECT 1 FROM journal_entries WHERE tenant_id = v_tenant AND source_id = p_sale_id) THEN
    RAISE EXCEPTION 'Facture déjà comptabilisée';
  END IF;
  IF EXISTS (SELECT 1 FROM sale_payments
             WHERE sale_id = p_sale_id
               AND (payment_method_id IS NOT NULL OR affects_balance = true)) THEN
    RAISE EXCEPTION 'Facture déjà encaissée';
  END IF;
  IF EXISTS (SELECT 1 FROM stock_movements
             WHERE tenant_id = v_tenant
               AND (reference_id = p_sale_id
                    OR (movement_type = 'sale' AND note LIKE 'Facture ' || v_sale.sale_number || '%'))) THEN
    RAISE EXCEPTION 'Mouvements de stock déjà générés';
  END IF;
  IF EXISTS (SELECT 1 FROM sale_lot_deductions WHERE sale_id = p_sale_id)
     OR EXISTS (SELECT 1 FROM sale_returns WHERE sale_id = p_sale_id)
     OR EXISTS (SELECT 1 FROM ipm_ventes WHERE sale_id = p_sale_id)
     OR EXISTS (SELECT 1 FROM quotes WHERE converted_sale_id = p_sale_id)
     OR EXISTS (SELECT 1 FROM online_orders WHERE sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'Facture liée à d''autres opérations';
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_auto_pay_total
  FROM sale_payments WHERE sale_id = p_sale_id;

  FOR v_alloc IN
    SELECT id, source_type, source_id, amount FROM credit_allocations
    WHERE tenant_id = v_tenant AND target_type = 'invoice' AND target_id = p_sale_id
    ORDER BY source_type, source_id
    FOR UPDATE
  LOOP
    IF v_alloc.amount IS NULL OR v_alloc.amount <= 0 THEN
      RAISE EXCEPTION 'Incohérence : allocation de crédit invalide sur cette facture';
    END IF;

    IF v_alloc.source_type = 'prepay' THEN
      PERFORM 1 FROM customer_prepayments
      WHERE id = v_alloc.source_id AND tenant_id = v_tenant FOR UPDATE;
      UPDATE customer_prepayments
         SET amount_used = amount_used - v_alloc.amount
       WHERE id = v_alloc.source_id AND tenant_id = v_tenant
         AND amount_used >= v_alloc.amount;
    ELSIF v_alloc.source_type = 'negative_adjustment' THEN
      PERFORM 1 FROM balance_adjustments
      WHERE id = v_alloc.source_id AND tenant_id = v_tenant FOR UPDATE;
      UPDATE balance_adjustments
         SET amount_used = COALESCE(amount_used, 0) - v_alloc.amount
       WHERE id = v_alloc.source_id AND tenant_id = v_tenant
         AND COALESCE(amount_used, 0) >= v_alloc.amount;
    ELSIF v_alloc.source_type = 'avoir' THEN
      PERFORM 1 FROM sale_returns
      WHERE id = v_alloc.source_id AND tenant_id = v_tenant FOR UPDATE;
      UPDATE sale_returns
         SET credit_used = COALESCE(credit_used, 0) - v_alloc.amount
       WHERE id = v_alloc.source_id AND tenant_id = v_tenant
         AND COALESCE(credit_used, 0) >= v_alloc.amount;
    ELSE
      RAISE EXCEPTION 'Facture liée à d''autres opérations';
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'Incohérence : la source de crédit ne peut pas être restituée à l''identique';
    END IF;

    DELETE FROM credit_allocations WHERE id = v_alloc.id;
    v_alloc_total := v_alloc_total + v_alloc.amount;
    v_restored := v_restored || jsonb_build_object(
      'source_type', v_alloc.source_type, 'source_id', v_alloc.source_id, 'amount', v_alloc.amount);
  END LOOP;

  IF round(v_alloc_total, 2) <> round(v_auto_pay_total, 2) THEN
    RAISE EXCEPTION 'Incohérence : les imputations automatiques ne correspondent pas aux allocations de crédit';
  END IF;

  DELETE FROM sales WHERE id = p_sale_id;

  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id,
                            'restored_total', v_alloc_total, 'restored', v_restored);
END;
$function$;

ALTER FUNCTION public.discard_failed_billing_sale(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.discard_failed_billing_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_failed_billing_sale(uuid) TO authenticated, service_role;
