-- Add persistent auto-print preferences for POS payment modal
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS auto_print_ticket boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_print_invoice boolean NOT NULL DEFAULT false;
