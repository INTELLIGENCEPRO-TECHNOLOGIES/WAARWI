
-- Remove activity-specific modules from plan limits
-- has_ipm: specific to Pharmacie activity type
-- has_stock_by_lot: specific to Pharmacie activity type
-- has_expiry_tracking: specific to Pharmacie activity type
-- These are controlled by tenant.enabled_modules and activity type, not by plan

UPDATE plans SET limits = limits - 'has_ipm' - 'has_stock_by_lot' - 'has_expiry_tracking'
WHERE limits ? 'has_ipm' OR limits ? 'has_stock_by_lot' OR limits ? 'has_expiry_tracking';
