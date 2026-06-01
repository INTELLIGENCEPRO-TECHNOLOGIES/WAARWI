/*
  # Bulk accounting functions for payments and purchases

  1. New Functions
    - `comptabiliser_reglements_clients_en_masse(tenant_id)` : accounts all unaccounted client payments
    - `comptabiliser_achats_en_masse(tenant_id)` : accounts all received supplier orders
    - `comptabiliser_reglements_fournisseurs_en_masse(tenant_id)` : accounts all unaccounted supplier payments

  2. Notes
    - Only payments linked to accounted sales (status 'accounted') get processed
    - Only supplier orders with status 'received' get accounted (draft orders are not invoices)
    - Uses existing individual functions: comptabiliser_reglement, comptabiliser_achat, comptabiliser_reglement_fournisseur
    - Each creates journal entries that credit/debit the auxiliary tiers accounts
*/

-- ==============================================
-- 1. BULK: Comptabiliser reglements clients
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_reglements_clients_en_masse(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay RECORD;
  v_result jsonb;
  v_success int := 0;
  v_errors int := 0;
  v_error_messages jsonb[] := '{}';
BEGIN
  FOR v_pay IN
    SELECT sp.id, s.sale_number
    FROM sale_payments sp
    JOIN sales s ON s.id = sp.sale_id
    WHERE sp.tenant_id = p_tenant_id
      AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
      AND s.accounting_status = 'accounted'
    ORDER BY sp.created_at
  LOOP
    v_result := comptabiliser_reglement(v_pay.id);
    IF (v_result->>'success')::boolean THEN
      v_success := v_success + 1;
    ELSE
      v_errors := v_errors + 1;
      v_error_messages := array_append(v_error_messages, jsonb_build_object('sale', v_pay.sale_number, 'error', v_result->>'error'));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'accounted', v_success,
    'errors', v_errors,
    'error_details', to_jsonb(v_error_messages)
  );
END;
$$;

-- ==============================================
-- 2. BULK: Comptabiliser achats fournisseurs (commandes recues)
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_achats_en_masse(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_result jsonb;
  v_success int := 0;
  v_errors int := 0;
  v_error_messages jsonb[] := '{}';
BEGIN
  FOR v_order IN
    SELECT id, order_number FROM supplier_orders
    WHERE tenant_id = p_tenant_id
      AND (accounting_status = 'not_accounted' OR accounting_status IS NULL)
      AND status = 'received'
    ORDER BY created_at
  LOOP
    v_result := comptabiliser_achat(v_order.id);
    IF (v_result->>'success')::boolean THEN
      v_success := v_success + 1;
    ELSE
      v_errors := v_errors + 1;
      v_error_messages := array_append(v_error_messages, jsonb_build_object('order', v_order.order_number, 'error', v_result->>'error'));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'accounted', v_success,
    'errors', v_errors,
    'error_details', to_jsonb(v_error_messages)
  );
END;
$$;

-- ==============================================
-- 3. BULK: Comptabiliser reglements fournisseurs
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_reglements_fournisseurs_en_masse(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay RECORD;
  v_result jsonb;
  v_success int := 0;
  v_errors int := 0;
  v_error_messages jsonb[] := '{}';
BEGIN
  FOR v_pay IN
    SELECT sp.id, so.order_number
    FROM supplier_payments sp
    LEFT JOIN supplier_orders so ON so.id = sp.order_id
    WHERE sp.tenant_id = p_tenant_id
      AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
    ORDER BY sp.created_at
  LOOP
    v_result := comptabiliser_reglement_fournisseur(v_pay.id);
    IF (v_result->>'success')::boolean THEN
      v_success := v_success + 1;
    ELSE
      v_errors := v_errors + 1;
      v_error_messages := array_append(v_error_messages, jsonb_build_object('order', COALESCE(v_pay.order_number, '?'), 'error', v_result->>'error'));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'accounted', v_success,
    'errors', v_errors,
    'error_details', to_jsonb(v_error_messages)
  );
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION comptabiliser_reglements_clients_en_masse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comptabiliser_achats_en_masse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comptabiliser_reglements_fournisseurs_en_masse(uuid) TO authenticated;
