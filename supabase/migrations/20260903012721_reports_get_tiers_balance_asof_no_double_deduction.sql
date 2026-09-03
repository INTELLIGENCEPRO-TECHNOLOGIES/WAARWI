/*
# Balance des tiers à une date (get_tiers_balance avec date d'arrêté)

## Objet
Nouvelle signature `get_tiers_balance(p_site_id, p_as_of)` qui renvoie la
situation des tiers ARRÊTÉE à une date (« Situation au … »).

## Correction apportée
L'ancienne version (sans date) redéduisait les acomptes (customer_prepayments) et
les avoirs (sale_returns) du solde `customers.balance` — alors que ce solde les
intègre DÉJÀ. Cela produisait une double déduction et de fausses lignes
« Crédit client ». La nouvelle version prend le solde opérationnel comme référence
et n'y touche pas :
- solde net à la date = solde_actuel − (delta des événements de solde datés ≥ arrêté)
- Clients : montant dû = GREATEST(net, 0), crédit = GREATEST(−net, 0).
- Fournisseurs : dette = GREATEST(net, 0), avance = GREATEST(−net, 0).

Ensemble complet des événements de solde datés :
- Clients : +total des ventes non annulées, −règlements, −avoirs, ±ajustements.
- Fournisseurs : +total des commandes non annulées/brouillon, −règlements (date
  réelle paid_at), ±ajustements.

## Inclusion
Sont listés les tiers dont le solde net à la date est non nul (y compris ceux sans
activité récente). Les tiers à solde nul sont masqués. Le filtre site inclut les
tiers du site et les tiers partagés (`site_id IS NULL`).

## Sécurité / sûreté
STABLE / SECURITY INVOKER, search_path figé, fuseau du tenant sinon Africa/Dakar,
borne d'arrêté exclusive au lendemain 00:00. Aucune donnée modifiée. L'ancienne
signature à un argument est conservée (aucune suppression).
*/

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
