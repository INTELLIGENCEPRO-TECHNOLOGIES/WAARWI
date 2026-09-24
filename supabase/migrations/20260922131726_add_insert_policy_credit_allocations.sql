/*
# Add INSERT RLS policy on credit_allocations

## Problem
The `credit_allocations` table has RLS enabled but only a SELECT policy exists.
Two SECURITY INVOKER functions (`_apply_avoirs_internal` and `apply_customer_prepayments`)
INSERT into this table. When called from other INVOKER functions (e.g. `record_cash_movement`),
the effective role is `authenticated`, which is blocked by the missing INSERT policy.
When called from DEFINER functions (e.g. `create_credit_sale`), the effective role is `postgres`
which bypasses RLS — explaining why the error appeared intermittently.

## Changes
- Add INSERT policy `insert_credit_allocations` on `credit_allocations` for the `authenticated` role.
- The WITH CHECK condition ensures rows can only be inserted for the user's current tenant,
  matching the existing SELECT policy pattern: `tenant_id = current_tenant_id()`.

## Security
- Tenant isolation is enforced: authenticated users can only insert allocations for their own tenant.
- No change to existing SELECT policy.
*/

DROP POLICY IF EXISTS "insert_credit_allocations" ON credit_allocations;
CREATE POLICY "insert_credit_allocations"
  ON credit_allocations
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = current_tenant_id());
