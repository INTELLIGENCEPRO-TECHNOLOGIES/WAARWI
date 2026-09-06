/*
# Register audit_logs table in BR registry

Adds the missing audit_logs table (general audit trail, tenant-scoped)
to the backup registry. Classified as 'audit' category, restore_order 80,
reset_behavior 'delete' (cleared during operational reset).
*/

INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior)
VALUES ('audit_logs', 'direct', 'audit', 80, 'delete')
ON CONFLICT (schema_name, table_name) DO NOTHING;
