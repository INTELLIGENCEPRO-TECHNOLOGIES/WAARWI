/*
  # Rapport des dépenses : afficher la note saisie dans « Motif / note »

  1. Changes
    - `get_expenses_report` : le champ `label` du détail affiche en priorité la note saisie,
      puis le motif saisi s'il diffère de la catégorie. Il ne répète plus le nom de la catégorie.
    - Aucun autre changement (totaux, regroupements, filtres et sécurité identiques).
*/
CREATE OR REPLACE FUNCTION public.get_expenses_report(p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE, p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
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
v_total     numeric := 0;
v_count     bigint  := 0;
v_par_cat   jsonb;
v_par_mode  jsonb;
v_detail    jsonb;
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

SELECT COALESCE(SUM(cm.amount), 0), COUNT(*)
INTO v_total, v_count
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.kind = 'expense' AND cm.supplier_id IS NULL
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

SELECT COALESCE(jsonb_agg(c ORDER BY (c->>'amount')::numeric DESC), '[]'::jsonb) INTO v_par_cat
FROM (
SELECT jsonb_build_object(
'category', COALESCE(NULLIF(ec.name, ''), 'Non catégorisé'),
'amount', COALESCE(SUM(cm.amount), 0),
'count', COUNT(*)
) AS c
FROM cash_movements cm
LEFT JOIN expense_categories ec ON ec.id = cm.expense_category_id
WHERE cm.tenant_id = v_tenant_id
AND cm.kind = 'expense' AND cm.supplier_id IS NULL
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
GROUP BY COALESCE(NULLIF(ec.name, ''), 'Non catégorisé')
) sub;

SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'amount')::numeric DESC), '[]'::jsonb) INTO v_par_mode
FROM (
SELECT jsonb_build_object(
'method', COALESCE(NULLIF(cm.method_name, ''), 'Non précisé'),
'amount', COALESCE(SUM(cm.amount), 0),
'count', COUNT(*)
) AS m
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.kind = 'expense' AND cm.supplier_id IS NULL
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
GROUP BY COALESCE(NULLIF(cm.method_name, ''), 'Non précisé')
) sub;

SELECT COALESCE(jsonb_agg(d ORDER BY d->>'date' DESC), '[]'::jsonb) INTO v_detail
FROM (
SELECT jsonb_build_object(
'date', to_char((cm.created_at AT TIME ZONE v_tz), 'YYYY-MM-DD"T"HH24:MI:SS'),
'category', COALESCE(NULLIF(ec.name, ''), 'Non catégorisé'),
'method', COALESCE(NULLIF(cm.method_name, ''), 'Non précisé'),
'site', COALESCE(st.name, 'Tous les sites'),
'label', COALESCE(
  NULLIF(btrim(cm.note), ''),
  CASE WHEN NULLIF(btrim(cm.reason), '') IS NOT NULL
        AND btrim(cm.reason) IS DISTINCT FROM btrim(COALESCE(ec.name, ''))
       THEN btrim(cm.reason) END,
  ''),
'amount_paid', cm.amount,
'remaining', 0
) AS d
FROM cash_movements cm
LEFT JOIN expense_categories ec ON ec.id = cm.expense_category_id
LEFT JOIN sites st ON st.id = cm.site_id
WHERE cm.tenant_id = v_tenant_id
AND cm.kind = 'expense' AND cm.supplier_id IS NULL
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
ORDER BY cm.created_at DESC
LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0)
) sub;

RETURN jsonb_build_object(
'total', v_total,
'count', v_count,
'par_categorie', v_par_cat,
'par_mode', v_par_mode,
'detail', v_detail,
'detail_limit', p_limit,
'detail_offset', p_offset
);
END;
$function$;
