
-- 1. Enrich the plans.limits jsonb with additional module flags
-- Update existing plans to include all technical limit fields
UPDATE plans SET limits = limits || '{"max_clients": -1, "max_suppliers": -1, "max_invoices_month": -1, "has_ipm": false, "has_whatsapp": false, "has_multi_store": false, "has_advanced_reports": false, "has_stock_by_lot": true, "has_expiry_tracking": false, "has_accounting_export": false}'::jsonb
WHERE NOT (limits ? 'max_clients');

-- Update specific plans with correct values
UPDATE plans SET limits = limits || '{"max_clients": 50, "max_suppliers": 10, "max_invoices_month": 200, "has_ipm": false, "has_whatsapp": false, "has_multi_store": false, "has_advanced_reports": false, "has_stock_by_lot": false, "has_expiry_tracking": false, "has_accounting_export": false}'::jsonb
WHERE code = 'trial';

UPDATE plans SET limits = limits || '{"max_clients": -1, "max_suppliers": -1, "max_invoices_month": -1, "has_ipm": false, "has_whatsapp": false, "has_multi_store": true, "has_advanced_reports": false, "has_stock_by_lot": true, "has_expiry_tracking": false, "has_accounting_export": false}'::jsonb
WHERE code = 'starter';

UPDATE plans SET limits = limits || '{"max_clients": -1, "max_suppliers": -1, "max_invoices_month": -1, "has_ipm": true, "has_whatsapp": true, "has_multi_store": true, "has_advanced_reports": true, "has_stock_by_lot": true, "has_expiry_tracking": true, "has_accounting_export": true}'::jsonb
WHERE code = 'pro';

UPDATE plans SET limits = limits || '{"max_clients": -1, "max_suppliers": -1, "max_invoices_month": -1, "has_ipm": true, "has_whatsapp": true, "has_multi_store": true, "has_advanced_reports": true, "has_stock_by_lot": true, "has_expiry_tracking": true, "has_accounting_export": true}'::jsonb
WHERE code = 'enterprise';

-- 2. Add custom_limits override column to tenant_subscriptions
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS custom_limits jsonb DEFAULT NULL;

-- 3. Create the effective limits function that respects overrides
CREATE OR REPLACE FUNCTION get_tenant_effective_limits(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  v_plan_code text;
  v_plan_limits jsonb;
  v_custom_limits jsonb;
BEGIN
  -- Get tenant's plan
  SELECT plan INTO v_plan_code FROM tenants WHERE id = p_tenant_id;
  IF v_plan_code IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Get plan limits
  SELECT limits INTO v_plan_limits FROM plans WHERE code = v_plan_code;
  IF v_plan_limits IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  -- Check for custom overrides in active subscription
  SELECT custom_limits INTO v_custom_limits
  FROM tenant_subscriptions
  WHERE tenant_id = p_tenant_id
    AND plan_code = v_plan_code
    AND status = 'active'
  ORDER BY started_at DESC
  LIMIT 1;

  -- Merge: custom_limits override plan_limits where set
  IF v_custom_limits IS NOT NULL AND v_custom_limits != '{}'::jsonb THEN
    RETURN v_plan_limits || v_custom_limits;
  END IF;

  RETURN v_plan_limits;
END;
$$;

-- 4. Update tenant_usage to include effective limits
CREATE OR REPLACE FUNCTION tenant_usage(p_tenant_id uuid)
RETURNS TABLE(
  sites_count int,
  users_count int,
  articles_count int,
  plan_code text,
  plan_limits jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
BEGIN
RETURN QUERY
SELECT
  (SELECT count(*) FROM sites WHERE tenant_id = p_tenant_id)::int,
  (SELECT count(*) FROM profiles WHERE tenant_id = p_tenant_id)::int,
  (SELECT count(*) FROM articles WHERE tenant_id = p_tenant_id)::int,
  (SELECT plan FROM tenants WHERE id = p_tenant_id),
  get_tenant_effective_limits(p_tenant_id);
END;
$$;

-- 5. Update enforce_tenant_plan_limit to use effective limits
CREATE OR REPLACE FUNCTION enforce_tenant_plan_limit(p_tenant_id uuid, p_key text, p_current bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE v_plan text; v_limit int; v_effective jsonb;
BEGIN
  SELECT plan INTO v_plan FROM tenants WHERE id = p_tenant_id;
  IF v_plan IS NULL THEN RETURN; END IF;
  
  -- Use effective limits (plan + overrides)
  v_effective := get_tenant_effective_limits(p_tenant_id);
  v_limit := NULLIF(v_effective->>p_key, '')::int;
  
  IF v_limit IS NULL OR v_limit = -1 THEN RETURN; END IF;
  IF p_current >= v_limit THEN
    RAISE EXCEPTION 'Limite du plan % atteinte pour %: max %. Mettez à niveau votre abonnement.', v_plan, p_key, v_limit USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

-- 6. Grant execute to authenticated
GRANT EXECUTE ON FUNCTION get_tenant_effective_limits(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION tenant_usage(uuid) TO authenticated;
