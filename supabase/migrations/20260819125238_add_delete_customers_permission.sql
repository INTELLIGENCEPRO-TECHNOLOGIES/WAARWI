/*
# Add delete_customers permission key

## Purpose
Introduces a new granular permission `delete_customers` that separately controls
the ability to delete or deactivate/reactivate customers and suppliers.
Previously, `manage_customers` covered both creation/modification AND deletion.
Cashiers had `manage_customers: true`, which let them delete clients — this was
too permissive.

## Changes
1. Backfills `delete_customers` into every existing `role_permissions` row:
   - admin / super_admin / manager → `true` (can delete/deactivate)
   - cashier → `false` (cannot delete or deactivate clients/suppliers)
   - viewer → `false` (already read-only)
   - any other role → inherits the value of `manage_customers` as a safe default
2. The trigger function that provisions default role permissions for new tenants
   is NOT modified here — the backfill uses `COALESCE` so re-running is safe.

## Security
- No RLS or policy changes.
- No table structure changes (permissions stored as jsonb column).
- Cashiers lose the ability to suppress or deactivate clients/suppliers.

## Important notes
1. The migration is idempotent — uses `|| jsonb_build_object` merge semantics.
2. Only the `cashier` and `viewer` roles are explicitly forced to `false`.
3. Admin/super_admin/manager rows are explicitly set to `true`.
4. Any custom role retains its previous `manage_customers` value as default.
*/

-- Backfill delete_customers for all existing role_permissions rows
UPDATE role_permissions
SET permissions = permissions || jsonb_build_object(
  'delete_customers',
  CASE
    WHEN role IN ('admin', 'super_admin', 'manager') THEN true
    WHEN role IN ('cashier', 'viewer') THEN false
    ELSE COALESCE((permissions->>'manage_customers')::boolean, false)
  END
),
updated_at = now();
