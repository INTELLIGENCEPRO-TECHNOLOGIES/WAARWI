/*
# Correction : colonne de liaison des règlements fournisseurs

## Résumé (langage clair)
Les fonctions serveur des rapports Fournisseurs et Balance des tiers reliaient les
règlements fournisseurs aux commandes par une colonne inexistante. La bonne colonne
de liaison est `supplier_payments.order_id`. Cette migration corrige les deux fonctions.

## Sécurité
- Fonctions inchangées sur le plan des droits (SECURITY INVOKER, STABLE, search_path=public).
- Aucune donnée modifiée. Ré-exécutable.
*/

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
           COALESCE((SELECT SUM(spm.amount) FROM supplier_payments spm WHERE spm.order_id = so.id), 0) AS paid
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

  WITH sup AS (
    SELECT s.id, s.name, COALESCE(s.balance, 0) AS raw_bal
    FROM suppliers s
    WHERE s.tenant_id = v_tenant_id
      AND (p_site_id IS NULL OR s.site_id = p_site_id OR s.site_id IS NULL)
  ),
  outstanding AS (
    SELECT so.supplier_id,
           SUM(GREATEST(0, so.total - COALESCE((SELECT SUM(spm.amount) FROM supplier_payments spm WHERE spm.order_id = so.id), 0))) AS amt
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