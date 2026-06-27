-- Add subscription management columns to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS billing_cycle text DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly'));
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_renew boolean DEFAULT true;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subscription_start_date timestamptz;

-- For existing approved tenants without subscription_start_date, set it to their approved_at
UPDATE tenants 
SET subscription_start_date = COALESCE(trial_end_date, approved_at, created_at)
WHERE approval_status = 'approved' AND subscription_start_date IS NULL;

-- For existing approved tenants without plan_expires_at, calculate it based on billing cycle
UPDATE tenants
SET plan_expires_at = CASE 
  WHEN billing_cycle = 'yearly' THEN subscription_start_date + INTERVAL '1 year'
  ELSE subscription_start_date + INTERVAL '1 month'
END
WHERE approval_status = 'approved' 
  AND plan_expires_at IS NULL 
  AND subscription_start_date IS NOT NULL
  AND plan != 'trial';

-- Update subscription_status for all approved tenants based on current dates
UPDATE tenants
SET subscription_status = CASE
  WHEN trial_end_date IS NOT NULL AND NOW() < trial_end_date THEN 'trial_active'
  WHEN plan_expires_at IS NOT NULL AND NOW() > plan_expires_at THEN 'expired'
  ELSE 'active'
END
WHERE approval_status = 'approved';

-- Set annual prices with 2 months free discount (10 months price for 12 months)
UPDATE plans SET price_yearly = price_monthly * 10 WHERE price_monthly > 0;
UPDATE plans SET price_yearly = 0 WHERE code = 'trial';
