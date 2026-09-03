/*
  # Coffre — RPC règlement fournisseur depuis le coffre + clôture de caisse avec versement

  ## Contexte
  Deux nouvelles fonctions serveur, atomiques et sécurisées, qui étendent le module
  Coffre sans modifier aucun flux existant. Elles ne sont exécutables que lorsque le
  module Coffre est activé pour le tenant et que l'utilisateur dispose des permissions.

  ## 1. register_supplier_payment_from_vault(...)
  Réplique EXACTEMENT l'imputation de register_supplier_payment (commande ciblée puis
  FIFO sur les autres commandes finalisées, puis reliquat sur le solde fournisseur avec
  balance_adjustments), MAIS :
    - ne touche AUCUNE session de caisse et ne crée AUCUN cash_movements ;
    - débite le coffre du site via UN seul mouvement de coffre (sortie, kind
      'supplier_payment'), sous verrou FOR UPDATE, refus si solde insuffisant ;
    - marque chaque supplier_payments avec funding_source='vault' + vault_id +
      vault_movement_id + site_id ;
    - recalcule le solde fournisseur via recompute_supplier_balance.
  Idempotent via idempotency_key.

  ## 2. close_cash_session_v2(...)
  Clôture serveur d'une session de caisse. Réplique la clôture actuelle (écriture des
  lignes de contrôle + passage de la session à 'closed' avec les mêmes montants), et
  ajoute une étape « Coffre » optionnelle : versement d'un montant d'espèces comptées
  vers le coffre du site. Le versement crée UN mouvement de coffre (entrée 'cash_deposit')
  et UN mouvement de caisse (sortie 'vault_deposit') ; le versement ne peut jamais
  dépasser les espèces physiquement comptées. Par défaut aucun versement.
  Idempotent via idempotency_key pour le versement.

  ## Sécurité
  - SECURITY DEFINER, SET search_path=public, EXECUTE révoqué à anon/public, accordé à
    authenticated uniquement.
  - Vérifie current_tenant_id(), l'activation du module, les permissions (avec bypass
    pour les rôles admin/super_admin), et l'accès au site.
  - Aucune donnée historique n'est modifiée ; le coffre ne peut jamais devenir négatif.
*/

-- =====================================================================
-- 1) Règlement fournisseur depuis le coffre
-- =====================================================================
CREATE OR REPLACE FUNCTION public.register_supplier_payment_from_vault(
  p_supplier_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT ''::text,
  p_site_id uuid DEFAULT NULL::uuid,
  p_order_id uuid DEFAULT NULL::uuid,
  p_idempotency_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_vault RECORD;
  v_bal_before numeric;
  v_bal_after numeric;
  v_movement_id uuid;
  v_remaining numeric;
  v_order RECORD;
  v_due numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_applied_orders jsonb := '[]'::jsonb;
  v_new_paid numeric;
  v_is_admin boolean;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  IF NOT vault_module_enabled() THEN
    RAISE EXCEPTION 'Le module Coffre n''est pas activé';
  END IF;

  v_is_admin := EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'));
  IF NOT (v_is_admin OR vault_has_permission('vault_pay_supplier')) THEN
    RAISE EXCEPTION 'Permission refusée : règlement fournisseur depuis le coffre';
  END IF;

  IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'Fournisseur obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;
  IF p_site_id IS NULL THEN RAISE EXCEPTION 'Site obligatoire'; END IF;
  IF NOT vault_site_accessible(p_site_id) THEN RAISE EXCEPTION 'Site non autorisé'; END IF;

  -- Idempotence : si la clé existe déjà, renvoyer sans rejouer
  IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
    SELECT id INTO v_movement_id
    FROM vault_movements
    WHERE tenant_id = v_tenant_id AND idempotency_key = p_idempotency_key;
    IF v_movement_id IS NOT NULL THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'vault_movement_id', v_movement_id);
    END IF;
  END IF;

  -- Verrou du coffre actif du site
  SELECT * INTO v_vault
  FROM vaults
  WHERE tenant_id = v_tenant_id AND site_id = p_site_id AND is_active
  FOR UPDATE;
  IF v_vault.id IS NULL THEN
    RAISE EXCEPTION 'Aucun coffre actif pour ce site';
  END IF;
  IF COALESCE(v_vault.current_balance,0) < p_amount THEN
    RAISE EXCEPTION 'Solde du coffre insuffisant';
  END IF;

  v_bal_before := COALESCE(v_vault.current_balance,0);
  v_bal_after  := v_bal_before - p_amount;

  -- Un seul mouvement de coffre (sortie) pour tout le règlement
  INSERT INTO vault_movements (
    tenant_id, vault_id, site_id, direction, kind, amount,
    balance_before, balance_after, supplier_id, payment_method_id,
    reference, note, created_by, idempotency_key
  ) VALUES (
    v_tenant_id, v_vault.id, p_site_id, 'out', 'supplier_payment', p_amount,
    v_bal_before, v_bal_after, p_supplier_id, p_payment_method_id,
    COALESCE(p_reference,''), 'Règlement fournisseur depuis le coffre', auth.uid(),
    NULLIF(p_idempotency_key,'')
  ) RETURNING id INTO v_movement_id;

  UPDATE vaults SET current_balance = v_bal_after, updated_at = now() WHERE id = v_vault.id;

  v_remaining := p_amount;

  -- Commande ciblée d'abord
  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM supplier_orders
    WHERE id = p_order_id AND tenant_id = v_tenant_id
      AND supplier_id = p_supplier_id AND status NOT IN ('cancelled','draft');
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
    v_due := GREATEST(0, COALESCE(v_order.total,0) - COALESCE(v_order.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      v_new_paid := COALESCE(v_order.paid,0) + v_take;
      UPDATE supplier_orders SET paid = v_new_paid WHERE id = v_order.id;
      INSERT INTO supplier_payments (
        tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference,
        funding_source, vault_id, vault_movement_id, site_id
      ) VALUES (
        v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id,
        COALESCE(p_method_name,''), v_take, COALESCE(p_reference,''),
        'vault', v_vault.id, v_movement_id, p_site_id
      );
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_orders := v_applied_orders || jsonb_build_object(
        'order_id', v_order.id, 'order_number', v_order.order_number, 'amount', v_take);
    END IF;
  END IF;

  -- Imputation FIFO sur les autres commandes impayées
  FOR v_order IN
    SELECT * FROM supplier_orders
    WHERE tenant_id = v_tenant_id
      AND supplier_id = p_supplier_id
      AND status NOT IN ('cancelled','draft')
      AND COALESCE(paid,0) < COALESCE(total,0)
      AND (p_order_id IS NULL OR id <> p_order_id)
    ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(0, COALESCE(v_order.total,0) - COALESCE(v_order.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      v_new_paid := COALESCE(v_order.paid,0) + v_take;
      UPDATE supplier_orders SET paid = v_new_paid WHERE id = v_order.id;
      INSERT INTO supplier_payments (
        tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference,
        funding_source, vault_id, vault_movement_id, site_id
      ) VALUES (
        v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id,
        COALESCE(p_method_name,''), v_take, COALESCE(p_reference,''),
        'vault', v_vault.id, v_movement_id, p_site_id
      );
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_orders := v_applied_orders || jsonb_build_object(
        'order_id', v_order.id, 'order_number', v_order.order_number, 'amount', v_take);
    END IF;
  END LOOP;

  -- Reliquat non imputé : solde positionné
  IF v_remaining > 0 THEN
    INSERT INTO supplier_payments (
      tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference,
      funding_source, vault_id, vault_movement_id, site_id
    ) VALUES (
      v_tenant_id, p_supplier_id, NULL, p_payment_method_id,
      COALESCE(p_method_name,''), v_remaining, COALESCE(p_reference,''),
      'vault', v_vault.id, v_movement_id, p_site_id
    );

    UPDATE suppliers
    SET balance = GREATEST(0, COALESCE(balance,0) - v_remaining)
    WHERE id = p_supplier_id AND tenant_id = v_tenant_id;

    INSERT INTO balance_adjustments (
      tenant_id, entity_type, entity_id,
      previous_balance, new_balance, amount, note, user_id
    ) VALUES (
      v_tenant_id, 'supplier', p_supplier_id,
      (SELECT COALESCE(balance,0) + v_remaining FROM suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant_id),
      (SELECT COALESCE(balance,0) FROM suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant_id),
      -v_remaining,
      'Règlement solde (coffre) · ' || COALESCE(p_method_name,''),
      auth.uid()
    );
  END IF;

  PERFORM recompute_supplier_balance(p_supplier_id);

  RETURN jsonb_build_object(
    'success', true,
    'applied', v_applied,
    'unapplied', v_remaining,
    'orders', v_applied_orders,
    'vault_movement_id', v_movement_id,
    'vault_balance', v_bal_after
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.register_supplier_payment_from_vault(uuid,uuid,text,numeric,text,uuid,uuid,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.register_supplier_payment_from_vault(uuid,uuid,text,numeric,text,uuid,uuid,text) TO authenticated;

-- =====================================================================
-- 2) Clôture de caisse (v2) avec versement optionnel au coffre
-- =====================================================================
CREATE OR REPLACE FUNCTION public.close_cash_session_v2(
  p_session_id uuid,
  p_control_lines jsonb,
  p_closing_note text DEFAULT ''::text,
  p_vault_deposit_amount numeric DEFAULT 0,
  p_idempotency_key text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_session RECORD;
  v_is_admin boolean;
  v_counted_total numeric := 0;
  v_theoretical_total numeric := 0;
  v_variance numeric := 0;
  v_cash_counted numeric := 0;
  v_deposit numeric := COALESCE(p_vault_deposit_amount, 0);
  v_vault RECORD;
  v_bal_before numeric;
  v_bal_after numeric;
  v_vault_movement_id uuid;
  v_cash_method_id uuid;
  v_cash_method_name text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;

  v_is_admin := EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'));
  IF NOT (v_is_admin OR vault_has_permission('pos_close_session')) THEN
    RAISE EXCEPTION 'Permission refusée : clôture de session';
  END IF;

  IF p_control_lines IS NULL OR jsonb_typeof(p_control_lines) <> 'array' THEN
    RAISE EXCEPTION 'Lignes de contrôle invalides';
  END IF;
  IF v_deposit < 0 THEN RAISE EXCEPTION 'Montant de versement invalide'; END IF;

  SELECT * INTO v_session
  FROM cash_sessions
  WHERE id = p_session_id AND tenant_id = v_tenant_id AND status = 'open'
  FOR UPDATE;
  IF v_session.id IS NULL THEN
    RAISE EXCEPTION 'Session de caisse introuvable ou déjà clôturée';
  END IF;

  -- Totaux à partir des lignes de contrôle
  SELECT
    COALESCE(SUM(COALESCE((x->>'counted_amount')::numeric,0)),0),
    COALESCE(SUM(COALESCE((x->>'theoretical_amount')::numeric,0)),0)
  INTO v_counted_total, v_theoretical_total
  FROM jsonb_array_elements(p_control_lines) x;
  v_variance := v_counted_total - v_theoretical_total;

  -- Écriture des lignes de contrôle (comme la clôture actuelle)
  INSERT INTO cash_control_lines (
    tenant_id, cash_session_id, payment_method_id, method_name, theoretical_amount, counted_amount
  )
  SELECT
    v_tenant_id, p_session_id,
    NULLIF(x->>'payment_method_id','')::uuid,
    COALESCE(x->>'method_name',''),
    COALESCE((x->>'theoretical_amount')::numeric,0),
    COALESCE((x->>'counted_amount')::numeric,0)
  FROM jsonb_array_elements(p_control_lines) x;

  -- Espèces physiquement comptées (méthodes de type cash, sinon nom espèces/liquide/cash)
  SELECT COALESCE(SUM(COALESCE((x->>'counted_amount')::numeric,0)),0)
  INTO v_cash_counted
  FROM jsonb_array_elements(p_control_lines) x
  JOIN payment_methods pm
    ON pm.id = NULLIF(x->>'payment_method_id','')::uuid
   AND pm.tenant_id = v_tenant_id
  WHERE pm.payment_type = 'cash'
     OR lower(pm.name) ~ '(esp|liquide|cash)';

  -- Versement optionnel au coffre
  IF v_deposit > 0 THEN
    IF NOT vault_module_enabled() THEN
      RAISE EXCEPTION 'Le module Coffre n''est pas activé';
    END IF;
    IF NOT (v_is_admin OR vault_has_permission('vault_receive_from_cash')) THEN
      RAISE EXCEPTION 'Permission refusée : versement au coffre';
    END IF;
    IF v_deposit > v_cash_counted THEN
      RAISE EXCEPTION 'Le versement ne peut pas dépasser les espèces comptées';
    END IF;

    SELECT * INTO v_vault
    FROM vaults
    WHERE tenant_id = v_tenant_id AND site_id = v_session.site_id AND is_active
    FOR UPDATE;
    IF v_vault.id IS NULL THEN
      RAISE EXCEPTION 'Aucun coffre actif pour ce site';
    END IF;

    -- Idempotence du versement
    IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
      SELECT id INTO v_vault_movement_id
      FROM vault_movements
      WHERE tenant_id = v_tenant_id AND idempotency_key = p_idempotency_key;
    END IF;

    IF v_vault_movement_id IS NULL THEN
      v_bal_before := COALESCE(v_vault.current_balance,0);
      v_bal_after  := v_bal_before + v_deposit;

      SELECT id, name INTO v_cash_method_id, v_cash_method_name
      FROM payment_methods
      WHERE tenant_id = v_tenant_id AND is_active
        AND (payment_type = 'cash' OR lower(name) ~ '(esp|liquide|cash)')
      ORDER BY sort_order NULLS LAST, created_at
      LIMIT 1;

      INSERT INTO vault_movements (
        tenant_id, vault_id, site_id, direction, kind, amount,
        balance_before, balance_after, cash_session_id, payment_method_id,
        reference, note, created_by, idempotency_key
      ) VALUES (
        v_tenant_id, v_vault.id, v_session.site_id, 'in', 'cash_deposit', v_deposit,
        v_bal_before, v_bal_after, p_session_id, v_cash_method_id,
        '', 'Versement à la clôture de caisse', auth.uid(), NULLIF(p_idempotency_key,'')
      ) RETURNING id INTO v_vault_movement_id;

      UPDATE vaults SET current_balance = v_bal_after, updated_at = now() WHERE id = v_vault.id;

      INSERT INTO cash_movements (
        tenant_id, cash_session_id, site_id, user_id, kind, amount,
        reason, note, payment_method_id, method_name, vault_movement_id
      ) VALUES (
        v_tenant_id, p_session_id, v_session.site_id, auth.uid(), 'vault_deposit', v_deposit,
        'Versement au coffre', '', v_cash_method_id, COALESCE(v_cash_method_name,'Espèces'),
        v_vault_movement_id
      );
    END IF;
  END IF;

  -- Clôture de la session (mêmes montants que la clôture actuelle)
  UPDATE cash_sessions SET
    status = 'closed',
    closed_at = now(),
    closing_amount = v_counted_total,
    counted_cash = v_counted_total,
    theoretical_amount = v_theoretical_total,
    variance = v_variance,
    closing_note = COALESCE(p_closing_note,''),
    physical_cash_counted = v_cash_counted,
    vault_deposit_amount = v_deposit,
    retained_cash_amount = GREATEST(0, v_cash_counted - v_deposit),
    updated_at = now()
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'counted_total', v_counted_total,
    'theoretical_total', v_theoretical_total,
    'variance', v_variance,
    'cash_counted', v_cash_counted,
    'vault_deposit', v_deposit,
    'retained_cash', GREATEST(0, v_cash_counted - v_deposit),
    'vault_movement_id', v_vault_movement_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.close_cash_session_v2(uuid,jsonb,text,numeric,text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.close_cash_session_v2(uuid,jsonb,text,numeric,text) TO authenticated;
