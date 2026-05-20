/*
  # Tenant approval tracking columns

  Adds audit columns for the approval workflow on the `tenants` table.

  1. New columns (all nullable)
    - `approved_at` (timestamptz) — when the tenant was approved
    - `approved_by` (uuid) — id of the super admin who approved
    - `rejection_reason` (text) — optional reason when rejected

  2. Security
    - No RLS change needed: columns inherit existing tenants policies.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='approved_at') THEN
    ALTER TABLE tenants ADD COLUMN approved_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='approved_by') THEN
    ALTER TABLE tenants ADD COLUMN approved_by uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='rejection_reason') THEN
    ALTER TABLE tenants ADD COLUMN rejection_reason text DEFAULT '';
  END IF;
END $$;