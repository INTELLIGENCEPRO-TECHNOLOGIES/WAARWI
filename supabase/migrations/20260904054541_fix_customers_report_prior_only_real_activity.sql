/*
# Correction du statut « Solde antérieur » (prior_only) dans le rapport Clients

## Résumé
Le rapport Clients (fonction `get_customers_report`) marquait à tort certains
clients comme « Solde antérieur — aucune activité sur la période » alors qu'ils
avaient bien eu une opération pendant la période.

L'ancienne détection ne regardait que trois signaux approximatifs :
nombre de ventes, retours, et encaissements en espèces (`cash_movements` de
type `income`). Elle ignorait les acomptes, les prêts/retraits clients, les
règlements par avoir/crédit et les ajustements manuels, ce qui produisait de
faux « aucune activité ».

## Changement
1. Nouvelle détection d'activité réelle sur la période (`act`), par client,
   sur l'ensemble des opérations métier :
   - vente non annulée / non supprimée (date effective = `doc_header.doc_date`
     avec repli sur `created_at`) ;
   - règlement de facture ou règlement client (`sale_payments`) ;
   - acompte, prêt et retrait client, remboursement, encaissement
     (`cash_movements` de type `income`, `customer_prepayment`,
     `customer_loan`, `customer_withdrawal`, `refund`) ;
   - retour / avoir approuvé (`sale_returns` status `approved`) ;
   - ajustement manuel réel (`balance_adjustments`), en excluant uniquement
     les écritures techniques `reconciliation` et `cancel_reversal`.
2. Un client reçoit désormais le statut `prior_only` UNIQUEMENT si :
   - son solde calculé juste avant le début de la période est non nul
     (`solde_anterieur`), ET
   - aucune activité réelle n'a eu lieu pendant la période.
   Dès qu'une opération existe dans la période, le statut redevient `active`.
3. Périmètre et solde restent cohérents : la détection d'activité et le solde
   sont calculés sur le même périmètre tenant global (le solde client est
   global), fuseau du tenant (défaut Africa/Dakar), fin de période exclusive.

## Sécurité
Aucune modification de RLS ni de données. Migration forward-only qui remplace
seulement le corps de la fonction (STABLE, SECURITY INVOKER, search_path public).
*/

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
SELECT cm.customer_id AS cid, SUM(cm.amount) AS enc
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.kind = 'income'
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
AND cm.customer_id IS NOT NULL
GROUP BY cm.customer_id
),
act AS (
-- Ventes réelles (date métier effective : doc_date sinon created_at)
SELECT DISTINCT s.customer_id AS cid
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
AND s.customer_id IS NOT NULL
AND (
CASE
WHEN (s.doc_header ->> 'doc_date') ~ '^\d{4}-\d{2}-\d{2}'
THEN ((s.doc_header ->> 'doc_date')::date)::timestamp AT TIME ZONE v_tz
ELSE s.created_at
END
) >= v_ts_from
AND (
CASE
WHEN (s.doc_header ->> 'doc_date') ~ '^\d{4}-\d{2}-\d{2}'
THEN ((s.doc_header ->> 'doc_date')::date)::timestamp AT TIME ZONE v_tz
ELSE s.created_at
END
) < v_ts_to
UNION
-- Règlements de facture / règlements clients
SELECT DISTINCT s.customer_id
FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
WHERE sp2.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
AND sp2.created_at >= v_ts_from AND sp2.created_at < v_ts_to
UNION
-- Retours / avoirs approuvés
SELECT DISTINCT sr.customer_id
FROM sale_returns sr
WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
UNION
-- Acomptes, prêts, retraits, remboursements, encaissements
SELECT DISTINCT cm.customer_id
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL
AND cm.kind IN ('income','customer_prepayment','customer_loan','customer_withdrawal','refund')
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
UNION
-- Ajustements manuels réels (hors écritures techniques)
SELECT DISTINCT ba.entity_id
FROM balance_adjustments ba
WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
AND ba.kind NOT IN ('reconciliation','cancel_reversal')
AND ba.created_at >= v_ts_from AND ba.created_at < v_ts_to
),
ev AS (
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
UNION ALL
SELECT s.customer_id, sp2.created_at, -sp2.amount
FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
WHERE sp2.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
UNION ALL
SELECT sr.customer_id, sr.created_at, -sr.total
FROM sale_returns sr WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
UNION ALL
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
AND ba.kind NOT IN ('reconciliation','cancel_reversal')
),
dc AS (
SELECT cid,
COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_from), 0) AS delta_from,
COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_to), 0)   AS delta_after
FROM ev GROUP BY cid
),
real_rows AS (
SELECT
c.id AS customer_id,
COALESCE(c.name, 'Client supprimé') AS name,
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
OR (COALESCE(c.balance, 0) <> 0 AND (p_site_id IS NULL OR c.site_id = p_site_id OR c.site_id IS NULL))
)
),
comptoir AS (
SELECT
NULL::uuid AS customer_id,
'Comptoir'::text AS name,
false AS is_shared,
true AS has_activity,
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
CASE WHEN NOT has_activity AND ABS(solde_anterieur) > 0.5
THEN 'prior_only' ELSE 'active' END AS status
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

RETURN jsonb_build_object('asOf', to_char(p_to, 'YYYY-MM-DD'), 'rows', v_rows, 'totals', v_totals);
END;
$function$;