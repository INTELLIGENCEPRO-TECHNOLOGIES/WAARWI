/*
  # Correction des fonctions de comptabilisation - codes 7 chiffres

  1. Modifications
    - Mise a jour de tous les codes comptes vers 7 chiffres (SYSCOHADA standard)
    - 4110000 = Clients (compte collectif)
    - 4010000 = Fournisseurs (compte collectif)
    - 5710000 = Caisse
    - 5210000 = Banque
    - 7010000 = Ventes de marchandises
    - 4457000 = TVA collectee
    - 4456000 = TVA deductible
    - 6010000 = Achats de marchandises
    - 6580000 = Charges diverses

  2. Notes
    - Le third_party_id identifie le client/fournisseur specifique (comme dans Sage)
    - Le compte collectif est utilise pour les ecritures
    - Pas besoin de creer des comptes auxiliaires par tiers
*/

-- ==============================================
-- COMPTABILISER UNE VENTE (FACTURE) - CORRIGE
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
BEGIN
  -- 1. Charger la vente
  SELECT s.*, c.name as customer_name
  INTO v_sale
  FROM sales s
  LEFT JOIN customers c ON c.id = s.customer_id
  WHERE s.id = p_sale_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente introuvable');
  END IF;

  -- 2. Verifier non deja comptabilisee
  IF v_sale.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Vente déjà comptabilisée');
  END IF;

  -- 3. Verifier statut valide
  IF v_sale.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Impossible de comptabiliser une vente annulée');
  END IF;

  -- 4. Calculs
  v_ht := v_sale.subtotal - COALESCE(v_sale.discount, 0);
  v_tva := COALESCE(v_sale.vat_amount, 0);
  v_ttc := v_sale.total;
  v_customer_name := COALESCE(v_sale.customer_name, 'Client comptant');

  -- 5. Determiner le journal et les comptes selon le type
  IF v_sale.status = 'paid' THEN
    -- Vente au comptant : debit Caisse, credit Vente + TVA
    v_journal := 'CA';
    v_debit_account := '5710000';
  ELSE
    -- Vente a credit : debit Client, credit Vente + TVA
    v_journal := 'VE';
    v_debit_account := '4110000';
  END IF;

  v_credit_vente := '7010000';
  v_credit_tva := '4457000';

  -- 6. Verifier que les comptes existent dans le plan comptable du tenant
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable. Veuillez le créer d''abord.');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_vente || ' introuvable dans le plan comptable. Veuillez le créer d''abord.');
  END IF;

  -- 7. Generer le numero de piece
  v_piece_number := next_accounting_piece_number(v_sale.tenant_id, v_journal);

  -- 8. Creer l'entree du journal
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

  -- 9. Creer les lignes d'ecritures
  -- Ligne debit (Caisse ou Client collectif)
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_sale.tenant_id, v_entry_id, v_debit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account LIMIT 1),
    v_ttc, 0,
    'Vente ' || v_sale.sale_number || ' ' || v_customer_name,
    v_sale.customer_id
  );

  -- Ligne credit Vente (HT)
  IF v_ht > 0 THEN
    INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
    VALUES (
      v_sale.tenant_id, v_entry_id, v_credit_vente,
      (SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente LIMIT 1),
      0, v_ht,
      'Vente marchandises ' || v_sale.sale_number
    );
  END IF;

  -- Ligne credit TVA (si applicable)
  IF v_tva > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva) THEN
      -- Si pas de compte TVA, tout sur vente (pas de TVA pour ce tenant)
      UPDATE journal_lines SET credit = v_ttc
      WHERE entry_id = v_entry_id AND account_code = v_credit_vente;
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

  -- 10. Mettre a jour la vente
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
-- COMPTABILISER UN REGLEMENT CLIENT - CORRIGE
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
BEGIN
  -- 1. Charger le reglement
  SELECT sp.*, s.sale_number, s.customer_id, s.tenant_id as sale_tenant_id
  INTO v_pay
  FROM sale_payments sp
  JOIN sales s ON s.id = sp.sale_id
  WHERE sp.id = p_payment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement introuvable');
  END IF;

  -- 2. Verifier non deja comptabilise
  IF v_pay.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement déjà comptabilisé');
  END IF;

  -- 3. Determiner le journal selon le mode de paiement
  IF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%banque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%virement%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%cheque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%chèque%' THEN
    v_journal := 'BQ';
    v_debit_account := '5210000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%wave%' THEN
    v_journal := 'BQ';
    v_debit_account := '5211000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%orange%' THEN
    v_journal := 'BQ';
    v_debit_account := '5212000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%free%' THEN
    v_journal := 'BQ';
    v_debit_account := '5213000';
  ELSE
    v_journal := 'CA';
    v_debit_account := '5710000';
  END IF;

  -- 4. Client
  SELECT COALESCE(c.name, 'Client comptant') INTO v_customer_name
  FROM customers c WHERE c.id = v_pay.customer_id;
  IF v_customer_name IS NULL THEN v_customer_name := 'Client comptant'; END IF;

  -- 5. Verifier comptes
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_debit_account) THEN
    -- Fallback sur caisse si le compte specifique n'existe pas
    v_debit_account := '5710000';
    v_journal := 'CA';
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_debit_account) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable');
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = '4110000') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte 4110000 (Clients) introuvable');
  END IF;

  -- 6. Generer piece
  v_piece_number := next_accounting_piece_number(v_pay.tenant_id, v_journal);

  -- 7. Creer l'entree
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

  -- 8. Lignes : Debit Tresorerie / Credit Client collectif
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, v_debit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_debit_account LIMIT 1),
    v_pay.amount, 0,
    'Encaissement ' || v_pay.sale_number,
    v_pay.customer_id
  );

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, '4110000',
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = '4110000' LIMIT 1),
    0, v_pay.amount,
    'Règlement client ' || v_customer_name,
    v_pay.customer_id
  );

  -- 9. Mettre a jour le reglement
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
-- COMPTABILISER UN ACHAT FOURNISSEUR - CORRIGE
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

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = '6010000') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte 6010000 (Achats) introuvable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = '4010000') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte 4010000 (Fournisseurs) introuvable');
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

  -- Debit Achats / Credit Fournisseur collectif
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
    v_order.tenant_id, v_entry_id, '4010000',
    (SELECT name FROM accounts WHERE tenant_id = v_order.tenant_id AND code = '4010000' LIMIT 1),
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
-- COMPTABILISER UN REGLEMENT FOURNISSEUR - CORRIGE
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

  IF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%banque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%virement%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%cheque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%chèque%' THEN
    v_journal := 'BQ';
    v_credit_account := '5210000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%wave%' THEN
    v_journal := 'BQ';
    v_credit_account := '5211000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%orange%' THEN
    v_journal := 'BQ';
    v_credit_account := '5212000';
  ELSIF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%free%' THEN
    v_journal := 'BQ';
    v_credit_account := '5213000';
  ELSE
    v_journal := 'CA';
    v_credit_account := '5710000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = '4010000') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte 4010000 (Fournisseurs) introuvable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_credit_account) THEN
    v_credit_account := '5710000';
    v_journal := 'CA';
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_credit_account) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' introuvable');
    END IF;
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

  -- Debit Fournisseur collectif / Credit Tresorerie
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, '4010000',
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = '4010000' LIMIT 1),
    v_pay.amount, 0,
    'Règlement ' || v_supplier_name,
    v_pay.supplier_id
  );

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
-- COMPTABILISER UNE DEPENSE - CORRIGE
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_depense(p_movement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov RECORD;
  v_entry_id uuid;
  v_piece_number text;
  v_journal text;
  v_debit_account text;
  v_credit_account text;
BEGIN
  SELECT * INTO v_mov
  FROM cash_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mouvement introuvable');
  END IF;

  IF v_mov.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mouvement déjà comptabilisé');
  END IF;

  -- Compte de charge par defaut : 6580000 (Charges diverses)
  -- Pour les depenses connues, on utilise des comptes specifiques s'ils existent
  v_debit_account := '6580000';

  -- Si le mouvement est une entree (deposit)
  IF v_mov.kind = 'deposit' THEN
    v_journal := 'CA';
    v_credit_account := '7580000';
    v_debit_account := '5710000';
    -- Verifier
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = '7580000') THEN
      v_credit_account := '7010000';
    END IF;
  ELSE
    -- Sortie de caisse : Debit Charge / Credit Caisse
    v_journal := 'CA';
    v_credit_account := '5710000';
  END IF;

  -- 3. Verifier comptes
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_debit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_credit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' introuvable dans le plan comptable');
  END IF;

  v_piece_number := next_accounting_piece_number(v_mov.tenant_id, v_journal);

  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
  ) VALUES (
    v_mov.tenant_id, v_piece_number, v_journal, CURRENT_DATE,
    COALESCE(v_mov.reference, ''),
    COALESCE(v_mov.reason, 'Mouvement caisse') || CASE WHEN v_mov.note IS NOT NULL AND v_mov.note != '' THEN ' - ' || v_mov.note ELSE '' END,
    v_mov.amount, v_mov.amount, true,
    'cash_movement', p_movement_id, 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
  VALUES (
    v_mov.tenant_id, v_entry_id, v_debit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_debit_account LIMIT 1),
    v_mov.amount, 0,
    COALESCE(v_mov.reason, 'Mouvement') || CASE WHEN v_mov.note IS NOT NULL AND v_mov.note != '' THEN ' ' || v_mov.note ELSE '' END
  );

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
  VALUES (
    v_mov.tenant_id, v_entry_id, v_credit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_credit_account LIMIT 1),
    0, v_mov.amount,
    COALESCE(v_mov.reason, 'Mouvement') || CASE WHEN v_mov.note IS NOT NULL AND v_mov.note != '' THEN ' ' || v_mov.note ELSE '' END
  );

  UPDATE cash_movements SET
    accounting_status = 'accounted',
    accounting_entry_id = v_entry_id
  WHERE id = p_movement_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number,
    'journal', v_journal,
    'total', v_mov.amount
  );
END;
$$;
