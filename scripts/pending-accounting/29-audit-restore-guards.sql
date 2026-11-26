-- Audit hardening. Apply only after 12–28 and in a validated test environment.
-- Preserve the existing destructive-operation lock; this is only an additional preflight check.
CREATE OR REPLACE FUNCTION public.br_preflight_restore(p_backup_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid;
v_backup record;
v_activation record;
v_issues jsonb := '[]'::jsonb;
v_rec record;
v_current_cols text[];
v_backup_cols text[];
v_extra_cols text[];
v_missing_notnull text[];
v_generated_cols text[];
v_recomputed text;
v_table_data jsonb;
v_has_fatal boolean := false;
v_has_accounting_rows boolean;
BEGIN
PERFORM public._br_assert_backup_admin(public.current_tenant_id());
IF NOT EXISTS (SELECT 1 FROM public.tenant_backups tb WHERE tb.id = p_backup_id AND tb.tenant_id = public.current_tenant_id()) THEN
  RAISE EXCEPTION 'BR-404: Sauvegarde introuvable' USING ERRCODE = 'P0002';
END IF;
SELECT p.tenant_id INTO v_tenant_id FROM profiles p WHERE p.id = auth.uid();
IF v_tenant_id IS NULL THEN
RAISE EXCEPTION 'BR-001: No tenant context';
END IF;

SELECT * INTO v_backup FROM tenant_backups WHERE id = p_backup_id;
IF NOT FOUND THEN
RETURN jsonb_build_object('viable', false, 'issues', jsonb_build_array(
jsonb_build_object('code', 'BACKUP_NOT_FOUND', 'severity', 'fatal',
'message', 'Backup does not exist')
));
END IF;

IF v_backup.tenant_id != v_tenant_id THEN
v_issues := v_issues || jsonb_build_array(jsonb_build_object(
'code', 'TENANT_MISMATCH', 'severity', 'fatal',
'message', 'Backup belongs to a different tenant'));
END IF;

SELECT * INTO v_activation FROM _br_tenant_activation WHERE tenant_id = v_tenant_id;
IF NOT FOUND OR NOT v_activation.enabled THEN
v_issues := v_issues || jsonb_build_array(jsonb_build_object(
'code', 'ACTIVATION_LOCKED', 'severity', 'fatal',
'message', 'Destructive operations are not activated for this tenant'));
END IF;

IF coalesce(v_backup.format_version, 1) < 2 THEN
v_issues := v_issues || jsonb_build_array(jsonb_build_object(
'code', 'LEGACY_FORMAT', 'severity', 'fatal',
'message', 'Backup is legacy format (v1). Cannot restore through v2 system.'));
END IF;

IF v_backup.status IS DISTINCT FROM 'verified'::br_backup_status THEN
v_issues := v_issues || jsonb_build_array(jsonb_build_object(
'code', 'INVALID_STATUS', 'severity', 'fatal',
'message', format('Backup status is %s, expected verified', v_backup.status)));
END IF;

FOR v_rec IN
SELECT r.table_name
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded' AND r.is_mandatory
AND NOT (v_backup.payload ? r.table_name)
AND EXISTS (
SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = r.table_name AND c.relkind = 'r'
)
LOOP
v_issues := v_issues || jsonb_build_array(jsonb_build_object(
'code', 'MISSING_TABLE', 'severity', 'warning',
'table', v_rec.table_name,
'message', format('Table %s not found in backup data', v_rec.table_name)));
END LOOP;

FOR v_rec IN
SELECT r.table_name, r.schema_name
FROM _br_table_registry r
WHERE r.tenant_link != 'excluded'
AND (v_backup.payload ? r.table_name)
AND jsonb_array_length(coalesce(v_backup.payload->r.table_name, '[]'::jsonb)) > 0
ORDER BY r.restore_order
LOOP
-- Get non-generated columns only for comparison
SELECT array_agg(a.attname::text ORDER BY a.attname)
INTO v_current_cols
FROM pg_attribute a
WHERE a.attrelid = (v_rec.schema_name || '.' || v_rec.table_name)::regclass
AND a.attnum > 0 AND NOT a.attisdropped;

-- Collect generated columns for exclusion from NOT NULL check
SELECT array_agg(a.attname::text)
INTO v_generated_cols
FROM pg_attribute a
WHERE a.attrelid = (v_rec.schema_name || '.' || v_rec.table_name)::regclass
AND a.attnum > 0 AND NOT a.attisdropped
AND a.attgenerated <> '';

v_table_data := v_backup.payload->v_rec.table_name;

SELECT array_agg(k ORDER BY k)
INTO v_backup_cols
FROM jsonb_object_keys(v_table_data->0) AS k;

SELECT array_agg(bc)
INTO v_extra_cols
FROM unnest(v_backup_cols) AS bc
WHERE bc != ALL(v_current_cols);

IF v_extra_cols IS NOT NULL AND array_length(v_extra_cols, 1) > 0 THEN
v_issues := v_issues || jsonb_build_array(jsonb_build_object(
'code', 'EXTRA_COLUMNS', 'severity', 'warning',
'table', v_rec.table_name,
'columns', to_jsonb(v_extra_cols),
'message', format('Backup has columns not in current schema: %s', array_to_string(v_extra_cols, ', '))));
END IF;

-- NOT NULL without default check — exclude generated columns
SELECT array_agg(a.attname::text)
INTO v_missing_notnull
FROM pg_attribute a
WHERE a.attrelid = (v_rec.schema_name || '.' || v_rec.table_name)::regclass
AND a.attnum > 0 AND NOT a.attisdropped
AND a.attnotnull
AND a.attgenerated = ''
AND NOT EXISTS (SELECT 1 FROM pg_attrdef d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum)
AND a.attname::text != ALL(v_backup_cols);

IF v_missing_notnull IS NOT NULL AND array_length(v_missing_notnull, 1) > 0 THEN
v_issues := v_issues || jsonb_build_array(jsonb_build_object(
'code', 'NOT_NULL_NO_DEFAULT', 'severity', 'fatal',
'table', v_rec.table_name,
'columns', to_jsonb(v_missing_notnull),
'message', format('NOT NULL columns without defaults missing from backup: %s', array_to_string(v_missing_notnull, ', '))));
END IF;

IF v_backup.checksums ? v_rec.table_name THEN
v_recomputed := encode(
extensions.digest(
coalesce((SELECT string_agg(j::text, '' ORDER BY j::text)
FROM jsonb_array_elements(v_table_data) AS j), ''),
'sha256'
),
'hex'
);
IF v_recomputed != (v_backup.checksums->>v_rec.table_name) THEN
v_issues := v_issues || jsonb_build_array(jsonb_build_object(
'code', 'CHECKSUM_MISMATCH', 'severity', 'fatal',
'table', v_rec.table_name,
'message', 'Stored checksum does not match — data may be corrupted'));
END IF;
END IF;
END LOOP;

-- An old archive must never silently erase a newly introduced accounting table.
FOR v_rec IN SELECT r.schema_name,r.table_name,r.tenant_id_column FROM public._br_table_registry r
 WHERE r.schema_name='public' AND r.tenant_link='direct'
 AND r.table_name IN ('accounting_journal_settings','accounting_entry_templates','accounting_template_occurrences','accounting_line_due_dates','accounting_cycle_reviews','accounting_fixed_assets','accounting_asset_depreciations','accounting_analytic_axes','accounting_analytic_centers','accounting_analytic_budgets','accounting_analytic_allocations')
 AND to_regclass(format('%I.%I',r.schema_name,r.table_name)) IS NOT NULL
 AND jsonb_typeof(v_backup.payload->r.table_name) IS DISTINCT FROM 'array'
LOOP
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',v_rec.schema_name,v_rec.table_name,v_rec.tenant_id_column)
 INTO v_has_accounting_rows USING v_tenant_id;
 IF v_has_accounting_rows THEN
  v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','ACCOUNTING_TABLE_MISSING','severity','fatal','table',v_rec.table_name,
  'message','Sauvegarde incompatible : données comptables existantes absentes du fichier.'));
 END IF;
END LOOP;

SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;

RETURN jsonb_build_object(
'viable', NOT v_has_fatal,
'backup_id', p_backup_id,
'format_version', v_backup.format_version,
'issues', v_issues,
'issue_count', jsonb_array_length(v_issues),
'checked_at', now()
);
END;
$function$;
REVOKE ALL ON FUNCTION public.br_preflight_restore(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.br_preflight_restore(uuid) TO authenticated;
-- Export is a private accounting endpoint. Its existing in-function authentication remains in force.
REVOKE ALL ON FUNCTION public.export_accounting_entries(uuid,date,date,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.export_accounting_entries(uuid,date,date,text,integer,integer) TO authenticated;
