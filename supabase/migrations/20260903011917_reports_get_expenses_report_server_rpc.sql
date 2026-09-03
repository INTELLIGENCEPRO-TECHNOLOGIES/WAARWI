/*
# Rapport Dépenses calculé côté serveur (get_expenses_report)

## Objet
Nouvelle fonction `get_expenses_report(p_site_id, p_from, p_to, p_limit, p_offset)`
qui calcule les dépenses d'exploitation côté serveur.

## Modèle de données constaté
Dans cette application il n'existe pas de table `expenses` avec un cycle de
validation (brouillon / rejeté / annulé). Une dépense d'exploitation EST un
décaissement de caisse : une ligne `cash_movements` de type `expense` sans
fournisseur (`supplier_id IS NULL`), rattachée à une catégorie de dépense.
Elle est donc « validée » par construction (l'argent est réellement sorti) et
le montant payé égale le montant, le reste dû étant nul.

Les règlements fournisseurs (`kind='expense'` AVEC `supplier_id`) ne sont PAS
des dépenses d'exploitation : ils figurent dans le rapport Fournisseurs. Ils
sont donc exclus ici pour éviter tout double comptage.

## Contenu renvoyé
- total, count (totaux serveur, sans dépendre d'une limite de lignes).
- Ventilation par catégorie (montant, nombre).
- Ventilation par mode de règlement (montant, nombre).
- Détail chronologique paginé : date effective, catégorie, mode, site, libellé,
  montant payé, reste dû (toujours 0 puisque décaissement immédiat).

## Règles respectées
- Date effective = `cash_movements.created_at`, fuseau du tenant sinon Africa/Dakar,
  borne de fin exclusive (lendemain 00:00).
- Chaque dépense compte une seule fois (dans le total et comme sortie de caisse).
- Détail paginé ; totaux calculés indépendamment de la pagination.

## Sécurité
STABLE / SECURITY INVOKER, search_path figé. Aucune donnée modifiée.
*/

CREATE OR REPLACE FUNCTION public.get_expenses_report(
  p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE,
  p_limit integer DEFAULT 100, p_offset integer DEFAULT 0)
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
'label', COALESCE(NULLIF(cm.reason, ''), COALESCE(NULLIF(cm.note, ''), 'Dépense')),
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

REVOKE ALL ON FUNCTION public.get_expenses_report(uuid, date, date, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_expenses_report(uuid, date, date, integer, integer) TO authenticated;
