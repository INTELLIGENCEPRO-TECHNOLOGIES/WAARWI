/*
# Offsite backup: PostgreSQL-native serialization and rehydration

## Problem
When sending backups offsite, the payload is loaded as a JavaScript object
then re-serialized with JSON.stringify. This double JS conversion can alter
numeric representations (e.g. 1.0 → 1, trailing decimals). On retrieval,
old checksums are copied verbatim without recalculation, causing
br_preflight_restore to detect CHECKSUM_MISMATCH.

## Solution
1. New function `_br_export_offsite_document_text(p_backup_id uuid)`
   - Builds the offsite document entirely in PostgreSQL using jsonb_build_object
   - Returns the document as text (::text cast of jsonb)
   - Includes serialization_version marker "postgres-jsonb-text-v1"
   - Only exports verified backups
   - Accessible only by service_role

2. New function `_br_rehydrate_offsite_backup(p_transfer_id uuid, p_document_text text)`
   - Converts document_text to jsonb only inside PostgreSQL
   - Recalculates all checksums, row_counts, manifest, global_checksum, size_bytes
     using the exact same algorithm as br_create_backup
   - Handles existing backups: repairs if checksums invalid, relinks if valid
   - Handles legacy archives (no serialization_version) with normalization
   - Idempotent operation
   - Accessible only by service_role

## Security
- Both functions: REVOKE ALL from PUBLIC, anon, authenticated
- SECURITY DEFINER with fixed search_path
*/

-- ============================================================
-- FUNCTION 1: _br_export_offsite_document_text
-- ============================================================
CREATE OR REPLACE FUNCTION _br_export_offsite_document_text(p_backup_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_backup record;
  v_document jsonb;
BEGIN
  SELECT id, tenant_id, created_at, label, kind, is_auto,
         size_bytes, payload, format_version, schema_fingerprint,
         manifest, row_counts, checksums, global_checksum,
         verified_at, status
  INTO v_backup
  FROM tenant_backups
  WHERE id = p_backup_id;

  IF v_backup IS NULL THEN
    RAISE EXCEPTION 'Backup % not found', p_backup_id;
  END IF;

  IF v_backup.status != 'verified' THEN
    RAISE EXCEPTION 'Backup % is not verified (status: %)', p_backup_id, v_backup.status;
  END IF;

  v_document := jsonb_build_object(
    'serialization_version', 'postgres-jsonb-text-v1',
    'format_version',     COALESCE(v_backup.format_version, 2),
    'tenant_id',          v_backup.tenant_id,
    'backup_id',          v_backup.id,
    'label',              v_backup.label,
    'kind',               v_backup.kind,
    'is_auto',            v_backup.is_auto,
    'schema_fingerprint', v_backup.schema_fingerprint,
    'manifest',           v_backup.manifest,
    'row_counts',         v_backup.row_counts,
    'checksums',          v_backup.checksums,
    'global_checksum',    v_backup.global_checksum,
    'size_bytes',         v_backup.size_bytes,
    'created_at',         v_backup.created_at,
    'verified_at',        v_backup.verified_at,
    'payload',            v_backup.payload
  );

  RETURN v_document::text;
END;
$$;

REVOKE ALL ON FUNCTION _br_export_offsite_document_text(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _br_export_offsite_document_text(uuid) FROM anon;
REVOKE ALL ON FUNCTION _br_export_offsite_document_text(uuid) FROM authenticated;

-- ============================================================
-- FUNCTION 2: _br_rehydrate_offsite_backup
-- ============================================================
CREATE OR REPLACE FUNCTION _br_rehydrate_offsite_backup(
  p_transfer_id uuid,
  p_document_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_transfer record;
  v_doc jsonb;
  v_doc_tenant_id uuid;
  v_doc_backup_id uuid;
  v_doc_format_version integer;
  v_payload jsonb;
  v_is_legacy boolean := false;
  -- Recalculated metadata
  v_row_counts jsonb := '{}'::jsonb;
  v_checksums jsonb := '{}'::jsonb;
  v_manifest jsonb := '[]'::jsonb;
  v_global_parts text := '';
  v_fingerprint text;
  v_size_bytes bigint;
  v_global_checksum text;
  -- Per-table iteration
  v_rec record;
  v_table_data jsonb;
  v_count integer;
  v_checksum text;
  -- Existing backup
  v_existing record;
  v_existing_valid boolean;
  v_action_taken text;
BEGIN
  -- 1. Lock and verify transfer
  SELECT id, source_backup_id, backup_id, tenant_id, status
  INTO v_transfer
  FROM _br_offsite_transfers
  WHERE id = p_transfer_id
  FOR UPDATE;

  IF v_transfer IS NULL THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  IF v_transfer.status != 'verified' THEN
    RAISE EXCEPTION 'Transfer % is not verified (status: %)', p_transfer_id, v_transfer.status;
  END IF;

  -- 2. Parse document in PostgreSQL only
  BEGIN
    v_doc := p_document_text::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Invalid JSON document: %', SQLERRM;
  END;

  -- 3. Validate core fields
  v_doc_tenant_id := (v_doc->>'tenant_id')::uuid;
  v_doc_backup_id := (v_doc->>'backup_id')::uuid;
  v_doc_format_version := COALESCE((v_doc->>'format_version')::integer, 2);

  IF v_doc_tenant_id IS NULL OR v_doc_tenant_id != v_transfer.tenant_id THEN
    RAISE EXCEPTION 'Document tenant_id (%) does not match transfer tenant_id (%)',
      v_doc_tenant_id, v_transfer.tenant_id;
  END IF;

  IF v_doc_backup_id IS NULL OR v_doc_backup_id != v_transfer.source_backup_id THEN
    RAISE EXCEPTION 'Document backup_id (%) does not match transfer source_backup_id (%)',
      v_doc_backup_id, v_transfer.source_backup_id;
  END IF;

  v_payload := v_doc->'payload';
  IF v_payload IS NULL OR jsonb_typeof(v_payload) != 'object' THEN
    RAISE EXCEPTION 'Document payload is missing or not an object';
  END IF;

  -- Detect legacy archive (no serialization_version)
  v_is_legacy := (v_doc->>'serialization_version') IS NULL;

  -- 4. Recalculate all metadata from the payload using the same algorithm as br_create_backup
  SELECT md5(string_agg(table_name || ':' || restore_order::text, ',' ORDER BY table_name))
  INTO v_fingerprint
  FROM _br_table_registry
  WHERE tenant_link != 'excluded';

  FOR v_rec IN
    SELECT r.table_name, r.restore_order
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
    ORDER BY r.restore_order, r.table_name
  LOOP
    -- Get table data from payload (may be absent for tables added after backup)
    v_table_data := v_payload->v_rec.table_name;
    IF v_table_data IS NULL OR jsonb_typeof(v_table_data) != 'array' THEN
      v_table_data := '[]'::jsonb;
    END IF;

    v_count := jsonb_array_length(v_table_data);

    v_checksum := encode(
      extensions.digest(
        coalesce(
          (SELECT string_agg(j::text, '' ORDER BY j::text)
           FROM jsonb_array_elements(v_table_data) AS j),
          ''
        ),
        'sha256'
      ),
      'hex'
    );

    v_row_counts := v_row_counts || jsonb_build_object(v_rec.table_name, v_count);
    v_checksums := v_checksums || jsonb_build_object(v_rec.table_name, v_checksum);
    v_manifest := v_manifest || jsonb_build_array(jsonb_build_object(
      'table', v_rec.table_name,
      'order', v_rec.restore_order,
      'rows', v_count,
      'checksum', v_checksum
    ));
    v_global_parts := v_global_parts || v_checksum;
  END LOOP;

  v_global_checksum := encode(extensions.digest(v_global_parts, 'sha256'), 'hex');
  v_size_bytes := octet_length(v_payload::text);

  -- 5. Check if local backup already exists
  SELECT id, status, global_checksum
  INTO v_existing
  FROM tenant_backups
  WHERE id = v_doc_backup_id;

  IF v_existing IS NOT NULL THEN
    -- Check if existing checksums are valid
    v_existing_valid := (v_existing.global_checksum IS NOT NULL
                         AND v_existing.global_checksum = v_global_checksum);

    IF v_existing_valid THEN
      -- Valid: just relink
      v_action_taken := 'relinked';
    ELSE
      -- Invalid: repair from remote document
      UPDATE tenant_backups SET
        payload = v_payload,
        format_version = v_doc_format_version,
        schema_fingerprint = v_fingerprint,
        manifest = v_manifest,
        row_counts = v_row_counts,
        checksums = v_checksums,
        global_checksum = v_global_checksum,
        size_bytes = v_size_bytes,
        status = 'verified'::br_backup_status,
        verified_at = now(),
        error_message = NULL
      WHERE id = v_doc_backup_id;

      v_action_taken := 'repaired';
    END IF;
  ELSE
    -- 6. Insert new backup row with recalculated metadata
    INSERT INTO tenant_backups (
      id, tenant_id, created_at, label, kind, is_auto,
      status, payload, format_version, schema_fingerprint,
      manifest, row_counts, checksums, global_checksum,
      size_bytes, verified_at
    ) VALUES (
      v_doc_backup_id,
      v_doc_tenant_id,
      COALESCE((v_doc->>'created_at')::timestamptz, now()),
      '[Rapatrié] ' || COALESCE(v_doc->>'label', 'Sauvegarde'),
      'import',
      false,
      'verified'::br_backup_status,
      v_payload,
      v_doc_format_version,
      v_fingerprint,
      v_manifest,
      v_row_counts,
      v_checksums,
      v_global_checksum,
      v_size_bytes,
      now()
    );

    v_action_taken := 'recreated';
  END IF;

  -- 7. Relink transfer -> backup
  UPDATE _br_offsite_transfers
  SET backup_id = v_doc_backup_id
  WHERE id = p_transfer_id;

  RETURN jsonb_build_object(
    'success', true,
    'backup_id', v_doc_backup_id,
    'action_taken', v_action_taken,
    'legacy_normalized', v_is_legacy,
    'global_checksum', v_global_checksum,
    'size_bytes', v_size_bytes,
    'table_count', (SELECT count(*) FROM jsonb_object_keys(v_row_counts) AS k),
    'total_rows', (SELECT coalesce(sum(v::bigint), 0) FROM jsonb_each_text(v_row_counts) AS x(k, v))
  );
END;
$$;

REVOKE ALL ON FUNCTION _br_rehydrate_offsite_backup(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION _br_rehydrate_offsite_backup(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION _br_rehydrate_offsite_backup(uuid, text) FROM authenticated;
