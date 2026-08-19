/*
# Session-scoped financial summary RPC

## Purpose
Creates `get_session_financial_summary(p_cash_session_id uuid)` — a read-only
function that computes the same financial indicators as `get_financial_summary`
but scoped to a specific cash session instead of a date range.

## How it works
- Sales are matched via `sales.cash_session_id = p_cash_session_id`
- Sale returns via `sale_returns.cash_session_id`
- Cash movements (expenses) via `cash_movements.cash_session_id`
- Credit sales: sales in status 'partial' or 'validated' linked to the session
- "Reste a encaisser" is the current outstanding balance on those credit sales

## Return shape (jsonb)
Same keys as get_financial_summary plus:
- `credit_sales_total`: total amount invoiced on credit during the session
- `credit_sales_outstanding`: current remaining balance on those credit sales
- `credit_sales_count`: number of credit sales in the session
- `encaissements`: total payments received during the session
- `remboursements`: total refund movements in the session
- `depenses_session`: total expense movements in the session
- `retraits`: total withdrawal movements in the session
- `prets_clients`: total customer loan movements in the session
- `entrees_directes`: total direct income movements in the session

## Security
- SECURITY INVOKER (runs as calling user, respects RLS)
- Restricted to authenticated role only
*/

CREATE OR REPLACE FUNCTION public.get_session_financial_summary(
  p_cash_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tenant_id uuid;
  v_ventes_validees numeric := 0;
  v_cogs_ventes numeric := 0;
  v_nb_ventes bigint := 0;
  v_retours numeric := 0;
  v_cogs_retours numeric := 0;
  v_nb_retours bigint := 0;
  v_nb_ventes_retour bigint := 0;
  v_nb_annulations bigint := 0;
  v_montant_annule numeric := 0;
  v_charges numeric := 0;
  v_ca_net numeric;
  v_cogs_net numeric;
  v_marge_brute numeric;
  v_taux_marge numeric;
  v_resultat numeric;
  v_credit_total numeric := 0;
  v_credit_outstanding numeric := 0;
  v_credit_count bigint := 0;
  v_encaissements numeric := 0;
  v_remboursements numeric := 0;
  v_depenses numeric := 0;
  v_retraits numeric := 0;
  v_prets numeric := 0;
  v_entrees numeric := 0;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Verify session belongs to tenant
  IF NOT EXISTS (
    SELECT 1 FROM cash_sessions
    WHERE id = p_cash_session_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Session not found or not authorized';
  END IF;

  -- Validated sales linked to this session
  SELECT COALESCE(SUM(s.total), 0),
         COALESCE(SUM(item_cost.cost), 0),
         COUNT(*)
  INTO v_ventes_validees, v_cogs_ventes, v_nb_ventes
  FROM sales s
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(si.purchase_cost * si.quantity), 0) AS cost
    FROM sale_items si WHERE si.sale_id = s.id
  ) item_cost ON true
  WHERE s.tenant_id = v_tenant_id
    AND s.cash_session_id = p_cash_session_id
    AND s.status IN ('paid', 'partial', 'validated');

  -- Approved returns linked to this session
  SELECT COALESCE(SUM(sr.total), 0),
         COALESCE(SUM(ret_cost.cost), 0),
         COUNT(*),
         COUNT(DISTINCT sr.sale_id)
  INTO v_retours, v_cogs_retours, v_nb_retours, v_nb_ventes_retour
  FROM sale_returns sr
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(sri.purchase_cost * sri.quantity), 0) AS cost
    FROM sale_return_items sri WHERE sri.return_id = sr.id
  ) ret_cost ON true
  WHERE sr.tenant_id = v_tenant_id
    AND sr.cash_session_id = p_cash_session_id
    AND sr.status = 'approved';

  -- Cancelled sales in this session
  SELECT COUNT(*), COALESCE(SUM(s.total), 0)
  INTO v_nb_annulations, v_montant_annule
  FROM sales s
  WHERE s.tenant_id = v_tenant_id
    AND s.cash_session_id = p_cash_session_id
    AND s.status = 'cancelled';

  -- Credit sales: created in this session, status partial or validated
  SELECT COUNT(*),
         COALESCE(SUM(s.total), 0),
         COALESCE(SUM(GREATEST(s.total - s.paid, 0)), 0)
  INTO v_credit_count, v_credit_total, v_credit_outstanding
  FROM sales s
  WHERE s.tenant_id = v_tenant_id
    AND s.cash_session_id = p_cash_session_id
    AND s.status IN ('partial', 'validated');

  -- Payments received in this session (encaissements)
  SELECT COALESCE(SUM(sp.amount), 0)
  INTO v_encaissements
  FROM sale_payments sp
  WHERE sp.tenant_id = v_tenant_id
    AND sp.cash_session_id = p_cash_session_id;

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

  -- Operating expenses for session = kind='expense' only
  v_charges := v_depenses;

  -- Derived indicators
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
    'remboursements',        v_remboursements,
    'depenses_session',      v_depenses,
    'retraits',              v_retraits,
    'prets_clients',         v_prets,
    'entrees_directes',      v_entrees
  );
END;
$$;

-- Restrict to authenticated only
REVOKE ALL ON FUNCTION public.get_session_financial_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_session_financial_summary(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_session_financial_summary(uuid) TO authenticated;
