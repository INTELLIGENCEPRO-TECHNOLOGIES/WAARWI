-- Add 'lifetime' to the billing_cycle check constraint
ALTER TABLE tenants DROP CONSTRAINT tenants_billing_cycle_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_billing_cycle_check
  CHECK (billing_cycle = ANY (ARRAY['monthly', 'yearly', 'lifetime']));

-- Add lifetime pricing to plans
ALTER TABLE plans ADD COLUMN IF NOT EXISTS price_lifetime numeric DEFAULT 0;