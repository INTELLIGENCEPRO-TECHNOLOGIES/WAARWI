/*
# Rapports & balances des tiers : exclure ventes supprimées et écritures techniques

Met à jour les fonctions de lecture pour ignorer les factures supprimées logiquement
(`status='deleted'`) et les écritures de type `reconciliation` / `cancel_reversal`
(techniques, jamais des règlements) :

1. get_tiers_balance(uuid) : encours clients sans ventes supprimées ; ajustements
   affichés hors reconciliation / cancel_reversal.
2. get_tiers_balance(uuid, date) : mêmes exclusions sur la balance des tiers as-of.
3. get_customers_report(uuid, date, date) : chiffre d'affaires, marges, encours et
   soldes calculés sans ventes supprimées ni écritures techniques.
4. rpc_paginated_invoices : masque les factures supprimées du journal des ventes.

Aucune donnée n'est modifiée ; seules des fonctions de lecture sont réécrites.
*/

-- 1. get_tiers_balance(uuid)
CREATE OR REPLACE FUNCTION public.get_tiers_balance(p_site_id uuid DEFAULT NULL::uuid)
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
AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
AND (p_site_id IS NULL OR s.site_id = p_site_id OR s.site_id IS NULL)
GROUP BY s.customer_id
),
adj AS (
SELECT entity_id, SUM(amount) AS amt
FROM balance_adjustments
WHERE tenant_id = v_tenant_id AND entity_type = 'customer'
AND kind NOT IN ('reconciliation','cancel_reversal')
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
AND kind NOT IN ('reconciliation','cancel_reversal')
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

-- 2. get_tiers_balance(uuid, date)
CREATE OR REPLACE FUNCTION public.get_tiers_balance(p_site_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_tz        text;
v_ts_asof   timestamptz;
v_customers jsonb;
v_suppliers jsonb;
v_cust_tot  jsonb;
v_sup_tot   jsonb;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
IF p_site_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
) THEN RAISE EXCEPTION 'Site not authorized'; END IF;

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_asof := ((p_as_of + 1)::timestamp AT TIME ZONE v_tz);

WITH ev AS (
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
UNION ALL
SELECT s.customer_id, sp.created_at, -sp.amount
FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
WHERE sp.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
UNION ALL
SELECT sr.customer_id, sr.created_at, -sr.total
FROM sale_returns sr WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
UNION ALL
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
AND ba.kind NOT IN ('reconciliation','cancel_reversal')
),
dc AS (
SELECT cid, COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_asof), 0) AS delta_after
FROM ev GROUP BY cid
),
cust AS (
SELECT c.id, COALESCE(c.name, 'Client inconnu') AS name,
COALESCE(c.balance, 0) - COALESCE(dc.delta_after, 0) AS net
FROM customers c
LEFT JOIN dc ON dc.cid = c.id
WHERE c.tenant_id = v_tenant_id
AND (p_site_id IS NULL OR c.site_id = p_site_id OR c.site_id IS NULL)
)
SELECT
COALESCE(jsonb_agg(jsonb_build_object(
'id', id, 'name', name, 'net', net,
'due', GREATEST(net, 0), 'credit', GREATEST(-net, 0)
) ORDER BY net DESC) FILTER (WHERE net <> 0), '[]'::jsonb),
jsonb_build_object(
'due', COALESCE(SUM(GREATEST(net, 0)), 0),
'credit', COALESCE(SUM(GREATEST(-net, 0)), 0)
)
INTO v_customers, v_cust_tot
FROM cust;

WITH ev AS (
SELECT so.supplier_id AS cid, so.created_at AS ts, so.total AS amt
FROM supplier_orders so WHERE so.tenant_id = v_tenant_id AND so.status NOT IN ('cancelled', 'draft')
UNION ALL
SELECT spm.supplier_id, COALESCE(spm.paid_at, spm.created_at), -spm.amount
FROM supplier_payments spm WHERE spm.tenant_id = v_tenant_id AND spm.order_id IS NOT NULL
UNION ALL
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'supplier'
AND ba.kind NOT IN ('reconciliation','cancel_reversal')
),
dc AS (
SELECT cid, COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_asof), 0) AS delta_after
FROM ev GROUP BY cid
),
sup AS (
SELECT s.id, COALESCE(s.name, 'Fournisseur inconnu') AS name,
COALESCE(s.balance, 0) - COALESCE(dc.delta_after, 0) AS net
FROM suppliers s
LEFT JOIN dc ON dc.cid = s.id
WHERE s.tenant_id = v_tenant_id
AND (p_site_id IS NULL OR s.site_id = p_site_id OR s.site_id IS NULL)
)
SELECT
COALESCE(jsonb_agg(jsonb_build_object(
'id', id, 'name', name, 'net', net,
'due', GREATEST(net, 0), 'advance', GREATEST(-net, 0)
) ORDER BY net DESC) FILTER (WHERE net <> 0), '[]'::jsonb),
jsonb_build_object(
'due', COALESCE(SUM(GREATEST(net, 0)), 0),
'advance', COALESCE(SUM(GREATEST(-net, 0)), 0)
)
INTO v_suppliers, v_sup_tot
FROM sup;

RETURN jsonb_build_object(
'asOf', to_char(p_as_of, 'YYYY-MM-DD'),
'customers', v_customers,
'suppliers', v_suppliers,
'totals', jsonb_build_object('customers', v_cust_tot, 'suppliers', v_sup_tot)
);
END;
$function$;
