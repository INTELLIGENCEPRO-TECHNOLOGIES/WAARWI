/*
# MC1-E : périmètre et filtres par caisse, caissier et session

1. Nouvelles fonctions
- `_cs_report_scope(site, caisse, caissier, session)` (SECURITY DEFINER, interne) : renvoie les sessions
  autorisées correspondant aux filtres (NULL si aucun filtre). Un caissier ordinaire ne peut cibler que ses
  propres sessions ; un profil élevé, les sessions des magasins qu'il supervise. Une session, une caisse ou un
  caissier hors périmètre est refusé (42501). Filtres disponibles uniquement en mode multi-caisse.
- `get_cash_scope_options(site, caisse, caissier, du, au)` (SECURITY DEFINER) : listes de filtres limitées au
  périmètre autorisé (caisses, caissiers, sessions). Renvoie `{multi:false}` en mode désactivé.

2. Fonctions modifiées (nouveaux paramètres optionnels, défaut NULL)
- `get_financial_summary(..., p_cash_session_ids)` : restreint ventes, retours et charges aux sessions données.
- `get_cash_report(..., p_cash_register_id, p_user_id, p_cash_session_id)` : toutes les sections (fonds,
  entrées/sorties, modes, jours, articles, synthèse) appliquent le même périmètre. Attribution par le lien réel
  `cash_session_id` (caisse et opérateur de la session), jamais par l'auteur du document. En mode multi :
  ventilations `par_caisse` / `par_caissier` avec catégorie distincte pour les opérations sans session.
- `rpc_paginated_cash_sessions(..., p_cash_register_id, p_user_id)` : filtres supplémentaires (lignes, total
  et statistiques sur le même ensemble), isolation toujours assurée par les politiques existantes.

3. Sécurité
- Les anciennes signatures sont remplacées (DROP puis CREATE) ; droits recréés à l'identique :
  EXECUTE pour authenticated et service_role, retiré à PUBLIC et anon.
- Sans filtre, les résultats sont identiques à l'existant (mode désactivé inchangé).
- Aucune donnée, permission ou politique modifiée.
*/
CREATE OR REPLACE FUNCTION public._cs_report_scope(p_site_id uuid, p_cash_register_id uuid, p_user_id uuid, p_cash_session_id uuid)
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
v_uid uuid := auth.uid();
v_tenant uuid := public.current_tenant_id();
v_elev boolean;
v_sites uuid[];
v_ids uuid[];
BEGIN
IF p_cash_register_id IS NULL AND p_user_id IS NULL AND p_cash_session_id IS NULL THEN
RETURN NULL;
END IF;
IF v_uid IS NULL OR v_tenant IS NULL THEN
RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
END IF;
IF NOT public._cs_multi_enabled(v_tenant) THEN
RAISE EXCEPTION 'Les filtres par caisse, caissier ou session nécessitent le mode multi-caisse' USING ERRCODE = '22023';
END IF;
v_elev := public._cs_profile_is_elevated(v_uid);
v_sites := CASE WHEN v_elev THEN public._cr_profile_site_ids(v_uid) ELSE '{}'::uuid[] END;
IF p_user_id IS NOT NULL AND p_user_id <> v_uid AND NOT v_elev THEN
RAISE EXCEPTION 'Accès refusé aux opérations de ce caissier' USING ERRCODE = '42501';
END IF;
IF p_cash_register_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM cash_registers r
WHERE r.id = p_cash_register_id AND r.tenant_id = v_tenant
AND (p_site_id IS NULL OR r.site_id = p_site_id)
AND (r.site_id = ANY (v_sites)
OR EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.cash_register_id = r.id AND cs.user_id = v_uid)
OR EXISTS (SELECT 1 FROM cash_register_assignments a WHERE a.cash_register_id = r.id AND a.user_id = v_uid AND a.is_active))
) THEN
RAISE EXCEPTION 'Accès refusé à cette caisse' USING ERRCODE = '42501';
END IF;
IF p_cash_session_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM cash_sessions cs
WHERE cs.id = p_cash_session_id AND cs.tenant_id = v_tenant
AND (cs.user_id = v_uid OR cs.site_id = ANY (v_sites))
) THEN
RAISE EXCEPTION 'Accès refusé à cette session de caisse' USING ERRCODE = '42501';
END IF;
SELECT COALESCE(array_agg(cs.id), '{}'::uuid[]) INTO v_ids
FROM cash_sessions cs
WHERE cs.tenant_id = v_tenant
AND (cs.user_id = v_uid OR cs.site_id = ANY (v_sites))
AND (p_site_id IS NULL OR cs.site_id = p_site_id)
AND (p_cash_register_id IS NULL OR cs.cash_register_id = p_cash_register_id)
AND (p_user_id IS NULL OR cs.user_id = p_user_id)
AND (p_cash_session_id IS NULL OR cs.id = p_cash_session_id);
RETURN v_ids;
END;
$f$;
REVOKE ALL ON FUNCTION public._cs_report_scope(uuid, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._cs_report_scope(uuid, uuid, uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_cash_scope_options(p_site_id uuid DEFAULT NULL, p_cash_register_id uuid DEFAULT NULL, p_user_id uuid DEFAULT NULL, p_from date DEFAULT NULL, p_to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $f$
DECLARE
v_uid uuid := auth.uid();
v_tenant uuid := public.current_tenant_id();
v_elev boolean;
v_sites uuid[];
v_tz text;
v_ts_from timestamptz;
v_ts_to timestamptz;
v_user uuid;
v_registers jsonb;
v_cashiers jsonb;
v_sessions jsonb;
BEGIN
IF v_uid IS NULL OR v_tenant IS NULL THEN
RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
END IF;
IF NOT public._cs_multi_enabled(v_tenant) THEN
RETURN jsonb_build_object('multi', false);
END IF;
IF p_site_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant) THEN
RAISE EXCEPTION 'Site not authorized' USING ERRCODE = '42501';
END IF;
v_elev := public._cs_profile_is_elevated(v_uid);
v_sites := CASE WHEN v_elev THEN public._cr_profile_site_ids(v_uid) ELSE '{}'::uuid[] END;
v_user := CASE WHEN v_elev THEN p_user_id ELSE v_uid END;

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_from := CASE WHEN p_from IS NULL THEN NULL ELSE (p_from::timestamp AT TIME ZONE v_tz) END;
v_ts_to := CASE WHEN p_to IS NULL THEN NULL ELSE ((p_to + 1)::timestamp AT TIME ZONE v_tz) END;

SELECT COALESCE(jsonb_agg(jsonb_build_object(
'id', r.id, 'name', r.name, 'code', r.code, 'site_id', r.site_id, 'is_active', r.is_active
) ORDER BY r.name, r.id), '[]'::jsonb) INTO v_registers
FROM cash_registers r
WHERE r.tenant_id = v_tenant
AND (p_site_id IS NULL OR r.site_id = p_site_id)
AND (r.site_id = ANY (v_sites)
OR EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.cash_register_id = r.id AND cs.user_id = v_uid)
OR EXISTS (SELECT 1 FROM cash_register_assignments a WHERE a.cash_register_id = r.id AND a.user_id = v_uid AND a.is_active));

IF v_elev THEN
SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'name', COALESCE(NULLIF(p.full_name, ''), p.email, ''))
ORDER BY COALESCE(NULLIF(p.full_name, ''), p.email, ''), p.id), '[]'::jsonb) INTO v_cashiers
FROM profiles p
WHERE p.tenant_id = v_tenant
AND (
EXISTS (SELECT 1 FROM cash_sessions cs
WHERE cs.user_id = p.id AND cs.tenant_id = v_tenant AND cs.site_id = ANY (v_sites)
AND (p_site_id IS NULL OR cs.site_id = p_site_id)
AND (p_cash_register_id IS NULL OR cs.cash_register_id = p_cash_register_id))
OR EXISTS (SELECT 1 FROM cash_register_assignments a JOIN cash_registers r ON r.id = a.cash_register_id
WHERE a.user_id = p.id AND a.is_active AND r.tenant_id = v_tenant AND r.site_id = ANY (v_sites)
AND (p_site_id IS NULL OR r.site_id = p_site_id)
AND (p_cash_register_id IS NULL OR r.id = p_cash_register_id))
);
ELSE
SELECT jsonb_build_array(jsonb_build_object('id', p.id, 'name', COALESCE(NULLIF(p.full_name, ''), p.email, '')))
INTO v_cashiers FROM profiles p WHERE p.id = v_uid;
END IF;

SELECT COALESCE(jsonb_agg(x.j ORDER BY x.opened_at DESC, x.id DESC), '[]'::jsonb) INTO v_sessions
FROM (
SELECT cs.id, cs.opened_at, jsonb_build_object(
'id', cs.id, 'opened_at', cs.opened_at, 'closed_at', cs.closed_at, 'status', cs.status,
'user_id', cs.user_id, 'cashier_name', COALESCE(NULLIF(p.full_name, ''), p.email, ''),
'cash_register_id', cs.cash_register_id, 'site_id', cs.site_id
) AS j
FROM cash_sessions cs
LEFT JOIN profiles p ON p.id = cs.user_id
WHERE cs.tenant_id = v_tenant
AND (cs.user_id = v_uid OR cs.site_id = ANY (v_sites))
AND (p_site_id IS NULL OR cs.site_id = p_site_id)
AND (p_cash_register_id IS NULL OR cs.cash_register_id = p_cash_register_id)
AND (v_user IS NULL OR cs.user_id = v_user)
AND (v_ts_to IS NULL OR cs.opened_at < v_ts_to)
AND (v_ts_from IS NULL OR cs.closed_at IS NULL OR cs.closed_at >= v_ts_from)
ORDER BY cs.opened_at DESC, cs.id DESC
LIMIT 300
) x;

RETURN jsonb_build_object(
'multi', true, 'elevated', v_elev, 'user_id', v_uid,
'registers', v_registers, 'cashiers', v_cashiers, 'sessions', v_sessions
);
END;
$f$;
REVOKE ALL ON FUNCTION public.get_cash_scope_options(uuid, uuid, uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_scope_options(uuid, uuid, uuid, date, date) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.get_financial_summary(uuid, date, date);
DROP FUNCTION IF EXISTS public.get_cash_report(uuid, date, date);
DROP FUNCTION IF EXISTS public.rpc_paginated_cash_sessions(uuid, uuid, integer, integer, text, timestamptz, timestamptz);

CREATE OR REPLACE FUNCTION public.get_financial_summary(p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE, p_cash_session_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id           uuid;
v_tz                  text;
v_ts_from             timestamptz;
v_ts_to               timestamptz;
v_ventes_validees     numeric := 0;
v_retours             numeric := 0;
v_cogs_ventes         numeric := 0;
v_cogs_retours        numeric := 0;
v_charges             numeric := 0;
v_nb_ventes           bigint  := 0;
v_nb_retours          bigint  := 0;
v_nb_ventes_retour    bigint  := 0;
v_nb_annulations      bigint  := 0;
v_montant_annule      numeric := 0;
v_nb_lignes_sans_cout bigint  := 0;
v_ca_net              numeric;
v_cogs_net            numeric;
v_marge_brute         numeric;
v_taux_marque         numeric;
v_taux_marge          numeric;
v_resultat            numeric;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

IF p_site_id IS NOT NULL THEN
IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
RAISE EXCEPTION 'Site not authorized';
END IF;
END IF;

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_from := (p_from::timestamp AT TIME ZONE v_tz);
v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

SELECT COALESCE(SUM(s.total - COALESCE(s.vat_amount, 0)), 0),
COALESCE(SUM(item_cost.cost), 0), COUNT(*)
INTO v_ventes_validees, v_cogs_ventes, v_nb_ventes
FROM sales s
LEFT JOIN LATERAL (
SELECT COALESCE(SUM(si.purchase_cost * si.quantity), 0) AS cost
FROM sale_items si WHERE si.sale_id = s.id
) item_cost ON true
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid', 'partial', 'validated')
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR s.cash_session_id = ANY (p_cash_session_ids));

SELECT COUNT(*) INTO v_nb_lignes_sans_cout
FROM sale_items si
JOIN sales s ON s.id = si.sale_id
JOIN articles a ON a.id = si.article_id
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid', 'partial', 'validated')
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR s.cash_session_id = ANY (p_cash_session_ids))
AND a.track_stock = true AND COALESCE(si.purchase_cost, 0) = 0;

SELECT COALESCE(SUM(sr.total), 0), COALESCE(SUM(ret_cost.cost), 0),
COUNT(*), COUNT(DISTINCT sr.sale_id)
INTO v_retours, v_cogs_retours, v_nb_retours, v_nb_ventes_retour
FROM sale_returns sr
LEFT JOIN LATERAL (
SELECT COALESCE(SUM(sri.purchase_cost * sri.quantity), 0) AS cost
FROM sale_return_items sri WHERE sri.return_id = sr.id
) ret_cost ON true
WHERE sr.tenant_id = v_tenant_id
AND sr.status = 'approved'
AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
AND (p_site_id IS NULL OR sr.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR sr.cash_session_id = ANY (p_cash_session_ids));

SELECT COUNT(*), COALESCE(SUM(s.total), 0)
INTO v_nb_annulations, v_montant_annule
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.status = 'cancelled'
AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR s.cash_session_id = ANY (p_cash_session_ids));

SELECT COALESCE(SUM(cm.amount), 0) INTO v_charges
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.kind = 'expense'
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
AND (p_cash_session_ids IS NULL OR cm.cash_session_id = ANY (p_cash_session_ids));

v_ca_net      := v_ventes_validees - v_retours;
v_cogs_net    := v_cogs_ventes - v_cogs_retours;
v_marge_brute := v_ca_net - v_cogs_net;
-- Taux de marque = marge / CA ; taux de marge = marge / CMV ; NULL si dénominateur nul.
v_taux_marque := CASE WHEN v_ca_net > 0 THEN ROUND((v_marge_brute / v_ca_net) * 100, 2) ELSE NULL END;
v_taux_marge  := CASE WHEN v_cogs_net > 0 THEN ROUND((v_marge_brute / v_cogs_net) * 100, 2) ELSE NULL END;
v_resultat    := v_marge_brute - v_charges;

RETURN jsonb_build_object(
'ventes_validees',       v_ventes_validees,
'retours',               v_retours,
'ca_net',                v_ca_net,
'cogs_ventes',           v_cogs_ventes,
'cogs_retours',          v_cogs_retours,
'cogs_net',              v_cogs_net,
'marge_brute',           v_marge_brute,
'taux_marque',           v_taux_marque,
'taux_marge',            v_taux_marge,
'charges_exploitation',  v_charges,
'resultat_exploitation', v_resultat,
'nb_ventes',             v_nb_ventes,
'nb_retours',            v_nb_retours,
'nb_ventes_avec_retour', v_nb_ventes_retour,
'nb_annulations',        v_nb_annulations,
'montant_annule',        v_montant_annule,
'nb_lignes_sans_cout',   v_nb_lignes_sans_cout
);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_cash_report(p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE, p_cash_register_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid, p_cash_session_id uuid DEFAULT NULL::uuid)
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
v_transf_coffre numeric := 0;
v_vers_coffre numeric := 0;
v_tot_in    numeric := 0;
v_tot_out   numeric := 0;
v_par_mode  jsonb;
v_par_jour  jsonb;
v_articles  jsonb;
v_multi     boolean;
v_sess      uuid[];
v_par_caisse jsonb;
v_par_caissier jsonb;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
IF p_site_id IS NOT NULL AND NOT EXISTS (
SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
) THEN RAISE EXCEPTION 'Site not authorized'; END IF;
v_multi := public._cs_multi_current();
v_sess := public._cs_report_scope(p_site_id, p_cash_register_id, p_user_id, p_cash_session_id);

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_from := (p_from::timestamp AT TIME ZONE v_tz);
v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

v_summary := get_financial_summary(p_site_id, p_from, p_to, v_sess);

SELECT COALESCE(SUM(cs.opening_amount), 0) INTO v_fonds
FROM cash_sessions cs
WHERE cs.tenant_id = v_tenant_id
AND cs.opened_at >= v_ts_from AND cs.opened_at < v_ts_to
AND (p_site_id IS NULL OR cs.site_id = p_site_id)
AND (v_sess IS NULL OR cs.id = ANY (v_sess));

SELECT
COALESCE(SUM(CASE WHEN cm.kind = 'income' AND cm.customer_id IS NOT NULL THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'income' AND cm.customer_id IS NULL THEN cm.amount
WHEN cm.kind = 'customer_prepayment' THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'expense' AND cm.supplier_id IS NOT NULL THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'expense' AND cm.supplier_id IS NULL THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'refund' THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind IN ('customer_loan', 'customer_withdrawal') THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'vault_withdrawal' THEN cm.amount ELSE 0 END), 0),
COALESCE(SUM(CASE WHEN cm.kind = 'vault_deposit' THEN cm.amount ELSE 0 END), 0)
INTO v_reg_cli, v_autres_in, v_reg_four, v_depenses, v_rembours, v_autres_out,
v_transf_coffre, v_vers_coffre
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
AND (v_sess IS NULL OR cm.cash_session_id = ANY (v_sess));

v_tot_in  := v_reg_cli + v_autres_in + v_transf_coffre;
v_tot_out := v_reg_four + v_depenses + v_rembours + v_autres_out + v_vers_coffre;

SELECT COALESCE(jsonb_agg(m ORDER BY (m->>'net')::numeric DESC), '[]'::jsonb) INTO v_par_mode
FROM (
SELECT jsonb_build_object(
'method', COALESCE(NULLIF(cm.method_name, ''), 'Non précisé'),
'entrees', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment','vault_withdrawal') THEN cm.amount ELSE 0 END), 0),
'sorties', COALESCE(SUM(CASE WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN cm.amount ELSE 0 END), 0),
'net', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment','vault_withdrawal') THEN cm.amount
WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN -cm.amount ELSE 0 END), 0)
) AS m
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
AND (v_sess IS NULL OR cm.cash_session_id = ANY (v_sess))
GROUP BY COALESCE(NULLIF(cm.method_name, ''), 'Non précisé')
) sub;

SELECT COALESCE(jsonb_agg(d ORDER BY d->>'date'), '[]'::jsonb) INTO v_par_jour
FROM (
SELECT jsonb_build_object(
'date', to_char((cm.created_at AT TIME ZONE v_tz)::date, 'YYYY-MM-DD'),
'entrees', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment','vault_withdrawal') THEN cm.amount ELSE 0 END), 0),
'sorties', COALESCE(SUM(CASE WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN cm.amount ELSE 0 END), 0),
'solde', COALESCE(SUM(CASE WHEN cm.kind IN ('income','customer_prepayment','vault_withdrawal') THEN cm.amount
WHEN cm.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN -cm.amount ELSE 0 END), 0)
) AS d
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
AND (v_sess IS NULL OR cm.cash_session_id = ANY (v_sess))
GROUP BY (cm.created_at AT TIME ZONE v_tz)::date
) sub;

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
AND (v_sess IS NULL OR s.cash_session_id = ANY (v_sess))
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
AND (v_sess IS NULL OR sr.cash_session_id = ANY (v_sess))
GROUP BY sri.article_id
)
SELECT COALESCE(jsonb_agg(jsonb_build_object(
'name', so.name,
'qty', so.qty - COALESCE(r.qty, 0),
'revenue', so.revenue - COALESCE(r.revenue, 0),
'cost', so.cost - COALESCE(r.cost, 0)
) ORDER BY (so.revenue - COALESCE(r.revenue, 0)) DESC), '[]'::jsonb) INTO v_articles
FROM sold so LEFT JOIN returned r ON r.article_id = so.article_id;

IF v_multi THEN
WITH m AS (
SELECT cm.cash_session_id, cs.cash_register_id, cs.user_id AS operator_id, cm.kind, cm.amount
FROM cash_movements cm
LEFT JOIN cash_sessions cs ON cs.id = cm.cash_session_id
WHERE cm.tenant_id = v_tenant_id
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
AND (v_sess IS NULL OR cm.cash_session_id = ANY (v_sess))
),
b AS (
SELECT CASE WHEN cash_session_id IS NULL THEN 'no_session' WHEN cash_register_id IS NULL THEN 'no_register' ELSE 'register' END AS bucket,
cash_register_id, operator_id, cash_session_id, kind, amount
FROM m
)
SELECT
(SELECT COALESCE(jsonb_agg(r ORDER BY r->>'bucket' DESC, r->>'cash_register_id'), '[]'::jsonb) FROM (
SELECT jsonb_build_object(
'bucket', bucket, 'cash_register_id', cash_register_id,
'nb_sessions', COUNT(DISTINCT cash_session_id),
'entrees', COALESCE(SUM(CASE WHEN kind IN ('income','customer_prepayment','vault_withdrawal') THEN amount ELSE 0 END), 0),
'sorties', COALESCE(SUM(CASE WHEN kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN amount ELSE 0 END), 0),
'net', COALESCE(SUM(CASE WHEN kind IN ('income','customer_prepayment','vault_withdrawal') THEN amount WHEN kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN -amount ELSE 0 END), 0)
) AS r
FROM b GROUP BY bucket, cash_register_id) q1),
(SELECT COALESCE(jsonb_agg(r ORDER BY r->>'bucket' DESC, r->>'name'), '[]'::jsonb) FROM (
SELECT jsonb_build_object(
'bucket', CASE WHEN b.cash_session_id IS NULL THEN 'no_session' ELSE 'operator' END,
'user_id', b.operator_id,
'name', MAX(COALESCE(NULLIF(p.full_name, ''), p.email, '')),
'nb_sessions', COUNT(DISTINCT b.cash_session_id),
'entrees', COALESCE(SUM(CASE WHEN b.kind IN ('income','customer_prepayment','vault_withdrawal') THEN b.amount ELSE 0 END), 0),
'sorties', COALESCE(SUM(CASE WHEN b.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN b.amount ELSE 0 END), 0),
'net', COALESCE(SUM(CASE WHEN b.kind IN ('income','customer_prepayment','vault_withdrawal') THEN b.amount WHEN b.kind IN ('expense','refund','customer_loan','customer_withdrawal','vault_deposit') THEN -b.amount ELSE 0 END), 0)
) AS r
FROM b LEFT JOIN profiles p ON p.id = b.operator_id
GROUP BY (b.cash_session_id IS NULL), b.operator_id) q2)
INTO v_par_caisse, v_par_caissier;
END IF;

RETURN v_summary || jsonb_build_object(
'fonds_ouverture',        v_fonds,
'reglements_clients',     v_reg_cli,
'autres_entrees',         v_autres_in,
'transferts_depuis_coffre', v_transf_coffre,
'versements_au_coffre',   v_vers_coffre,
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
) || CASE WHEN v_multi THEN jsonb_build_object(
'par_caisse', v_par_caisse,
'par_caissier', v_par_caissier,
'scope', jsonb_build_object(
'cash_register_id', p_cash_register_id, 'user_id', p_user_id, 'cash_session_id', p_cash_session_id,
'nb_sessions', CASE WHEN v_sess IS NULL THEN NULL ELSE cardinality(v_sess) END,
'includes_unassigned', v_sess IS NULL)
) ELSE '{}'::jsonb END;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_paginated_cash_sessions(p_tenant_id uuid, p_site_id uuid DEFAULT NULL::uuid, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_search text DEFAULT NULL::text, p_date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_cash_register_id uuid DEFAULT NULL::uuid, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
v_where text;
v_total_count int;
v_stats jsonb;
v_rows jsonb;
v_offset int;
BEGIN
-- Tenant guard
IF p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'tenant mismatch';
END IF;

-- Site access guard
IF p_site_id IS NOT NULL AND NOT current_user_can_access_site(p_site_id) THEN
RAISE EXCEPTION 'site access denied';
END IF;

v_where := 'WHERE cs.tenant_id = ' || quote_literal(p_tenant_id);

IF p_site_id IS NOT NULL THEN
v_where := v_where || ' AND cs.site_id = ' || quote_literal(p_site_id);
END IF;

IF p_cash_register_id IS NOT NULL THEN
v_where := v_where || ' AND cs.cash_register_id = ' || quote_literal(p_cash_register_id);
END IF;

IF p_user_id IS NOT NULL THEN
v_where := v_where || ' AND cs.user_id = ' || quote_literal(p_user_id);
END IF;

IF p_date_from IS NOT NULL THEN
v_where := v_where || ' AND cs.opened_at >= ' || quote_literal(p_date_from);
END IF;

IF p_date_to IS NOT NULL THEN
v_where := v_where || ' AND cs.opened_at < ' || quote_literal(p_date_to);
END IF;

IF p_search IS NOT NULL AND p_search <> '' THEN
v_where := v_where || ' AND ('
|| 'cs.id::text ILIKE ' || quote_literal('%' || p_search || '%')
|| ' OR p.full_name ILIKE ' || quote_literal('%' || p_search || '%')
|| ' OR p.email ILIKE ' || quote_literal('%' || p_search || '%')
|| ' OR s.name ILIKE ' || quote_literal('%' || p_search || '%')
|| ')';
END IF;

-- Total count over filtered set
EXECUTE 'SELECT count(*) FROM cash_sessions cs'
|| ' LEFT JOIN profiles p ON p.id = cs.user_id'
|| ' LEFT JOIN sites s ON s.id = cs.site_id '
|| v_where
INTO v_total_count;

-- Stats over filtered set
EXECUTE 'SELECT jsonb_build_object('
|| '''open_count'', count(*) FILTER (WHERE cs.status = ''open''),'
|| '''closed_count'', count(*) FILTER (WHERE cs.status = ''closed''),'
|| '''variance_count'', count(*) FILTER (WHERE cs.variance IS NOT NULL AND cs.variance <> 0)'
|| ') FROM cash_sessions cs'
|| ' LEFT JOIN profiles p ON p.id = cs.user_id'
|| ' LEFT JOIN sites s ON s.id = cs.site_id '
|| v_where
INTO v_stats;

-- Paginated rows
v_offset := GREATEST((COALESCE(p_page, 1) - 1), 0) * GREATEST(p_page_size, 1);

EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM ('
|| 'SELECT cs.id, cs.tenant_id, cs.site_id, cs.user_id,'
|| ' cs.opened_at, cs.closed_at, cs.opening_amount, cs.closing_amount,'
|| ' cs.counted_cash, cs.theoretical_amount, cs.variance, cs.status,'
|| ' cs.opening_note, cs.closing_note,'
|| ' COALESCE(p.full_name, p.email, '''') AS cashier_name,'
|| ' COALESCE(s.name, '''') AS site_name'
|| ' FROM cash_sessions cs'
|| ' LEFT JOIN profiles p ON p.id = cs.user_id'
|| ' LEFT JOIN sites s ON s.id = cs.site_id '
|| v_where
|| ' ORDER BY cs.opened_at DESC, cs.id DESC'
|| ' LIMIT ' || GREATEST(p_page_size, 1)
|| ' OFFSET ' || v_offset
|| ') t'
INTO v_rows;

RETURN jsonb_build_object(
'rows', v_rows,
'total_count', v_total_count,
'stats', v_stats
);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_financial_summary(uuid, date, date, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_financial_summary(uuid, date, date, uuid[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_cash_report(uuid, date, date, uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cash_report(uuid, date, date, uuid, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.rpc_paginated_cash_sessions(uuid, uuid, integer, integer, text, timestamptz, timestamptz, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_paginated_cash_sessions(uuid, uuid, integer, integer, text, timestamptz, timestamptz, uuid, uuid) TO authenticated, service_role;
