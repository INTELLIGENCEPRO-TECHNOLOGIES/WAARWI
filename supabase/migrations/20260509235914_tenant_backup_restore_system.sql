/*
  # Tenant Backup / Restore / Reset / Safe-delete system

  1. New tables
    - `tenant_backups`: stores per-tenant JSONB snapshots of all tenant data
    - `tenant_backup_settings`: auto-backup schedule per tenant

  2. New functions (SECURITY DEFINER, scoped to caller's tenant)
    - `tenant_create_backup(label, auto)` -> snapshots all tenant tables into a single row
    - `tenant_restore_backup(backup_id)` -> wipes tenant rows & reinserts from snapshot
    - `tenant_reset_operations()` -> clears operational data only (keeps articles/customers/suppliers etc.)
    - `tenant_delete_article_safe(id)`, `tenant_delete_customer_safe(id)`, `tenant_delete_supplier_safe(id)`
    - `tenant_run_due_auto_backup()` -> creates an auto backup if next_run_at is reached

  3. Security
    - All tables RLS enabled and restricted to the caller's tenant
    - Functions check `current_tenant_id()` / ownership before touching data
*/

-- Backup snapshot storage
CREATE TABLE IF NOT EXISTS public.tenant_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  label text NOT NULL DEFAULT '',
  kind text NOT NULL DEFAULT 'manual',
  is_auto boolean NOT NULL DEFAULT false,
  size_bytes bigint NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_tenant_backups_tenant_created
  ON public.tenant_backups (tenant_id, created_at DESC);

ALTER TABLE public.tenant_backups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_backups_select" ON public.tenant_backups;
CREATE POLICY "tenant_backups_select"
  ON public.tenant_backups FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "tenant_backups_delete" ON public.tenant_backups;
CREATE POLICY "tenant_backups_delete"
  ON public.tenant_backups FOR DELETE TO authenticated
  USING (tenant_id = public.current_tenant_id());

-- Schedule
CREATE TABLE IF NOT EXISTS public.tenant_backup_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  auto_enabled boolean NOT NULL DEFAULT false,
  frequency_hours integer NOT NULL DEFAULT 24,
  keep_count integer NOT NULL DEFAULT 10,
  last_run_at timestamptz,
  next_run_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_backup_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_backup_settings_select" ON public.tenant_backup_settings;
CREATE POLICY "tenant_backup_settings_select"
  ON public.tenant_backup_settings FOR SELECT TO authenticated
  USING (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "tenant_backup_settings_insert" ON public.tenant_backup_settings;
CREATE POLICY "tenant_backup_settings_insert"
  ON public.tenant_backup_settings FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.current_tenant_id());

DROP POLICY IF EXISTS "tenant_backup_settings_update" ON public.tenant_backup_settings;
CREATE POLICY "tenant_backup_settings_update"
  ON public.tenant_backup_settings FOR UPDATE TO authenticated
  USING (tenant_id = public.current_tenant_id())
  WITH CHECK (tenant_id = public.current_tenant_id());
