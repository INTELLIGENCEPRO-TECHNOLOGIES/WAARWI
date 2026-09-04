/*
# Coffre — Retrait manuel + traçabilité des flux Coffre/Caisse

Migration additive, forward-only, non destructive. Aucune donnée existante n'est
supprimée, renommée ou modifiée. Toutes les instructions sont idempotentes.

## 1. Modifications de tables
- `vault_movements.kind` : la contrainte CHECK est étendue pour accepter en plus la
  valeur `manual_withdrawal` (retrait manuel du coffre, sortie directe sans caisse).
  Les valeurs existantes restent valides.

## 2. Nouvelle fonction (RPC) — retrait manuel du coffre
- `record_manual_vault_withdrawal(p_site_id, p_amount, p_effective_at, p_reason,
  p_beneficiary, p_reference, p_note, p_idempotency_key)` SECURITY DEFINER.
  Débite UNIQUEMENT le coffre du site (mouvement `out` / `manual_withdrawal`).
  Ne crée AUCUN mouvement de caisse.
  Contrôles :
    1. Tenant courant présent.
    2. Module Coffre activé.
    3. Permission `vault_receive_from_cash` ou `access_vault`.
    4. Site accessible.
    5. Montant strictement positif.
    6. Refus si le montant dépasse le solde du coffre.
    7. Idempotence via `p_idempotency_key`.
  Le coffre est verrouillé (`FOR UPDATE`) le temps de la mise à jour du solde.
  Le motif/destination est stocké dans `reference` s'il n'y a pas de référence,
  sinon concaténé dans la note ; le bénéficiaire et le motif sont préfixés dans la
  note pour rester lisibles dans le rapport du coffre.

## 3. Extension de `get_session_financial_summary`
Ajout de 5 champs pour rendre visibles et explicables les flux physiques liés au
coffre dans les statistiques de session :
  - `transferts_depuis_coffre` : total des entrées physiques venues du coffre
    (`cash_movements.kind = 'vault_withdrawal'`).
  - `versements_au_coffre` : total des sorties physiques vers le coffre
    (`cash_movements.kind = 'vault_deposit'`).
  - `total_entrees_physiques`, `total_sorties_physiques`, `solde_theorique`.
Ces flux ne modifient JAMAIS le chiffre d'affaires, la marge, les encaissements
commerciaux ni les créances : ils sont comptés séparément.

## 4. Extension de `get_cash_report`
Ajout des mêmes flux coffre dans le rapport de caisse (écran / impression / export)
et intégration dans les totaux (`total_entrees`, `total_sorties`, `solde_theorique`),
la ventilation par mode et l'évolution journalière, afin de préserver l'invariant
fonds + entrées − sorties = solde théorique.

## 5. Sécurité
- EXECUTE révoqué pour anon/public, accordé à `authenticated` sur les nouvelles/mises à jour de fonctions.
- Aucune policy d'écriture directe sur `vaults`/`vault_movements`.
*/

-- 1. Extension de la contrainte kind (additive) : ajout de manual_withdrawal
DO $ext_vault_kind_w$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'vault_movements_kind_check'
      AND conrelid = 'public.vault_movements'::regclass
  ) THEN
    ALTER TABLE public.vault_movements DROP CONSTRAINT vault_movements_kind_check;
  END IF;
  ALTER TABLE public.vault_movements ADD CONSTRAINT vault_movements_kind_check
    CHECK (kind = ANY (ARRAY[
      'opening_balance','cash_deposit','cash_withdrawal',
      'supplier_payment','adjustment_in','adjustment_out',
      'manual_deposit','manual_withdrawal'
    ]));
END
$ext_vault_kind_w$;

-- 2. RPC : retrait manuel du coffre (sortie directe, aucun mouvement de caisse)
CREATE OR REPLACE FUNCTION public.record_manual_vault_withdrawal(
  p_site_id uuid,
  p_amount numeric,
  p_effective_at timestamptz DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_beneficiary text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE
  v_tenant uuid;
  v_vault vaults%ROWTYPE;
  v_before numeric(14,2);
  v_after numeric(14,2);
  v_vm_id uuid;
  v_amount numeric(14,2) := COALESCE(p_amount, 0);
  v_when timestamptz := COALESCE(p_effective_at, now());
  v_note text;
BEGIN
  v_tenant := public.current_tenant_id();
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Aucun tenant courant'; END IF;
  IF NOT public.vault_module_enabled() THEN RAISE EXCEPTION 'Le module Coffre n''est pas activé'; END IF;
  IF NOT public.vault_has_permission('vault_receive_from_cash') AND NOT public.vault_has_permission('access_vault') THEN
    RAISE EXCEPTION 'Permission insuffisante';
  END IF;
  IF NOT public.vault_site_accessible(p_site_id) THEN RAISE EXCEPTION 'Site non autorisé'; END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION 'Le montant doit être strictement positif'; END IF;

  -- Idempotence
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' AND EXISTS (
    SELECT 1 FROM vault_movements WHERE tenant_id = v_tenant AND idempotency_key = p_idempotency_key
  ) THEN
    SELECT current_balance INTO v_after FROM vaults WHERE tenant_id = v_tenant AND site_id = p_site_id AND is_active;
    RETURN jsonb_build_object('already_processed', true, 'vault_balance', v_after);
  END IF;

  -- Verrou coffre
  SELECT * INTO v_vault FROM vaults WHERE tenant_id = v_tenant AND site_id = p_site_id AND is_active FOR UPDATE;
  IF v_vault.id IS NULL THEN RAISE EXCEPTION 'Aucun coffre initialisé pour ce site'; END IF;

  v_before := COALESCE(v_vault.current_balance, 0);
  IF v_amount > v_before THEN
    RAISE EXCEPTION 'Solde du coffre insuffisant (solde: %, demandé: %)', v_before, v_amount;
  END IF;
  v_after := v_before - v_amount;

  -- Motif / bénéficiaire lisibles dans la note du rapport coffre
  v_note := NULLIF(p_note, '');
  IF NULLIF(p_beneficiary, '') IS NOT NULL THEN
    v_note := TRIM(BOTH ' ' FROM COALESCE('Bénéficiaire: ' || p_beneficiary, '') ||
      CASE WHEN v_note IS NOT NULL THEN ' — ' || v_note ELSE '' END);
  END IF;
  IF NULLIF(p_reason, '') IS NOT NULL THEN
    v_note := TRIM(BOTH ' ' FROM COALESCE('Motif: ' || p_reason, '') ||
      CASE WHEN v_note IS NOT NULL THEN ' — ' || v_note ELSE '' END);
  END IF;

  INSERT INTO vault_movements (
    tenant_id, vault_id, site_id, direction, kind, amount,
    balance_before, balance_after, effective_at,
    reference, note, created_by, idempotency_key
  ) VALUES (
    v_tenant, v_vault.id, p_site_id, 'out', 'manual_withdrawal', v_amount,
    v_before, v_after, v_when,
    NULLIF(p_reference,''), v_note, auth.uid(), NULLIF(p_idempotency_key,'')
  ) RETURNING id INTO v_vm_id;

  UPDATE vaults SET current_balance = v_after, updated_at = now() WHERE id = v_vault.id;

  RETURN jsonb_build_object('vault_movement_id', v_vm_id, 'vault_balance', v_after);
END
$fn$;

REVOKE ALL ON FUNCTION public.record_manual_vault_withdrawal(uuid,numeric,timestamptz,text,text,text,text,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.record_manual_vault_withdrawal(uuid,numeric,timestamptz,text,text,text,text,text) TO authenticated;

-- 3. Extension de get_session_financial_summary : flux coffre visibles séparément
CREATE OR REPLACE FUNCTION public.get_session_financial_summary(
  p_cash_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_tenant_id uuid;
  v_ventes_validees numeric := 0;
  v_cogs_ventes numeric := 0;
  v_nb_ventes bigint := 0;
  v_retours numeric := 0;
  v_cogs_retours numeric := 0;
  v_nb_retours bigint := 0;
  v_nb_ventes_retour bigint := 0;
  v_nb_annulations bigint := 0;
  v_montant_annule numeric := 0;
  v_charges numeric := 0;
  v_ca_net numeric;
  v_cogs_net numeric;
  v_marge_brute numeric;
  v_taux_marge numeric;
  v_resultat numeric;
  v_credit_total numeric := 0;
  v_credit_outstanding numeric := 0;
  v_credit_count bigint := 0;
  v_encaissements numeric := 0;
  v_acomptes numeric := 0;
  v_remboursements numeric := 0;
  v_depenses numeric := 0;
  v_retraits numeric := 0;
  v_prets numeric := 0;
  v_entrees numeric := 0;
  v_transferts_coffre numeric := 0;
  v_versements_coffre numeric := 0;
  v_opening numeric := 0;
  v_entrees_phys numeric := 0;
  v_sorties_phys numeric := 0;
  v_solde_theo numeric := 0;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cash_sessions
    WHERE id = p_cash_session_id AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Session not found or not authorized';
  END IF;

  SELECT COALESCE(SUM(s.total), 0),
         COALESCE(SUM(item_cost.cost), 0),
         COUNT(*)
  INTO v_ventes_validees, v_cogs_ventes, v_nb_ventes
  FROM sales s
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(si.purchase_cost * si.quantity), 0) AS cost
    FROM sale_items si WHERE si.sale_id = s.id
  ) item_cost ON true
  WHERE s.tenant_id = v_tenant_id
    AND s.cash_session_id = p_cash_session_id
    AND s.status IN ('paid', 'partial', 'validated');

  SELECT COALESCE(SUM(sr.total), 0),
         COALESCE(SUM(ret_cost.cost), 0),
         COUNT(*),
         COUNT(DISTINCT sr.sale_id)
  INTO v_retours, v_cogs_retours, v_nb_retours, v_nb_ventes_retour
  FROM sale_returns sr
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(sri.purchase_cost * sri.quantity), 0) AS cost
    FROM sale_return_items sri WHERE sri.return_id = sr.id
  ) ret_cost ON true
  WHERE sr.tenant_id = v_tenant_id
    AND sr.cash_session_id = p_cash_session_id
    AND sr.status = 'approved';

  SELECT COUNT(*), COALESCE(SUM(s.total), 0)
  INTO v_nb_annulations, v_montant_annule
  FROM sales s
  WHERE s.tenant_id = v_tenant_id
    AND s.cash_session_id = p_cash_session_id
    AND s.status = 'cancelled';

  SELECT COUNT(*),
         COALESCE(SUM(s.total), 0),
         COALESCE(SUM(GREATEST(s.total - s.paid, 0)), 0)
  INTO v_credit_count, v_credit_total, v_credit_outstanding
  FROM sales s
  WHERE s.tenant_id = v_tenant_id
    AND s.cash_session_id = p_cash_session_id
    AND s.status IN ('partial', 'validated');

  SELECT COALESCE(SUM(sp.amount), 0)
  INTO v_encaissements
  FROM sale_payments sp
  WHERE sp.tenant_id = v_tenant_id
    AND sp.cash_session_id = p_cash_session_id;

  SELECT COALESCE(SUM(cm.amount), 0)
  INTO v_acomptes
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.cash_session_id = p_cash_session_id
    AND cm.kind = 'customer_prepayment';

  v_encaissements := v_encaissements + v_acomptes;

  SELECT
    COALESCE(SUM(CASE WHEN cm.kind = 'expense' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'refund' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'withdrawal' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'customer_loan' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'income'
      AND NOT (cm.reason IS NOT NULL AND cm.reason LIKE 'Règlement %' AND cm.reason NOT LIKE 'Règlement solde%')
      THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'vault_withdrawal' THEN cm.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN cm.kind = 'vault_deposit' THEN cm.amount ELSE 0 END), 0)
  INTO v_depenses, v_remboursements, v_retraits, v_prets, v_entrees,
       v_transferts_coffre, v_versements_coffre
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.cash_session_id = p_cash_session_id;

  v_charges := v_depenses;

  SELECT COALESCE(opening_amount, 0) INTO v_opening
  FROM cash_sessions WHERE id = p_cash_session_id AND tenant_id = v_tenant_id;

  v_ca_net      := v_ventes_validees - v_retours;
  v_cogs_net    := v_cogs_ventes - v_cogs_retours;
  v_marge_brute := v_ca_net - v_cogs_net;
  v_taux_marge  := CASE WHEN v_ca_net > 0 THEN ROUND((v_marge_brute / v_ca_net) * 100, 2) ELSE 0 END;
  v_resultat    := v_marge_brute - v_charges;

  -- Flux physiques de caisse (le transfert du coffre entre en caisse ; le versement au coffre en sort)
  v_entrees_phys := v_encaissements + v_entrees + v_transferts_coffre;
  v_sorties_phys := v_depenses + v_remboursements + v_retraits + v_prets + v_versements_coffre;
  v_solde_theo   := v_opening + v_entrees_phys - v_sorties_phys;

  RETURN jsonb_build_object(
    'ventes_validees',       v_ventes_validees,
    'retours',               v_retours,
    'ca_net',                v_ca_net,
    'cogs_ventes',           v_cogs_ventes,
    'cogs_retours',          v_cogs_retours,
    'cogs_net',              v_cogs_net,
    'marge_brute',           v_marge_brute,
    'taux_marge',            v_taux_marge,
    'charges_exploitation',  v_charges,
    'resultat_exploitation', v_resultat,
    'nb_ventes',             v_nb_ventes,
    'nb_retours',            v_nb_retours,
    'nb_ventes_avec_retour', v_nb_ventes_retour,
    'nb_annulations',        v_nb_annulations,
    'montant_annule',        v_montant_annule,
    'credit_sales_total',    v_credit_total,
    'credit_sales_outstanding', v_credit_outstanding,
    'credit_sales_count',    v_credit_count,
    'encaissements',         v_encaissements,
    'acomptes',              v_acomptes,
    'remboursements',        v_remboursements,
    'depenses_session',      v_depenses,
    'retraits',              v_retraits,
    'prets_clients',         v_prets,
    'entrees_directes',      v_entrees,
    'transferts_depuis_coffre', v_transferts_coffre,
    'versements_au_coffre',  v_versements_coffre,
    'total_entrees_physiques', v_entrees_phys,
    'total_sorties_physiques', v_sorties_phys,
    'solde_theorique',       v_solde_theo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_session_financial_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_session_financial_summary(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_session_financial_summary(uuid) TO authenticated;

-- 4. Extension de get_cash_report : intégration des flux coffre
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
v_transf_coffre numeric := 0;
v_vers_coffre numeric := 0;
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

v_summary := get_financial_summary(p_site_id, p_from, p_to);

SELECT COALESCE(SUM(cs.opening_amount), 0) INTO v_fonds
FROM cash_sessions cs
WHERE cs.tenant_id = v_tenant_id
AND cs.opened_at >= v_ts_from AND cs.opened_at < v_ts_to
AND (p_site_id IS NULL OR cs.site_id = p_site_id);

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
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

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
);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_cash_report(uuid, date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_cash_report(uuid, date, date) TO authenticated;
