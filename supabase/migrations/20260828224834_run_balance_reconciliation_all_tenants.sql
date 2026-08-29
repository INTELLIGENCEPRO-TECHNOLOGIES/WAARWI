/*
# Run balance reconciliation for all customers

## Summary
Executes _recalculate_all_customer_balances for every tenant that has customers,
then runs allocation engines for any customers who now have allocatable credit.

## Data Changes
- Corrects stored balances for all customers with drift
- Creates reconciliation balance_adjustments for audit trail
- Runs credit allocation engines after corrections

## Important Notes
1. This is a one-time execution of the permanent reconciliation engine
2. Each correction is traceable via kind='reconciliation' adjustments
3. After reconciliation, allocation engines process any remaining credit
*/

-- ============================================================
-- 1. Run reconciliation for ALL tenants
-- ============================================================
DO $$
DECLARE
  v_tenant record;
  v_result jsonb;
BEGIN
  FOR v_tenant IN SELECT DISTINCT tenant_id FROM public.customers WHERE tenant_id IS NOT NULL
  LOOP
    v_result := public._recalculate_all_customer_balances(v_tenant.tenant_id);
    RAISE NOTICE 'Tenant %: %', v_tenant.tenant_id, v_result;
  END LOOP;
END $$;
