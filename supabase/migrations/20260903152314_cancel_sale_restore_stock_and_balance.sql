/*
# Annulation de vente propre (stock + solde client)

## Objet
L'annulation d'une facture doit restaurer le stock et recalculer le solde du client,
comme le fait déjà la suppression. Cette fonction crée `cancel_sale(p_sale_id, p_tenant_id)`.

## Sécurité
- SECURITY DEFINER, search_path figé à public, contrôle du tenant via assert_tenant_access.
- EXECUTE réservé à authenticated.

## Notes
1. La vente est conservée (statut « cancelled ») pour l'audit ; stock et solde reviennent à l'état d'avant.
2. Idempotent : une vente déjà annulée n'est pas retraitée.
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
  PERFORM public.assert_tenant_access(p_tenant_id);

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

  UPDATE sales SET status = 'cancelled' WHERE id = p_sale_id;

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
