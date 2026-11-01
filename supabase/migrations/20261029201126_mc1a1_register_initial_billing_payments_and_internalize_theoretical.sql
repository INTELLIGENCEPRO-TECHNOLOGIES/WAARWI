/*
# MC1-A.1 — Suppression du dernier accès direct au théorique de caisse

## Résumé
Les écrans de facturation (Billing et éditeur de facture) inséraient eux-mêmes les
règlements initiaux dans sale_payments puis appelaient directement
increment_session_theoretical, une fonction SECURITY DEFINER permettant de modifier
le théorique de n'importe quelle session. Cette migration :
1. crée une opération serveur atomique et contrôlée pour enregistrer ces règlements
   et augmenter le théorique de la session exactement une fois ;
2. crée une opération de nettoyage strictement bornée pour supprimer une facture
   dont l'enregistrement initial a échoué (avant tout mouvement de stock) ;
3. rend increment_session_theoretical strictement interne.

## 1. Nouvelle fonction register_initial_billing_payments(uuid, uuid, jsonb) -> jsonb
- SECURITY DEFINER, search_path = public, pg_temp, owner postgres.
- Contrôles : auth.uid() obligatoire, tenant courant, vente verrouillée FOR UPDATE,
  même tenant, source = 'billing', non annulée / non supprimée, site accessible.
- Session : obligatoire dès qu'il y a un règlement ; ouverte, même tenant, même site
  que la vente ; utilisable par son propriétaire, ou par admin / super_admin /
  manager / propriétaire du tenant.
- Règlements : tableau JSON (1 à 50 éléments), montant numérique > 0 avec au plus
  2 décimales, mode de paiement actif du même tenant et non « credit » ; method_name
  lu côté serveur ; total <= sales.paid (tolérance 0,005 pour l'arrondi flottant du
  navigateur).
- Insère les sale_payments et augmente cash_sessions.theoretical_amount une seule
  fois (UPDATE filtré sur id, tenant_id, site_id, status = 'open').
- Aucun cash_movement créé ; sales.paid / total / status et soldes clients inchangés.
- Idempotence : seuls les règlements « de caisse » (payment_method_id non NULL et
  affects_balance = true) sont comparés ; les imputations d'acompte / solde créditeur
  générées par le trigger AFTER INSERT de sales en sont exclues. Appel identique ->
  already_processed = true ; appel différent -> erreur de cohérence.

## 2. Nouvelle fonction discard_failed_billing_sale(uuid) -> jsonb
- SECURITY DEFINER. Nécessaire car aucune policy DELETE n'existe sur sales : la
  suppression directe depuis le navigateur ne supprimait rien.
- N'accepte qu'une vente billing du tenant courant, créée par l'appelant depuis
  moins de 15 minutes, sans règlement de caisse, sans mouvement de stock, sans lot
  déduit, sans retour, sans IPM et non comptabilisée.
- Annule les seuls effets automatiques ciblant cette vente (acomptes et soldes
  créditeurs imputés), puis supprime la vente (lignes et règlements en cascade).

## 3. Sécurité
- Les deux nouvelles fonctions : EXECUTE révoqué à PUBLIC et anon, accordé à
  authenticated et service_role.
- increment_session_theoretical : EXECUTE révoqué à PUBLIC, anon et authenticated ;
  conservé pour postgres (propriétaire) et service_role. Signature et corps inchangés.

## 4. Notes
- Aucune donnée existante n'est modifiée par cette migration.
- Aucune autre fonction existante n'est modifiée.
*/

CREATE OR REPLACE FUNCTION public.register_initial_billing_payments(
  p_sale_id uuid,
  p_cash_session_id uuid,
  p_payments jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_role text;
  v_sale record;
  v_sess record;
  v_el jsonb;
  v_amount numeric;
  v_method_id uuid;
  v_method record;
  v_ref text;
  v_total numeric := 0;
  v_count int := 0;
  v_req jsonb := '[]'::jsonb;
  v_existing jsonb;
  v_existing_count int;
  v_existing_total numeric;
  v_rows int;
  v_item jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  v_tenant := current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Aucun tenant courant';
  END IF;

  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'Facture introuvable';
  END IF;

  SELECT id, tenant_id, site_id, source, paid, status, deleted_at
    INTO v_sale
    FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'Facture introuvable';
  END IF;
  IF v_sale.source IS DISTINCT FROM 'billing' THEN
    RAISE EXCEPTION 'Cette opération est réservée aux factures';
  END IF;
  IF v_sale.deleted_at IS NOT NULL OR v_sale.status = 'cancelled' THEN
    RAISE EXCEPTION 'Facture annulée ou supprimée';
  END IF;
  IF NOT current_user_can_access_site(v_sale.site_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce site';
  END IF;

  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' THEN
    RAISE EXCEPTION 'Format des règlements invalide';
  END IF;
  IF jsonb_array_length(p_payments) > 50 THEN
    RAISE EXCEPTION 'Trop de règlements';
  END IF;

  IF jsonb_array_length(p_payments) = 0 THEN
    RETURN jsonb_build_object('success', true, 'already_processed', false,
      'payment_count', 0, 'payment_total', 0, 'cash_session_id', NULL);
  END IF;

  IF p_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'Aucune session de caisse ouverte : impossible d''encaisser';
  END IF;

  SELECT id, tenant_id, site_id, user_id, status
    INTO v_sess
    FROM cash_sessions WHERE id = p_cash_session_id FOR UPDATE;
  IF NOT FOUND OR v_sess.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'Session de caisse introuvable';
  END IF;
  IF v_sess.status IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'La session de caisse n''est pas ouverte';
  END IF;
  IF v_sess.site_id <> v_sale.site_id THEN
    RAISE EXCEPTION 'La session de caisse n''appartient pas au site de la facture';
  END IF;
  IF NOT current_user_can_access_site(v_sess.site_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce site';
  END IF;
  IF v_sess.user_id <> v_uid THEN
    SELECT role INTO v_role FROM profiles WHERE id = v_uid;
    IF NOT (COALESCE(v_role, '') IN ('admin', 'super_admin', 'manager') OR is_tenant_owner()) THEN
      RAISE EXCEPTION 'Vous ne pouvez pas encaisser sur la session d''un autre utilisateur';
    END IF;
  END IF;

  FOR v_el IN SELECT value FROM jsonb_array_elements(p_payments)
  LOOP
    IF jsonb_typeof(v_el) <> 'object' THEN
      RAISE EXCEPTION 'Format des règlements invalide';
    END IF;
    IF jsonb_typeof(v_el->'amount') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'Montant de règlement invalide';
    END IF;
    v_amount := (v_el->>'amount')::numeric;
    IF v_amount <= 0 OR v_amount <> round(v_amount, 2) THEN
      RAISE EXCEPTION 'Montant de règlement invalide (strictement positif, 2 décimales maximum)';
    END IF;

    IF jsonb_typeof(v_el->'payment_method_id') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'Mode de paiement manquant';
    END IF;
    BEGIN
      v_method_id := (v_el->>'payment_method_id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Mode de paiement invalide';
    END;

    SELECT id, name, code, payment_type, is_active INTO v_method
      FROM payment_methods WHERE id = v_method_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mode de paiement introuvable';
    END IF;
    IF v_method.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Mode de paiement inactif';
    END IF;
    IF v_method.payment_type = 'credit' OR upper(COALESCE(v_method.code, '')) = 'CREDIT' THEN
      RAISE EXCEPTION 'Le mode « crédit » n''est pas un encaissement';
    END IF;

    IF v_el ? 'reference' AND jsonb_typeof(v_el->'reference') NOT IN ('string', 'null') THEN
      RAISE EXCEPTION 'Référence de règlement invalide';
    END IF;
    v_ref := COALESCE(v_el->>'reference', '');
    IF length(v_ref) > 500 THEN
      RAISE EXCEPTION 'Référence de règlement trop longue';
    END IF;

    v_total := v_total + v_amount;
    v_count := v_count + 1;
    v_req := v_req || jsonb_build_array(jsonb_build_object(
      'm', v_method_id, 'n', v_method.name, 'a', v_amount, 'r', v_ref));
  END LOOP;

  IF v_total > COALESCE(v_sale.paid, 0) + 0.005 THEN
    RAISE EXCEPTION 'Le total des règlements dépasse le montant payé de la facture';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('m', payment_method_id, 'a', amount,
           'r', COALESCE(reference, ''), 's', cash_session_id)
           ORDER BY payment_method_id, amount, COALESCE(reference, ''), cash_session_id), '[]'::jsonb),
         count(*), COALESCE(sum(amount), 0)
    INTO v_existing, v_existing_count, v_existing_total
    FROM sale_payments
   WHERE sale_id = p_sale_id
     AND payment_method_id IS NOT NULL
     AND affects_balance = true;

  IF v_existing_count > 0 THEN
    IF v_existing = (
      SELECT jsonb_agg(jsonb_build_object('m', (e->>'m')::uuid, 'a', (e->>'a')::numeric,
               'r', e->>'r', 's', p_cash_session_id)
               ORDER BY (e->>'m')::uuid, (e->>'a')::numeric, e->>'r')
        FROM jsonb_array_elements(v_req) e
    ) THEN
      RETURN jsonb_build_object('success', true, 'already_processed', true,
        'payment_count', v_existing_count, 'payment_total', v_existing_total,
        'cash_session_id', p_cash_session_id);
    END IF;
    RAISE EXCEPTION 'Incohérence : des règlements différents existent déjà pour cette facture';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_req)
  LOOP
    INSERT INTO sale_payments (tenant_id, sale_id, cash_session_id, payment_method_id,
                               method_name, amount, reference, affects_balance)
    VALUES (v_tenant, p_sale_id, p_cash_session_id, (v_item->>'m')::uuid,
            v_item->>'n', (v_item->>'a')::numeric, v_item->>'r', true);
  END LOOP;

  UPDATE cash_sessions
     SET theoretical_amount = COALESCE(theoretical_amount, 0) + v_total
   WHERE id = p_cash_session_id
     AND tenant_id = v_tenant
     AND site_id = v_sale.site_id
     AND status = 'open';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Mise à jour de la session de caisse impossible';
  END IF;

  RETURN jsonb_build_object('success', true, 'already_processed', false,
    'payment_count', v_count, 'payment_total', v_total,
    'cash_session_id', p_cash_session_id);
END;
$$;

ALTER FUNCTION public.register_initial_billing_payments(uuid, uuid, jsonb) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.register_initial_billing_payments(uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_initial_billing_payments(uuid, uuid, jsonb) TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.discard_failed_billing_sale(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid;
  v_sale record;
  v_alloc record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  v_tenant := current_tenant_id();
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Aucun tenant courant';
  END IF;

  SELECT id, tenant_id, site_id, source, user_id, created_at, sale_number,
         accounting_status, accounting_entry_id, deleted_at
    INTO v_sale
    FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.tenant_id <> v_tenant THEN
    RAISE EXCEPTION 'Facture introuvable';
  END IF;
  IF v_sale.source IS DISTINCT FROM 'billing'
     OR v_sale.user_id IS DISTINCT FROM v_uid
     OR v_sale.created_at < now() - interval '15 minutes'
     OR v_sale.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cette facture ne peut pas être annulée automatiquement';
  END IF;
  IF NOT current_user_can_access_site(v_sale.site_id) THEN
    RAISE EXCEPTION 'Accès refusé à ce site';
  END IF;
  IF v_sale.accounting_entry_id IS NOT NULL
     OR COALESCE(v_sale.accounting_status, 'not_accounted') <> 'not_accounted' THEN
    RAISE EXCEPTION 'Facture déjà comptabilisée';
  END IF;
  IF EXISTS (SELECT 1 FROM sale_payments
              WHERE sale_id = p_sale_id
                AND (payment_method_id IS NOT NULL OR affects_balance = true)) THEN
    RAISE EXCEPTION 'Facture déjà encaissée';
  END IF;
  IF EXISTS (SELECT 1 FROM stock_movements
              WHERE tenant_id = v_tenant
                AND (reference_id = p_sale_id
                     OR (movement_type = 'sale' AND note LIKE 'Facture ' || v_sale.sale_number || '%'))) THEN
    RAISE EXCEPTION 'Mouvements de stock déjà générés';
  END IF;
  IF EXISTS (SELECT 1 FROM sale_lot_deductions WHERE sale_id = p_sale_id)
     OR EXISTS (SELECT 1 FROM sale_returns WHERE sale_id = p_sale_id)
     OR EXISTS (SELECT 1 FROM ipm_ventes WHERE sale_id = p_sale_id) THEN
    RAISE EXCEPTION 'Facture liée à d''autres opérations';
  END IF;

  FOR v_alloc IN
    SELECT id, source_type, source_id, amount FROM credit_allocations
     WHERE tenant_id = v_tenant AND target_type = 'invoice' AND target_id = p_sale_id
     FOR UPDATE
  LOOP
    IF v_alloc.source_type = 'prepay' THEN
      UPDATE customer_prepayments
         SET amount_used = GREATEST(0, amount_used - v_alloc.amount)
       WHERE id = v_alloc.source_id AND tenant_id = v_tenant;
    ELSIF v_alloc.source_type = 'negative_adjustment' THEN
      UPDATE balance_adjustments
         SET amount_used = GREATEST(0, COALESCE(amount_used, 0) - v_alloc.amount)
       WHERE id = v_alloc.source_id AND tenant_id = v_tenant;
    ELSE
      RAISE EXCEPTION 'Facture liée à d''autres opérations';
    END IF;
    DELETE FROM credit_allocations WHERE id = v_alloc.id;
  END LOOP;

  DELETE FROM sales WHERE id = p_sale_id;

  RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id);
END;
$$;

ALTER FUNCTION public.discard_failed_billing_sale(uuid) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.discard_failed_billing_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.discard_failed_billing_sale(uuid) TO authenticated, service_role;


REVOKE EXECUTE ON FUNCTION public.increment_session_theoretical(uuid, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_session_theoretical(uuid, numeric) TO service_role;
