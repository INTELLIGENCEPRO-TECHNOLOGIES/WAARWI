/*
# Rewrite delete_sale_and_recalculate: safe, guarded, traceable

## Overview
Replaces the old delete_sale_and_recalculate with a guarded version that:
- Refuses deletion if sale is cancelled, accounted, has payments, returns, IPM, or linked docs
- Restores stock via sale_lot_deductions if available, else stock_levels (tracked only)
- Restores stock_lots.remaining_quantity precisely
- Deletes sale + items + payments + lot_deductions atomically
- Logs deletion in sale_deletion_log (number, total, reason, user, timestamp)
- Never modifies cash (a sale with payments is always refused)

## Parameters
- p_sale_id: the sale to delete
- p_tenant_id: caller's tenant (validated via assert_tenant_access)
- p_reason: mandatory reason for the deletion log

## Security
- SECURITY DEFINER, search_path = public
- REVOKE from PUBLIC and anon
- GRANT to authenticated only
*/

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
  v_has_accounted boolean;
BEGIN
  PERFORM public.assert_tenant_access(p_tenant_id);

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id FOR UPDATE;
  IF v_sale IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
  END IF;

  -- Guard: already cancelled
  IF v_sale.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Une facture annulée ne peut pas être supprimée');
  END IF;

  -- Guard: accounted
  IF v_sale.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée, suppression impossible');
  END IF;

  -- Guard: has any payment
  SELECT EXISTS(SELECT 1 FROM sale_payments WHERE sale_id = p_sale_id) INTO v_has_payments;
  IF v_has_payments THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cette vente a un règlement. Suppression impossible — utilisez l''annulation.');
  END IF;

  -- Guard: has returns or avoirs
  SELECT EXISTS(
    SELECT 1 FROM sale_returns WHERE sale_id = p_sale_id
  ) INTO v_has_returns;
  IF v_has_returns THEN
    RETURN jsonb_build_object('success', false, 'error', 'Un retour ou avoir existe pour cette vente. Suppression impossible.');
  END IF;

  -- Guard: has IPM
  SELECT EXISTS(SELECT 1 FROM ipm_ventes WHERE sale_id = p_sale_id) INTO v_has_ipm;
  IF v_has_ipm THEN
    RETURN jsonb_build_object('success', false, 'error', 'Une opération IPM est liée à cette vente. Suppression impossible.');
  END IF;

  -- Require reason
  IF COALESCE(p_reason, '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Un motif de suppression est obligatoire');
  END IF;

  -- Restore stock: use sale_lot_deductions if available, else stock_levels
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
      IF v_line.track_stock THEN
        IF v_line.current_stock IS NOT NULL THEN
          v_previous := v_line.current_stock;
          v_new := v_previous + v_line.quantity;
          UPDATE stock_levels SET quantity = v_new, updated_at = now()
          WHERE article_id = v_line.article_id AND site_id = COALESCE(v_line.site_id, v_sale.site_id);
          INSERT INTO stock_movements (tenant_id, article_id, site_id, movement_type, quantity, previous_qty, new_qty, reference_type, reference_id, user_id, note)
          VALUES (v_tenant_id, v_line.article_id, COALESCE(v_line.site_id, v_sale.site_id), 'adjustment',
                  v_line.quantity, v_previous, v_new, 'sale_delete', p_sale_id, v_user_id,
                  'Restauration stock - suppression vente ' || v_sale.sale_number);
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Log the deletion
  INSERT INTO sale_deletion_log (tenant_id, sale_id_snapshot, sale_number, sale_total, reason, user_id)
  VALUES (v_tenant_id, p_sale_id, v_sale.sale_number, v_sale.total, p_reason, v_user_id);

  -- Delete related records
  DELETE FROM sale_lot_deductions WHERE sale_id = p_sale_id;
  DELETE FROM sale_items WHERE sale_id = p_sale_id;
  DELETE FROM sale_payments WHERE sale_id = p_sale_id;
  DELETE FROM sales WHERE id = p_sale_id;

  RETURN jsonb_build_object('success', true, 'restored_total', v_sale.total);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid, text) TO authenticated;

-- Backward-compatible 2-arg signature
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
  RETURN public.delete_sale_and_recalculate(p_sale_id, p_tenant_id, 'Suppression par l''utilisateur');
END;
$$;

REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid) TO authenticated;
