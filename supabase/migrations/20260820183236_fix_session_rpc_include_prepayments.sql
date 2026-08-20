-- Fix: get_session_financial_summary must include customer prepayments in encaissements
-- Acomptes are cash_movements with kind='customer_prepayment', not sale_payments.
-- They were completely missing from the session encaissements and cash balance.

CREATE OR REPLACE FUNCTION public.get_session_financial_summary(p_cash_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_ventes_validees numeric := 0;
  v_retours numeric := 0;
  v_ca_net numeric := 0;
  v_cogs_ventes numeric := 0;
  v_cogs_retours numeric := 0;
  v_cogs_net numeric := 0;
  v_marge_brute numeric := 0;
  v_taux_marge numeric := 0;
  v_charges numeric := 0;
  v_resultat numeric := 0;
  v_nb_ventes int := 0;
  v_nb_retours int := 0;
  v_nb_ventes_retour int := 0;
  v_nb_annulations int := 0;
  v_montant_annule numeric := 0;
  v_credit_count int := 0;
  v_credit_total numeric := 0;
  v_credit_outstanding numeric := 0;
  v_encaissements numeric := 0;
  v_acomptes numeric := 0;
  v_depenses numeric := 0;
  v_remboursements numeric := 0;
  v_retraits numeric := 0;
  v_prets numeric := 0;
  v_entrees numeric := 0;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('error', 'No tenant'); END IF;
  IF p_cash_session_id IS NULL THEN RETURN jsonb_build_object('error', 'No session'); END IF;

  -- Validated sales (paid + partial + validated, NOT cancelled)
  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_ventes_validees, v_nb_ventes
  FROM sales
  WHERE tenant_id = v_tenant_id
    AND cash_session_id = p_cash_session_id
    AND status IN ('paid', 'partial', 'validated');

  -- Returns
  SELECT COALESCE(SUM(total), 0), COUNT(*)
    INTO v_retours, v_nb_retours
  FROM sale_returns
  WHERE tenant_id = v_tenant_id
    AND cash_session_id = p_cash_session_id
    AND status = 'approved';

  -- COGS for sales
  SELECT COALESCE(SUM(si.purchase_cost * si.quantity), 0)
    INTO v_cogs_ventes
  FROM sale_items si
  INNER JOIN sales s ON s.id = si.sale_id
  WHERE s.tenant_id = v_tenant_id
    AND s.cash_session_id = p_cash_session_id
    AND s.status IN ('paid', 'partial', 'validated');

  -- COGS for returns
  SELECT COALESCE(SUM(sri.purchase_cost * sri.quantity), 0)
    INTO v_cogs_retours
  FROM sale_return_items sri
  INNER JOIN sale_returns sr ON sr.id = sri.sale_return_id
  WHERE sr.tenant_id = v_tenant_id
    AND sr.cash_session_id = p_cash_session_id
    AND sr.status = 'approved';

  -- Credit sales
  SELECT COUNT(*), COALESCE(SUM(total), 0),
         COALESCE(SUM(GREATEST(total - paid, 0)), 0)
    INTO v_credit_count, v_credit_total, v_credit_outstanding
  FROM sales s
  WHERE s.tenant_id = v_tenant_id
    AND s.cash_session_id = p_cash_session_id
    AND s.status IN ('partial', 'validated');

  -- Payments received in this session (encaissements from sales)
  SELECT COALESCE(SUM(sp.amount), 0)
    INTO v_encaissements
  FROM sale_payments sp
  WHERE sp.tenant_id = v_tenant_id
    AND sp.cash_session_id = p_cash_session_id;

  -- Customer prepayments (acomptes) received in this session
  SELECT COALESCE(SUM(cm.amount), 0)
    INTO v_acomptes
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.cash_session_id = p_cash_session_id
    AND cm.kind = 'customer_prepayment';

  -- Add acomptes to total encaissements
  v_encaissements := v_encaissements + v_acomptes;

  -- Cash movements by kind in this session
  SELECT
    COALESCE(SUM(CASE WHEN cm.kind = 'expense' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'refund' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'withdrawal' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'customer_loan' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'income'
      AND NOT (cm.reason IS NOT NULL AND cm.reason LIKE 'Règlement %' AND cm.reason NOT LIKE 'Règlement solde%')
      THEN cm.amount ELSE 0 END), 0)
  INTO v_depenses, v_remboursements, v_retraits, v_prets, v_entrees
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.cash_session_id = p_cash_session_id;

  v_charges := v_depenses;
  v_ca_net      := v_ventes_validees - v_retours;
  v_cogs_net    := v_cogs_ventes - v_cogs_retours;
  v_marge_brute := v_ca_net - v_cogs_net;
  v_taux_marge  := CASE WHEN v_ca_net > 0 THEN ROUND((v_marge_brute / v_ca_net) * 100, 2) ELSE 0 END;
  v_resultat    := v_marge_brute - v_charges;

  RETURN jsonb_build_object(
    'ventes_validees',       v_ventes_validees,
    'retours',               v_retours,
    'ca_net',                v_ca_net,
    'cogs_ventes',           v_cogs_ventes,
    'cogs_retours',          v_cogs_retours,
    'cogs_net',              v_cogs_net,
    'marge_brute',           v_marge_brute,
    'taux_marge',            v_taux_marge,
    'charges_exploitation',  v_charges,
    'resultat_exploitation', v_resultat,
    'nb_ventes',             v_nb_ventes,
    'nb_retours',            v_nb_retours,
    'nb_ventes_avec_retour', v_nb_ventes_retour,
    'nb_annulations',        v_nb_annulations,
    'montant_annule',        v_montant_annule,
    'credit_sales_total',    v_credit_total,
    'credit_sales_outstanding', v_credit_outstanding,
    'credit_sales_count',    v_credit_count,
    'encaissements',         v_encaissements,
    'acomptes',              v_acomptes,
    'remboursements',        v_remboursements,
    'depenses_session',      v_depenses,
    'retraits',              v_retraits,
    'prets_clients',         v_prets,
    'entrees_directes',      v_entrees
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_session_financial_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_session_financial_summary(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_session_financial_summary(uuid) TO authenticated;
