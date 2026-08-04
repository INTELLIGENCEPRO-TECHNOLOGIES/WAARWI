/*
# Add pos_customer_loan permission to admin roles

## Context
Backfill the new `pos_customer_loan` permission for all existing admin roles
so that admins can use the loan feature immediately after the tenant enables it.

## Changes
- Updates all `role_permissions` rows where `role = 'admin'` to include
  `pos_customer_loan: true` in their `permissions` JSONB column.
- Safe to re-run (idempotent SET on jsonb key).
*/

UPDATE role_permissions
SET permissions = permissions || '{"pos_customer_loan": true}'::jsonb
WHERE role = 'admin'
  AND NOT (permissions ? 'pos_customer_loan');
