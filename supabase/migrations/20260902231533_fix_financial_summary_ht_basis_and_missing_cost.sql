/*
# Correction du moteur de marge : base HT homogène + indicateur de coût manquant

## Résumé (langage clair)
Cette mise à jour corrige le calcul de la marge dans le moteur financier central
(`get_financial_summary`) utilisé par le Rapport Caisse et le Rapport Dépenses.

1. Base de calcul homogène (HT vs HT)
   - Le chiffre d'affaires des ventes est désormais calculé hors taxe : on retire
     le montant de TVA (`sales.vat_amount`) du total encaissé. Le coût des marchandises
     (COGS) est déjà hors taxe (`sale_items.purchase_cost`). On ne compare donc plus
     un CA TTC à un coût HT.
   - Remarque : la TVA n'est aujourd'hui renseignée sur aucune vente (tous les montants
     de TVA valent 0), donc le résultat chiffré reste identique. La correction garantit
     l'exactitude si la TVA est activée plus tard.
   - Les retours ne possèdent pas de ventilation de TVA dans le schéma : ils sont pris
     à leur valeur enregistrée (équivalente au HT tant que la TVA est désactivée).

2. Fuseau horaire explicite (Africa/Dakar)
   - Les bornes de dates sont désormais interprétées dans le fuseau `Africa/Dakar`
     (au lieu du fuseau implicite du serveur). La borne de fin reste exclusive :
     00h00 le lendemain de la date de fin.

3. Indicateur « Marge non fiabilisée »
   - Nouveau champ renvoyé `nb_lignes_sans_cout` : nombre de lignes de vente validées,
     sur la période et le site demandés, portant sur un article suivi en stock
     (`articles.track_stock = true`) dont le coût d'achat est absent ou nul.
   - Les services (articles non suivis en stock) à coût nul ne sont PAS comptés :
     un coût nul y est légitime.
   - Aucune donnée n'est corrigée automatiquement : cet indicateur ne fait que signaler.

## Sécurité
- Fonction inchangée sur le plan des droits : SECURITY INVOKER, STABLE, search_path=public.
- Le périmètre reste borné au tenant courant (`current_tenant_id()`) et au site autorisé.
- Aucune donnée modifiée. Opération non destructive.
*/

CREATE OR REPLACE FUNCTION public.get_financial_summary(
  p_site_id uuid DEFAULT NULL::uuid,
  p_from date DEFAULT CURRENT_DATE,
  p_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id           uuid;
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
  v_taux_marge          numeric;
  v_resultat            numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_site_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
      RAISE EXCEPTION 'Site not authorized';
    END IF;
  END IF;

  -- Bornes de dates dans le fuseau métier (défaut Africa/Dakar), fin exclusive.
  v_ts_from := (p_from::timestamp AT TIME ZONE 'Africa/Dakar');
  v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Dakar');

  -- Ventes validées : CA net HT (total - TVA) + COGS HT + nombre
  SELECT COALESCE(SUM(s.total - COALESCE(s.vat_amount, 0)), 0),
         COALESCE(SUM(item_cost.cost), 0),
         COUNT(*)
    INTO v_ventes_validees, v_cogs_ventes, v_nb_ventes
  FROM sales s
  LEFT JOIN LATERAL (
    SELECT COALESCE(SUM(si.purchase_cost * si.quantity), 0) AS cost
    FROM sale_items si WHERE si.sale_id = s.id
  ) item_cost ON true
  WHERE s.tenant_id = v_tenant_id
    AND s.status IN ('paid', 'partial', 'validated')
    AND s.created_at >= v_ts_from
    AND s.created_at <  v_ts_to
    AND (p_site_id IS NULL OR s.site_id = p_site_id);

  -- Lignes de vente validées sans coût fiable : article suivi en stock, coût absent/nul.
  SELECT COUNT(*)
    INTO v_nb_lignes_sans_cout
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  JOIN articles a ON a.id = si.article_id
  WHERE s.tenant_id = v_tenant_id
    AND s.status IN ('paid', 'partial', 'validated')
    AND s.created_at >= v_ts_from
    AND s.created_at <  v_ts_to
    AND (p_site_id IS NULL OR s.site_id = p_site_id)
    AND a.track_stock = true
    AND COALESCE(si.purchase_cost, 0) = 0;

  -- Retours approuvés : total (équivalent HT tant que la TVA est désactivée) + COGS HT + comptes
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
    AND sr.status = 'approved'
    AND sr.created_at >= v_ts_from
    AND sr.created_at <  v_ts_to
    AND (p_site_id IS NULL OR sr.site_id = p_site_id);

  -- Ventes annulées (indicateurs de contrôle uniquement)
  SELECT COUNT(*), COALESCE(SUM(s.total), 0)
    INTO v_nb_annulations, v_montant_annule
  FROM sales s
  WHERE s.tenant_id = v_tenant_id
    AND s.status = 'cancelled'
    AND s.created_at >= v_ts_from
    AND s.created_at <  v_ts_to
    AND (p_site_id IS NULL OR s.site_id = p_site_id);

  -- Charges d'exploitation : mouvements de caisse kind='expense'
  SELECT COALESCE(SUM(cm.amount), 0)
    INTO v_charges
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id
    AND cm.kind = 'expense'
    AND cm.created_at >= v_ts_from
    AND cm.created_at <  v_ts_to
    AND (p_site_id IS NULL OR cm.site_id = p_site_id);

  -- Indicateurs dérivés (tout en HT)
  v_ca_net      := v_ventes_validees - v_retours;
  v_cogs_net    := v_cogs_ventes - v_cogs_retours;
  v_marge_brute := v_ca_net - v_cogs_net;
  v_taux_marge  := CASE WHEN v_ca_net > 0 THEN ROUND((v_marge_brute / v_ca_net) * 100, 2) ELSE 0 END;
  v_resultat    := v_marge_brute - v_charges;

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
    'nb_lignes_sans_cout',   v_nb_lignes_sans_cout
  );
END;
$function$;