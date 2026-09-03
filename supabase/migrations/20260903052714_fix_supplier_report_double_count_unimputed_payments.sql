/*
  # Fix: supplier debt double-counting for unimputed (balance) payments

  suppliers.balance is rebuilt from (orders.total - orders.paid) + sum(balance_adjustments);
  it does NOT subtract supplier_payments without an order_id, because such a settlement is
  already represented by a matching balance_adjustments -amount row. The dated-debt reports
  subtracted ALL payments AND all adjustments, double-counting unimputed payments and
  inventing a phantom prior debt. Fix: count supplier_payments only when imputed to an order.
*/

CREATE OR REPLACE FUNCTION public.get_suppliers_report(
  p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_tz        text;
v_ts_from   timestamptz;
v_ts_to     timestamptz;
v_rows      jsonb;
v_totals    jsonb;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
IF p_site_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
) THEN RAISE EXCEPTION 'Site not authorized'; END IF;

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_from := (p_from::timestamp AT TIME ZONE v_tz);
v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

WITH op AS (
SELECT so.supplier_id AS cid, COUNT(*) AS nb, SUM(so.total) AS total_achats
FROM supplier_orders so
WHERE so.tenant_id = v_tenant_id
AND so.status IN ('received', 'sent')
AND so.created_at >= v_ts_from AND so.created_at < v_ts_to
AND (p_site_id IS NULL OR so.site_id = p_site_id)
GROUP BY so.supplier_id
),
pp AS (
SELECT spm.supplier_id AS cid,
SUM(spm.amount) AS reglements,
COALESCE(SUM(spm.amount) FILTER (WHERE spm.order_id IS NULL), 0) AS avances
FROM supplier_payments spm
LEFT JOIN supplier_orders so ON so.id = spm.order_id
WHERE spm.tenant_id = v_tenant_id
AND COALESCE(spm.paid_at, spm.created_at) >= v_ts_from
AND COALESCE(spm.paid_at, spm.created_at) <  v_ts_to
AND (p_site_id IS NULL OR COALESCE(so.site_id, spm.site_id) = p_site_id)
GROUP BY spm.supplier_id
),
ev AS (
SELECT so.supplier_id AS cid, so.created_at AS ts, so.total AS amt
FROM supplier_orders so WHERE so.tenant_id = v_tenant_id AND so.status NOT IN ('cancelled', 'draft')
UNION ALL
SELECT spm.supplier_id, COALESCE(spm.paid_at, spm.created_at), -spm.amount
FROM supplier_payments spm WHERE spm.tenant_id = v_tenant_id AND spm.order_id IS NOT NULL
UNION ALL
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'supplier'
),
dc AS (
SELECT cid,
COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_from), 0) AS delta_from,
COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_to), 0)   AS delta_after
FROM ev GROUP BY cid
),
real_rows AS (
SELECT
s.id AS supplier_id,
COALESCE(s.name, 'Fournisseur inconnu') AS name,
(s.site_id IS NULL) AS is_shared,
COALESCE(op.nb, 0) AS nb_commandes,
COALESCE(op.total_achats, 0) AS total_achats,
COALESCE(pp.reglements, 0) AS reglements,
COALESCE(pp.avances, 0) AS avances,
GREATEST(0, COALESCE(s.balance, 0) - COALESCE(dc.delta_from, 0))  AS dette_anterieure,
GREATEST(0, COALESCE(s.balance, 0) - COALESCE(dc.delta_after, 0)) AS dette_a_date
FROM suppliers s
LEFT JOIN op ON op.cid = s.id
LEFT JOIN pp ON pp.cid = s.id
LEFT JOIN dc ON dc.cid = s.id
WHERE s.tenant_id = v_tenant_id
AND (
op.cid IS NOT NULL OR pp.cid IS NOT NULL
OR (COALESCE(s.balance, 0) > 0 AND (p_site_id IS NULL OR s.site_id = p_site_id OR s.site_id IS NULL))
)
),
all_rows AS (
SELECT supplier_id, name, is_shared, nb_commandes, total_achats, reglements, avances,
dette_anterieure, dette_a_date,
CASE WHEN nb_commandes = 0 AND reglements = 0 AND dette_a_date > 0
     THEN 'prior_only' ELSE 'active' END AS status
FROM real_rows
)
SELECT
COALESCE(jsonb_agg(jsonb_build_object(
'supplier_id', supplier_id, 'name', name, 'is_shared', is_shared,
'nb_commandes', nb_commandes, 'total_achats', total_achats,
'reglements', reglements, 'avances', avances,
'dette_anterieure', dette_anterieure, 'dette_a_date', dette_a_date,
'status', status
) ORDER BY total_achats DESC, dette_a_date DESC), '[]'::jsonb),
jsonb_build_object(
'nb_fournisseurs', COUNT(*),
'total_achats', COALESCE(SUM(total_achats), 0),
'reglements', COALESCE(SUM(reglements), 0),
'avances', COALESCE(SUM(avances), 0),
'dette_a_date', COALESCE(SUM(dette_a_date), 0)
)
INTO v_rows, v_totals
FROM all_rows;

RETURN jsonb_build_object('asOf', to_char(p_to, 'YYYY-MM-DD'), 'rows', v_rows, 'totals', v_totals);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_suppliers_report(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_suppliers_report(uuid, date, date) TO authenticated;


CREATE OR REPLACE FUNCTION public.get_tiers_balance(
  p_site_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT CURRENT_DATE)
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

-- Clients
WITH ev AS (
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.customer_id IS NOT NULL
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

-- Fournisseurs
WITH ev AS (
SELECT so.supplier_id AS cid, so.created_at AS ts, so.total AS amt
FROM supplier_orders so WHERE so.tenant_id = v_tenant_id AND so.status NOT IN ('cancelled', 'draft')
UNION ALL
SELECT spm.supplier_id, COALESCE(spm.paid_at, spm.created_at), -spm.amount
FROM supplier_payments spm WHERE spm.tenant_id = v_tenant_id AND spm.order_id IS NOT NULL
UNION ALL
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'supplier'
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

REVOKE ALL ON FUNCTION public.get_tiers_balance(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tiers_balance(uuid, date) TO authenticated;
