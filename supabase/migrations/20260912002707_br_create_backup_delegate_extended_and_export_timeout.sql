/*
# Redirect br_create_backup to optimized function + add timeout to export

1. Modified Functions
   - `br_create_backup(text,text)`: now delegates to `_br_create_backup_for_tenant_extended`
     instead of the old `_br_create_backup_for_tenant`, so tenant-side manual backups
     benefit from the temp-table strategy and 60s timeout.
   - `_br_export_offsite_document_text(uuid)`: adds `statement_timeout=60s` and
     `work_mem=16MB` to prevent timeout on large tenants (CHEZ DELICE 34 MB payload).

2. Security
   - Both remain SECURITY DEFINER with restricted search_path.
   - No RLS or privilege changes.

3. Notes
   - The old `_br_create_backup_for_tenant` is NOT dropped; the scheduler edge function
     still references it as a first-try before falling back to extended.
   - The export function iterates ~89 tables computing SHA-256 checksums over JSONB arrays;
     for a 34 MB payload this exceeds the default 8s authenticator timeout.
*/

-- 1. Redirect br_create_backup to extended function
CREATE OR REPLACE FUNCTION public.br_create_backup(
  p_label text DEFAULT 'manual',
  p_kind  text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT p.tenant_id INTO v_tenant_id
  FROM profiles p WHERE p.id = auth.uid();

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant context for current user';
  END IF;

  RETURN _br_create_backup_for_tenant_extended(v_tenant_id, p_label, p_kind);
END;
$function$;

-- 2. Add statement_timeout + work_mem to export function
ALTER FUNCTION public._br_export_offsite_document_text(uuid)
  SET statement_timeout = '60s';
ALTER FUNCTION public._br_export_offsite_document_text(uuid)
  SET work_mem = '16MB';
