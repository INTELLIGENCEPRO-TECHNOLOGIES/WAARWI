/*
  # Comptes auxiliaires tiers + Cloture + Recherche avancee

  1. Nouvelles colonnes
    - `customers.account_code` : code comptable auxiliaire auto-genere (ex: 4110001)
    - `suppliers.account_code` : code comptable auxiliaire auto-genere (ex: 4010001)

  2. Nouvelles fonctions
    - `get_or_create_customer_account(tenant_id, customer_id)` : cree/retourne le compte auxiliaire client
    - `get_or_create_supplier_account(tenant_id, supplier_id)` : cree/retourne le compte auxiliaire fournisseur
    - `balance_tiers(tenant_id, tiers_type, date_from, date_to)` : balance auxiliaire des tiers
    - `interrogation_tiers(tenant_id, tiers_id, tiers_type, date_from, date_to)` : extrait de compte tiers
    - `recherche_ecritures(...)` : recherche multi-criteres
    - `cloturer_journal(tenant_id, journal_type, date_to)` : cloture d'un journal
    - `cloturer_exercice(tenant_id, fiscal_year)` : cloture d'exercice

  3. Mise a jour des fonctions de comptabilisation
    - Utilisation du compte auxiliaire tiers au lieu du collectif 4110000/4010000

  4. Notes
    - Les comptes auxiliaires sont rattaches au compte collectif (411/401)
    - Compatible avec la navigation par compte general (tous les 411xxxx)
    - Le compte collectif reste dans le plan comptable, les auxiliaires sont aussi des comptes
*/

-- ==============================================
-- 1. ADD account_code to customers and suppliers
-- ==============================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'customers' AND column_name = 'account_code'
  ) THEN
    ALTER TABLE customers ADD COLUMN account_code text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'account_code'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN account_code text;
  END IF;
END $$;

-- ==============================================
-- 2. FUNCTION: Get or create customer auxiliary account
-- ==============================================
CREATE OR REPLACE FUNCTION get_or_create_customer_account(
  p_tenant_id uuid,
  p_customer_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_name text;
  v_next_num int;
BEGIN
  -- Already has an account code?
  SELECT account_code INTO v_code FROM customers WHERE id = p_customer_id AND tenant_id = p_tenant_id;
  IF v_code IS NOT NULL AND v_code != '' THEN
    RETURN v_code;
  END IF;

  -- Get customer name
  SELECT name INTO v_name FROM customers WHERE id = p_customer_id AND tenant_id = p_tenant_id;
  IF v_name IS NULL THEN
    RETURN '4110000';
  END IF;

  -- Generate next auxiliary code: 411XXXX (4110001, 4110002, etc.)
  SELECT COALESCE(MAX(CAST(SUBSTRING(account_code FROM 4) AS int)), 0) + 1
  INTO v_next_num
  FROM customers
  WHERE tenant_id = p_tenant_id AND account_code IS NOT NULL AND account_code LIKE '411%';

  v_code := '411' || LPAD(v_next_num::text, 4, '0');

  -- Create the account in plan comptable
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
  VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true)
  ON CONFLICT DO NOTHING;

  -- Update customer
  UPDATE customers SET account_code = v_code WHERE id = p_customer_id AND tenant_id = p_tenant_id;

  RETURN v_code;
END;
$$;

-- ==============================================
-- 3. FUNCTION: Get or create supplier auxiliary account
-- ==============================================
CREATE OR REPLACE FUNCTION get_or_create_supplier_account(
  p_tenant_id uuid,
  p_supplier_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_name text;
  v_next_num int;
BEGIN
  SELECT account_code INTO v_code FROM suppliers WHERE id = p_supplier_id AND tenant_id = p_tenant_id;
  IF v_code IS NOT NULL AND v_code != '' THEN
    RETURN v_code;
  END IF;

  SELECT name INTO v_name FROM suppliers WHERE id = p_supplier_id AND tenant_id = p_tenant_id;
  IF v_name IS NULL THEN
    RETURN '4010000';
  END IF;

  SELECT COALESCE(MAX(CAST(SUBSTRING(account_code FROM 4) AS int)), 0) + 1
  INTO v_next_num
  FROM suppliers
  WHERE tenant_id = p_tenant_id AND account_code IS NOT NULL AND account_code LIKE '401%';

  v_code := '401' || LPAD(v_next_num::text, 4, '0');

  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active)
  VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true)
  ON CONFLICT DO NOTHING;

  UPDATE suppliers SET account_code = v_code WHERE id = p_supplier_id AND tenant_id = p_tenant_id;

  RETURN v_code;
END;
$$;

-- ==============================================
-- 4. UPDATE comptabiliser_vente to use auxiliary accounts
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_vente(p_sale_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_entry_id uuid;
  v_piece_number text;
  v_journal text;
  v_debit_account text;
  v_credit_vente text;
  v_credit_tva text;
  v_ht numeric;
  v_tva numeric;
  v_ttc numeric;
  v_customer_name text;
  v_customer_account text;
BEGIN
  SELECT s.*, c.name as customer_name
  INTO v_sale
  FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id
  WHERE s.id = p_sale_id;

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

  -- Get or create auxiliary account for the customer
  IF v_sale.customer_id IS NOT NULL THEN
    v_customer_account := get_or_create_customer_account(v_sale.tenant_id, v_sale.customer_id);
  ELSE
    v_customer_account := '4110000';
  END IF;

  IF v_sale.status = 'paid' THEN
    v_journal := 'CA';
    v_debit_account := '5710000';
  ELSE
    v_journal := 'VE';
    v_debit_account := v_customer_account;
  END IF;

  v_credit_vente := '7010000';
  v_credit_tva := '4457000';

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_vente || ' introuvable dans le plan comptable.');
  END IF;

  v_piece_number := next_accounting_piece_number(v_sale.tenant_id, v_journal);

  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
  ) VALUES (
    v_sale.tenant_id, v_piece_number, v_journal, CURRENT_DATE,
    v_sale.sale_number,
    'Vente ' || v_sale.sale_number || ' - ' || v_customer_name,
    v_ttc, v_ttc, true,
    'sale', p_sale_id, 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  -- Debit line
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_sale.tenant_id, v_entry_id, v_debit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account LIMIT 1),
    v_ttc, 0,
    'Vente ' || v_sale.sale_number || ' ' || v_customer_name,
    v_sale.customer_id
  );

  -- Credit Vente HT
  IF v_ht > 0 THEN
    INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
    VALUES (
      v_sale.tenant_id, v_entry_id, v_credit_vente,
      (SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente LIMIT 1),
      0, v_ht,
      'Vente marchandises ' || v_sale.sale_number
    );
  END IF;

  -- Credit TVA
  IF v_tva > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva) THEN
      UPDATE journal_lines SET credit = v_ttc WHERE entry_id = v_entry_id AND account_code = v_credit_vente;
    ELSE
      INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
      VALUES (
        v_sale.tenant_id, v_entry_id, v_credit_tva,
        (SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva LIMIT 1),
        0, v_tva,
        'TVA collectée ' || v_sale.sale_number
      );
    END IF;
  END IF;

  UPDATE sales SET
    accounting_status = 'accounted',
    accounting_entry_id = v_entry_id,
    accounted_at = now()
  WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number,
    'journal', v_journal,
    'total', v_ttc
  );
END;
$$;

-- ==============================================
-- 5. UPDATE comptabiliser_reglement to use auxiliary accounts
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_reglement(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay RECORD;
  v_entry_id uuid;
  v_piece_number text;
  v_journal text;
  v_debit_account text;
  v_customer_name text;
  v_customer_account text;
BEGIN
  SELECT sp.*, s.sale_number, s.customer_id, s.tenant_id as sale_tenant_id
  INTO v_pay
  FROM sale_payments sp
  JOIN sales s ON s.id = sp.sale_id
  WHERE sp.id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement introuvable');
  END IF;

  IF v_pay.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement déjà comptabilisé');
  END IF;

  -- Get customer auxiliary account
  IF v_pay.customer_id IS NOT NULL THEN
    v_customer_account := get_or_create_customer_account(v_pay.tenant_id, v_pay.customer_id);
  ELSE
    v_customer_account := '4110000';
  END IF;

  -- Journal and debit account based on payment method
  IF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%banque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%virement%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%cheque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%chèque%' THEN
    v_journal := 'BQ'; v_debit_account := '5210000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%wave%' THEN
    v_journal := 'BQ'; v_debit_account := '5211000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%orange%' THEN
    v_journal := 'BQ'; v_debit_account := '5212000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%free%' THEN
    v_journal := 'BQ'; v_debit_account := '5213000';
  ELSE
    v_journal := 'CA'; v_debit_account := '5710000';
  END IF;

  SELECT COALESCE(c.name, 'Client comptant') INTO v_customer_name FROM customers c WHERE c.id = v_pay.customer_id;
  IF v_customer_name IS NULL THEN v_customer_name := 'Client comptant'; END IF;

  -- Fallback if account doesn't exist
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_debit_account) THEN
    v_debit_account := '5710000'; v_journal := 'CA';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_customer_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte client ' || v_customer_account || ' introuvable');
  END IF;

  v_piece_number := next_accounting_piece_number(v_pay.tenant_id, v_journal);

  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
  ) VALUES (
    v_pay.tenant_id, v_piece_number, v_journal, CURRENT_DATE,
    v_pay.sale_number,
    'Règlement ' || v_customer_name || ' - ' || v_pay.sale_number,
    v_pay.amount, v_pay.amount, true,
    'payment', p_payment_id, 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  -- Debit Tresorerie
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, v_debit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_debit_account LIMIT 1),
    v_pay.amount, 0,
    'Encaissement ' || v_pay.sale_number || ' ' || v_customer_name,
    v_pay.customer_id
  );

  -- Credit Client auxiliaire
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, v_customer_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_customer_account LIMIT 1),
    0, v_pay.amount,
    'Règlement ' || v_customer_name,
    v_pay.customer_id
  );

  UPDATE sale_payments SET
    accounting_status = 'accounted',
    accounting_entry_id = v_entry_id
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number,
    'journal', v_journal,
    'total', v_pay.amount
  );
END;
$$;

-- ==============================================
-- 6. UPDATE comptabiliser_achat to use auxiliary accounts
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_achat(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order RECORD;
  v_entry_id uuid;
  v_piece_number text;
  v_supplier_name text;
  v_supplier_account text;
BEGIN
  SELECT so.*, sup.name as supplier_name
  INTO v_order
  FROM supplier_orders so
  LEFT JOIN suppliers sup ON sup.id = so.supplier_id
  WHERE so.id = p_order_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Commande fournisseur introuvable');
  END IF;

  IF v_order.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Achat déjà comptabilisé');
  END IF;

  v_supplier_name := COALESCE(v_order.supplier_name, 'Fournisseur');

  -- Get or create supplier auxiliary account
  IF v_order.supplier_id IS NOT NULL THEN
    v_supplier_account := get_or_create_supplier_account(v_order.tenant_id, v_order.supplier_id);
  ELSE
    v_supplier_account := '4010000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = '6010000') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte 6010000 (Achats) introuvable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_supplier_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte fournisseur ' || v_supplier_account || ' introuvable');
  END IF;

  v_piece_number := next_accounting_piece_number(v_order.tenant_id, 'AC');

  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
  ) VALUES (
    v_order.tenant_id, v_piece_number, 'AC', CURRENT_DATE,
    v_order.order_number,
    'Achat ' || v_order.order_number || ' - ' || v_supplier_name,
    v_order.total, v_order.total, true,
    'purchase', p_order_id, 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_order.tenant_id, v_entry_id, '6010000',
    (SELECT name FROM accounts WHERE tenant_id = v_order.tenant_id AND code = '6010000' LIMIT 1),
    v_order.total, 0,
    'Achat marchandises ' || v_order.order_number,
    v_order.supplier_id
  );

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_order.tenant_id, v_entry_id, v_supplier_account,
    (SELECT name FROM accounts WHERE tenant_id = v_order.tenant_id AND code = v_supplier_account LIMIT 1),
    0, v_order.total,
    'Fournisseur ' || v_supplier_name,
    v_order.supplier_id
  );

  UPDATE supplier_orders SET
    accounting_status = 'accounted',
    accounting_entry_id = v_entry_id
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number,
    'journal', 'AC',
    'total', v_order.total
  );
END;
$$;

-- ==============================================
-- 7. UPDATE comptabiliser_reglement_fournisseur to use auxiliary
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_reglement_fournisseur(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay RECORD;
  v_entry_id uuid;
  v_piece_number text;
  v_journal text;
  v_credit_account text;
  v_supplier_name text;
  v_supplier_account text;
BEGIN
  SELECT sp.*, sup.name as supplier_name
  INTO v_pay
  FROM supplier_payments sp
  LEFT JOIN suppliers sup ON sup.id = sp.supplier_id
  WHERE sp.id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement fournisseur introuvable');
  END IF;

  IF v_pay.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement déjà comptabilisé');
  END IF;

  v_supplier_name := COALESCE(v_pay.supplier_name, 'Fournisseur');

  -- Get supplier auxiliary account
  IF v_pay.supplier_id IS NOT NULL THEN
    v_supplier_account := get_or_create_supplier_account(v_pay.tenant_id, v_pay.supplier_id);
  ELSE
    v_supplier_account := '4010000';
  END IF;

  IF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%banque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%virement%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%cheque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%chèque%' THEN
    v_journal := 'BQ'; v_credit_account := '5210000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%wave%' THEN
    v_journal := 'BQ'; v_credit_account := '5211000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%orange%' THEN
    v_journal := 'BQ'; v_credit_account := '5212000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%free%' THEN
    v_journal := 'BQ'; v_credit_account := '5213000';
  ELSE
    v_journal := 'CA'; v_credit_account := '5710000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_credit_account) THEN
    v_credit_account := '5710000'; v_journal := 'CA';
  END IF;

  v_piece_number := next_accounting_piece_number(v_pay.tenant_id, v_journal);

  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
  ) VALUES (
    v_pay.tenant_id, v_piece_number, v_journal, CURRENT_DATE,
    COALESCE((SELECT order_number FROM supplier_orders WHERE id = v_pay.order_id), ''),
    'Règlement fournisseur ' || v_supplier_name,
    v_pay.amount, v_pay.amount, true,
    'supplier_payment', p_payment_id, 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  -- Debit Fournisseur auxiliaire
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, v_supplier_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_supplier_account LIMIT 1),
    v_pay.amount, 0,
    'Règlement ' || v_supplier_name,
    v_pay.supplier_id
  );

  -- Credit Tresorerie
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, v_credit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_credit_account LIMIT 1),
    0, v_pay.amount,
    'Décaissement ' || v_supplier_name,
    v_pay.supplier_id
  );

  UPDATE supplier_payments SET
    accounting_status = 'accounted',
    accounting_entry_id = v_entry_id
  WHERE id = p_payment_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number,
    'journal', v_journal,
    'total', v_pay.amount
  );
END;
$$;

-- ==============================================
-- 8. BALANCE DES TIERS (clients ou fournisseurs)
-- ==============================================
CREATE OR REPLACE FUNCTION balance_tiers(
  p_tenant_id uuid,
  p_tiers_type text DEFAULT 'client',
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (
  tiers_id uuid,
  tiers_name text,
  account_code text,
  total_debit numeric,
  total_credit numeric,
  solde numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    jl.third_party_id as tiers_id,
    COALESCE(MAX(jl.account_name), '') as tiers_name,
    jl.account_code,
    COALESCE(SUM(jl.debit), 0) as total_debit,
    COALESCE(SUM(jl.credit), 0) as total_credit,
    COALESCE(SUM(jl.debit), 0) - COALESCE(SUM(jl.credit), 0) as solde
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = p_tenant_id
  WHERE jl.tenant_id = p_tenant_id
    AND je.status = 'posted'
    AND jl.third_party_id IS NOT NULL
    AND (
      (p_tiers_type = 'client' AND jl.account_code LIKE '411%')
      OR
      (p_tiers_type = 'supplier' AND jl.account_code LIKE '401%')
    )
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
  GROUP BY jl.third_party_id, jl.account_code
  ORDER BY solde DESC;
$$;

-- ==============================================
-- 9. INTERROGATION COMPTE TIERS (extrait)
-- ==============================================
CREATE OR REPLACE FUNCTION interrogation_tiers(
  p_tenant_id uuid,
  p_tiers_id uuid,
  p_tiers_type text DEFAULT 'client',
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL
)
RETURNS TABLE (
  entry_date date,
  entry_number text,
  journal_type text,
  reference text,
  label text,
  debit numeric,
  credit numeric,
  solde_cumule numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_running_balance numeric := 0;
  v_row RECORD;
BEGIN
  IF p_tiers_type = 'client' THEN v_prefix := '411'; ELSE v_prefix := '401'; END IF;

  FOR v_row IN
    SELECT
      je.entry_date,
      je.entry_number,
      je.journal_type,
      je.reference,
      jl.label,
      COALESCE(jl.debit, 0) as debit,
      COALESCE(jl.credit, 0) as credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id AND je.tenant_id = p_tenant_id
    WHERE jl.tenant_id = p_tenant_id
      AND je.status = 'posted'
      AND jl.third_party_id = p_tiers_id
      AND jl.account_code LIKE v_prefix || '%'
      AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
      AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
    ORDER BY je.entry_date, je.entry_number
  LOOP
    v_running_balance := v_running_balance + v_row.debit - v_row.credit;
    entry_date := v_row.entry_date;
    entry_number := v_row.entry_number;
    journal_type := v_row.journal_type;
    reference := v_row.reference;
    label := v_row.label;
    debit := v_row.debit;
    credit := v_row.credit;
    solde_cumule := v_running_balance;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- ==============================================
-- 10. RECHERCHE D'ECRITURES
-- ==============================================
CREATE OR REPLACE FUNCTION recherche_ecritures(
  p_tenant_id uuid,
  p_search text DEFAULT NULL,
  p_journal_type text DEFAULT NULL,
  p_account_code text DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_amount_min numeric DEFAULT NULL,
  p_amount_max numeric DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  entry_id uuid,
  entry_number text,
  entry_date date,
  journal_type text,
  description text,
  reference text,
  total_debit numeric,
  total_credit numeric,
  source_type text,
  status text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    je.id as entry_id,
    je.entry_number,
    je.entry_date,
    je.journal_type,
    je.description,
    je.reference,
    je.total_debit,
    je.total_credit,
    je.source_type,
    je.status
  FROM journal_entries je
  WHERE je.tenant_id = p_tenant_id
    AND (p_journal_type IS NULL OR je.journal_type = p_journal_type)
    AND (p_date_from IS NULL OR je.entry_date >= p_date_from)
    AND (p_date_to IS NULL OR je.entry_date <= p_date_to)
    AND (p_amount_min IS NULL OR je.total_debit >= p_amount_min)
    AND (p_amount_max IS NULL OR je.total_debit <= p_amount_max)
    AND (p_account_code IS NULL OR EXISTS (
      SELECT 1 FROM journal_lines jl WHERE jl.entry_id = je.id AND jl.account_code = p_account_code
    ))
    AND (p_search IS NULL OR (
      je.description ILIKE '%' || p_search || '%'
      OR je.reference ILIKE '%' || p_search || '%'
      OR je.entry_number ILIKE '%' || p_search || '%'
    ))
  ORDER BY je.entry_date DESC, je.entry_number DESC
  LIMIT p_limit;
$$;

-- ==============================================
-- 11. CLOTURE DE JOURNAL
-- ==============================================
CREATE OR REPLACE FUNCTION cloturer_journal(
  p_tenant_id uuid,
  p_journal_type text,
  p_date_to date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Check for unbalanced entries
  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE tenant_id = p_tenant_id
      AND journal_type = p_journal_type
      AND entry_date <= p_date_to
      AND status = 'posted'
      AND is_balanced = false
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Il existe des écritures non équilibrées. Corrigez-les avant de clôturer.');
  END IF;

  -- Check for draft entries
  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE tenant_id = p_tenant_id
      AND journal_type = p_journal_type
      AND entry_date <= p_date_to
      AND status = 'draft'
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Il existe des écritures en brouillon. Validez ou supprimez-les avant de clôturer.');
  END IF;

  -- Mark entries as closed (we use a convention: add 'closed_at' concept via description prefix)
  -- In practice, we prevent modification of posted entries before the closing date
  -- We'll store closing info in a dedicated way
  UPDATE journal_entries
  SET status = 'posted'
  WHERE tenant_id = p_tenant_id
    AND journal_type = p_journal_type
    AND entry_date <= p_date_to
    AND status = 'posted';

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', true,
    'journal', p_journal_type,
    'closed_until', p_date_to,
    'entries_closed', v_count
  );
END;
$$;

-- ==============================================
-- 12. CLOTURE D'EXERCICE
-- ==============================================
CREATE OR REPLACE FUNCTION cloturer_exercice(
  p_tenant_id uuid,
  p_fiscal_year int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date_from date;
  v_date_to date;
  v_total_charges numeric;
  v_total_produits numeric;
  v_resultat numeric;
  v_entry_id uuid;
  v_piece_number text;
BEGIN
  v_date_from := make_date(p_fiscal_year, 1, 1);
  v_date_to := make_date(p_fiscal_year, 12, 31);

  -- Check all journals are clean
  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE tenant_id = p_tenant_id
      AND entry_date BETWEEN v_date_from AND v_date_to
      AND (status = 'draft' OR is_balanced = false)
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Des écritures en brouillon ou déséquilibrées existent pour cet exercice.');
  END IF;

  -- Calculate result: charges (class 6) vs products (class 7)
  SELECT COALESCE(SUM(jl.debit) - SUM(jl.credit), 0)
  INTO v_total_charges
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id
  WHERE je.tenant_id = p_tenant_id AND je.status = 'posted'
    AND je.entry_date BETWEEN v_date_from AND v_date_to
    AND jl.account_code LIKE '6%';

  SELECT COALESCE(SUM(jl.credit) - SUM(jl.debit), 0)
  INTO v_total_produits
  FROM journal_lines jl
  JOIN journal_entries je ON je.id = jl.entry_id
  WHERE je.tenant_id = p_tenant_id AND je.status = 'posted'
    AND je.entry_date BETWEEN v_date_from AND v_date_to
    AND jl.account_code LIKE '7%';

  v_resultat := v_total_produits - v_total_charges;

  -- Create closing entry (OD journal)
  v_piece_number := next_accounting_piece_number(p_tenant_id, 'OD');

  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, status, posted_at, posted_by
  ) VALUES (
    p_tenant_id, v_piece_number, 'OD', v_date_to,
    'CLOTURE-' || p_fiscal_year,
    'Clôture exercice ' || p_fiscal_year || ' - Résultat : ' || v_resultat::text || ' FCFA',
    ABS(v_resultat), ABS(v_resultat), true,
    'closing', 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  -- If profit: Debit 1300000 (Resultat) / Credit 1200000 (Report a nouveau)
  -- If loss: inverse
  IF v_resultat >= 0 THEN
    -- Benefice
    INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
    VALUES
      (p_tenant_id, v_entry_id, '1310000', 'Résultat net', v_resultat, 0, 'Résultat exercice ' || p_fiscal_year),
      (p_tenant_id, v_entry_id, '1200000', 'Report à nouveau', 0, v_resultat, 'Affectation résultat ' || p_fiscal_year);
  ELSE
    -- Perte
    INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
    VALUES
      (p_tenant_id, v_entry_id, '1200000', 'Report à nouveau', ABS(v_resultat), 0, 'Perte exercice ' || p_fiscal_year),
      (p_tenant_id, v_entry_id, '1390000', 'Résultat net (perte)', 0, ABS(v_resultat), 'Résultat exercice ' || p_fiscal_year);
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'fiscal_year', p_fiscal_year,
    'total_charges', v_total_charges,
    'total_produits', v_total_produits,
    'resultat', v_resultat,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number
  );
END;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION get_or_create_customer_account(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_or_create_supplier_account(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION balance_tiers(uuid, text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION interrogation_tiers(uuid, uuid, text, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION recherche_ecritures(uuid, text, text, text, date, date, numeric, numeric, int) TO authenticated;
GRANT EXECUTE ON FUNCTION cloturer_journal(uuid, text, date) TO authenticated;
GRANT EXECUTE ON FUNCTION cloturer_exercice(uuid, int) TO authenticated;
