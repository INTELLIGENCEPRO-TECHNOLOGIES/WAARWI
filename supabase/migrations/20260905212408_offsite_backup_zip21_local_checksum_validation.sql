/*
  ZIP-21 Final: local row checksum validation

  Fixes:
  1. _br_export_offsite_document_text: reject format_version != 2;
     full JSONB comparison of stored checksums vs recalculated.
  2. _br_rehydrate_offsite_backup:
     - UNSUPPORTED_SERIALIZATION_VERSION for unknown non-null markers.
     - Full JSONB equality for remote document checksums.
     - Existing local row validated against BOTH stored metadata AND remote:
       status=verified, same tenant, stored checksums = recalculated = remote.
     - Any mismatch -> repaired branch (never relinked with stale metadata).
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
  v_payload jsonb;
  v_checksums jsonb := '{}'::jsonb;
  v_global_parts text := '';
  v_global_checksum text;
  v_rec record;
  v_table_data jsonb;
  v_checksum text;
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

  IF COALESCE(v_backup.format_version, 0) != 2 THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: Backup % has format_version=%, only 2 is accepted',
      p_backup_id, COALESCE(v_backup.format_version, 0);
  END IF;

  v_payload := v_backup.payload;
  IF v_payload IS NULL OR jsonb_typeof(v_payload) != 'object' THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: Backup % has NULL or invalid payload', p_backup_id;
  END IF;

  FOR v_rec IN
    SELECT r.table_name, r.restore_order
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
    ORDER BY r.restore_order, r.table_name
  LOOP
    v_table_data := v_payload->v_rec.table_name;
    IF v_table_data IS NULL OR jsonb_typeof(v_table_data) != 'array' THEN
      v_table_data := '[]'::jsonb;
    END IF;

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

    v_checksums := v_checksums || jsonb_build_object(v_rec.table_name, v_checksum);
    v_global_parts := v_global_parts || v_checksum;
  END LOOP;

  v_global_checksum := encode(extensions.digest(v_global_parts, 'sha256'), 'hex');

  -- Full JSONB comparison: stored checksums object must equal recalculated
  IF v_backup.checksums IS DISTINCT FROM v_checksums THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: Backup % stored checksums object does not match recalculated from payload',
      p_backup_id;
  END IF;

  IF v_backup.global_checksum IS DISTINCT FROM v_global_checksum THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: Backup % stored global_checksum (%) != recalculated (%)',
      p_backup_id, coalesce(v_backup.global_checksum, 'NULL'), v_global_checksum;
  END IF;

  v_document := jsonb_build_object(
    'serialization_version', 'postgres-jsonb-text-v1',
    'format_version',     2,
    'tenant_id',          v_backup.tenant_id,
    'backup_id',          v_backup.id,
    'label',              v_backup.label,
    'kind',               v_backup.kind,
    'is_auto',            v_backup.is_auto,
    'schema_fingerprint', v_backup.schema_fingerprint,
    'manifest',           v_backup.manifest,
    'row_counts',         v_backup.row_counts,
    'checksums',          v_checksums,
    'global_checksum',    v_global_checksum,
    'size_bytes',         v_backup.size_bytes,
    'created_at',         v_backup.created_at,
    'verified_at',        v_backup.verified_at,
    'payload',            v_payload
  );

  RETURN v_document::text;
END;
$$;

REVOKE ALL ON FUNCTION _br_export_offsite_document_text(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION _br_export_offsite_document_text(uuid) FROM anon;
REVOKE ALL ON FUNCTION _br_export_offsite_document_text(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION _br_export_offsite_document_text(uuid) TO service_role;


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
  v_doc_ser_version text;
  v_payload jsonb;
  v_is_legacy boolean := false;
  -- Recalculated from remote payload
  v_row_counts jsonb := '{}'::jsonb;
  v_checksums jsonb := '{}'::jsonb;
  v_manifest jsonb := '[]'::jsonb;
  v_global_parts text := '';
  v_fingerprint text;
  v_size_bytes bigint;
  v_global_checksum text;
  -- iteration
  v_rec record;
  v_table_data jsonb;
  v_count integer;
  v_checksum text;
  -- existing local
  v_existing record;
  v_existing_valid boolean;
  v_action_taken text;
  -- local recalc
  v_local_checksums jsonb;
  v_local_global_parts text;
  v_local_global_checksum text;
  v_local_table_data jsonb;
  v_local_checksum text;
BEGIN
  -- 1. Lock transfer
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

  -- 2. Parse
  BEGIN
    v_doc := p_document_text::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Invalid JSON document: %', SQLERRM;
  END;

  -- 3. Core fields
  v_doc_tenant_id := (v_doc->>'tenant_id')::uuid;
  v_doc_backup_id := (v_doc->>'backup_id')::uuid;
  v_doc_format_version := COALESCE((v_doc->>'format_version')::integer, 0);
  v_doc_ser_version := v_doc->>'serialization_version';

  IF v_doc_format_version != 2 THEN
    RAISE EXCEPTION 'UNSUPPORTED_FORMAT: document format_version=%, only 2 accepted', v_doc_format_version;
  END IF;
  IF v_doc_tenant_id IS NULL OR v_doc_tenant_id != v_transfer.tenant_id THEN
    RAISE EXCEPTION 'Document tenant_id (%) != transfer tenant_id (%)', v_doc_tenant_id, v_transfer.tenant_id;
  END IF;
  IF v_doc_backup_id IS NULL OR v_doc_backup_id != v_transfer.source_backup_id THEN
    RAISE EXCEPTION 'Document backup_id (%) != transfer source_backup_id (%)', v_doc_backup_id, v_transfer.source_backup_id;
  END IF;

  v_payload := v_doc->'payload';
  IF v_payload IS NULL OR jsonb_typeof(v_payload) != 'object' THEN
    RAISE EXCEPTION 'Document payload is missing or not an object';
  END IF;

  -- 4. Serialization version gate
  IF v_doc_ser_version IS NULL THEN
    v_is_legacy := true;
  ELSIF v_doc_ser_version = 'postgres-jsonb-text-v1' THEN
    v_is_legacy := false;
  ELSE
    RAISE EXCEPTION 'UNSUPPORTED_SERIALIZATION_VERSION: "%"', v_doc_ser_version;
  END IF;

  -- 5. Recalculate all metadata from remote payload
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
      'table', v_rec.table_name, 'order', v_rec.restore_order, 'rows', v_count, 'checksum', v_checksum
    ));
    v_global_parts := v_global_parts || v_checksum;
  END LOOP;

  v_global_checksum := encode(extensions.digest(v_global_parts, 'sha256'), 'hex');
  v_size_bytes := octet_length(v_payload::text);

  -- 6. Validate remote document checksums (non-legacy only)
  IF NOT v_is_legacy THEN
    IF v_doc->'checksums' IS NULL OR jsonb_typeof(v_doc->'checksums') != 'object' THEN
      RAISE EXCEPTION 'REMOTE_DOCUMENT_CHECKSUM_MISMATCH: document.checksums is missing or not an object';
    END IF;
    -- Full JSONB equality
    IF (v_doc->'checksums') IS DISTINCT FROM v_checksums THEN
      RAISE EXCEPTION 'REMOTE_DOCUMENT_CHECKSUM_MISMATCH: document.checksums object != recalculated';
    END IF;
    IF (v_doc->>'global_checksum') IS DISTINCT FROM v_global_checksum THEN
      RAISE EXCEPTION 'REMOTE_DOCUMENT_CHECKSUM_MISMATCH: global_checksum document=% recalculated=%',
        coalesce(v_doc->>'global_checksum', 'NULL'), v_global_checksum;
    END IF;
  END IF;

  -- 7. Check existing local backup
  SELECT id, status, tenant_id, payload, checksums, global_checksum
  INTO v_existing
  FROM tenant_backups
  WHERE id = v_doc_backup_id;

  IF v_existing IS NOT NULL THEN
    IF v_existing.tenant_id IS DISTINCT FROM v_doc_tenant_id THEN
      RAISE EXCEPTION 'Existing backup tenant_id (%) != document (%)', v_existing.tenant_id, v_doc_tenant_id;
    END IF;

    v_existing_valid := false;

    IF v_existing.status = 'verified'
       AND v_existing.payload IS NOT NULL
       AND jsonb_typeof(v_existing.payload) = 'object'
    THEN
      -- Recalculate checksums from LOCAL payload
      v_local_checksums := '{}'::jsonb;
      v_local_global_parts := '';

      FOR v_rec IN
        SELECT r.table_name, r.restore_order
        FROM _br_table_registry r
        WHERE r.tenant_link != 'excluded'
        ORDER BY r.restore_order, r.table_name
      LOOP
        v_local_table_data := v_existing.payload->v_rec.table_name;
        IF v_local_table_data IS NULL OR jsonb_typeof(v_local_table_data) != 'array' THEN
          v_local_table_data := '[]'::jsonb;
        END IF;

        v_local_checksum := encode(
          extensions.digest(
            coalesce(
              (SELECT string_agg(j::text, '' ORDER BY j::text)
               FROM jsonb_array_elements(v_local_table_data) AS j),
              ''
            ),
            'sha256'
          ),
          'hex'
        );

        v_local_checksums := v_local_checksums || jsonb_build_object(v_rec.table_name, v_local_checksum);
        v_local_global_parts := v_local_global_parts || v_local_checksum;
      END LOOP;

      v_local_global_checksum := encode(extensions.digest(v_local_global_parts, 'sha256'), 'hex');

      -- ALL SIX conditions must hold for relinked:
      --   1. status = verified (checked above)
      --   2. same tenant (checked above)
      --   3. stored global_checksum = recalculated local global
      --   4. stored checksums JSONB = recalculated local checksums JSONB
      --   5. local global = remote global
      --   6. local checksums JSONB = remote checksums JSONB
      IF  v_existing.global_checksum IS NOT DISTINCT FROM v_local_global_checksum
          AND v_existing.checksums IS NOT DISTINCT FROM v_local_checksums
          AND v_local_global_checksum IS NOT DISTINCT FROM v_global_checksum
          AND v_local_checksums IS NOT DISTINCT FROM v_checksums
      THEN
        v_existing_valid := true;
      END IF;
    END IF;

    IF v_existing_valid THEN
      v_action_taken := 'relinked';
    ELSE
      UPDATE tenant_backups SET
        payload = v_payload,
        format_version = 2,
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
    -- 8. Insert new
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
      2,
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

  -- 9. Relink
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
GRANT EXECUTE ON FUNCTION _br_rehydrate_offsite_backup(uuid, text) TO service_role;
