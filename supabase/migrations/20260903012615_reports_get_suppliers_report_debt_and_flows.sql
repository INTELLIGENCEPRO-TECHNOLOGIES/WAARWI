/*
# Rapport Fournisseurs : achats, règlements, dette (get_suppliers_report)

## Objet
Réécriture de `get_suppliers_report(p_site_id, p_from, p_to)` pour fournir, par
fournisseur :
- Achats validés de la période (commandes reçues/envoyées) : nombre et total.
- Règlements de la période à la DATE RÉELLE de paiement (`supplier_payments.paid_at`,
  sinon `created_at`).
- Avances / crédits fournisseur de la période (règlements non imputés à une commande).
- Dette antérieure (au début de la période) et dette à la date de fin.

## Exclusions
Les commandes en brouillon, annulées ou non finalisées sont exclues : seules
`status IN ('received','sent')` comptent (règle déjà appliquée, conservée).

## Principe de dette
`suppliers.balance` est la dette opérationnelle faisant autorité (TTC, plancher 0).
On ne la recalcule pas. Les dettes datées sont dérivées du solde actuel en
retranchant le delta des événements datés (commandes non annulées/brouillon +total,
règlements −montant, ajustements ±), résultat plancher à 0 :
- dette à la date de fin = GREATEST(0, solde_actuel − delta des événements datés ≥ fin)
- dette antérieure       = GREATEST(0, solde_actuel − delta des événements datés ≥ début)
La dette étant globale, le filtre site s'applique aux achats/règlements, pas à la dette.

## Inclusion / exclusion
- Fournisseur avec dette mais sans achat récent : affiché, marqué `prior_only`.
- Fournisseur sans activité ET sans dette : masqué.
- Fournisseurs partagés (`site_id IS NULL`) : inclus dès que leurs transactions
  relèvent du site sélectionné.

## Sécurité / sûreté
STABLE / SECURITY INVOKER, search_path figé, fuseau du tenant sinon Africa/Dakar,
borne de fin exclusive. Aucune donnée modifiée.
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
AND (p_site_id IS NULL OR so.site_id = p_site_id)
GROUP BY spm.supplier_id
),
ev AS (
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
