/*
# Rapport Caisse calculé côté serveur (get_cash_report)

## Objet
Nouvelle fonction `get_cash_report(p_site_id, p_from, p_to)` qui calcule tous les
flux de trésorerie côté serveur, à partir du registre de caisse (`cash_movements`)
et des fonds d'ouverture (`cash_sessions.opening_amount`).

Le registre `cash_movements` est la source unique et canonique : chaque règlement
de vente, règlement client, règlement fournisseur payé en caisse, dépense,
remboursement, acompte, prêt ou retrait y est inscrit une seule fois. On n'utilise
donc jamais `sale_payments` pour la trésorerie (ce qui doublerait les encaissements).

## Contenu renvoyé
- Reprise de l'activité commerciale et de la rentabilité (via get_financial_summary).
- fonds_ouverture, règlements clients, autres entrées, encaissements réels,
  règlements fournisseurs, dépenses payées, remboursements décaissés, autres sorties,
  total entrées / sorties, solde théorique.
- Ventilation par mode de règlement (entrées / sorties / net).
- Évolution journalière de la caisse (entrées / sorties / solde du jour).
- Articles vendus nets de retours (quantité, CA net, coût) calculés côté serveur.

## Règles respectées
- Date réelle du mouvement (`cash_movements.created_at`), fuseau du tenant sinon
  Africa/Dakar, borne de fin exclusive (lendemain 00:00).
- Vente à crédit sans paiement : aucun mouvement => non comptée.
- Allocation d'acompte / avoir : aucun mouvement => non comptée.
- Avoir sans remboursement : aucun mouvement => n'affecte pas la caisse.
- Remboursement compté seulement s'il a été réellement décaissé (kind='refund').
- Chaque mouvement compté une seule fois ; pas de dépendance à une limite de lignes.
- Invariant : fonds_ouverture + total_entrees − total_sorties = solde_theorique.

## Sécurité
STABLE / SECURITY INVOKER, search_path figé. Aucune donnée modifiée.
*/

CREATE OR REPLACE FUNCTION public.get_cash_report(
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
v_summary   jsonb;
v_fonds     numeric := 0;
v_reg_cli   numeric := 0;
v_autres_in numeric := 0;
v_reg_four  numeric := 0;
v_depenses  numeric := 0;
v_rembours  numeric := 0;
v_autres_out numeric := 0;
v_tot_in    numeric := 0;
v_tot_out   numeric := 0;
v_par_mode  jsonb;
v_par_jour  jsonb;
v_articles  jsonb;
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

-- Activité commerciale + rentabilité (moteur central déjà corrigé)
v_summary := get_financial_summary(p_site_id, p_from, p_to);

-- Fonds d'ouverture : sommes des floats d'ouverture des sessions ouvertes sur la période
SELECT COALESCE(SUM(cs.opening_amount), 0) INTO v_fonds
FROM cash_sessions cs
WHERE cs.tenant_id = v_tenant_id
AND cs.opened_at >= v_ts_from AND cs.opened_at < v_ts_to
AND (p_site_id IS NULL OR cs.site_id = p_site_id);

-- Agrégats du registre de caisse par grande catégorie
SELECT
COALESCE(SUM(CASE WHEN cm.kind = 'income' AND cm.customer_id IS NOT NULL THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'income' AND cm.customer_id IS NULL THEN cm.amount
                  WHEN cm.kind = 'customer_prepayment' THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'expense' AND cm.supplier_id IS NOT NULL THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'expense' AND cm.supplier_id IS NULL THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'refund' THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind IN ('customer_loan', 'customer_withdrawal') THEN cm.amount ELSE 0 END), 0)
INTO v_reg_cli, v_autres_in, v_reg_four, v_depenses, v_rembours, v_autres_out
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

v_tot_in  := v_reg_cli + v_autres_in;
v_tot_out := v_reg_four + v_depenses + v_rembours + v_autres_out;

-- Ventilation par mode de règlement
SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'net')::numeric DESC), '[]'::jsonb) INTO v_par_mode
FROM (
SELECT jsonb_build_object(
'method', COALESCE(NULLIF(cm.method_name, ''), 'Non précisé'),
'entrees', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment') THEN cm.amount ELSE 0 END), 0),
'sorties', COALESCE(SUM(CASE WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal') THEN cm.amount ELSE 0 END), 0),
'net', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment') THEN cm.amount
                        WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal') THEN -cm.amount ELSE 0 END), 0)
) AS m
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
GROUP BY COALESCE(NULLIF(cm.method_name, ''), 'Non précisé')
) sub;

-- Évolution journalière (date métier)
SELECT COALESCE(jsonb_agg(d ORDER BY d->>'date'), '[]'::jsonb) INTO v_par_jour
FROM (
SELECT jsonb_build_object(
'date', to_char((cm.created_at AT TIME ZONE v_tz)::date, 'YYYY-MM-DD'),
'entrees', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment') THEN cm.amount ELSE 0 END), 0),
'sorties', COALESCE(SUM(CASE WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal') THEN cm.amount ELSE 0 END), 0),
'solde', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment') THEN cm.amount
                          WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal') THEN -cm.amount ELSE 0 END), 0)
) AS d
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
GROUP BY (cm.created_at AT TIME ZONE v_tz)::date
) sub;

-- Articles vendus nets de retours (côté serveur)
WITH sold AS (
SELECT si.article_id, COALESCE(a.name, si.name) AS name,
SUM(si.quantity) AS qty, SUM(si.total) AS revenue, SUM(COALESCE(si.purchase_cost,0) * si.quantity) AS cost
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
LEFT JOIN articles a ON a.id = si.article_id
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid','partial','validated')
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
GROUP BY si.article_id, COALESCE(a.name, si.name)
),
returned AS (
SELECT sri.article_id,
SUM(sri.quantity) AS qty, SUM(sri.total) AS revenue, SUM(COALESCE(sri.purchase_cost,0) * sri.quantity) AS cost
FROM sale_return_items sri
JOIN sale_returns sr ON sr.id = sri.return_id
WHERE sr.tenant_id = v_tenant_id
AND sr.status = 'approved'
AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
AND (p_site_id IS NULL OR sr.site_id = p_site_id)
GROUP BY sri.article_id
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
'name', so.name,
'qty', so.qty - COALESCE(r.qty, 0),
'revenue', so.revenue - COALESCE(r.revenue, 0),
'cost', so.cost - COALESCE(r.cost, 0)
) ORDER BY (so.revenue - COALESCE(r.revenue, 0)) DESC), '[]'::jsonb) INTO v_articles
FROM sold so LEFT JOIN returned r ON r.article_id = so.article_id;

RETURN v_summary || jsonb_build_object(
'fonds_ouverture',        v_fonds,
'reglements_clients',     v_reg_cli,
'autres_entrees',         v_autres_in,
'encaissements_reels',    v_tot_in,
'reglements_fournisseurs',v_reg_four,
'depenses_payees',        v_depenses,
'remboursements_clients', v_rembours,
'autres_sorties',         v_autres_out,
'total_entrees',          v_tot_in,
'total_sorties',          v_tot_out,
'solde_theorique',        v_fonds + v_tot_in - v_tot_out,
'par_mode',               v_par_mode,
'par_jour',               v_par_jour,
'articles',               v_articles
);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cash_report(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cash_report(uuid, date, date) TO authenticated;
