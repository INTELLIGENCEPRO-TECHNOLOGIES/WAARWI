/*
# Annulation de vente propre (stock + solde client)

## Objet
Jusqu'ici, l'annulation d'une facture depuis l'écran Facturation faisait une simple
mise à jour du statut à « cancelled » sans restaurer le stock ni recalculer le solde
du client. Résultat : le solde du client restait gonflé du montant de la facture annulée.
De plus, l'écran Journal des ventes appelait une fonction `cancel_sale` qui n'existait pas,
donc l'annulation y échouait.

Cette migration crée `cancel_sale(p_sale_id, p_tenant_id)` qui :
1. Vérifie que la vente appartient bien au tenant et n'est pas déjà comptabilisée ni annulée.
2. Restaure le stock de chaque ligne de la vente (avec trace de mouvement de stock).
3. Passe la vente au statut « cancelled ».
4. Recalcule le solde du client : somme des ventes non annulées non réglées + ajustements.

## Sécurité
- Fonction SECURITY DEFINER, `search_path` figé à `public`.
- EXECUTE réservé au rôle `authenticated`, révoqué pour `anon`.

## Notes
1. Aucune donnée n'est supprimée : la vente est conservée à des fins d'audit, seul son
   statut change. Le stock et le solde reviennent à l'état d'avant la vente.
2. Idempotent : une vente déjà annulée n'est pas retraitée (le stock n'est pas restauré deux fois).
*/

CREATE OR REPLACE FUNCTION public.cancel_sale(
  p_sale_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale record;
  v_customer_id uuid;
  v_line record;
  v_new_balance numeric;
BEGIN
  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = p_tenant_id;
  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
  END IF;

  IF v_sale.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée, annulation impossible');
  END IF;

  IF v_sale.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', true, 'already_cancelled', true);
  END IF;

  v_customer_id := v_sale.customer_id;

  -- Restore stock for each item
  FOR v_line IN
    SELECT si.article_id, si.quantity, sl.id AS stock_level_id, sl.quantity AS current_stock, sl.site_id
    FROM sale_items si
    LEFT JOIN stock_levels sl ON sl.article_id = si.article_id AND sl.tenant_id = p_tenant_id
    WHERE si.sale_id = p_sale_id AND si.article_id IS NOT NULL
  LOOP
    IF v_line.stock_level_id IS NOT NULL THEN
      UPDATE stock_levels SET quantity = quantity + v_line.quantity
      WHERE id = v_line.stock_level_id;

      INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, note)
      VALUES (p_tenant_id, v_line.article_id, v_line.site_id, 'adjustment',
              v_line.quantity, v_line.current_stock, v_line.current_stock + v_line.quantity,
              'Restauration stock - annulation vente');
    END IF;
  END LOOP;

  -- Mark the sale as cancelled (kept for audit)
  UPDATE sales SET status = 'cancelled' WHERE id = p_sale_id;

  -- Recalculate customer balance: unpaid non-cancelled invoices + net balance adjustments
  IF v_customer_id IS NOT NULL THEN
    v_new_balance := COALESCE((
      SELECT SUM(total - paid) FROM sales
      WHERE customer_id = v_customer_id AND tenant_id = p_tenant_id AND status <> 'cancelled'
    ), 0) + COALESCE((
      SELECT SUM(amount) FROM balance_adjustments
      WHERE entity_id = v_customer_id AND entity_type = 'customer' AND tenant_id = p_tenant_id
    ), 0);

    UPDATE customers SET balance = v_new_balance WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'new_balance', v_new_balance);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sale(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_sale(uuid, uuid) TO authenticated;
