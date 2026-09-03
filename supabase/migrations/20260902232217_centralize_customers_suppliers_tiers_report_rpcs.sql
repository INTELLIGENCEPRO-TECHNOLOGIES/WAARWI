/*
# Centralisation serveur des rapports Clients, Fournisseurs et Balance des tiers

## Résumé (langage clair)
Jusqu'ici, les rapports Clients, Fournisseurs et Balance des tiers étaient calculés
dans le navigateur à partir de listes brutes. Deux problèmes : au-delà de 1000 lignes
les totaux devenaient faux (plafond de lecture), et les tiers « partagés » entre sites
(sans site précis) étaient exclus dès qu'on filtrait sur un site.

Cette migration crée trois fonctions serveur qui calculent les totaux directement dans
la base, sur le tenant courant uniquement, dans le fuseau horaire du Sénégal
(Africa/Dakar), avec une borne de fin exclusive (jusqu'à minuit le lendemain).

1. `get_customers_report(p_site_id, p_from, p_to)`
   - Renvoie, par client, le nombre de transactions, le chiffre d'affaires net des
     retours, l'encaissé, le crédit impayé et le coût des marchandises (net des retours).

2. `get_suppliers_report(p_site_id, p_from, p_to)`
   - Renvoie, par fournisseur, le nombre de commandes, le total commandé et le total réglé.

3. `get_tiers_balance(p_site_id)`
   - Renvoie l'état des créances clients et des dettes fournisseurs « à ce jour ».
   - Correction : les tiers partagés (sans site) sont désormais inclus quand un site
     est sélectionné (site du tiers = site demandé OU tiers sans site).

## Sécurité
- Les trois fonctions sont SECURITY INVOKER, STABLE, search_path=public : elles
  s'exécutent avec les droits de l'utilisateur connecté, la RLS s'applique donc.
- Périmètre borné au tenant courant (`current_tenant_id()`) + contrôle d'accès au site.
- Droit d'exécution accordé au rôle `authenticated` uniquement (retiré à anon/public).
- Aucune donnée modifiée. Opération non destructive et ré-exécutable.
*/

-- 1) Rapport Clients ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_customers_report(
  p_site_id uuid DEFAULT NULL::uuid,
  p_from date DEFAULT CURRENT_DATE,
  p_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_ts_from   timestamptz;
  v_ts_to     timestamptz;
  v_result    jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Site not authorized';
  END IF;

  v_ts_from := (p_from::timestamp AT TIME ZONE 'Africa/Dakar');
  v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Dakar');

  WITH sale_agg AS (
    SELECT s.customer_id, s.total, s.status,
           COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp WHERE sp.sale_id = s.id), 0) AS paid_sum,
           COALESCE((SELECT SUM(si.purchase_cost * si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0) AS cost
    FROM sales s
    WHERE s.tenant_id = v_tenant_id
      AND s.status <> 'cancelled'
      AND s.created_at >= v_ts_from
      AND s.created_at <  v_ts_to
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
  ),
  sale_by_cust AS (
    SELECT customer_id,
           COUNT(*) AS tx,
           SUM(total) AS revenue,
           SUM(CASE WHEN status = 'paid' THEN total ELSE LEAST(paid_sum, total) END) AS paid,
           SUM(GREATEST(0, total - CASE WHEN status = 'paid' THEN total ELSE LEAST(paid_sum, total) END)) AS credit,
           SUM(cost) AS cost
    FROM sale_agg
    GROUP BY customer_id
  ),
  ret_agg AS (
    SELECT sr.customer_id,
           SUM(sr.total) AS ret_total,
           SUM(COALESCE((SELECT SUM(sri.purchase_cost * sri.quantity) FROM sale_return_items sri WHERE sri.return_id = sr.id), 0)) AS ret_cost
    FROM sale_returns sr
    WHERE sr.tenant_id = v_tenant_id
      AND sr.status = 'approved'
      AND sr.created_at >= v_ts_from
      AND sr.created_at <  v_ts_to
      AND (p_site_id IS NULL OR sr.site_id = p_site_id)
    GROUP BY sr.customer_id
  ),
  merged AS (
    SELECT sc.customer_id,
           sc.tx,
           sc.revenue - COALESCE(r.ret_total, 0) AS revenue,
           sc.paid    - COALESCE(r.ret_total, 0) AS paid,
           sc.credit  AS credit,
           sc.cost    - COALESCE(r.ret_cost, 0)  AS cost
    FROM sale_by_cust sc
    LEFT JOIN ret_agg r ON r.customer_id IS NOT DISTINCT FROM sc.customer_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name',    CASE WHEN m.customer_id IS NULL THEN 'Comptoir' ELSE COALESCE(c.name, 'Client supprimé') END,
           'txCount', m.tx,
           'revenue', m.revenue,
           'paid',    m.paid,
           'credit',  m.credit,
           'cost',    m.cost
         ) ORDER BY m.revenue DESC), '[]'::jsonb)
    INTO v_result
  FROM merged m
  LEFT JOIN customers c ON c.id = m.customer_id;

  RETURN v_result;
END;
$function$;

-- 2) Rapport Fournisseurs ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_suppliers_report(
  p_site_id uuid DEFAULT NULL::uuid,
  p_from date DEFAULT CURRENT_DATE,
  p_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_ts_from   timestamptz;
  v_ts_to     timestamptz;
  v_result    jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Site not authorized';
  END IF;

  v_ts_from := (p_from::timestamp AT TIME ZONE 'Africa/Dakar');
  v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Dakar');

  WITH ord AS (
    SELECT so.supplier_id, so.total,
           COALESCE((SELECT SUM(spm.amount) FROM supplier_payments spm WHERE spm.supplier_order_id = so.id), 0) AS paid
    FROM supplier_orders so
    WHERE so.tenant_id = v_tenant_id
      AND so.status <> 'cancelled'
      AND so.created_at >= v_ts_from
      AND so.created_at <  v_ts_to
      AND (p_site_id IS NULL OR so.site_id = p_site_id)
  ),
  by_sup AS (
    SELECT supplier_id,
           COUNT(*) AS order_count,
           SUM(total) AS total_ordered,
           SUM(paid)  AS total_paid
    FROM ord
    GROUP BY supplier_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name',         COALESCE(sp.name, 'Fournisseur inconnu'),
           'orderCount',   b.order_count,
           'totalOrdered', b.total_ordered,
           'totalPaid',    b.total_paid
         ) ORDER BY b.total_ordered DESC), '[]'::jsonb)
    INTO v_result
  FROM by_sup b
  LEFT JOIN suppliers sp ON sp.id = b.supplier_id;

  RETURN v_result;
END;
$function$;

-- 3) Balance des tiers « à ce jour » ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_tiers_balance(
  p_site_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_customers jsonb;
  v_suppliers jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Site not authorized';
  END IF;

  -- Clients
  WITH cust AS (
    SELECT c.id, c.name, COALESCE(c.balance, 0) AS raw_bal
    FROM customers c
    WHERE c.tenant_id = v_tenant_id
      AND (p_site_id IS NULL OR c.site_id = p_site_id OR c.site_id IS NULL)
  ),
  outstanding AS (
    SELECT s.customer_id,
           SUM(GREATEST(0, s.total - COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp WHERE sp.sale_id = s.id), 0))) AS amt
    FROM sales s
    WHERE s.tenant_id = v_tenant_id
      AND s.status <> 'cancelled'
      AND (p_site_id IS NULL OR s.site_id = p_site_id OR s.site_id IS NULL)
    GROUP BY s.customer_id
  ),
  adj AS (
    SELECT entity_id, SUM(amount) AS amt
    FROM balance_adjustments
    WHERE tenant_id = v_tenant_id AND entity_type = 'customer'
    GROUP BY entity_id
  ),
  prepay AS (
    SELECT customer_id, SUM(GREATEST(0, amount - amount_used)) AS amt
    FROM customer_prepayments
    WHERE tenant_id = v_tenant_id
    GROUP BY customer_id
  ),
  avoir AS (
    SELECT customer_id, SUM(GREATEST(0, total - credit_used)) AS amt
    FROM sale_returns
    WHERE tenant_id = v_tenant_id AND status = 'approved' AND refund_method = 'avoir'
    GROUP BY customer_id
  ),
  cust_final AS (
    SELECT c.id, c.name, c.raw_bal,
           COALESCE(o.amt, 0) AS outstanding,
           COALESCE(a.amt, 0) AS adjustments,
           LEAST(COALESCE(pp.amt, 0), GREATEST(0, c.raw_bal)) AS applied_prepay,
           COALESCE(av.amt, 0) AS avoir_amt
    FROM cust c
    LEFT JOIN outstanding o ON o.customer_id = c.id
    LEFT JOIN adj a         ON a.entity_id  = c.id
    LEFT JOIN prepay pp     ON pp.customer_id = c.id
    LEFT JOIN avoir av      ON av.customer_id = c.id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',           cf.id,
           'name',         COALESCE(cf.name, 'Client inconnu'),
           'outstanding',  cf.outstanding,
           'adjustments',  cf.adjustments,
           'finalBalance', cf.raw_bal - cf.applied_prepay
                           - LEAST(cf.avoir_amt, GREATEST(0, cf.raw_bal - cf.applied_prepay))
         ) ORDER BY (cf.raw_bal - cf.applied_prepay
                     - LEAST(cf.avoir_amt, GREATEST(0, cf.raw_bal - cf.applied_prepay))) DESC), '[]'::jsonb)
    INTO v_customers
  FROM cust_final cf;

  -- Fournisseurs
  WITH sup AS (
    SELECT s.id, s.name, COALESCE(s.balance, 0) AS raw_bal
    FROM suppliers s
    WHERE s.tenant_id = v_tenant_id
      AND (p_site_id IS NULL OR s.site_id = p_site_id OR s.site_id IS NULL)
  ),
  outstanding AS (
    SELECT so.supplier_id,
           SUM(GREATEST(0, so.total - COALESCE((SELECT SUM(spm.amount) FROM supplier_payments spm WHERE spm.supplier_order_id = so.id), 0))) AS amt
    FROM supplier_orders so
    WHERE so.tenant_id = v_tenant_id
      AND so.status <> 'cancelled'
      AND so.status <> 'draft'
      AND (p_site_id IS NULL OR so.site_id = p_site_id OR so.site_id IS NULL)
    GROUP BY so.supplier_id
  ),
  adj AS (
    SELECT entity_id, SUM(amount) AS amt
    FROM balance_adjustments
    WHERE tenant_id = v_tenant_id AND entity_type = 'supplier'
    GROUP BY entity_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id',           s.id,
           'name',         COALESCE(s.name, 'Fournisseur inconnu'),
           'outstanding',  COALESCE(o.amt, 0),
           'adjustments',  COALESCE(a.amt, 0),
           'finalBalance', s.raw_bal
         ) ORDER BY s.raw_bal DESC), '[]'::jsonb)
    INTO v_suppliers
  FROM sup s
  LEFT JOIN outstanding o ON o.supplier_id = s.id
  LEFT JOIN adj a         ON a.entity_id   = s.id;

  RETURN jsonb_build_object('customers', v_customers, 'suppliers', v_suppliers);
END;
$function$;

-- Droits d'exécution : authenticated uniquement
REVOKE ALL ON FUNCTION public.get_customers_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_suppliers_report(uuid, date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_tiers_balance(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customers_report(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_suppliers_report(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tiers_balance(uuid) TO authenticated;