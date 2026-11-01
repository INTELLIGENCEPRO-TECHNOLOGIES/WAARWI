/*
# MC1-E : soldes clients globaux dans les rapports clients et la balance des tiers

1. Nouvelles fonctions (SECURITY DEFINER, agrégats uniquement)
- `_cs_customer_balance_deltas(ts_from, ts_to)` : variation du solde de chaque client du tenant courant
  depuis ts_from et depuis ts_to (même formule d'événements que les rapports existants).
  Ne renvoie qu'un identifiant client et deux montants : aucune référence d'acompte, de session ou de magasin.
- `_cs_customer_balance_components(site)` : par client, reste dû sur ventes, acompte disponible
  (agrégat MC1-D.3 get_customer_prepay_available) et avoirs disponibles.
- EXECUTE réservé à authenticated et service_role.

2. Fonctions modifiées
- `get_customers_report`, `get_tiers_balance(site, date)`, `get_tiers_balance(site)` :
  en mode multi-caisse uniquement, les soldes (solde antérieur, solde à date, montant dû, crédit disponible,
  solde final) sont calculés sur les agrégats globaux au lieu des seules lignes visibles.
  Les mouvements de la période (ventes, retours, encaissements) restent limités au périmètre autorisé.
  En mode multi, la réponse contient `balances_scope = 'global'`.
- Mode désactivé : branche historique inchangée (mêmes requêtes, mêmes résultats).

3. Notes
1. Aucune donnée, permission ou politique modifiée.
2. Les droits d'exécution existants des trois rapports sont conservés (CREATE OR REPLACE).
*/
CREATE OR REPLACE FUNCTION public._cs_customer_balance_deltas(p_ts_from timestamptz, p_ts_to timestamptz)
RETURNS TABLE(cid uuid, delta_from numeric, delta_after numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
WITH t AS (SELECT public.current_tenant_id() AS tid WHERE auth.uid() IS NOT NULL),
ev AS (
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = (SELECT tid FROM t) AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
UNION ALL
SELECT s.customer_id, sp2.created_at, -sp2.amount
FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
WHERE sp2.tenant_id = (SELECT tid FROM t) AND s.customer_id IS NOT NULL AND COALESCE(sp2.affects_balance, true) = true
UNION ALL
SELECT sr.customer_id, sr.created_at, -sr.total
FROM sale_returns sr WHERE sr.tenant_id = (SELECT tid FROM t) AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
UNION ALL
SELECT pp.customer_id, pp.created_at, -pp.amount
FROM customer_prepayments pp WHERE pp.tenant_id = (SELECT tid FROM t) AND pp.customer_id IS NOT NULL
UNION ALL
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = (SELECT tid FROM t) AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_withdrawal'
UNION ALL
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = (SELECT tid FROM t) AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_loan'
UNION ALL
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = (SELECT tid FROM t) AND ba.entity_type = 'customer' AND ba.kind NOT IN ('reconciliation','cancel_reversal')
UNION ALL
SELECT cp.customer_id, cp.created_at, -cp.amount
FROM customer_payments cp WHERE cp.tenant_id = (SELECT tid FROM t) AND cp.status = 'confirmed'
)
SELECT ev.cid,
COALESCE(SUM(ev.amt) FILTER (WHERE ev.ts >= p_ts_from), 0),
COALESCE(SUM(ev.amt) FILTER (WHERE ev.ts >= p_ts_to), 0)
FROM ev WHERE ev.cid IS NOT NULL GROUP BY ev.cid
$f$;
REVOKE ALL ON FUNCTION public._cs_customer_balance_deltas(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._cs_customer_balance_deltas(timestamptz, timestamptz) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._cs_customer_balance_components(p_site_id uuid)
RETURNS TABLE(cid uuid, outstanding numeric, prepay numeric, avoir numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
WITH t AS (SELECT public.current_tenant_id() AS tid WHERE auth.uid() IS NOT NULL),
o AS (
SELECT s.customer_id AS cid,
SUM(GREATEST(0, s.total - COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp WHERE sp.sale_id = s.id), 0))) AS amt
FROM sales s
WHERE s.tenant_id = (SELECT tid FROM t) AND s.customer_id IS NOT NULL
AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
AND (p_site_id IS NULL OR s.site_id = p_site_id OR s.site_id IS NULL)
GROUP BY s.customer_id
),
pp AS (
SELECT e.key::uuid AS cid, e.value::numeric AS amt
FROM t, jsonb_each_text(public.get_customer_prepay_available(NULL)) e
),
av AS (
SELECT customer_id AS cid, SUM(GREATEST(0, total - credit_used)) AS amt
FROM sale_returns
WHERE tenant_id = (SELECT tid FROM t) AND customer_id IS NOT NULL
AND status = 'approved' AND refund_method = 'avoir'
GROUP BY customer_id
),
k AS (SELECT o.cid FROM o UNION SELECT pp.cid FROM pp UNION SELECT av.cid FROM av)
SELECT k.cid, COALESCE(o.amt, 0), COALESCE(pp.amt, 0), COALESCE(av.amt, 0)
FROM k LEFT JOIN o ON o.cid = k.cid LEFT JOIN pp ON pp.cid = k.cid LEFT JOIN av ON av.cid = k.cid
$f$;
REVOKE ALL ON FUNCTION public._cs_customer_balance_components(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._cs_customer_balance_components(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_customers_report(p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE)
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
v_multi     boolean := public._cs_multi_current();
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
IF p_site_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
) THEN RAISE EXCEPTION 'Site not authorized'; END IF;

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz
FROM tenants WHERE id = v_tenant_id;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_from := (p_from::timestamp AT TIME ZONE v_tz);
v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

WITH sp AS (
SELECT s.customer_id AS cid,
COUNT(*) AS nb,
SUM(s.total - COALESCE(s.vat_amount, 0)) AS ca_ht,
SUM(COALESCE(s.discount, 0)) AS remises,
SUM(COALESCE((SELECT SUM(si.purchase_cost * si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0)) AS cost
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND s.customer_id IS NOT NULL
GROUP BY s.customer_id
),
rp AS (
SELECT sr.customer_id AS cid,
SUM(sr.total) AS retours,
SUM(COALESCE((SELECT SUM(sri.purchase_cost * sri.quantity) FROM sale_return_items sri WHERE sri.return_id = sr.id), 0)) AS ret_cost
FROM sale_returns sr
WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved'
AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
AND (p_site_id IS NULL OR sr.site_id = p_site_id)
AND sr.customer_id IS NOT NULL
GROUP BY sr.customer_id
),
ep AS (
SELECT cid, SUM(enc) AS enc FROM (
SELECT cm.customer_id AS cid, SUM(cm.amount) AS enc
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.kind IN ('income', 'customer_prepayment')
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
AND cm.customer_id IS NOT NULL
GROUP BY cm.customer_id
UNION ALL
SELECT s.customer_id AS cid, SUM(spay.amount) AS enc
FROM sale_payments spay
JOIN sales s ON s.id = spay.sale_id
WHERE spay.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
AND COALESCE(spay.affects_balance, true) = true
AND spay.created_at >= v_ts_from AND spay.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND NOT EXISTS (
SELECT 1 FROM cash_movements cm2
WHERE cm2.tenant_id = v_tenant_id AND cm2.kind = 'income'
AND cm2.customer_id = s.customer_id
AND cm2.reference = spay.reference
AND cm2.amount = spay.amount
AND cm2.created_at >= v_ts_from AND cm2.created_at < v_ts_to
)
GROUP BY s.customer_id
) sub GROUP BY cid
),
act AS (
SELECT DISTINCT cid FROM (
SELECT s.customer_id AS cid FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
AND s.customer_id IS NOT NULL
AND (CASE WHEN (s.doc_header ->> 'doc_date') ~ '^\d{4}-\d{2}-\d{2}'
THEN ((s.doc_header ->> 'doc_date')::date)::timestamp AT TIME ZONE v_tz
ELSE s.created_at END) >= v_ts_from
AND (CASE WHEN (s.doc_header ->> 'doc_date') ~ '^\d{4}-\d{2}-\d{2}'
THEN ((s.doc_header ->> 'doc_date')::date)::timestamp AT TIME ZONE v_tz
ELSE s.created_at END) < v_ts_to
UNION
SELECT s.customer_id FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
WHERE sp2.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
AND sp2.created_at >= v_ts_from AND sp2.created_at < v_ts_to
UNION
SELECT sr.customer_id FROM sale_returns sr
WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
UNION
SELECT cm.customer_id FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL
AND cm.kind IN ('income','customer_prepayment','customer_loan','customer_withdrawal','refund')
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
UNION
SELECT ba.entity_id FROM balance_adjustments ba
WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
AND ba.kind NOT IN ('reconciliation','cancel_reversal')
AND ba.created_at >= v_ts_from AND ba.created_at < v_ts_to
UNION
SELECT cp.customer_id FROM customer_payments cp
WHERE cp.tenant_id = v_tenant_id AND cp.status = 'confirmed'
AND cp.created_at >= v_ts_from AND cp.created_at < v_ts_to
) a
),
ev AS (
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
UNION ALL
SELECT s.customer_id, sp2.created_at, -sp2.amount
FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
WHERE sp2.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL AND COALESCE(sp2.affects_balance, true) = true
UNION ALL
SELECT sr.customer_id, sr.created_at, -sr.total
FROM sale_returns sr WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
UNION ALL
SELECT pp.customer_id, pp.created_at, -pp.amount
FROM customer_prepayments pp WHERE pp.tenant_id = v_tenant_id AND pp.customer_id IS NOT NULL
UNION ALL
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_withdrawal'
UNION ALL
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_loan'
UNION ALL
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer' AND ba.kind NOT IN ('reconciliation','cancel_reversal')
UNION ALL
-- Customer balance payments reduce balance
SELECT cp.customer_id, cp.created_at, -cp.amount
FROM customer_payments cp WHERE cp.tenant_id = v_tenant_id AND cp.status = 'confirmed'
),
dc AS (
SELECT cid,
COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_from), 0) AS delta_from,
COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_to), 0)   AS delta_after
FROM ev WHERE NOT v_multi GROUP BY cid
UNION ALL
SELECT g.cid, g.delta_from, g.delta_after
FROM public._cs_customer_balance_deltas(v_ts_from, v_ts_to) g WHERE v_multi
),
real_rows AS (
SELECT
c.id AS customer_id, COALESCE(c.name, 'Client supprimé') AS name,
(c.site_id IS NULL) AS is_shared,
(act.cid IS NOT NULL) AS has_activity,
COALESCE(sp.nb, 0) AS nb_ventes,
COALESCE(sp.ca_ht, 0) AS ca_ht,
COALESCE(sp.remises, 0) AS remises,
COALESCE(rp.retours, 0) AS retours,
COALESCE(sp.ca_ht, 0) - COALESCE(rp.retours, 0) AS ca_net,
COALESCE(sp.cost, 0) - COALESCE(rp.ret_cost, 0) AS cost,
(COALESCE(sp.ca_ht, 0) - COALESCE(rp.retours, 0)) - (COALESCE(sp.cost, 0) - COALESCE(rp.ret_cost, 0)) AS marge,
COALESCE(ep.enc, 0) AS encaissements,
COALESCE(c.balance, 0) - COALESCE(dc.delta_from, 0)  AS solde_anterieur,
COALESCE(c.balance, 0) - COALESCE(dc.delta_after, 0) AS solde_a_date
FROM customers c
LEFT JOIN sp ON sp.cid = c.id
LEFT JOIN rp ON rp.cid = c.id
LEFT JOIN ep ON ep.cid = c.id
LEFT JOIN dc ON dc.cid = c.id
LEFT JOIN act ON act.cid = c.id
WHERE c.tenant_id = v_tenant_id
AND (
sp.cid IS NOT NULL OR rp.cid IS NOT NULL OR ep.cid IS NOT NULL
OR act.cid IS NOT NULL
OR (COALESCE(c.balance, 0) <> 0 AND (p_site_id IS NULL OR c.site_id = p_site_id OR c.site_id IS NULL))
OR (COALESCE(c.balance, 0) - COALESCE(dc.delta_after, 0)) <> 0
)
),
comptoir AS (
SELECT
NULL::uuid AS customer_id, 'Comptoir'::text AS name,
false AS is_shared, true AS has_activity,
COUNT(*) AS nb_ventes,
SUM(s.total - COALESCE(s.vat_amount, 0)) AS ca_ht,
SUM(COALESCE(s.discount, 0)) AS remises,
0::numeric AS retours,
SUM(s.total - COALESCE(s.vat_amount, 0)) AS ca_net,
SUM(COALESCE((SELECT SUM(si.purchase_cost * si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0)) AS cost,
SUM(s.total - COALESCE(s.vat_amount, 0)) - SUM(COALESCE((SELECT SUM(si.purchase_cost * si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0)) AS marge,
0::numeric AS encaissements,
0::numeric AS solde_anterieur,
0::numeric AS solde_a_date
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND s.customer_id IS NULL
HAVING COUNT(*) > 0
),
all_rows AS (
SELECT customer_id, name, is_shared, nb_ventes, ca_ht, remises, retours, ca_net, cost, marge,
encaissements, solde_anterieur, solde_a_date,
GREATEST(solde_a_date, 0) AS montant_du,
GREATEST(-solde_a_date, 0) AS credit_disponible,
CASE WHEN NOT has_activity AND ABS(solde_anterieur) > 0.5 THEN 'prior_only' ELSE 'active' END AS status
FROM real_rows
UNION ALL
SELECT customer_id, name, is_shared, nb_ventes, ca_ht, remises, retours, ca_net, cost, marge,
encaissements, solde_anterieur, solde_a_date, 0::numeric, 0::numeric, 'active'
FROM comptoir
)
SELECT
COALESCE(jsonb_agg(jsonb_build_object(
'customer_id', customer_id, 'name', name, 'is_shared', is_shared,
'nb_ventes', nb_ventes, 'ca_ht', ca_ht, 'remises', remises, 'retours', retours,
'ca_net', ca_net, 'cost', cost, 'marge', marge,
'encaissements', encaissements, 'solde_anterieur', solde_anterieur,
'solde_a_date', solde_a_date, 'montant_du', montant_du,
'credit_disponible', credit_disponible, 'status', status
) ORDER BY ca_net DESC, montant_du DESC), '[]'::jsonb),
jsonb_build_object(
'nb_clients', COUNT(*),
'ca_ht', COALESCE(SUM(ca_ht), 0),
'remises', COALESCE(SUM(remises), 0),
'retours', COALESCE(SUM(retours), 0),
'ca_net', COALESCE(SUM(ca_net), 0),
'marge', COALESCE(SUM(marge), 0),
'encaissements', COALESCE(SUM(encaissements), 0),
'montant_du', COALESCE(SUM(montant_du), 0),
'credit_disponible', COALESCE(SUM(credit_disponible), 0)
)
INTO v_rows, v_totals
FROM all_rows;

RETURN jsonb_build_object('asOf', to_char(p_to, 'YYYY-MM-DD'), 'rows', v_rows, 'totals', v_totals)
|| CASE WHEN v_multi THEN jsonb_build_object('balances_scope', 'global') ELSE '{}'::jsonb END;
END;
$function$;

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
v_multi     boolean := public._cs_multi_current();
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
IF p_site_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
) THEN RAISE EXCEPTION 'Site not authorized'; END IF;

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz
FROM tenants WHERE id = v_tenant_id;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_asof := ((p_as_of + 1)::timestamp AT TIME ZONE v_tz);

WITH ev AS (
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
UNION ALL
SELECT s.customer_id, sp.created_at, -sp.amount
FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
WHERE sp.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL AND COALESCE(sp.affects_balance, true) = true
UNION ALL
SELECT sr.customer_id, sr.created_at, -sr.total
FROM sale_returns sr WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
UNION ALL
SELECT pp.customer_id, pp.created_at, -pp.amount
FROM customer_prepayments pp WHERE pp.tenant_id = v_tenant_id AND pp.customer_id IS NOT NULL
UNION ALL
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_withdrawal'
UNION ALL
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_loan'
UNION ALL
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer' AND ba.kind NOT IN ('reconciliation','cancel_reversal')
UNION ALL
-- Customer balance payments
SELECT cp.customer_id, cp.created_at, -cp.amount
FROM customer_payments cp WHERE cp.tenant_id = v_tenant_id AND cp.status = 'confirmed'
),
dc AS (
SELECT cid, COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_asof), 0) AS delta_after
FROM ev WHERE NOT v_multi GROUP BY cid
UNION ALL
SELECT g.cid, g.delta_after
FROM public._cs_customer_balance_deltas(v_ts_asof, v_ts_asof) g WHERE v_multi
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
'due', COALESCE(SUM(GREATEST(net, 0)) FILTER (WHERE net <> 0), 0),
'credit', COALESCE(SUM(GREATEST(-net, 0)) FILTER (WHERE net <> 0), 0)
)
INTO v_customers, v_cust_tot
FROM cust;

-- Suppliers (unchanged)
WITH ev AS (
SELECT so.supplier_id AS cid, so.created_at AS ts, so.total AS amt
FROM supplier_orders so WHERE so.tenant_id = v_tenant_id AND so.status NOT IN ('cancelled', 'draft')
UNION ALL
SELECT spm.supplier_id, COALESCE(spm.paid_at, spm.created_at), -spm.amount
FROM supplier_payments spm WHERE spm.tenant_id = v_tenant_id
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
'due', COALESCE(SUM(GREATEST(net, 0)) FILTER (WHERE net <> 0), 0),
'advance', COALESCE(SUM(GREATEST(-net, 0)) FILTER (WHERE net <> 0), 0)
)
INTO v_suppliers, v_sup_tot
FROM sup;

RETURN jsonb_build_object(
'asOf', to_char(p_as_of, 'YYYY-MM-DD'),
'customers', v_customers,
'suppliers', v_suppliers,
'totals', jsonb_build_object('customers', v_cust_tot, 'suppliers', v_sup_tot)
)
|| CASE WHEN v_multi THEN jsonb_build_object('balances_scope', 'global') ELSE '{}'::jsonb END;
END;
$function$;

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
v_multi     boolean := public._cs_multi_current();
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
gc AS (
SELECT * FROM public._cs_customer_balance_components(p_site_id) WHERE v_multi
),
outstanding AS (
SELECT s.customer_id,
SUM(GREATEST(0, s.total - COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp WHERE sp.sale_id = s.id), 0))) AS amt
FROM sales s
WHERE NOT v_multi AND s.tenant_id = v_tenant_id
AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
AND (p_site_id IS NULL OR s.site_id = p_site_id OR s.site_id IS NULL)
GROUP BY s.customer_id
UNION ALL
SELECT gc.cid, gc.outstanding FROM gc
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
WHERE NOT v_multi AND tenant_id = v_tenant_id
GROUP BY customer_id
UNION ALL
SELECT gc.cid, gc.prepay FROM gc
),
avoir AS (
SELECT customer_id, SUM(GREATEST(0, total - credit_used)) AS amt
FROM sale_returns
WHERE NOT v_multi AND tenant_id = v_tenant_id AND status = 'approved' AND refund_method = 'avoir'
GROUP BY customer_id
UNION ALL
SELECT gc.cid, gc.avoir FROM gc
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
