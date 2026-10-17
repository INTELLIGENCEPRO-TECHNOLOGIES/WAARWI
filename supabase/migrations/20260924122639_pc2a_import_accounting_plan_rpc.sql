/*
# PC2A — Import/export du plan comptable opérationnel

1. New Functions
   - `import_accounting_plan(p_tenant_id uuid, p_rows jsonb, p_dry_run boolean)` — SECURITY DEFINER RPC
     - Validates and imports accounting plan rows (code + name) into the `accounts` table
     - p_rows: JSON array of {code, name} objects
     - p_dry_run=true: validates without writing anything
     - p_dry_run=false: repeats all validations then writes atomically
     - Returns JSON: {success, dry_run, total, created, renamed, unchanged, errors, rows}

2. Security
   - SECURITY DEFINER with search_path = public
   - REVOKE from PUBLIC and anon
   - GRANT EXECUTE to authenticated and service_role only
   - Guards: auth.uid(), current_tenant_id(), current_user_can_manage_accounting()

3. Business Rules
   - Code must be exactly 7 digits, class 1-8
   - Name required, trimmed, max 200 chars
   - Duplicate codes within the import file are rejected
   - New valid code → INSERT with account_type='general', is_active=true
   - Existing general account, same name → 'unchanged'
   - Existing general account, different name → UPDATE name only ('renamed')
   - Existing auxiliary account → if same name 'unchanged', else error
   - Any error → entire import rolled back (atomic)
   - Idempotent: re-import produces no duplicates

4. Audit
   - On successful real import, inserts one audit_logs row with action='accounting_plan_import'

5. Important Notes
   - Does NOT delete, deactivate, or change code/class/type of existing accounts
   - Does NOT touch accounting_account_mappings, journal_entries, journal_lines
   - Does NOT modify auxiliary accounts (customers/suppliers)
   - Does NOT modify save_accounting_account or its privileges
*/

CREATE OR REPLACE FUNCTION public.import_accounting_plan(
  p_tenant_id uuid,
  p_rows jsonb,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $fn$
DECLARE
  v_uid         uuid;
  v_row         jsonb;
  v_idx         int := 0;
  v_code        text;
  v_name        text;
  v_class       int;
  v_existing    record;
  v_status      text;
  v_err         text;
  v_results     jsonb := '[]'::jsonb;
  v_created     int := 0;
  v_renamed     int := 0;
  v_unchanged   int := 0;
  v_error_count int := 0;
  v_total       int;
  v_seen_codes  text[] := '{}';
  v_has_errors  boolean := false;
BEGIN
  -- ──── AUTH GUARDS ────
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'errors', jsonb_build_array(
      jsonb_build_object('line', 0, 'error', 'Utilisateur non authentifié')
    ));
  END IF;

  IF current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RETURN jsonb_build_object('success', false, 'errors', jsonb_build_array(
      jsonb_build_object('line', 0, 'error', 'Accès refusé au tenant demandé')
    ));
  END IF;

  IF NOT current_user_can_manage_accounting() THEN
    RETURN jsonb_build_object('success', false, 'errors', jsonb_build_array(
      jsonb_build_object('line', 0, 'error', 'Permission manage_accounting requise')
    ));
  END IF;

  -- ──── INPUT VALIDATION ────
  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RETURN jsonb_build_object('success', false, 'errors', jsonb_build_array(
      jsonb_build_object('line', 0, 'error', 'Aucune ligne à importer')
    ));
  END IF;

  v_total := jsonb_array_length(p_rows);

  IF v_total > 5000 THEN
    RETURN jsonb_build_object('success', false, 'errors', jsonb_build_array(
      jsonb_build_object('line', 0, 'error', 'Maximum 5000 lignes (reçu: ' || v_total || ')')
    ));
  END IF;

  -- ──── VALIDATION PASS ────
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows)
  LOOP
    v_idx := v_idx + 1;
    v_code := trim(v_row ->> 'code');
    v_name := trim(v_row ->> 'name');
    v_status := null;
    v_err := null;

    -- Validate code format
    IF v_code IS NULL OR v_code = '' THEN
      v_err := 'Code manquant';
    ELSIF length(v_code) != 7 OR v_code !~ '^\d{7}$' THEN
      v_err := 'Le code doit contenir exactement 7 chiffres';
    ELSE
      v_class := (left(v_code, 1))::int;
      IF v_class < 1 OR v_class > 8 THEN
        v_err := 'Classe invalide (premier chiffre doit être entre 1 et 8)';
      END IF;
    END IF;

    -- Validate name
    IF v_err IS NULL THEN
      IF v_name IS NULL OR v_name = '' THEN
        v_err := 'Intitulé manquant';
      ELSIF length(v_name) > 200 THEN
        v_err := 'Intitulé trop long (max 200 caractères)';
      END IF;
    END IF;

    -- Check duplicate within file
    IF v_err IS NULL THEN
      IF v_code = ANY(v_seen_codes) THEN
        v_err := 'Code dupliqué dans le fichier';
      ELSE
        v_seen_codes := array_append(v_seen_codes, v_code);
      END IF;
    END IF;

    -- Check against existing accounts
    IF v_err IS NULL THEN
      SELECT id, code, name, account_type, is_active
        INTO v_existing
        FROM accounts
       WHERE tenant_id = p_tenant_id AND code = v_code;

      IF FOUND THEN
        IF v_existing.account_type != 'general' THEN
          -- Auxiliary account
          IF trim(v_existing.name) = v_name THEN
            v_status := 'unchanged';
          ELSE
            v_err := 'Compte auxiliaire existant — modification interdite';
          END IF;
        ELSE
          -- General account
          IF trim(v_existing.name) = v_name THEN
            v_status := 'unchanged';
          ELSE
            v_status := 'renamed';
          END IF;
        END IF;
      ELSE
        v_status := 'created';
      END IF;
    END IF;

    IF v_err IS NOT NULL THEN
      v_has_errors := true;
      v_error_count := v_error_count + 1;
      v_results := v_results || jsonb_build_object(
        'line', v_idx, 'code', coalesce(v_code, ''), 'name', coalesce(v_name, ''),
        'status', 'error', 'error', v_err
      );
    ELSE
      CASE v_status
        WHEN 'created'   THEN v_created   := v_created + 1;
        WHEN 'renamed'   THEN v_renamed   := v_renamed + 1;
        WHEN 'unchanged' THEN v_unchanged := v_unchanged + 1;
      END CASE;
      v_results := v_results || jsonb_build_object(
        'line', v_idx, 'code', v_code, 'name', v_name, 'status', v_status
      );
    END IF;
  END LOOP;

  -- ──── DRY RUN → return preview ────
  IF p_dry_run THEN
    RETURN jsonb_build_object(
      'success', NOT v_has_errors,
      'dry_run', true,
      'total', v_total,
      'created', v_created,
      'renamed', v_renamed,
      'unchanged', v_unchanged,
      'error_count', v_error_count,
      'rows', v_results
    );
  END IF;

  -- ──── REAL IMPORT → abort on any error ────
  IF v_has_errors THEN
    RETURN jsonb_build_object(
      'success', false,
      'dry_run', false,
      'total', v_total,
      'created', 0,
      'renamed', 0,
      'unchanged', v_unchanged,
      'error_count', v_error_count,
      'rows', v_results
    );
  END IF;

  -- ──── APPLY CHANGES ────
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_results)
  LOOP
    v_code   := v_row ->> 'code';
    v_name   := v_row ->> 'name';
    v_status := v_row ->> 'status';

    IF v_status = 'created' THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
      VALUES (p_tenant_id, v_code, v_name, (left(v_code, 1))::int, 'general', true);

    ELSIF v_status = 'renamed' THEN
      UPDATE accounts SET name = v_name
       WHERE tenant_id = p_tenant_id AND code = v_code AND account_type = 'general';
    END IF;
    -- 'unchanged' → no-op
  END LOOP;

  -- ──── AUDIT LOG ────
  INSERT INTO audit_logs (tenant_id, user_id, action, module, new_value)
  VALUES (
    p_tenant_id,
    v_uid,
    'accounting_plan_import',
    'accounting',
    jsonb_build_object(
      'total', v_total,
      'created', v_created,
      'renamed', v_renamed,
      'unchanged', v_unchanged
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'dry_run', false,
    'total', v_total,
    'created', v_created,
    'renamed', v_renamed,
    'unchanged', v_unchanged,
    'error_count', 0,
    'rows', v_results
  );
END;
$fn$;

-- Security: revoke from PUBLIC and anon, grant to authenticated and service_role only
REVOKE ALL ON FUNCTION public.import_accounting_plan(uuid, jsonb, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.import_accounting_plan(uuid, jsonb, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_accounting_plan(uuid, jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_accounting_plan(uuid, jsonb, boolean) TO service_role;
