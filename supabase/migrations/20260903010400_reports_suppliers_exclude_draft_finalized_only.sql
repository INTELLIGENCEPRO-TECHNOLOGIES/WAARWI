/*
# Rapport fournisseurs : n'inclure que les achats finalisés

## Objet
`get_suppliers_report` incluait les commandes au statut `draft` (brouillon) dans
les totaux commandés et réglés. Un brouillon n'est pas un achat engagé : il ne
doit pas peser sur les achats de la période.

Nouveau comportement : seules les commandes finalisées (`received`, `sent`)
comptent ; `draft` et `cancelled` sont exclues. Les règlements restent rattachés
à ces commandes finalisées. La forme du résultat (name, orderCount,
totalOrdered, totalPaid) est inchangée.

## Sécurité
STABLE / SECURITY INVOKER, `search_path` figé. Aucune donnée modifiée.
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
v_result    jsonb;
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

WITH ord AS (
SELECT so.supplier_id, so.total,
COALESCE((SELECT SUM(spm.amount) FROM supplier_payments spm WHERE spm.order_id = so.id), 0) AS paid
FROM supplier_orders so
WHERE so.tenant_id = v_tenant_id
AND so.status IN ('received', 'sent')
AND so.created_at >= v_ts_from
AND so.created_at <  v_ts_to
AND (p_site_id IS NULL OR so.site_id = p_site_id)
),
by_sup AS (
SELECT supplier_id, COUNT(*) AS order_count, SUM(total) AS total_ordered, SUM(paid) AS total_paid
FROM ord GROUP BY supplier_id
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
