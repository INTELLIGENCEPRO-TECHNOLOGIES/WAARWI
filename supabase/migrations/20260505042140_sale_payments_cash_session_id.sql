/*
  # Add cash_session_id to sale_payments and user_id to cash_sessions

  ## Summary
  Fixes the cash control workflow by linking sale_payments directly to the
  cash session they belong to, enabling correct theoretical amount calculation
  per payment method during session closing.

  ## Changes

  ### Modified Tables
  - `sale_payments`: Add `cash_session_id` column (uuid, nullable FK to cash_sessions)
  - `cash_sessions`: Add `user_id` column (uuid, nullable FK to auth.users) if missing

  ## Notes
  - Existing rows will have cash_session_id = NULL (backfilled below via join on sales)
  - The create_pos_sale RPC will be updated separately to populate this column
*/

-- Add cash_session_id to sale_payments
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sale_payments' AND column_name = 'cash_session_id') THEN
    ALTER TABLE sale_payments ADD COLUMN cash_session_id uuid REFERENCES cash_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add user_id to cash_sessions if missing
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'cash_sessions' AND column_name = 'user_id') THEN
    ALTER TABLE cash_sessions ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Backfill cash_session_id on existing sale_payments via sales table
UPDATE sale_payments sp
SET cash_session_id = s.cash_session_id
FROM sales s
WHERE sp.sale_id = s.id
  AND s.cash_session_id IS NOT NULL
  AND sp.cash_session_id IS NULL;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_sale_payments_cash_session_id ON sale_payments(cash_session_id);
