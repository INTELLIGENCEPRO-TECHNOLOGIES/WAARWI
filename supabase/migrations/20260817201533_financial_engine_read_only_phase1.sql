/*
# Phase 1 — Financial Engine (Read-Only)

Creates 4 read-only RPC functions that form the single source of truth
for all financial indicators. These functions do NOT modify any data.
They run as SECURITY INVOKER so existing RLS applies. The tenant is
always derived from current_tenant_id() — never passed as a parameter.

## Functions

### 1. get_financial_summary(p_site_id, p_from, p_to)
Returns a JSONB object with:
  - ventes_validees, retours, ca_net
  - cogs_ventes, cogs_retours, cogs_net
  - marge_brute, taux_marge
  - charges_exploitation, resultat_exploitation
  - nb_ventes, nb_retours, nb_ventes_avec_retour, nb_annulations, montant_annule

### 2. get_sales_by_article(p_site_id, p_from, p_to)
Returns a TABLE with per-article breakdown including proportional
global-discount allocation so that SUM(ca) = sales.total for each sale.

### 3. get_cash_flow(p_site_id, p_from, p_to)
Returns a JSONB object with treasury indicators. Uses pattern-matching
on cash_movements.reason to identify return-refunds (transitional logic
until Phase 2 introduces kind='refund').

### 4. get_returns_detail(p_site_id, p_from, p_to)
Returns a TABLE with per-return detail including articles, user, method.

## Security
- All functions use SECURITY INVOKER (RLS enforced).
- tenant_id obtained via current_tenant_id(), never a parameter.
- p_site_id validated against the tenant's sites table.
- STABLE + search_path = 'public' for safety.

## Business rules
- Validated sales: status IN ('paid','partial','validated')
- Cancelled sales: status = 'cancelled' (excluded from CA, shown in control)
- Approved returns: sale_returns.status = 'approved'
- Charges: cash_movements.kind = 'expense' EXCLUDING return-refunds
  (identified by reason pattern until kind='refund' exists)
- Revenue source: sales.total (includes global discount)
- COGS source: sale_items.purchase_cost * quantity (snapshot at sale time)
- Date range: >= p_from AND < p_to + 1 day (full inclusive day range)
*/

-- ============================================================
-- 1. get_financial_summary
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_financial_summary(
  p_site_id uuid DEFAULT NULL,
  p_from    date DEFAULT CURRENT_DATE,
  p_to      date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_tenant_id        uuid;
  v_ts_from          timestamptz;
  v_ts_to            timestamptz;
  v_ventes_validees  numeric := 0;
  v_retours          numeric := 0;
  v_cogs_ventes      numeric := 0;
  v_cogs_retours     numeric := 0;
  v_charges          numeric := 0;
  v_nb_ventes        bigint  := 0;
  v_nb_retours       bigint  := 0;
  v_nb_ventes_retour bigint  := 0;
  v_nb_annulations   bigint  := 0;
  v_montant_annule   numeric := 0;
  v_ca_net           numeric;
  v_cogs_net         numeric;
  v_marge_brute      numeric;
  v_taux_marge       numeric;
  v_resultat         numeric;
BEGIN
  -- Resolve tenant
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate site belongs to tenant
  IF p_site_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Site not authorized';
    END IF;
  END IF;

  -- Compute timestamp boundaries (inclusive full days)
  v_ts_from := p_from::timestamptz;
  v_ts_to   := (p_to + 1)::timestamptz;

  -- Validated sales: revenue + COGS + count
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
    AND s.status IN ('paid', 'partial', 'validated')
    AND s.created_at >= v_ts_from
    AND s.created_at < v_ts_to
    AND (p_site_id IS NULL OR s.site_id = p_site_id);

  -- Approved returns: total + COGS + counts
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
    AND sr.status = 'approved'
    AND sr.created_at >= v_ts_from
    AND sr.created_at < v_ts_to
    AND (p_site_id IS NULL OR sr.site_id = p_site_id);

  -- Cancelled sales (control indicators only)
  SELECT COUNT(*), COALESCE(SUM(s.total), 0)
  INTO v_nb_annulations, v_montant_annule
  FROM sales s
  WHERE s.tenant_id = v_tenant_id
    AND s.status = 'cancelled'
    AND s.created_at >= v_ts_from
    AND s.created_at < v_ts_to
    AND (p_site_id IS NULL OR s.site_id = p_site_id);

  -- Operating expenses: kind='expense' EXCLUDING return-refunds
  -- Transitional: identify refunds by reason pattern (until Phase 2 adds kind='refund')
  SELECT COALESCE(SUM(cm.amount), 0)
  INTO v_charges
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.kind = 'expense'
    AND cm.reason NOT ILIKE 'remboursement retour%'
    AND cm.reason NOT ILIKE 'retour RET-%'
    AND cm.created_at >= v_ts_from
    AND cm.created_at < v_ts_to
    AND (p_site_id IS NULL OR cm.site_id = p_site_id);

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
    'montant_annule',        v_montant_annule
  );
END;
$$;


-- ============================================================
-- 2. get_sales_by_article
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_sales_by_article(
  p_site_id uuid DEFAULT NULL,
  p_from    date DEFAULT CURRENT_DATE,
  p_to      date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  article_id        uuid,
  article_name      text,
  ca                numeric,
  cout              numeric,
  marge             numeric,
  quantite_vendue   numeric,
  quantite_retournee numeric,
  taux_marge        numeric
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_tenant_id uuid;
  v_ts_from   timestamptz;
  v_ts_to     timestamptz;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_site_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Site not authorized';
    END IF;
  END IF;

  v_ts_from := p_from::timestamptz;
  v_ts_to   := (p_to + 1)::timestamptz;

  RETURN QUERY
  WITH sale_line_ca AS (
    -- Per sale-item: compute proportional CA including global discount
    -- If sale has discount: item_ca = item.total * (sale.total / sale.subtotal)
    -- ratio = sale.total / sale.subtotal handles the global discount proportionally
    SELECT
      si.article_id,
      si.name AS article_name,
      -- Proportional revenue: item_total * (sale_total / subtotal) if subtotal > 0
      CASE
        WHEN s.subtotal > 0 THEN ROUND(si.total * (s.total::numeric / s.subtotal::numeric), 2)
        ELSE si.total
      END AS item_ca,
      (si.purchase_cost * si.quantity) AS item_cost,
      si.quantity
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE s.tenant_id = v_tenant_id
      AND s.status IN ('paid', 'partial', 'validated')
      AND s.created_at >= v_ts_from
      AND s.created_at < v_ts_to
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
  ),
  sold AS (
    SELECT
      sl.article_id,
      MAX(sl.article_name) AS article_name,
      SUM(sl.item_ca) AS ca,
      SUM(sl.item_cost) AS cout,
      SUM(sl.quantity) AS quantite_vendue
    FROM sale_line_ca sl
    GROUP BY sl.article_id
  ),
  returned AS (
    SELECT
      sri.article_id,
      SUM(sri.quantity) AS quantite_retournee,
      SUM(sri.total) AS ret_total,
      SUM(sri.purchase_cost * sri.quantity) AS ret_cost
    FROM sale_return_items sri
    JOIN sale_returns sr ON sr.id = sri.return_id
    WHERE sr.tenant_id = v_tenant_id
      AND sr.status = 'approved'
      AND sr.created_at >= v_ts_from
      AND sr.created_at < v_ts_to
      AND (p_site_id IS NULL OR sr.site_id = p_site_id)
    GROUP BY sri.article_id
  )
  SELECT
    so.article_id,
    so.article_name,
    (so.ca - COALESCE(r.ret_total, 0))::numeric AS ca,
    (so.cout - COALESCE(r.ret_cost, 0))::numeric AS cout,
    ((so.ca - COALESCE(r.ret_total, 0)) - (so.cout - COALESCE(r.ret_cost, 0)))::numeric AS marge,
    so.quantite_vendue,
    COALESCE(r.quantite_retournee, 0)::numeric AS quantite_retournee,
    CASE
      WHEN (so.ca - COALESCE(r.ret_total, 0)) > 0
      THEN ROUND(
        (((so.ca - COALESCE(r.ret_total, 0)) - (so.cout - COALESCE(r.ret_cost, 0)))
         / (so.ca - COALESCE(r.ret_total, 0))) * 100, 2
      )
      ELSE 0
    END::numeric AS taux_marge
  FROM sold so
  LEFT JOIN returned r ON r.article_id = so.article_id
  ORDER BY ca DESC;
END;
$$;


-- ============================================================
-- 3. get_cash_flow
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_cash_flow(
  p_site_id uuid DEFAULT NULL,
  p_from    date DEFAULT CURRENT_DATE,
  p_to      date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_tenant_id          uuid;
  v_ts_from            timestamptz;
  v_ts_to              timestamptz;
  v_encaissements      numeric := 0;
  v_autres_entrees     numeric := 0;
  v_remboursements     numeric := 0;
  v_charges            numeric := 0;
  v_retraits_clients   numeric := 0;
  v_prets_clients      numeric := 0;
  v_flux_net           numeric;
  v_by_method          jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_site_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Site not authorized';
    END IF;
  END IF;

  v_ts_from := p_from::timestamptz;
  v_ts_to   := (p_to + 1)::timestamptz;

  -- Sale payments (encaissements from validated sales)
  SELECT COALESCE(SUM(sp.amount), 0)
  INTO v_encaissements
  FROM sale_payments sp
  JOIN sales s ON s.id = sp.sale_id
  WHERE s.tenant_id = v_tenant_id
    AND s.status IN ('paid', 'partial', 'validated')
    AND sp.created_at >= v_ts_from
    AND sp.created_at < v_ts_to
    AND (p_site_id IS NULL OR s.site_id = p_site_id);

  -- Cash movements by kind
  -- income + customer_prepayment = autres_entrees
  SELECT COALESCE(SUM(cm.amount), 0)
  INTO v_autres_entrees
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.kind IN ('income', 'customer_prepayment')
    AND cm.created_at >= v_ts_from
    AND cm.created_at < v_ts_to
    AND (p_site_id IS NULL OR cm.site_id = p_site_id);

  -- Return refunds (transitional: pattern-match on reason while kind='refund' does not exist)
  SELECT COALESCE(SUM(cm.amount), 0)
  INTO v_remboursements
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.kind = 'expense'
    AND (cm.reason ILIKE 'remboursement retour%' OR cm.reason ILIKE 'retour RET-%')
    AND cm.created_at >= v_ts_from
    AND cm.created_at < v_ts_to
    AND (p_site_id IS NULL OR cm.site_id = p_site_id);

  -- Real operating expenses (expense minus return-refunds)
  SELECT COALESCE(SUM(cm.amount), 0)
  INTO v_charges
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.kind = 'expense'
    AND cm.reason NOT ILIKE 'remboursement retour%'
    AND cm.reason NOT ILIKE 'retour RET-%'
    AND cm.created_at >= v_ts_from
    AND cm.created_at < v_ts_to
    AND (p_site_id IS NULL OR cm.site_id = p_site_id);

  -- Customer withdrawals
  SELECT COALESCE(SUM(cm.amount), 0)
  INTO v_retraits_clients
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.kind = 'customer_withdrawal'
    AND cm.created_at >= v_ts_from
    AND cm.created_at < v_ts_to
    AND (p_site_id IS NULL OR cm.site_id = p_site_id);

  -- Customer loans
  SELECT COALESCE(SUM(cm.amount), 0)
  INTO v_prets_clients
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.kind = 'customer_loan'
    AND cm.created_at >= v_ts_from
    AND cm.created_at < v_ts_to
    AND (p_site_id IS NULL OR cm.site_id = p_site_id);

  -- Payment method breakdown (from sale_payments)
  SELECT COALESCE(
    jsonb_object_agg(method, total),
    '{}'::jsonb
  )
  INTO v_by_method
  FROM (
    SELECT COALESCE(NULLIF(sp.method_name, ''), 'Espèces') AS method,
           SUM(sp.amount) AS total
    FROM sale_payments sp
    JOIN sales s ON s.id = sp.sale_id
    WHERE s.tenant_id = v_tenant_id
      AND s.status IN ('paid', 'partial', 'validated')
      AND sp.created_at >= v_ts_from
      AND sp.created_at < v_ts_to
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
    GROUP BY method
  ) sub;

  v_flux_net := v_encaissements + v_autres_entrees - v_remboursements - v_charges - v_retraits_clients - v_prets_clients;

  RETURN jsonb_build_object(
    'encaissements_ventes', v_encaissements,
    'autres_entrees',       v_autres_entrees,
    'remboursements',       v_remboursements,
    'charges',              v_charges,
    'retraits_clients',     v_retraits_clients,
    'prets_clients',        v_prets_clients,
    'flux_net',             v_flux_net,
    'par_methode',          v_by_method
  );
END;
$$;


-- ============================================================
-- 4. get_returns_detail
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_returns_detail(
  p_site_id uuid DEFAULT NULL,
  p_from    date DEFAULT CURRENT_DATE,
  p_to      date DEFAULT CURRENT_DATE
)
RETURNS TABLE (
  return_id      uuid,
  return_number  text,
  sale_number    text,
  return_date    timestamptz,
  montant        numeric,
  articles       jsonb,
  motif          text,
  utilisateur    text,
  refund_method  text,
  refund_status  text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
  v_tenant_id uuid;
  v_ts_from   timestamptz;
  v_ts_to     timestamptz;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_site_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Site not authorized';
    END IF;
  END IF;

  v_ts_from := p_from::timestamptz;
  v_ts_to   := (p_to + 1)::timestamptz;

  RETURN QUERY
  SELECT
    sr.id AS return_id,
    sr.return_number,
    s.sale_number,
    sr.created_at AS return_date,
    sr.total AS montant,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object(
          'name', sri.name,
          'quantity', sri.quantity,
          'unit_price', sri.unit_price,
          'total', sri.total,
          'purchase_cost', sri.purchase_cost
        ))
       FROM sale_return_items sri WHERE sri.return_id = sr.id
      ),
      '[]'::jsonb
    ) AS articles,
    COALESCE(sr.reason, '') AS motif,
    COALESCE(p.full_name, '') AS utilisateur,
    sr.refund_method,
    sr.status AS refund_status
  FROM sale_returns sr
  LEFT JOIN sales s ON s.id = sr.sale_id
  LEFT JOIN profiles p ON p.id = sr.user_id
  WHERE sr.tenant_id = v_tenant_id
    AND sr.created_at >= v_ts_from
    AND sr.created_at < v_ts_to
    AND (p_site_id IS NULL OR sr.site_id = p_site_id)
  ORDER BY sr.created_at DESC;
END;
$$;
