/*
# Allow permanent tenant deletion when off-site backup history exists

1. Problem
- `delete_tenant_permanently` failed for every tenant that had at least one row in
  `_br_offsite_transfers`, because `_br_offsite_transfers_tenant_id_fkey` was
  ON DELETE NO ACTION while every other backup table (`tenant_backups`,
  `tenant_backup_settings`, `_br_tenant_activation`, `_br_tenant_schedule_override`,
  `_br_schedule_run_items`) already cascades on tenant deletion.

2. Change
- Recreate `_br_offsite_transfers_tenant_id_fkey` with ON DELETE CASCADE.
- No column, type, or row is changed by this migration. Transfer history rows are
  removed only when their tenant is permanently deleted.

3. Notes
- Files already pushed to the off-site storage are not touched.
- Idempotent: the constraint is dropped if present and recreated.
*/

ALTER TABLE public._br_offsite_transfers
  DROP CONSTRAINT IF EXISTS _br_offsite_transfers_tenant_id_fkey;

ALTER TABLE public._br_offsite_transfers
  ADD CONSTRAINT _br_offsite_transfers_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
