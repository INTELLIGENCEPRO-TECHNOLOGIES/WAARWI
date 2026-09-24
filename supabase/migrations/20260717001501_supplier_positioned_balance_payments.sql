/*
  # Paiements fournisseurs sur solde positionné + choix caisse

  ## Résumé
  Permet aux paiements fournisseurs d'être imputés sur un solde positionné
  (dette sans commande précise), avec un choix explicite: sortir l'argent de
  la caisse ou non. Corrige aussi les soldes fournisseurs bloqués et rend
  visibles les règlements sur solde positionné dans l'historique de caisse.

  ## Changements de schéma
  1. `cash_movements.supplier_id` (uuid, nullable, FK vers suppliers) —
     permet d'attribuer un mouvement de caisse à un fournisseur (règlement
     sur solde positionné sorti de la caisse).
  2. Index sur `cash_movements(tenant_id, supplier_id)`.

  ## Nouveaux RPCs
  - `register_supplier_payment(p_supplier_id, p_payment_method_id,
     p_method_name, p_amount, p_reference, p_cash_session_id, p_order_id,
     p_from_cash boolean)` — Enregistre un règlement fournisseur:
      * Applique en FIFO sur la commande cible puis les autres commandes
        impayées (met à jour `supplier_orders.paid`).
      * Pour le reliquat non imputé (solde positionné): réduit directement
        `suppliers.balance` et insère un `balance_adjustment` négatif.
      * Si `p_from_cash` est vrai: insère un `cash_movements` (kind 'expense',
        motif 'Règlement solde fournisseur', supplier_id renseigné) et met
        à jour le `theoretical_amount` de la session. Si faux: aucun
        mouvement de caisse.
      * Insère toujours une ligne `supplier_payments`.

  ## RPCs modifiés
  - `recompute_supplier_balance` et `trigger_update_supplier_balance` —
    la formule du solde soustrait désormais les `supplier_payments` sans
    `order_id` (paiements de solde positionné), afin que le solde reste
    correct après un paiement positionné. Auparavant ces paiements n'étaient
    pas comptés et le solde restait bloqué.

  ## Backfill
  - Recalcule tous les soldes fournisseurs avec la formule corrigée pour
    débloquer les dettes positionnées existantes.

  ## Sécurité
  - Aucune nouvelle table. RLS existant sur cash_movements couvre la
    nouvelle colonne supplier_id (les politiques existantes restent valides).
  - Les RPCs sont SECURITY DEFINER, utilisent current_tenant_id().
*/

-- 1) Ajouter supplier_id à cash_movements
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='cash_movements' AND column_name='supplier_id'
  ) THEN
    ALTER TABLE cash_movements ADD COLUMN supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cash_movements_supplier ON cash_movements(tenant_id, supplier_id);

-- 2) register_supplier_payment
CREATE OR REPLACE FUNCTION register_supplier_payment(
  p_supplier_id uuid,
  p_payment_method_id uuid,
  p_method_name text,
  p_amount numeric,
  p_reference text DEFAULT '',
  p_cash_session_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL,
  p_from_cash boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_remaining numeric;
  v_order record;
  v_due numeric;
  v_take numeric;
  v_applied numeric := 0;
  v_applied_orders jsonb := '[]'::jsonb;
  v_site_id uuid;
  v_new_paid numeric;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'Fournisseur obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  v_remaining := p_amount;

  -- Si une commande précise est ciblée, la traiter d'abord
  IF p_order_id IS NOT NULL AND p_order_id <> '' AND p_order_id <> '__balance__' THEN
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
        tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference
      ) VALUES (
        v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id,
        COALESCE(p_method_name,''), v_take, COALESCE(p_reference,'')
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
       AND (p_order_id IS NULL OR p_order_id = '' OR p_order_id = '__balance__' OR id <> p_order_id)
     ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(0, COALESCE(v_order.total,0) - COALESCE(v_order.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      v_new_paid := COALESCE(v_order.paid,0) + v_take;
      UPDATE supplier_orders SET paid = v_new_paid WHERE id = v_order.id;
      INSERT INTO supplier_payments (
        tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference
      ) VALUES (
        v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id,
        COALESCE(p_method_name,''), v_take, COALESCE(p_reference,'')
      );
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_orders := v_applied_orders || jsonb_build_object(
        'order_id', v_order.id, 'order_number', v_order.order_number, 'amount', v_take);
    END IF;
  END LOOP;

  -- Reliquat non imputé = solde positionné
  IF v_remaining > 0 THEN
    -- Paiement sans commande (solde positionné)
    INSERT INTO supplier_payments (
      tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference
    ) VALUES (
      v_tenant_id, p_supplier_id, NULL, p_payment_method_id,
      COALESCE(p_method_name,''), v_remaining, COALESCE(p_reference,'')
    );

    -- Réduire le solde fournisseur directement
    UPDATE suppliers
    SET balance = GREATEST(0, COALESCE(balance,0) - v_remaining)
    WHERE id = p_supplier_id AND tenant_id = v_tenant_id;

    -- Ajustement de solde négatif pour le grand livre fournisseur
    INSERT INTO balance_adjustments (
      tenant_id, entity_type, entity_id,
      previous_balance, new_balance, amount,
      note, user_id
    ) VALUES (
      v_tenant_id, 'supplier', p_supplier_id,
      (SELECT COALESCE(balance,0) + v_remaining FROM suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant_id),
      (SELECT COALESCE(balance,0) FROM suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant_id),
      -v_remaining,
      'Règlement solde · ' || COALESCE(p_method_name,''),
      auth.uid()
    );

    -- Mouvement de caisse si l'utilisateur a choisi de sortir l'argent de la caisse
    IF p_from_cash AND p_cash_session_id IS NOT NULL THEN
      SELECT site_id INTO v_site_id FROM cash_sessions WHERE id = p_cash_session_id;
      INSERT INTO cash_movements (
        tenant_id, cash_session_id, site_id, user_id, kind, amount,
        reason, note, reference, supplier_id, payment_method_id, method_name
      ) VALUES (
        v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'expense', v_remaining,
        'Règlement solde fournisseur', '', COALESCE(p_reference,''),
        p_supplier_id, p_payment_method_id, COALESCE(p_method_name,'')
      );
      -- Diminuer le théorique de caisse (sortie d'espèces)
      PERFORM increment_session_theoretical(p_cash_session_id, -v_remaining);
    END IF;
  END IF;

  -- Recalcul final du solde pour cohérence
  PERFORM recompute_supplier_balance(p_supplier_id);

  RETURN jsonb_build_object(
    'applied', v_applied,
    'unapplied', v_remaining,
    'orders', v_applied_orders
  );
END;
$$;

-- 3) recompute_supplier_balance: soustrait les paiements sans commande (solde positionné)
CREATE OR REPLACE FUNCTION recompute_supplier_balance(p_supplier_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_new_balance numeric;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM suppliers WHERE id = p_supplier_id;
  IF v_tenant_id IS NULL THEN RETURN; END IF;

  v_new_balance := COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = p_supplier_id
      AND o.tenant_id = v_tenant_id
      AND o.status NOT IN ('cancelled', 'draft')
  ), 0) + COALESCE((
    SELECT SUM(amount) FROM balance_adjustments
    WHERE entity_id = p_supplier_id AND entity_type = 'supplier' AND tenant_id = v_tenant_id
  ), 0) - COALESCE((
    SELECT SUM(sp.amount) FROM supplier_payments sp
    WHERE sp.supplier_id = p_supplier_id
      AND sp.tenant_id = v_tenant_id
      AND sp.order_id IS NULL
  ), 0);

  UPDATE suppliers
  SET balance = GREATEST(0, v_new_balance)
  WHERE id = p_supplier_id;
END;
$$;

-- 4) trigger_update_supplier_balance: même correction
CREATE OR REPLACE FUNCTION trigger_update_supplier_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_supplier_id uuid;
  v_tenant_id uuid;
  v_new_balance numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_supplier_id := OLD.supplier_id;
    v_tenant_id := OLD.tenant_id;
  ELSE
    v_supplier_id := NEW.supplier_id;
    v_tenant_id := NEW.tenant_id;
  END IF;

  IF v_supplier_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_new_balance := COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = v_supplier_id
      AND o.tenant_id = v_tenant_id
      AND o.status NOT IN ('cancelled', 'draft')
  ), 0) + COALESCE((
    SELECT SUM(amount) FROM balance_adjustments
    WHERE entity_id = v_supplier_id AND entity_type = 'supplier' AND tenant_id = v_tenant_id
  ), 0) - COALESCE((
    SELECT SUM(sp.amount) FROM supplier_payments sp
    WHERE sp.supplier_id = v_supplier_id
      AND sp.tenant_id = v_tenant_id
      AND sp.order_id IS NULL
  ), 0);

  UPDATE suppliers
  SET balance = GREATEST(0, v_new_balance)
  WHERE id = v_supplier_id AND tenant_id = v_tenant_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 5) trigger_update_old_supplier_balance: même correction
CREATE OR REPLACE FUNCTION trigger_update_old_supplier_balance()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_new_balance numeric;
  v_tenant_id uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.supplier_id IS DISTINCT FROM NEW.supplier_id AND OLD.supplier_id IS NOT NULL THEN
    v_tenant_id := OLD.tenant_id;
    v_new_balance := COALESCE((
      SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
      FROM supplier_orders o
      WHERE o.supplier_id = OLD.supplier_id
        AND o.tenant_id = v_tenant_id
        AND o.status NOT IN ('cancelled', 'draft')
    ), 0) + COALESCE((
      SELECT SUM(amount) FROM balance_adjustments
      WHERE entity_id = OLD.supplier_id AND entity_type = 'supplier' AND tenant_id = v_tenant_id
    ), 0) - COALESCE((
      SELECT SUM(sp.amount) FROM supplier_payments sp
      WHERE sp.supplier_id = OLD.supplier_id
        AND sp.tenant_id = v_tenant_id
        AND sp.order_id IS NULL
    ), 0);

    UPDATE suppliers
    SET balance = GREATEST(0, v_new_balance)
    WHERE id = OLD.supplier_id AND tenant_id = v_tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 6) Backfill: recalculer tous les soldes fournisseurs avec la formule corrigée
UPDATE suppliers s
SET balance = GREATEST(0,
  COALESCE((
    SELECT GREATEST(0, SUM(o.total) - SUM(COALESCE(o.paid, 0)))
    FROM supplier_orders o
    WHERE o.supplier_id = s.id AND o.tenant_id = s.tenant_id AND o.status NOT IN ('cancelled','draft')
  ), 0) + COALESCE((
    SELECT SUM(ba.amount) FROM balance_adjustments ba
    WHERE ba.entity_id = s.id AND ba.entity_type = 'supplier' AND ba.tenant_id = s.tenant_id
  ), 0) - COALESCE((
    SELECT SUM(sp.amount) FROM supplier_payments sp
    WHERE sp.supplier_id = s.id AND sp.tenant_id = s.tenant_id AND sp.order_id IS NULL
  ), 0)
);
