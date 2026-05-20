/*
  # Mouvements de caisse et avoirs client (prépaiements)

  1. Nouvelles tables
    - `cash_movements` : dépenses, entrées libres et acomptes clients liés à une session de caisse.
      Colonnes : tenant_id, cash_session_id, site_id, user_id, kind ('expense'|'income'|'customer_prepayment'),
      amount (positif), reason, note, reference, customer_id, payment_method_id, method_name, created_at.
    - `customer_prepayments` : état des acomptes clients disponibles.
      Colonnes : tenant_id, customer_id, cash_movement_id, amount, amount_used,
      payment_method_id, method_name, reference, cash_session_id, created_at.

  2. Nouveaux RPCs
    - `record_cash_movement` : enregistre un mouvement. Pour un acompte client,
      crée aussi la ligne `customer_prepayments` puis tente une auto-imputation
      sur les factures impayées (FIFO).
    - `apply_customer_prepayments(customer_id)` : imput les acomptes dispo sur
      les factures impayées dans l'ordre d'ancienneté.

  3. Automatismes
    - Trigger AFTER INSERT OR UPDATE ON sales qui déclenche l'imputation
      automatique des acomptes dès qu'une facture impayée existe pour le client.

  4. Sécurité
    - RLS activée, lecture/écriture limitées au tenant courant.
*/

CREATE TABLE IF NOT EXISTS cash_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL,
  site_id uuid REFERENCES sites(id) ON DELETE SET NULL,
  user_id uuid,
  kind text NOT NULL CHECK (kind IN ('expense','income','customer_prepayment')),
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  reason text DEFAULT '',
  note text DEFAULT '',
  reference text DEFAULT '',
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  method_name text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_movements_tenant_session ON cash_movements(tenant_id, cash_session_id);
CREATE INDEX IF NOT EXISTS idx_cash_movements_customer ON cash_movements(tenant_id, customer_id);

ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cash_movements tenant select" ON cash_movements;
CREATE POLICY "cash_movements tenant select" ON cash_movements
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "cash_movements tenant insert" ON cash_movements;
CREATE POLICY "cash_movements tenant insert" ON cash_movements
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "cash_movements tenant update" ON cash_movements;
CREATE POLICY "cash_movements tenant update" ON cash_movements
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "cash_movements tenant delete" ON cash_movements;
CREATE POLICY "cash_movements tenant delete" ON cash_movements
  FOR DELETE TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE TABLE IF NOT EXISTS customer_prepayments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  cash_movement_id uuid REFERENCES cash_movements(id) ON DELETE SET NULL,
  cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  amount_used numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_used >= 0),
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  method_name text DEFAULT '',
  reference text DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_prepayments_customer ON customer_prepayments(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_prepayments_available
  ON customer_prepayments(tenant_id, customer_id) WHERE amount_used < amount;

ALTER TABLE customer_prepayments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "customer_prepayments tenant select" ON customer_prepayments;
CREATE POLICY "customer_prepayments tenant select" ON customer_prepayments
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "customer_prepayments tenant insert" ON customer_prepayments;
CREATE POLICY "customer_prepayments tenant insert" ON customer_prepayments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "customer_prepayments tenant update" ON customer_prepayments;
CREATE POLICY "customer_prepayments tenant update" ON customer_prepayments
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- Imputation automatique des acomptes disponibles sur les factures impayées
CREATE OR REPLACE FUNCTION apply_customer_prepayments(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_prepay record;
  v_sale record;
  v_available numeric;
  v_due numeric;
  v_take numeric;
  v_new_paid numeric;
  v_new_status text;
  v_applied numeric := 0;
  v_method text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;
  IF p_customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;

  FOR v_prepay IN
    SELECT * FROM customer_prepayments
     WHERE tenant_id = v_tenant_id
       AND customer_id = p_customer_id
       AND amount_used < amount
     ORDER BY created_at ASC
     FOR UPDATE
  LOOP
    v_available := v_prepay.amount - v_prepay.amount_used;
    EXIT WHEN v_available <= 0;

    FOR v_sale IN
      SELECT * FROM sales
       WHERE tenant_id = v_tenant_id
         AND customer_id = p_customer_id
         AND status <> 'cancelled'
         AND COALESCE(paid,0) < COALESCE(total,0)
       ORDER BY created_at ASC
       FOR UPDATE
    LOOP
      v_due := GREATEST(0, COALESCE(v_sale.total,0) - COALESCE(v_sale.paid,0));
      v_take := LEAST(v_available, v_due);
      IF v_take <= 0 THEN CONTINUE; END IF;

      v_method := COALESCE(NULLIF(v_prepay.method_name,''), 'Acompte client');

      -- On inscrit un règlement SANS cash_session_id (pas de double cash-in).
      INSERT INTO sale_payments (
        tenant_id, sale_id, cash_session_id, payment_method_id, method_name, amount, reference
      ) VALUES (
        v_tenant_id, v_sale.id, NULL, v_prepay.payment_method_id,
        'Acompte · ' || v_method, v_take,
        COALESCE(NULLIF(v_prepay.reference,''), 'Acompte client du ' || to_char(v_prepay.created_at, 'DD/MM/YYYY'))
      );

      v_new_paid := COALESCE(v_sale.paid, 0) + v_take;
      v_new_status := CASE
        WHEN v_new_paid >= v_sale.total THEN 'paid'
        WHEN v_new_paid > 0 THEN 'partial'
        ELSE v_sale.status
      END;

      UPDATE sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

      UPDATE customer_prepayments
         SET amount_used = amount_used + v_take
       WHERE id = v_prepay.id;

      v_available := v_available - v_take;
      v_applied := v_applied + v_take;
      EXIT WHEN v_available <= 0;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('applied', v_applied);
END;
$$;

-- Enregistrement d'un mouvement de caisse
CREATE OR REPLACE FUNCTION record_cash_movement(
  p_cash_session_id uuid,
  p_site_id uuid,
  p_kind text,
  p_amount numeric,
  p_reason text DEFAULT '',
  p_note text DEFAULT '',
  p_reference text DEFAULT '',
  p_customer_id uuid DEFAULT NULL,
  p_payment_method_id uuid DEFAULT NULL,
  p_method_name text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_movement_id uuid;
  v_prepay_id uuid;
  v_applied jsonb;
  v_pm_type text;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF p_kind NOT IN ('expense','income','customer_prepayment') THEN
    RAISE EXCEPTION 'Type de mouvement invalide';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  IF p_kind = 'customer_prepayment' THEN
    IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire pour un acompte'; END IF;
    IF p_payment_method_id IS NOT NULL THEN
      SELECT payment_type INTO v_pm_type FROM payment_methods
        WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
      IF COALESCE(v_pm_type,'') = 'credit' THEN
        RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
      END IF;
    END IF;
  END IF;

  INSERT INTO cash_movements (
    tenant_id, cash_session_id, site_id, user_id, kind, amount,
    reason, note, reference, customer_id, payment_method_id, method_name
  ) VALUES (
    v_tenant_id, p_cash_session_id, p_site_id, auth.uid(), p_kind, p_amount,
    COALESCE(p_reason,''), COALESCE(p_note,''), COALESCE(p_reference,''),
    p_customer_id, p_payment_method_id, COALESCE(p_method_name,'')
  ) RETURNING id INTO v_movement_id;

  IF p_kind = 'customer_prepayment' THEN
    INSERT INTO customer_prepayments (
      tenant_id, customer_id, cash_movement_id, cash_session_id,
      amount, payment_method_id, method_name, reference
    ) VALUES (
      v_tenant_id, p_customer_id, v_movement_id, p_cash_session_id,
      p_amount, p_payment_method_id, COALESCE(p_method_name,''), COALESCE(p_reference,'')
    ) RETURNING id INTO v_prepay_id;

    v_applied := apply_customer_prepayments(p_customer_id);

    RETURN jsonb_build_object(
      'movement_id', v_movement_id,
      'prepayment_id', v_prepay_id,
      'auto_applied', COALESCE((v_applied->>'applied')::numeric, 0)
    );
  END IF;

  RETURN jsonb_build_object('movement_id', v_movement_id);
END;
$$;

-- Trigger : dès qu'une facture est créée ou mise à jour (impayée),
-- tente d'imputer les acomptes existants.
CREATE OR REPLACE FUNCTION trg_apply_prepayments_on_sale()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.customer_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.status = 'cancelled' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.paid, 0) >= COALESCE(NEW.total, 0) THEN RETURN NEW; END IF;

  PERFORM apply_customer_prepayments(NEW.customer_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sales_apply_prepayments ON sales;
CREATE TRIGGER sales_apply_prepayments
  AFTER INSERT ON sales
  FOR EACH ROW EXECUTE FUNCTION trg_apply_prepayments_on_sale();