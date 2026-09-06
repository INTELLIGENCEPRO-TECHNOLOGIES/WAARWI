/*
# Register scheduling tables as excluded from backup/restore

1. Changes
   - Registers `_br_schedule_policy`, `_br_tenant_schedule_override`,
     `_br_schedule_runs`, `_br_schedule_run_items` in `_br_table_registry`
     with `tenant_link = 'excluded'` and an `exclusion_reason` so the backup
     function never attempts to back up or restore scheduling metadata.
   - Uses ON CONFLICT (schema_name, table_name) to be idempotent.

2. Security
   - No RLS or privilege changes.
*/

INSERT INTO _br_table_registry (schema_name, table_name, tenant_link, category, restore_order, is_mandatory, exclusion_reason)
VALUES
  ('public', '_br_schedule_policy',          'excluded', 'backup_system', 0, false, 'Scheduling config — not tenant data'),
  ('public', '_br_tenant_schedule_override', 'excluded', 'backup_system', 0, false, 'Scheduling overrides — not tenant data'),
  ('public', '_br_schedule_runs',            'excluded', 'backup_system', 0, false, 'Scheduling run history — not tenant data'),
  ('public', '_br_schedule_run_items',       'excluded', 'backup_system', 0, false, 'Scheduling run items — not tenant data')
ON CONFLICT (schema_name, table_name) DO UPDATE
  SET tenant_link      = EXCLUDED.tenant_link,
      is_mandatory     = EXCLUDED.is_mandatory,
      exclusion_reason = EXCLUDED.exclusion_reason;
