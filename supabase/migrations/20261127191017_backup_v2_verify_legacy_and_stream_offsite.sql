-- Validate old extended V2 archives with their original algorithm before
-- producing a canonical SHA-256 document for the existing offsite format.
CREATE OR REPLACE FUNCTION public._br_archive_table_sha256(p_rows jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path = ''
AS $$
  SELECT encode(sha256(convert_to(
    coalesce(string_agg(row_data::text, '' ORDER BY row_data::text), ''), 'UTF8'
  )), 'hex')
  FROM jsonb_array_elements(p_rows) row_data
$$;

CREATE OR REPLACE FUNCTION public._br_archive_legacy_md5(p_schema text, p_table text, p_rows jsonb)
RETURNS text LANGUAGE plpgsql STABLE STRICT SET search_path = '' SET timezone = 'UTC'
AS $$
DECLARE
  archived_keys jsonb := p_rows->0;
  columns_sql text;
  available_columns integer;
  archive_columns integer;
  ordering text;
  checksum text;
  rows_match boolean;
BEGIN
  IF jsonb_array_length(p_rows) = 0 THEN RETURN ''; END IF;

  SELECT string_agg(format('typed.%I', a.attname), ', ' ORDER BY a.attnum), count(*)
  INTO columns_sql, available_columns
  FROM pg_catalog.pg_attribute a
  JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = p_schema AND c.relname = p_table
    AND a.attnum > 0 AND NOT a.attisdropped AND archived_keys ? a.attname;
  SELECT count(*) INTO archive_columns FROM jsonb_object_keys(archived_keys);
  IF available_columns <> archive_columns OR columns_sql IS NULL THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: legacy columns cannot be verified for %', p_table;
  END IF;

  ordering := CASE WHEN archived_keys ? 'id' THEN 'original.id::text' ELSE 'row_to_json(original)::text' END;
  EXECUTE format(
    'SELECT md5(string_agg(md5(row_to_json(original)::text), '''' ORDER BY %s)),
       bool_and(row_to_json(original)::jsonb = archived.row_data)
     FROM jsonb_array_elements($1) archived(row_data)
     CROSS JOIN LATERAL jsonb_populate_record(NULL::%I.%I, archived.row_data) typed
     CROSS JOIN LATERAL (SELECT %s) original',
    ordering, p_schema, p_table, columns_sql
  ) INTO checksum, rows_match USING p_rows;
  IF rows_match IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: legacy rows cannot be represented exactly for %', p_table;
  END IF;
  RETURN checksum;
END;
$$;

CREATE OR REPLACE FUNCTION public._br_export_offsite_document_text(p_backup_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
SET statement_timeout = '120s' SET work_mem = '16MB'
AS $$
DECLARE
  backup public.tenant_backups;
  item record;
  rows_data jsonb;
  checksum text;
  computed_checksums jsonb := '{}'::jsonb;
  legacy_checksums jsonb := '{}'::jsonb;
  manifest jsonb := '[]'::jsonb;
  parts text := '';
  legacy_parts text := '';
  global_sha text;
  legacy boolean;
BEGIN
  SELECT b.* INTO backup FROM public.tenant_backups b WHERE b.id = p_backup_id;
  IF NOT FOUND OR backup.status IS DISTINCT FROM 'verified'::public.br_backup_status THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: backup unavailable or not verified';
  END IF;
  IF backup.format_version IS DISTINCT FROM 2 OR jsonb_typeof(backup.payload) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: invalid V2 archive';
  END IF;

  legacy := coalesce(backup.global_checksum ~ '^[0-9a-f]{32}$', false);
  FOR item IN
    SELECT r.schema_name, r.table_name, r.restore_order
    FROM public._br_table_registry r
    WHERE r.tenant_link <> 'excluded'
    ORDER BY r.restore_order, r.table_name
  LOOP
    rows_data := backup.payload->item.table_name;
    IF jsonb_typeof(rows_data) IS DISTINCT FROM 'array' THEN
      IF legacy THEN RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: missing legacy table %', item.table_name; END IF;
      rows_data := '[]'::jsonb;
    END IF;
    IF legacy THEN
      IF jsonb_array_length(rows_data) IS DISTINCT FROM (backup.row_counts->>item.table_name)::integer THEN
        RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: legacy row count mismatch for %', item.table_name;
      END IF;
      checksum := public._br_archive_legacy_md5(item.schema_name, item.table_name, rows_data);
      IF checksum IS DISTINCT FROM backup.checksums->>item.table_name THEN
        RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: legacy checksum mismatch for %', item.table_name;
      END IF;
      legacy_checksums := legacy_checksums || jsonb_build_object(item.table_name, checksum);
      legacy_parts := legacy_parts || checksum;
    END IF;
    checksum := public._br_archive_table_sha256(rows_data);
    computed_checksums := computed_checksums || jsonb_build_object(item.table_name, checksum);
    parts := parts || checksum;
    manifest := manifest || jsonb_build_array(jsonb_build_object(
      'table', item.table_name, 'order', item.restore_order,
      'rows', jsonb_array_length(rows_data), 'checksum', checksum
    ));
  END LOOP;

  IF EXISTS (SELECT 1 FROM jsonb_object_keys(backup.payload) archived_table
             WHERE NOT computed_checksums ? archived_table) THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: archive contains an unverified table';
  END IF;

  global_sha := encode(sha256(convert_to(parts, 'UTF8')), 'hex');
  IF legacy THEN
    IF legacy_checksums IS DISTINCT FROM backup.checksums
       OR md5(legacy_parts) IS DISTINCT FROM backup.global_checksum THEN
      RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: legacy archive manifest mismatch';
    END IF;
  ELSIF computed_checksums IS DISTINCT FROM backup.checksums
        OR global_sha IS DISTINCT FROM backup.global_checksum THEN
    RAISE EXCEPTION 'EXPORT_INTEGRITY_FAIL: stored checksum does not match archived payload';
  END IF;

  RETURN jsonb_build_object(
    'serialization_version', 'postgres-jsonb-text-v1',
    'backup_id', backup.id, 'tenant_id', backup.tenant_id, 'format_version', 2,
    'created_at', backup.created_at, 'verified_at', backup.verified_at,
    'label', backup.label, 'kind', backup.kind, 'is_auto', backup.is_auto,
    'size_bytes', backup.size_bytes, 'schema_fingerprint', backup.schema_fingerprint,
    'payload', backup.payload, 'row_counts', backup.row_counts,
    'checksums', computed_checksums, 'global_checksum', global_sha,
    'manifest', CASE WHEN legacy THEN manifest ELSE backup.manifest END
  )::text;
END;
$$;

DO $media$
BEGIN
  IF to_regtype('public."application/octet-stream"') IS NULL THEN
    CREATE DOMAIN public."application/octet-stream" AS bytea;
  END IF;
END;
$media$;

-- Return raw UTF-8 so a large document can be compressed as a stream in Edge.
CREATE OR REPLACE FUNCTION public._br_export_offsite_document_raw(p_backup_id uuid)
RETURNS public."application/octet-stream" LANGUAGE sql SECURITY DEFINER
SET search_path = '' SET statement_timeout = '120s'
AS $$
  SELECT convert_to(public._br_export_offsite_document_text(p_backup_id), 'UTF8')::public."application/octet-stream"
$$;

-- PostgREST accepts a raw request for a function with one unnamed text argument.
-- Read the transfer id from the trusted server request header.
CREATE OR REPLACE FUNCTION public._br_rehydrate_offsite_document_raw(text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER
SET search_path = '' SET statement_timeout = '120s'
AS $$
  SELECT public._br_rehydrate_offsite_backup(
    (current_setting('request.headers', true)::jsonb->>'x-waarwi-transfer-id')::uuid, $1
  )
$$;

REVOKE ALL ON FUNCTION public._br_archive_table_sha256(jsonb), public._br_archive_legacy_md5(text,text,jsonb),
  public._br_export_offsite_document_text(uuid), public._br_export_offsite_document_raw(uuid),
  public._br_rehydrate_offsite_document_raw(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._br_export_offsite_document_text(uuid), public._br_export_offsite_document_raw(uuid),
  public._br_rehydrate_offsite_document_raw(text) TO service_role;


-- Newly created extended backups use the same checksum as the regular V2 path.
CREATE OR REPLACE FUNCTION public._br_create_backup_for_tenant_extended(
  p_tenant_id uuid,
  p_label text DEFAULT '',
  p_kind text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '300s'
SET work_mem = '64MB'
AS $$
DECLARE
  v_backup_id     uuid;
  v_drift         jsonb;
  v_fingerprint   text;
  v_rec           record;
  v_table_exists  boolean;
  v_has_id        boolean;
  v_table_data_text text;
  v_table_data jsonb;
  v_count         integer;
  v_checksum      text;
  v_payload       jsonb;
  v_row_counts    jsonb;
  v_checksums     jsonb;
  v_manifest      jsonb;
  v_global_hash   text;
  v_size_bytes    integer;
  v_table_count   bigint;
  v_total_rows    bigint;
  v_stage         text := 'init';
  v_current_table text := '';
BEGIN
  -- Validate tenant
  v_stage := 'validate_tenant';
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'BR-001: No tenant_id provided';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = p_tenant_id) THEN
    RAISE EXCEPTION 'BR-001: Tenant % does not exist', p_tenant_id;
  END IF;

  -- Schema drift check
  v_stage := 'schema_drift';
  v_drift := br_check_schema_drift();
  IF (v_drift->>'drift_detected')::boolean THEN
    RAISE EXCEPTION 'BR-002: Schema drift detected. Unregistered: %, Missing: %',
      v_drift->>'unregistered_tables', v_drift->>'missing_tables';
  END IF;

  -- Create backup row
  v_stage := 'create_backup_row';
  INSERT INTO tenant_backups (tenant_id, created_by, label, kind, is_auto, format_version, status)
  VALUES (
    p_tenant_id, NULL, COALESCE(NULLIF(p_label, ''), 'Sauvegarde'),
    p_kind, (p_kind = 'auto'), 2, 'creating'::br_backup_status
  )
  RETURNING id INTO v_backup_id;

  -- Schema fingerprint
  v_stage := 'fingerprint';
  SELECT md5(string_agg(table_name || ':' || restore_order::text, ',' ORDER BY table_name))
  INTO v_fingerprint
  FROM _br_table_registry
  WHERE tenant_link != 'excluded';

  -- Materialize each archived table once before computing its checksum.
  v_stage := 'create_temp';
  CREATE TEMPORARY TABLE _br_ext_work (
    schema_name   text    NOT NULL,
    table_name    text    NOT NULL,
    restore_order integer NOT NULL,
    table_data    jsonb   NOT NULL DEFAULT '[]'::jsonb,
    row_count     integer NOT NULL DEFAULT 0,
    checksum      text    NOT NULL DEFAULT ''
  ) ON COMMIT DROP;

  -- Loop through registry
  v_stage := 'loop';
  FOR v_rec IN
    SELECT r.schema_name, r.table_name, r.tenant_link, r.tenant_id_column,
           r.parent_table, r.restore_order
    FROM _br_table_registry r
    WHERE r.tenant_link != 'excluded'
    ORDER BY r.restore_order, r.table_name
  LOOP
    v_current_table := v_rec.schema_name || '.' || v_rec.table_name;

    SELECT EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = v_rec.schema_name AND c.relname = v_rec.table_name AND c.relkind = 'r'
    ) INTO v_table_exists;

    IF NOT v_table_exists THEN
      CONTINUE;
    END IF;

    -- Check if this table has an 'id' column
    SELECT EXISTS (
      SELECT 1 FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = v_rec.schema_name
        AND c.relname = v_rec.table_name
        AND a.attname = 'id'
        AND a.attnum > 0
        AND NOT a.attisdropped
    ) INTO v_has_id;

    v_table_data_text := '[]';
    v_count := 0;

    -- Extract the archived rows once.
    IF v_rec.tenant_link = 'direct' THEN
      IF v_has_id THEN
        EXECUTE format(
          'SELECT
             ''['' || coalesce(string_agg(row_to_json(t.*)::text, '','' ORDER BY t.id), '''') || '']'',
             count(*)::integer
           FROM %I.%I t WHERE t.%I = $1',
          v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
        ) INTO v_table_data_text, v_count USING p_tenant_id;
      ELSE
        EXECUTE format(
          'SELECT
             ''['' || coalesce(string_agg(row_to_json(t.*)::text, '',''), '''') || '']'',
             count(*)::integer
           FROM %I.%I t WHERE t.%I = $1',
          v_rec.schema_name, v_rec.table_name, v_rec.tenant_id_column
        ) INTO v_table_data_text, v_count USING p_tenant_id;
      END IF;

    ELSIF v_rec.tenant_link = 'indirect' THEN
      IF v_has_id THEN
        EXECUTE format(
          'SELECT
             ''['' || coalesce(string_agg(row_to_json(c.*)::text, '','' ORDER BY c.id), '''') || '']'',
             count(*)::integer
           FROM %I.%I c
           JOIN %I.%I p ON p.id = c.wholesaler_id
           WHERE p.tenant_id = $1',
          v_rec.schema_name, v_rec.table_name,
          v_rec.schema_name, v_rec.parent_table
        ) INTO v_table_data_text, v_count USING p_tenant_id;
      ELSE
        EXECUTE format(
          'SELECT
             ''['' || coalesce(string_agg(row_to_json(c.*)::text, '',''), '''') || '']'',
             count(*)::integer
           FROM %I.%I c
           JOIN %I.%I p ON p.id = c.wholesaler_id
           WHERE p.tenant_id = $1',
          v_rec.schema_name, v_rec.table_name,
          v_rec.schema_name, v_rec.parent_table
        ) INTO v_table_data_text, v_count USING p_tenant_id;
      END IF;
    END IF;

    -- Hash the same rows that become the payload.
    v_table_data := coalesce(v_table_data_text, '[]')::jsonb;
    v_checksum := public._br_archive_table_sha256(v_table_data);

    INSERT INTO _br_ext_work (schema_name, table_name, restore_order, table_data, row_count, checksum)
    VALUES (v_rec.schema_name, v_rec.table_name, v_rec.restore_order,
            v_table_data, coalesce(v_count, 0), v_checksum);
  END LOOP;

  -- Assemble the V2 payload and its SHA-256 manifest.
  v_stage := 'aggregate';
  v_current_table := '';

  SELECT
    jsonb_object_agg(w.table_name, w.table_data),
    jsonb_object_agg(w.table_name, w.row_count),
    jsonb_object_agg(w.table_name, w.checksum),
    jsonb_agg(
      jsonb_build_object(
        'table', w.table_name,
        'order', w.restore_order,
        'rows', w.row_count,
        'checksum', w.checksum
      ) ORDER BY w.restore_order, w.table_name
    ),
    encode(sha256(convert_to(string_agg(w.checksum, '' ORDER BY w.restore_order, w.table_name), 'UTF8')), 'hex'),
    count(*)::bigint,
    coalesce(sum(w.row_count), 0)::bigint
  INTO v_payload, v_row_counts, v_checksums, v_manifest, v_global_hash, v_table_count, v_total_rows
  FROM _br_ext_work w;

  -- Compute size
  v_stage := 'size';
  v_size_bytes := octet_length(v_payload::text);

  -- Update backup row
  v_stage := 'update_backup';
  UPDATE tenant_backups SET
    payload           = v_payload,
    format_version    = 2,
    schema_fingerprint = v_fingerprint,
    manifest          = v_manifest,
    row_counts        = v_row_counts,
    checksums         = v_checksums,
    global_checksum   = v_global_hash,
    size_bytes        = v_size_bytes,
    status            = 'verified'::br_backup_status,
    verified_at       = now()
  WHERE id = v_backup_id;

  v_stage := 'return';
  RETURN jsonb_build_object(
    'success', true,
    'backup_id', v_backup_id,
    'format_version', 2,
    'table_count', v_table_count,
    'total_rows', v_total_rows,
    'row_counts', v_row_counts,
    'global_checksum', v_global_hash,
    'size_bytes', v_size_bytes,
    'created_at', now()
  );

EXCEPTION WHEN others THEN
  IF v_backup_id IS NOT NULL THEN
    UPDATE tenant_backups SET
      status = 'failed'::br_backup_status,
      error_message = format('[BR-EXT][stage=%s][table=%s] %s', v_stage, v_current_table, SQLERRM)
    WHERE id = v_backup_id;
  END IF;
  RAISE EXCEPTION '%', format('[BR-EXT][stage=%s][table=%s] %s', v_stage, v_current_table, SQLERRM)
    USING ERRCODE = SQLSTATE;
END;
$$;
