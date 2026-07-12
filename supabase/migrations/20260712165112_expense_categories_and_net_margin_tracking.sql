/*
# Catégorisation et suivi des dépenses de caisse

1. New Tables
- `expense_categories` : types de dépenses paramétrables par entreprise
  - `id` (uuid, primary key)
  - `tenant_id` (uuid, FK tenants)
  - `name` (text) — libellé du type de dépense (unique par tenant)
  - `is_active` (boolean, default true) — permet de désactiver un type sans le supprimer
  - `created_at` (timestamptz)

2. Modified Tables
- `cash_movements` : ajout de `expense_category_id` (uuid, FK expense_categories, ON DELETE SET NULL)
  pour rattacher chaque dépense à un type paramétrable.

3. Functions
- `record_cash_movement` : nouvelle signature avec `p_expense_category_id uuid DEFAULT NULL`.
  L'ancienne signature (10 paramètres) est supprimée pour éviter toute ambiguïté d'appel.
  Le comportement existant (mise à jour du solde théorique, acomptes clients) est inchangé.

4. Seed
- Catégories de dépenses par défaut créées pour chaque tenant existant
  (Loyer, Carburant, Électricité & eau, Fournitures, Transport, Salaires & personnel, Entretien & réparations, Divers)
  uniquement si le tenant n'a encore aucune catégorie.

5. Security
- RLS activé sur `expense_categories`.
- 4 politiques (select/insert/update/delete) réservées aux utilisateurs authentifiés
  du tenant courant via `current_tenant_id()`.
*/

CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE (tenant_id, name)
);

ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_tenant_expense_categories" ON expense_categories;
CREATE POLICY "select_tenant_expense_categories" ON expense_categories FOR SELECT
  TO authenticated USING (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "insert_tenant_expense_categories" ON expense_categories;
CREATE POLICY "insert_tenant_expense_categories" ON expense_categories FOR INSERT
  TO authenticated WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "update_tenant_expense_categories" ON expense_categories;
CREATE POLICY "update_tenant_expense_categories" ON expense_categories FOR UPDATE
  TO authenticated USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

DROP POLICY IF EXISTS "delete_tenant_expense_categories" ON expense_categories;
CREATE POLICY "delete_tenant_expense_categories" ON expense_categories FOR DELETE
  TO authenticated USING (tenant_id = current_tenant_id());

CREATE INDEX IF NOT EXISTS idx_expense_categories_tenant ON expense_categories(tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cash_movements' AND column_name = 'expense_category_id'
  ) THEN
    ALTER TABLE cash_movements
      ADD COLUMN expense_category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cash_movements_expense_category ON cash_movements(expense_category_id);

-- Seed default categories for tenants that have none yet
INSERT INTO expense_categories (tenant_id, name)
SELECT t.id, c.name
FROM tenants t
CROSS JOIN (VALUES
  ('Loyer'), ('Carburant'), ('Électricité & eau'), ('Fournitures'),
  ('Transport'), ('Salaires & personnel'), ('Entretien & réparations'), ('Divers')
) AS c(name)
WHERE NOT EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = t.id)
ON CONFLICT (tenant_id, name) DO NOTHING;

DROP FUNCTION IF EXISTS public.record_cash_movement(uuid, uuid, text, numeric, text, text, text, uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.record_cash_movement(
  p_cash_session_id uuid,
  p_site_id uuid,
  p_kind text,
  p_amount numeric,
  p_reason text DEFAULT '',
  p_note text DEFAULT '',
  p_reference text DEFAULT '',
  p_customer_id uuid DEFAULT NULL,
  p_payment_method_id uuid DEFAULT NULL,
  p_method_name text DEFAULT '',
  p_expense_category_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
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
    reason, note, reference, customer_id, payment_method_id, method_name,
    expense_category_id
  ) VALUES (
    v_tenant_id, p_cash_session_id, p_site_id, auth.uid(), p_kind, p_amount,
    COALESCE(p_reason,''), COALESCE(p_note,''), COALESCE(p_reference,''),
    p_customer_id, p_payment_method_id, COALESCE(p_method_name,''),
    CASE WHEN p_kind = 'expense' THEN p_expense_category_id ELSE NULL END
  ) RETURNING id INTO v_movement_id;

  IF p_cash_session_id IS NOT NULL THEN
    IF p_kind = 'expense' THEN
      UPDATE cash_sessions
      SET theoretical_amount = COALESCE(theoretical_amount, 0) - p_amount
      WHERE id = p_cash_session_id;
    ELSE
      UPDATE cash_sessions
      SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
      WHERE id = p_cash_session_id;
    END IF;
  END IF;

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