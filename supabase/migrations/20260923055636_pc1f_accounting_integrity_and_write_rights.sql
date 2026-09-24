/*
  # PC1F — Intégrité et droits d'écriture comptable

  ## Part 1: Permission manage_accounting
  - Adds 'manage_accounting' to both create_default_role_permissions functions
    (trigger version + manual version).
  - admin/super_admin: true; manager/cashier/viewer: false.
  - Backfills existing tenants: adds manage_accounting=true for admin role
    where it is missing.

  ## Part 2: Helper current_user_can_manage_accounting()
  - STABLE SECURITY DEFINER function.
  - Returns true for super_admin/admin roles or if role_permissions has
    manage_accounting=true for the user's role in their tenant.

  ## Part 3: Journal integrity constraints
  - UNIQUE (tenant_id, entry_number) on journal_entries.
  - UNIQUE (tenant_id, id) on journal_entries (for composite FK target).
  - Composite FK journal_lines(tenant_id, entry_id) → journal_entries(tenant_id, id).
  - Composite FK journal_lines(tenant_id, account_code) → accounts(tenant_id, code).
  - CHECK constraints: debit >= 0, credit >= 0, exactly one side > 0.

  ## Part 4: RPC create_manual_journal_entry(...)
  - Atomic server-side manual entry creation with full validation.
  - Permission guard, tenant guard, balance check, account validation.
  - Uses next_accounting_piece_number() for sequential numbering.

  ## Part 5: RPC save_accounting_account(...)
  - Create or rename an accounting account. Code must be exactly 7 digits.
  - Cannot change code, type, or class of existing accounts.

  ## Part 6: Revoke direct INSERT/UPDATE/DELETE
  - Removes INSERT, UPDATE, DELETE from authenticated and anon on
    journal_entries, journal_lines, and accounts.
  - Keeps SELECT for read access. SECURITY DEFINER functions unaffected.

  ## Part 7: Add manage_accounting guard to 5 public RPCs
  - comptabiliser_vente, comptabiliser_ventes_en_masse,
    comptabiliser_reglements_clients_en_masse,
    comptabiliser_achats_en_masse,
    comptabiliser_reglements_fournisseurs_en_masse

  ## Part 8: Privilege grants for new functions
  - Revoke anon, grant to authenticated + service_role.

  ## Security
  - All new functions: SECURITY DEFINER, search_path=public.
  - No changes to existing data.
*/

-- ============================================================
-- PART 1: Permission manage_accounting in provisioning
-- ============================================================

-- 1a) Update the trigger-based version (fires on tenant INSERT)
CREATE OR REPLACE FUNCTION public.create_default_role_permissions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
INSERT INTO role_permissions (tenant_id, role, permissions) VALUES
(NEW.id, 'admin', jsonb_build_object(
'access_pos', true, 'access_billing', true, 'access_articles', true,
'access_tiers', true, 'access_dashboard', true, 'access_reports', true,
'access_master_catalog', true, 'access_stock', true, 'access_sales', true,
'access_supplier_orders', true, 'access_online_orders', true,
'access_accounting', true, 'access_cash_history', true,
'view_purchase_prices', true, 'view_margins', true,
'view_stock_levels', true, 'view_sales_history', true,
'view_accounting', true, 'view_dashboard_stats', true, 'view_cash_sessions', true,
'manage_stock', true, 'manage_articles', true, 'manage_categories', true,
'create_quotes', true, 'edit_invoices', true, 'delete_invoices', true,
'edit_quotes', true, 'delete_quotes', true,
'edit_supplier_orders', true, 'delete_supplier_orders', true,
'apply_discounts', true, 'sell_below_min_price', true,
'manage_cash_sessions', true, 'pos_close_session', true, 'pos_open_session', true,
'pos_returns', true, 'pos_cancel_sale', true, 'pos_reprint', true,
'pos_cash_movement', true, 'pos_view_x_report', true, 'pos_view_z_report', true,
'pos_view_session_stats', true,
'manage_online_orders', true, 'manage_supplier_orders', true, 'manage_customers', true,
'export_data', true, 'manage_settings', true, 'manage_users', true,
'manage_accounting', true
)),
(NEW.id, 'manager', jsonb_build_object(
'access_pos', true, 'access_billing', true, 'access_articles', true,
'access_tiers', true, 'access_dashboard', true, 'access_reports', true,
'access_master_catalog', true, 'access_stock', true, 'access_sales', true,
'access_supplier_orders', true, 'access_online_orders', true,
'access_accounting', false, 'access_cash_history', true,
'view_purchase_prices', true, 'view_margins', true,
'view_stock_levels', true, 'view_sales_history', true,
'view_accounting', false, 'view_dashboard_stats', true, 'view_cash_sessions', true,
'manage_stock', true, 'manage_articles', true, 'manage_categories', true,
'create_quotes', true, 'edit_invoices', true, 'delete_invoices', false,
'edit_quotes', true, 'delete_quotes', true,
'edit_supplier_orders', true, 'delete_supplier_orders', false,
'apply_discounts', true, 'sell_below_min_price', false,
'manage_cash_sessions', true, 'pos_close_session', true, 'pos_open_session', true,
'pos_returns', true, 'pos_cancel_sale', false, 'pos_reprint', true,
'pos_cash_movement', true, 'pos_view_x_report', true, 'pos_view_z_report', false,
'pos_view_session_stats', true,
'manage_online_orders', true, 'manage_supplier_orders', true, 'manage_customers', true,
'export_data', true, 'manage_settings', false, 'manage_users', false,
'manage_accounting', false
)),
(NEW.id, 'cashier', jsonb_build_object(
'access_pos', true, 'access_billing', false, 'access_articles', false,
'access_tiers', false, 'access_dashboard', false, 'access_reports', false,
'access_master_catalog', false, 'access_stock', false, 'access_sales', false,
'access_supplier_orders', false, 'access_online_orders', false,
'access_accounting', false, 'access_cash_history', false,
'view_purchase_prices', false, 'view_margins', false,
'view_stock_levels', true, 'view_sales_history', false,
'view_accounting', false, 'view_dashboard_stats', false, 'view_cash_sessions', false,
'manage_stock', false, 'manage_articles', false, 'manage_categories', false,
'create_quotes', false, 'edit_invoices', false, 'delete_invoices', false,
'edit_quotes', false, 'delete_quotes', false,
'edit_supplier_orders', false, 'delete_supplier_orders', false,
'apply_discounts', false, 'sell_below_min_price', false,
'manage_cash_sessions', true, 'pos_close_session', false, 'pos_open_session', true,
'pos_returns', false, 'pos_cancel_sale', false, 'pos_reprint', true,
'pos_cash_movement', false, 'pos_view_x_report', false, 'pos_view_z_report', false,
'pos_view_session_stats', false,
'manage_online_orders', false, 'manage_supplier_orders', false, 'manage_customers', true,
'export_data', false, 'manage_settings', false, 'manage_users', false,
'manage_accounting', false
)),
(NEW.id, 'viewer', jsonb_build_object(
'access_pos', false, 'access_billing', false, 'access_articles', true,
'access_tiers', true, 'access_dashboard', true, 'access_reports', true,
'access_master_catalog', false, 'access_stock', true, 'access_sales', true,
'access_supplier_orders', false, 'access_online_orders', false,
'access_accounting', false, 'access_cash_history', true,
'view_purchase_prices', false, 'view_margins', false,
'view_stock_levels', true, 'view_sales_history', true,
'view_accounting', false, 'view_dashboard_stats', true, 'view_cash_sessions', true,
'manage_stock', false, 'manage_articles', false, 'manage_categories', false,
'create_quotes', false, 'edit_invoices', false, 'delete_invoices', false,
'edit_quotes', false, 'delete_quotes', false,
'edit_supplier_orders', false, 'delete_supplier_orders', false,
'apply_discounts', false, 'sell_below_min_price', false,
'manage_cash_sessions', false, 'pos_close_session', false, 'pos_open_session', false,
'pos_returns', false, 'pos_cancel_sale', false, 'pos_reprint', false,
'pos_cash_movement', false, 'pos_view_x_report', false, 'pos_view_z_report', false,
'pos_view_session_stats', false,
'manage_online_orders', false, 'manage_supplier_orders', false, 'manage_customers', false,
'export_data', false, 'manage_settings', false, 'manage_users', false,
'manage_accounting', false
))
ON CONFLICT (tenant_id, role) DO UPDATE
SET permissions = EXCLUDED.permissions, updated_at = now();
RETURN NEW;
END;
$function$;

-- 1b) Update the manual callable version
CREATE OR REPLACE FUNCTION public.create_default_role_permissions(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql AS $function$
BEGIN
INSERT INTO role_permissions (tenant_id, role, permissions)
VALUES (p_tenant_id, 'admin', jsonb_build_object(
'access_pos', true, 'access_billing', true, 'access_articles', true,
'access_tiers', true, 'access_dashboard', true, 'access_reports', true,
'access_master_catalog', true, 'view_purchase_prices', true, 'view_margins', true,
'view_stock_levels', true, 'manage_stock', true, 'view_sales_history', true,
'view_accounting', true, 'manage_articles', true, 'manage_categories', true,
'manage_customers', true, 'manage_cash_sessions', true, 'view_cash_sessions', true,
'apply_discounts', true, 'sell_below_min_price', true, 'create_quotes', true,
'manage_online_orders', true, 'manage_supplier_orders', true,
'view_dashboard_stats', true, 'export_data', true,
'manage_settings', true, 'manage_users', true, 'manage_accounting', true
))
ON CONFLICT (tenant_id, role) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now();

INSERT INTO role_permissions (tenant_id, role, permissions)
VALUES (p_tenant_id, 'manager', jsonb_build_object(
'access_pos', true, 'access_billing', true, 'access_articles', true,
'access_tiers', true, 'access_dashboard', true, 'access_reports', true,
'access_master_catalog', true, 'view_purchase_prices', true, 'view_margins', true,
'view_stock_levels', true, 'manage_stock', true, 'view_sales_history', true,
'view_accounting', false, 'manage_articles', true, 'manage_categories', true,
'manage_customers', true, 'manage_cash_sessions', true, 'view_cash_sessions', true,
'apply_discounts', true, 'sell_below_min_price', false, 'create_quotes', true,
'manage_online_orders', true, 'manage_supplier_orders', true,
'view_dashboard_stats', true, 'export_data', true,
'manage_settings', false, 'manage_users', false, 'manage_accounting', false
))
ON CONFLICT (tenant_id, role) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now();

INSERT INTO role_permissions (tenant_id, role, permissions)
VALUES (p_tenant_id, 'cashier', jsonb_build_object(
'access_pos', true, 'access_billing', false, 'access_articles', false,
'access_tiers', false, 'access_dashboard', false, 'access_reports', false,
'access_master_catalog', false, 'view_purchase_prices', false, 'view_margins', false,
'view_stock_levels', true, 'manage_stock', false, 'view_sales_history', false,
'view_accounting', false, 'manage_articles', false, 'manage_categories', false,
'manage_customers', true, 'manage_cash_sessions', true, 'view_cash_sessions', true,
'apply_discounts', false, 'sell_below_min_price', false, 'create_quotes', false,
'manage_online_orders', false, 'manage_supplier_orders', false,
'view_dashboard_stats', false, 'export_data', false,
'manage_settings', false, 'manage_users', false, 'manage_accounting', false
))
ON CONFLICT (tenant_id, role) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now();

INSERT INTO role_permissions (tenant_id, role, permissions)
VALUES (p_tenant_id, 'viewer', jsonb_build_object(
'access_pos', false, 'access_billing', false, 'access_articles', true,
'access_tiers', true, 'access_dashboard', true, 'access_reports', false,
'access_master_catalog', false, 'view_purchase_prices', false, 'view_margins', false,
'view_stock_levels', true, 'manage_stock', false, 'view_sales_history', true,
'view_accounting', false, 'manage_articles', false, 'manage_categories', false,
'manage_customers', false, 'manage_cash_sessions', false, 'view_cash_sessions', false,
'apply_discounts', false, 'sell_below_min_price', false, 'create_quotes', false,
'manage_online_orders', false, 'manage_supplier_orders', false,
'view_dashboard_stats', false, 'export_data', false,
'manage_settings', false, 'manage_users', false, 'manage_accounting', false
))
ON CONFLICT (tenant_id, role) DO UPDATE SET permissions = EXCLUDED.permissions, updated_at = now();
END;
$function$;

-- 1c) Backfill: add manage_accounting=true for admin rows that don't have it
UPDATE role_permissions
SET permissions = permissions || '{"manage_accounting": true}'::jsonb,
    updated_at = now()
WHERE role = 'admin'
AND NOT (permissions ? 'manage_accounting');

-- ============================================================
-- PART 2: Helper current_user_can_manage_accounting()
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_user_can_manage_accounting()
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_role text;
  v_tenant_id uuid;
  v_perm boolean;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RETURN false; END IF;

  SELECT p.role, p.tenant_id INTO v_role, v_tenant_id
  FROM profiles p WHERE p.id = v_uid;

  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role IN ('super_admin', 'admin') THEN RETURN true; END IF;

  SELECT (rp.permissions->>'manage_accounting')::boolean INTO v_perm
  FROM role_permissions rp
  WHERE rp.tenant_id = v_tenant_id AND rp.role = v_role;

  RETURN COALESCE(v_perm, false);
END;
$function$;

REVOKE ALL ON FUNCTION current_user_can_manage_accounting() FROM anon;
GRANT EXECUTE ON FUNCTION current_user_can_manage_accounting() TO authenticated, service_role;

-- ============================================================
-- PART 3: Journal integrity constraints
-- ============================================================

-- 3a) UNIQUE (tenant_id, entry_number) on journal_entries
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'journal_entries'::regclass
    AND conname = 'uq_journal_entries_tenant_entry_number'
  ) THEN
    ALTER TABLE journal_entries
    ADD CONSTRAINT uq_journal_entries_tenant_entry_number UNIQUE (tenant_id, entry_number);
  END IF;
END $$;

-- 3b) UNIQUE (tenant_id, id) on journal_entries (for composite FK target)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'journal_entries'::regclass
    AND conname = 'uq_journal_entries_tenant_id'
  ) THEN
    ALTER TABLE journal_entries
    ADD CONSTRAINT uq_journal_entries_tenant_id UNIQUE (tenant_id, id);
  END IF;
END $$;

-- 3c) Composite FK: journal_lines(tenant_id, entry_id) → journal_entries(tenant_id, id)
-- First drop the old simple FK if it exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'journal_lines'::regclass
    AND conname = 'journal_lines_entry_id_fkey'
    AND contype = 'f'
  ) THEN
    ALTER TABLE journal_lines DROP CONSTRAINT journal_lines_entry_id_fkey;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'journal_lines'::regclass
    AND conname = 'fk_journal_lines_tenant_entry'
  ) THEN
    ALTER TABLE journal_lines
    ADD CONSTRAINT fk_journal_lines_tenant_entry
    FOREIGN KEY (tenant_id, entry_id) REFERENCES journal_entries(tenant_id, id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3d) Composite FK: journal_lines(tenant_id, account_code) → accounts(tenant_id, code)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'journal_lines'::regclass
    AND conname = 'fk_journal_lines_tenant_account'
  ) THEN
    ALTER TABLE journal_lines
    ADD CONSTRAINT fk_journal_lines_tenant_account
    FOREIGN KEY (tenant_id, account_code) REFERENCES accounts(tenant_id, code);
  END IF;
END $$;

-- 3e) CHECK constraints on journal_lines
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'journal_lines'::regclass AND conname = 'chk_journal_lines_debit_positive') THEN
    ALTER TABLE journal_lines ADD CONSTRAINT chk_journal_lines_debit_positive CHECK (coalesce(debit, 0) >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'journal_lines'::regclass AND conname = 'chk_journal_lines_credit_positive') THEN
    ALTER TABLE journal_lines ADD CONSTRAINT chk_journal_lines_credit_positive CHECK (coalesce(credit, 0) >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'journal_lines'::regclass AND conname = 'chk_journal_lines_one_side') THEN
    ALTER TABLE journal_lines ADD CONSTRAINT chk_journal_lines_one_side
    CHECK (
      (coalesce(debit, 0) > 0 AND coalesce(credit, 0) = 0)
      OR (coalesce(debit, 0) = 0 AND coalesce(credit, 0) > 0)
    );
  END IF;
END $$;

-- ============================================================
-- PART 4: RPC create_manual_journal_entry
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_manual_journal_entry(
  p_tenant_id uuid,
  p_journal_type text,
  p_entry_date date,
  p_description text,
  p_reference text DEFAULT '',
  p_lines jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_entry_id uuid;
  v_piece_number text;
  v_line jsonb;
  v_total_debit numeric := 0;
  v_total_credit numeric := 0;
  v_line_count int;
  v_account_name text;
  v_valid_types text[] := ARRAY['VE','AC','CA','BQ','OD'];
BEGIN
  -- Tenant guard
  IF auth.uid() IS NULL OR current_tenant_id() IS NULL
     OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'Acces refuse au tenant demande';
  END IF;

  -- Permission guard
  IF NOT current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Permission manage_accounting requise';
  END IF;

  -- Validate journal type
  IF p_journal_type IS NULL OR NOT (p_journal_type = ANY(v_valid_types)) THEN
    RAISE EXCEPTION 'Type de journal invalide: %', coalesce(p_journal_type, 'NULL');
  END IF;

  -- Validate date and description
  IF p_entry_date IS NULL THEN RAISE EXCEPTION 'Date obligatoire'; END IF;
  IF p_description IS NULL OR trim(p_description) = '' THEN
    RAISE EXCEPTION 'Description obligatoire';
  END IF;

  -- Validate line count
  v_line_count := jsonb_array_length(p_lines);
  IF v_line_count < 2 THEN RAISE EXCEPTION 'Au moins 2 lignes requises'; END IF;
  IF v_line_count > 500 THEN RAISE EXCEPTION 'Maximum 500 lignes'; END IF;

  -- Validate lines and compute totals
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    -- Validate account exists and is active in this tenant
    SELECT a.name INTO v_account_name
    FROM accounts a
    WHERE a.tenant_id = p_tenant_id
      AND a.code = v_line->>'account_code'
      AND a.is_active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Compte % introuvable ou inactif', v_line->>'account_code';
    END IF;

    -- Validate amounts
    IF coalesce((v_line->>'debit')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'Debit negatif interdit pour compte %', v_line->>'account_code';
    END IF;
    IF coalesce((v_line->>'credit')::numeric, 0) < 0 THEN
      RAISE EXCEPTION 'Credit negatif interdit pour compte %', v_line->>'account_code';
    END IF;
    IF coalesce((v_line->>'debit')::numeric, 0) = 0 AND coalesce((v_line->>'credit')::numeric, 0) = 0 THEN
      RAISE EXCEPTION 'Ligne sans montant pour compte %', v_line->>'account_code';
    END IF;
    IF coalesce((v_line->>'debit')::numeric, 0) > 0 AND coalesce((v_line->>'credit')::numeric, 0) > 0 THEN
      RAISE EXCEPTION 'Debit et credit simultanes interdits pour compte %', v_line->>'account_code';
    END IF;

    v_total_debit := v_total_debit + coalesce((v_line->>'debit')::numeric, 0);
    v_total_credit := v_total_credit + coalesce((v_line->>'credit')::numeric, 0);
  END LOOP;

  -- Balance check
  IF round(v_total_debit, 2) IS DISTINCT FROM round(v_total_credit, 2) THEN
    RAISE EXCEPTION 'Ecriture desequilibree: debit=%, credit=%', round(v_total_debit,2), round(v_total_credit,2);
  END IF;

  -- Generate piece number
  v_piece_number := next_accounting_piece_number(p_tenant_id, p_journal_type);

  -- Create entry
  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, status, posted_at, posted_by
  ) VALUES (
    p_tenant_id, v_piece_number, p_journal_type, p_entry_date, coalesce(p_reference, ''),
    trim(p_description), v_total_debit, v_total_credit, true,
    'manual', 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  -- Create lines (account_name read from accounts, never from client)
  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    SELECT a.name INTO v_account_name
    FROM accounts a
    WHERE a.tenant_id = p_tenant_id AND a.code = v_line->>'account_code';

    INSERT INTO journal_lines (
      tenant_id, entry_id, account_code, account_name, debit, credit, label
    ) VALUES (
      p_tenant_id, v_entry_id, v_line->>'account_code', v_account_name,
      coalesce((v_line->>'debit')::numeric, 0),
      coalesce((v_line->>'credit')::numeric, 0),
      coalesce(v_line->>'label', '')
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number,
    'journal', p_journal_type,
    'total', v_total_debit
  );
END;
$function$;

-- ============================================================
-- PART 5: RPC save_accounting_account
-- ============================================================

CREATE OR REPLACE FUNCTION public.save_accounting_account(
  p_tenant_id uuid,
  p_account_id uuid DEFAULT NULL,
  p_code text DEFAULT NULL,
  p_name text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_existing record;
BEGIN
  -- Tenant guard
  IF auth.uid() IS NULL OR current_tenant_id() IS NULL
     OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'Acces refuse au tenant demande';
  END IF;

  -- Permission guard
  IF NOT current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Permission manage_accounting requise';
  END IF;

  IF p_name IS NULL OR trim(p_name) = '' THEN
    RAISE EXCEPTION 'Intitule obligatoire';
  END IF;

  IF p_account_id IS NOT NULL THEN
    -- UPDATE mode: rename only
    SELECT * INTO v_existing FROM accounts
    WHERE id = p_account_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Compte introuvable';
    END IF;

    UPDATE accounts SET name = trim(p_name) WHERE id = p_account_id AND tenant_id = p_tenant_id;

    RETURN jsonb_build_object('success', true, 'id', p_account_id, 'mode', 'updated');
  ELSE
    -- CREATE mode
    IF p_code IS NULL OR length(p_code) != 7 OR p_code !~ '^\d{7}$' THEN
      RAISE EXCEPTION 'Le code doit contenir exactement 7 chiffres';
    END IF;

    IF EXISTS (SELECT 1 FROM accounts WHERE tenant_id = p_tenant_id AND code = p_code) THEN
      RAISE EXCEPTION 'Ce code existe deja';
    END IF;

    INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
    VALUES (p_tenant_id, p_code, trim(p_name), (left(p_code, 1))::int, 'general', true)
    RETURNING id INTO p_account_id;

    RETURN jsonb_build_object('success', true, 'id', p_account_id, 'mode', 'created');
  END IF;
END;
$function$;

-- ============================================================
-- PART 6: Revoke direct write access
-- ============================================================

REVOKE INSERT, UPDATE, DELETE ON journal_entries FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON journal_lines FROM authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON accounts FROM authenticated, anon;

-- ============================================================
-- PART 7: Add manage_accounting guard to 5 public RPCs
-- ============================================================

-- 7a) comptabiliser_vente (takes p_sale_id)
CREATE OR REPLACE FUNCTION public.comptabiliser_vente(p_sale_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_sale RECORD;
v_entry_id uuid;
v_piece_number text;
v_debit_account text;
v_credit_vente text;
v_credit_tva text;
v_ht numeric;
v_tva numeric;
v_ttc numeric;
v_customer_name text;
v_customer_account text;
v_caller_tenant uuid;
v_entry_date date;
BEGIN
-- C2 tenant guard
IF auth.uid() IS NULL THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;
v_caller_tenant := current_tenant_id();
IF v_caller_tenant IS NULL THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

-- PC1F: permission guard
IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

SELECT s.*, c.name as customer_name
INTO v_sale
FROM sales s
LEFT JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
WHERE s.id = p_sale_id
AND s.tenant_id = v_caller_tenant;

IF NOT FOUND THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
END IF;

IF v_sale.accounting_status = 'accounted' THEN
RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée');
END IF;

IF v_sale.status = 'cancelled' THEN
RETURN jsonb_build_object('success', false, 'error', 'Impossible de comptabiliser une vente annulée');
END IF;

v_ht := v_sale.subtotal - COALESCE(v_sale.discount, 0);
v_tva := COALESCE(v_sale.vat_amount, 0);
v_ttc := v_sale.total;
v_customer_name := COALESCE(v_sale.customer_name, 'Client comptant');

v_entry_date := COALESCE(v_sale.created_at::date, CURRENT_DATE);

IF v_sale.customer_id IS NOT NULL THEN
v_customer_account := get_or_create_customer_account(v_sale.tenant_id, v_sale.customer_id);
ELSE
BEGIN
v_customer_account := resolve_account(v_sale.tenant_id, 'CUSTOMER_CONTROL');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution CUSTOMER_CONTROL échouée: ' || SQLERRM);
END;
END IF;

v_debit_account := v_customer_account;

BEGIN
v_credit_vente := resolve_account(v_sale.tenant_id, 'SALES_GOODS');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution SALES_GOODS échouée: ' || SQLERRM);
END;

IF v_tva > 0 THEN
BEGIN
v_credit_tva := resolve_account(v_sale.tenant_id, 'VAT_OUTPUT');
EXCEPTION WHEN OTHERS THEN
RETURN jsonb_build_object('success', false, 'error', 'Résolution VAT_OUTPUT échouée: ' || SQLERRM);
END;
END IF;

IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable.');
END IF;
IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente) THEN
RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_vente || ' introuvable dans le plan comptable.');
END IF;

v_piece_number := next_accounting_piece_number(v_sale.tenant_id, 'VE');

INSERT INTO journal_entries (
tenant_id, entry_number, journal_type, entry_date, reference, description,
total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
) VALUES (
v_sale.tenant_id, v_piece_number, 'VE', v_entry_date,
v_sale.sale_number,
'Vente ' || v_sale.sale_number || ' - ' || v_customer_name,
v_ttc, v_ttc, true,
'sale', p_sale_id, 'posted', now(), auth.uid()
) RETURNING id INTO v_entry_id;

INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
VALUES (
v_sale.tenant_id, v_entry_id, v_debit_account,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account LIMIT 1),
v_ttc, 0,
'Vente ' || v_sale.sale_number || ' ' || v_customer_name,
v_sale.customer_id
);

IF v_ht > 0 THEN
INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES (
v_sale.tenant_id, v_entry_id, v_credit_vente,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente LIMIT 1),
0, v_ht,
'Vente marchandises ' || v_sale.sale_number
);
END IF;

IF v_tva > 0 THEN
INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
VALUES (
v_sale.tenant_id, v_entry_id, v_credit_tva,
(SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva LIMIT 1),
0, v_tva,
'TVA collectée ' || v_sale.sale_number
);
END IF;

UPDATE sales SET
accounting_status = 'accounted',
accounting_entry_id = v_entry_id,
accounted_at = now()
WHERE id = p_sale_id
AND tenant_id = v_caller_tenant;

RETURN jsonb_build_object(
'success', true,
'entry_id', v_entry_id,
'piece_number', v_piece_number,
'journal', 'VE',
'total', v_ttc
);
END;
$function$;

-- 7b) comptabiliser_ventes_en_masse
CREATE OR REPLACE FUNCTION public.comptabiliser_ventes_en_masse(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_sale RECORD;
v_result jsonb;
v_success int := 0;
v_errors int := 0;
v_error_messages jsonb[] := '{}';
BEGIN
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

FOR v_sale IN
SELECT id, sale_number FROM sales
WHERE tenant_id = p_tenant_id
AND accounting_status = 'not_accounted'
AND status != 'cancelled'
ORDER BY created_at
LOOP
v_result := comptabiliser_vente(v_sale.id);
IF (v_result->>'success')::boolean THEN
v_success := v_success + 1;
ELSE
v_errors := v_errors + 1;
v_error_messages := array_append(v_error_messages, jsonb_build_object('sale', v_sale.sale_number, 'error', v_result->>'error'));
END IF;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'accounted', v_success,
'errors', v_errors,
'error_details', to_jsonb(v_error_messages)
);
END;
$function$;

-- 7c) comptabiliser_reglements_clients_en_masse
CREATE OR REPLACE FUNCTION public.comptabiliser_reglements_clients_en_masse(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_pay                 record;
v_result              jsonb;
v_success             int := 0;
v_errors              int := 0;
v_skipped_no_bal      int := 0;
v_skipped_overpaid    int := 0;
v_skipped_unconfirmed int := 0;
v_error_messages      jsonb[] := '{}';
BEGIN
IF auth.uid() IS NULL OR current_tenant_id() IS NULL
OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

SELECT count(*) INTO v_skipped_no_bal
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND s.accounting_status = 'accounted'
AND sp.affects_balance IS NOT TRUE;

SELECT count(*) INTO v_skipped_overpaid
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND s.accounting_status = 'accounted'
AND sp.affects_balance IS TRUE
AND sp.status = 'confirmed'
AND s.status <> 'cancelled'
AND s.deleted_at IS NULL
AND round(s.paid, 2) > round(s.total, 2);

SELECT count(*) INTO v_skipped_unconfirmed
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND s.accounting_status = 'accounted'
AND sp.affects_balance IS TRUE
AND (sp.status IS NULL OR sp.status <> 'confirmed');

FOR v_pay IN
SELECT sp.id, sp.sale_id
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id AND s.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND s.accounting_status = 'accounted'
AND sp.affects_balance IS TRUE
AND sp.status = 'confirmed'
AND s.status <> 'cancelled'
AND s.deleted_at IS NULL
AND round(s.paid, 2) <= round(s.total, 2)
ORDER BY sp.created_at
LOOP
v_result := comptabiliser_reglement(v_pay.id);
IF (v_result->>'success')::boolean THEN
IF (v_result->>'skipped')::boolean IS TRUE THEN
v_skipped_no_bal := v_skipped_no_bal + 1;
ELSE
v_success := v_success + 1;
END IF;
ELSE
v_errors := v_errors + 1;
v_error_messages := array_append(v_error_messages,
jsonb_build_object('payment_id', v_pay.id, 'error', v_result->>'error'));
END IF;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'accounted', v_success,
'errors', v_errors,
'skipped_no_balance', v_skipped_no_bal,
'skipped_overpaid', v_skipped_overpaid,
'skipped_unconfirmed', v_skipped_unconfirmed,
'error_details', to_jsonb(v_error_messages)
);
END;
$function$;

-- 7d) comptabiliser_achats_en_masse
CREATE OR REPLACE FUNCTION public.comptabiliser_achats_en_masse(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_order RECORD;
v_result jsonb;
v_success int := 0;
v_errors int := 0;
v_error_messages jsonb[] := '{}';
BEGIN
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

FOR v_order IN
SELECT id, order_number FROM supplier_orders
WHERE tenant_id = p_tenant_id
AND (accounting_status = 'not_accounted' OR accounting_status IS NULL)
AND status = 'received'
ORDER BY created_at
LOOP
v_result := comptabiliser_achat(v_order.id);
IF (v_result->>'success')::boolean THEN
v_success := v_success + 1;
ELSE
v_errors := v_errors + 1;
v_error_messages := array_append(v_error_messages, jsonb_build_object('order', v_order.order_number, 'error', v_result->>'error'));
END IF;
END LOOP;

RETURN jsonb_build_object(
'success', true,
'accounted', v_success,
'errors', v_errors,
'error_details', to_jsonb(v_error_messages)
);
END;
$function$;

-- 7e) comptabiliser_reglements_fournisseurs_en_masse
CREATE OR REPLACE FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
v_pay record; v_result jsonb; v_success int := 0; v_errors int := 0;
v_error_details jsonb[] := '{}';
v_total_not_accounted int;
v_skipped_invalid int; v_skipped_order_not_accounted int;
v_skipped_vault_unconfigured int; v_skipped_treasury_unconfigured int;
v_eligible int;
BEGIN
IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
RAISE EXCEPTION 'Acces refuse au tenant demande';
END IF;

IF NOT current_user_can_manage_accounting() THEN
RAISE EXCEPTION 'Permission manage_accounting requise';
END IF;

SELECT count(*) INTO v_total_not_accounted FROM supplier_payments sp
WHERE sp.tenant_id = p_tenant_id AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL);

SELECT count(*) INTO v_skipped_invalid FROM supplier_payments sp
WHERE sp.tenant_id = p_tenant_id AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND (sp.amount <= 0 OR sp.supplier_id IS NULL OR sp.payment_method_id IS NULL);

SELECT count(*) INTO v_skipped_order_not_accounted FROM supplier_payments sp
JOIN supplier_orders so ON so.id = sp.order_id AND so.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND sp.amount > 0 AND sp.supplier_id IS NOT NULL AND sp.payment_method_id IS NOT NULL
AND sp.order_id IS NOT NULL AND so.accounting_status IS DISTINCT FROM 'accounted';

SELECT count(*) INTO v_skipped_vault_unconfigured FROM supplier_payments sp
LEFT JOIN vaults v ON v.id = sp.vault_id AND v.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND sp.amount > 0 AND sp.supplier_id IS NOT NULL AND sp.payment_method_id IS NOT NULL
AND (sp.order_id IS NULL OR EXISTS (SELECT 1 FROM supplier_orders so2 WHERE so2.id = sp.order_id AND so2.tenant_id = sp.tenant_id AND so2.accounting_status = 'accounted'))
AND sp.funding_source = 'vault' AND (v.account_code IS NULL OR TRIM(v.account_code) = '');

SELECT count(*) INTO v_skipped_treasury_unconfigured FROM supplier_payments sp
LEFT JOIN payment_methods pm ON pm.id = sp.payment_method_id AND pm.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND sp.amount > 0 AND sp.supplier_id IS NOT NULL AND sp.payment_method_id IS NOT NULL
AND (sp.order_id IS NULL OR EXISTS (SELECT 1 FROM supplier_orders so2 WHERE so2.id = sp.order_id AND so2.tenant_id = sp.tenant_id AND so2.accounting_status = 'accounted'))
AND sp.funding_source IS DISTINCT FROM 'vault'
AND (pm.account_code IS NULL OR TRIM(pm.account_code) = '');

v_eligible := v_total_not_accounted - v_skipped_invalid - v_skipped_order_not_accounted
- v_skipped_vault_unconfigured - v_skipped_treasury_unconfigured;

FOR v_pay IN
SELECT sp.id, so.order_number FROM supplier_payments sp
LEFT JOIN supplier_orders so ON so.id = sp.order_id AND so.tenant_id = sp.tenant_id
WHERE sp.tenant_id = p_tenant_id
AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
AND sp.amount > 0 AND sp.supplier_id IS NOT NULL AND sp.payment_method_id IS NOT NULL
AND (sp.order_id IS NULL OR so.accounting_status = 'accounted')
AND NOT (sp.funding_source = 'vault' AND NOT EXISTS (
SELECT 1 FROM vaults v WHERE v.id = sp.vault_id AND v.tenant_id = sp.tenant_id AND v.account_code IS NOT NULL AND TRIM(v.account_code) <> ''))
AND NOT (sp.funding_source IS DISTINCT FROM 'vault' AND NOT EXISTS (
SELECT 1 FROM payment_methods pm WHERE pm.id = sp.payment_method_id AND pm.tenant_id = sp.tenant_id AND pm.account_code IS NOT NULL AND TRIM(pm.account_code) <> ''))
ORDER BY sp.created_at
LOOP
BEGIN
v_result := comptabiliser_reglement_fournisseur(v_pay.id);
IF (v_result->>'success')::boolean THEN v_success := v_success + 1;
ELSE v_errors := v_errors + 1;
v_error_details := array_append(v_error_details, jsonb_build_object('order', COALESCE(v_pay.order_number,'?'), 'error', v_result->>'error'));
END IF;
EXCEPTION WHEN OTHERS THEN
v_errors := v_errors + 1;
v_error_details := array_append(v_error_details, jsonb_build_object('order', COALESCE(v_pay.order_number,'?'), 'error', SQLERRM));
END;
END LOOP;

RETURN jsonb_build_object('success', true, 'accounted', v_success, 'errors', v_errors,
'total_not_accounted', v_total_not_accounted, 'eligible', v_eligible,
'skipped_invalid', v_skipped_invalid, 'skipped_order_not_accounted', v_skipped_order_not_accounted,
'skipped_vault_unconfigured', v_skipped_vault_unconfigured, 'skipped_treasury_unconfigured', v_skipped_treasury_unconfigured,
'error_details', to_jsonb(v_error_details));
END;
$function$;

-- ============================================================
-- PART 8: Privilege grants for new functions
-- ============================================================

REVOKE ALL ON FUNCTION create_manual_journal_entry(uuid, text, date, text, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION create_manual_journal_entry(uuid, text, date, text, text, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION save_accounting_account(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION save_accounting_account(uuid, uuid, text, text) TO authenticated, service_role;
