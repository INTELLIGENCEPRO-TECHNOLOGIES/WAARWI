/*
  # POS Cash Control Enhancement

  ## Summary
  Extends the cash session system to support professional cash control workflows
  including per-payment-method counting, variance regularization, and detailed closing reports.

  ## Changes

  ### Modified Tables
  - `cash_sessions`: Add columns for closing workflow state
    - `counted_cash` (numeric): Total counted by cashier during close
    - `opening_note` (text): Note at opening
    - `closing_note` (text): Note at closing
    - `updated_at` (timestamptz): Last update timestamp

  ### New Tables
  1. `cash_control_lines`
     - Per payment method cash count during session close
     - `id`, `tenant_id`, `cash_session_id`
     - `payment_method_id`, `method_name`
     - `theoretical_amount` (numeric): sum of sales for this method
     - `counted_amount` (numeric): cashier's physical count
     - `difference_amount` (numeric): counted - theoretical
     - `note` (text)
     - `created_at`

  2. `cash_regularizations`
     - Discrepancy regularization entries
     - `id`, `tenant_id`, `cash_session_id`
     - `reg_type` (text): 'excedent' | 'manquant' | 'depot' | 'retrait'
     - `amount` (numeric)
     - `reason` (text)
     - `note` (text)
     - `user_id` (uuid): cashier who made the regularization
     - `created_at`

  ## Security
  - RLS enabled on both new tables
  - Authenticated users can SELECT/INSERT/UPDATE/DELETE their tenant's data
*/

-- Add missing columns to cash_sessions
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_sessions' AND column_name = 'counted_cash') THEN
    ALTER TABLE cash_sessions ADD COLUMN counted_cash numeric DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_sessions' AND column_name = 'opening_note') THEN
    ALTER TABLE cash_sessions ADD COLUMN opening_note text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_sessions' AND column_name = 'closing_note') THEN
    ALTER TABLE cash_sessions ADD COLUMN closing_note text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_sessions' AND column_name = 'updated_at') THEN
    ALTER TABLE cash_sessions ADD COLUMN updated_at timestamptz DEFAULT now();
  END IF;
END $$;

-- cash_control_lines: per-method count at session close
CREATE TABLE IF NOT EXISTS cash_control_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cash_session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES payment_methods(id) ON DELETE SET NULL,
  method_name text NOT NULL DEFAULT '',
  theoretical_amount numeric NOT NULL DEFAULT 0,
  counted_amount numeric NOT NULL DEFAULT 0,
  difference_amount numeric GENERATED ALWAYS AS (counted_amount - theoretical_amount) STORED,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_control_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can select cash_control_lines"
  ON cash_control_lines FOR SELECT
  TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "Tenant members can insert cash_control_lines"
  ON cash_control_lines FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "Tenant members can update cash_control_lines"
  ON cash_control_lines FOR UPDATE
  TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "Tenant members can delete cash_control_lines"
  ON cash_control_lines FOR DELETE
  TO authenticated
  USING (tenant_id = current_tenant_id());

-- cash_regularizations: discrepancy regularization entries
CREATE TABLE IF NOT EXISTS cash_regularizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cash_session_id uuid NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  reg_type text NOT NULL DEFAULT 'manquant' CHECK (reg_type IN ('excedent', 'manquant', 'depot', 'retrait')),
  amount numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  reason text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cash_regularizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant members can select cash_regularizations"
  ON cash_regularizations FOR SELECT
  TO authenticated
  USING (tenant_id = current_tenant_id());

CREATE POLICY "Tenant members can insert cash_regularizations"
  ON cash_regularizations FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "Tenant members can update cash_regularizations"
  ON cash_regularizations FOR UPDATE
  TO authenticated
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());

CREATE POLICY "Tenant members can delete cash_regularizations"
  ON cash_regularizations FOR DELETE
  TO authenticated
  USING (tenant_id = current_tenant_id());
