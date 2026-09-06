# Backup / Restore System v2 — Runbook

**CONFIDENTIAL — INTELLIGENCEPRO ONLY**

## Architecture Overview

The v2 backup/restore system replaces the legacy hardcoded approach with a
**registry-driven, checksummed, activation-locked** architecture.

### Core Tables

| Table | Purpose |
|-------|---------|
| `_br_table_registry` | Central registry of all tenant-scoped tables (89+ entries) |
| `_br_tenant_activation` | Per-tenant activation lock (fail-closed) |
| `tenant_backups` | Backup storage, extended with v2 columns |

### Functions

| Function | Access | Description |
|----------|--------|-------------|
| `br_check_schema_drift()` | authenticated | Compares registry vs pg_catalog |
| `br_create_backup(label, kind)` | authenticated | Registry-driven backup with SHA-256 checksums |
| `br_preflight_restore(backup_id)` | authenticated | Non-destructive pre-restore validation |
| `br_restore_backup(backup_id)` | authenticated (+ activation lock) | Atomic fail-fast restore |
| `br_reset_operations()` | authenticated (+ activation lock) | Operational data reset |
| `br_import_payload(payload)` | authenticated (+ activation lock) | Import from external JSON |

### Error Codes

| Code | Meaning |
|------|---------|
| BR-001 | No tenant context |
| BR-002 | Schema drift detected |
| BR-003 | Backup not found |
| BR-004 | Tenant mismatch |
| BR-005 | Preflight failed |
| BR-006 | Safety backup creation failed |
| BR-007 | Safety backup verification failed |
| BR-008 | Post-restore integrity check failed |
| BR-010 | Advisory lock contention |
| BR-011 | Activation lock not enabled |
| BR-012 | Foreign tenant data in import |

---

## Validation Checklist

### Pre-deployment

- [ ] Run `SELECT br_check_schema_drift()` — must return `drift_detected: false`
- [ ] Verify registry count: `SELECT count(*) FROM _br_table_registry` — expect 89+ rows
- [ ] Verify legacy backups preserved: `SELECT count(*) FROM tenant_backups WHERE status = 'legacy'`
- [ ] Verify all legacy functions revoked:
  ```sql
  SELECT proname, proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND proname IN ('tenant_create_backup', 'tenant_restore_backup',
                    'tenant_restore_from_payload', 'reset_tenant_data',
                    'tenant_reset_operations', '_apply_tenant_metadata',
                    'tenant_run_due_auto_backup');
  ```
  Confirm no `anon` or `authenticated` in proacl.

### Post-deployment — Test with a test tenant

1. **Create backup:**
   ```sql
   SELECT br_create_backup('Test backup', 'manual');
   ```
   Expect: `success: true`, `format_version: 2`, checksums present.

2. **Check schema drift:**
   ```sql
   SELECT br_check_schema_drift();
   ```
   Expect: `drift_detected: false`.

3. **Preflight without activation:**
   ```sql
   SELECT br_preflight_restore('<backup_id>');
   ```
   Expect: `viable: false`, issue code `ACTIVATION_LOCKED`.

4. **Enable activation (service role only):**
   ```sql
   INSERT INTO _br_tenant_activation (tenant_id, enabled, enabled_at)
   VALUES ('<tenant_id>', true, now())
   ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, enabled_at = now();
   ```

5. **Preflight with activation:**
   Expect: `viable: true` (or warnings only).

6. **Restore:**
   ```sql
   SELECT br_restore_backup('<backup_id>');
   ```
   Expect: `success: true`, `integrity_verified: true`, `safety_backup_id` present.

7. **Reset operations:**
   ```sql
   SELECT br_reset_operations();
   ```
   Expect: `success: true`, safety backup created, only operation/audit tables deleted.

### Security Verification

- [ ] `SELECT br_restore_backup(...)` fails from anon key
- [ ] All `br_*` functions fail for unauthenticated calls
- [ ] `reset_tenant_data(uuid)` is not callable by authenticated role
- [ ] `_apply_tenant_metadata(uuid, jsonb)` is not callable by authenticated role
- [ ] `_br_tenant_activation` is not writable by authenticated role

---

## Activation Lock Management

The activation lock is **fail-closed**: destructive operations are blocked unless
explicitly enabled per tenant.

**Enable** (service role / platform admin only):
```sql
INSERT INTO _br_tenant_activation (tenant_id, enabled, enabled_at, enabled_by)
VALUES ('<tenant_id>', true, now(), '<admin_user_id>')
ON CONFLICT (tenant_id) DO UPDATE
SET enabled = true, enabled_at = now(), enabled_by = '<admin_user_id>', disabled_at = null;
```

**Disable** (after maintenance):
```sql
UPDATE _br_tenant_activation
SET enabled = false, disabled_at = now()
WHERE tenant_id = '<tenant_id>';
```

---

## Registry Maintenance

When a new tenant-scoped table is added to the schema, it **must** be registered:
```sql
INSERT INTO _br_table_registry (table_name, tenant_link, category, restore_order, reset_behavior)
VALUES ('new_table', 'direct', 'operation', 70, 'delete');
```

Failure to register will cause `br_create_backup` to fail with `BR-002: Schema drift detected`.

### Table Categories

| Category | Backup | Reset Behavior | Example |
|----------|--------|---------------|---------|
| structure | Yes | Preserved | articles, customers, sites |
| operation | Yes | Deleted | sales, cash_movements |
| audit | Yes | Deleted | site_change_log |
| backup_system | No | Preserved | tenant_backups |
| platform | No | Preserved | plans, profiles |

### Restore Order

| Order | Content |
|-------|---------|
| 10 | Root tables (FK only to tenants) |
| 20 | FK to order-10 tables |
| 30 | FK to order-20 tables |
| 40 | FK to articles, vehicle_models |
| 50 | Session containers |
| 60 | Document headers |
| 70 | Line items |
| 80 | Post-transaction / audit |
| 90 | Deepest children |

---

## Excluded Tables — Justifications

| Table | Reason |
|-------|--------|
| `tenants` | Identity table — overwriting would break tenant |
| `profiles` | Auth-linked via trigger on auth.users |
| `tenant_subscriptions` | Platform-managed billing state |
| `subscription_action_tokens` | Platform-managed security tokens |
| `tenant_backups` | Backup data must not overwrite itself |
| `tenant_backup_settings` | Schedule config preserved across restores |
| `_br_table_registry` | System metadata |
| `_br_tenant_activation` | Activation lock metadata |
| `plans` | Global platform data |
| `business_activity_types` | Global platform data |
| `master_catalogs` | Global platform data |
| `master_catalog_categories` | Global platform data |
| `master_catalog_items` | Global platform data |
| `platform_login_config` | Global platform data |
| `landing_config` | Global platform data |
| `app_releases` | Global platform data |
| `platform_events` | Global platform data |
| `tenant_messages` | Cross-tenant messaging |
| `tenant_message_reads` | Cross-tenant messaging |

### Non-existent tables (confirmed absent from schema)

These tables do NOT exist as standalone tables:
- `warranties`, `warranty_items` — never created
- `sale_cancellations` — cancellation tracked via columns on `sales`
- `site_doc_header_config` — stored as jsonb column, not a table
- `a4_header_config` — stored as jsonb column on tenants/sites
