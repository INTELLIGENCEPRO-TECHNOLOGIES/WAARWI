/*
  # Système de comptabilisation automatique SYSCOHADA

  1. Extensions des tables existantes
    - `journal_entries` : ajout de `status` (draft/posted/cancelled), `posted_at`, `posted_by`
    - `journal_lines` : ajout de `third_party_id` pour lettrage tiers

  2. Nouvelles colonnes de suivi comptable (non destructives)
    - `sales` : ajout `accounting_status`, `accounting_entry_id`, `accounted_at`
    - `sale_payments` : ajout `accounting_status`, `accounting_entry_id`
    - `supplier_orders` : ajout `accounting_status`, `accounting_entry_id`
    - `supplier_payments` : ajout `accounting_status`, `accounting_entry_id`
    - `cash_movements` : ajout `accounting_status`, `accounting_entry_id`

  3. Table de séquence comptable
    - `accounting_sequences` : numérotation automatique par journal/année/tenant

  4. Sécurité
    - RLS activé sur accounting_sequences
    - Policies restrictives par tenant

  5. Notes
    - Aucune table existante n'est supprimée
    - Aucune colonne existante n'est modifiée
    - Les workflows existants ne sont pas affectés
    - Le statut par défaut est 'not_accounted' (ne change rien aux opérations en cours)
*/

-- ==============================================
-- 1. EXTEND journal_entries : add status, posted_at, posted_by
-- ==============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'status'
  ) THEN
    ALTER TABLE journal_entries ADD COLUMN status text NOT NULL DEFAULT 'posted';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'posted_at'
  ) THEN
    ALTER TABLE journal_entries ADD COLUMN posted_at timestamptz;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_entries' AND column_name = 'posted_by'
  ) THEN
    ALTER TABLE journal_entries ADD COLUMN posted_by uuid;
  END IF;
END $$;

-- ==============================================
-- 2. EXTEND journal_lines : add third_party_id
-- ==============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'journal_lines' AND column_name = 'third_party_id'
  ) THEN
    ALTER TABLE journal_lines ADD COLUMN third_party_id uuid;
  END IF;
END $$;

-- ==============================================
-- 3. ADD accounting columns to sales
-- ==============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales' AND column_name = 'accounting_status'
  ) THEN
    ALTER TABLE sales ADD COLUMN accounting_status text NOT NULL DEFAULT 'not_accounted';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales' AND column_name = 'accounting_entry_id'
  ) THEN
    ALTER TABLE sales ADD COLUMN accounting_entry_id uuid REFERENCES journal_entries(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sales' AND column_name = 'accounted_at'
  ) THEN
    ALTER TABLE sales ADD COLUMN accounted_at timestamptz;
  END IF;
END $$;

-- ==============================================
-- 4. ADD accounting columns to sale_payments
-- ==============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sale_payments' AND column_name = 'accounting_status'
  ) THEN
    ALTER TABLE sale_payments ADD COLUMN accounting_status text NOT NULL DEFAULT 'not_accounted';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sale_payments' AND column_name = 'accounting_entry_id'
  ) THEN
    ALTER TABLE sale_payments ADD COLUMN accounting_entry_id uuid REFERENCES journal_entries(id);
  END IF;
END $$;

-- ==============================================
-- 5. ADD accounting columns to supplier_orders
-- ==============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_orders' AND column_name = 'accounting_status'
  ) THEN
    ALTER TABLE supplier_orders ADD COLUMN accounting_status text NOT NULL DEFAULT 'not_accounted';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_orders' AND column_name = 'accounting_entry_id'
  ) THEN
    ALTER TABLE supplier_orders ADD COLUMN accounting_entry_id uuid REFERENCES journal_entries(id);
  END IF;
END $$;

-- ==============================================
-- 6. ADD accounting columns to supplier_payments
-- ==============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_payments' AND column_name = 'accounting_status'
  ) THEN
    ALTER TABLE supplier_payments ADD COLUMN accounting_status text NOT NULL DEFAULT 'not_accounted';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supplier_payments' AND column_name = 'accounting_entry_id'
  ) THEN
    ALTER TABLE supplier_payments ADD COLUMN accounting_entry_id uuid REFERENCES journal_entries(id);
  END IF;
END $$;

-- ==============================================
-- 7. ADD accounting columns to cash_movements
-- ==============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cash_movements' AND column_name = 'accounting_status'
  ) THEN
    ALTER TABLE cash_movements ADD COLUMN accounting_status text NOT NULL DEFAULT 'not_accounted';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cash_movements' AND column_name = 'accounting_entry_id'
  ) THEN
    ALTER TABLE cash_movements ADD COLUMN accounting_entry_id uuid REFERENCES journal_entries(id);
  END IF;
END $$;

-- ==============================================
-- 8. CREATE accounting_sequences table
-- ==============================================
CREATE TABLE IF NOT EXISTS accounting_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  journal_type text NOT NULL,
  fiscal_year int NOT NULL,
  last_number int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, journal_type, fiscal_year)
);

ALTER TABLE accounting_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "acseq_select" ON accounting_sequences
  FOR SELECT TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "acseq_insert" ON accounting_sequences
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "acseq_update" ON accounting_sequences
  FOR UPDATE TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

-- ==============================================
-- 9. INDEX for performance
-- ==============================================
CREATE INDEX IF NOT EXISTS idx_sales_accounting_status ON sales(accounting_status) WHERE accounting_status != 'accounted';
CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_status ON journal_entries(status);
