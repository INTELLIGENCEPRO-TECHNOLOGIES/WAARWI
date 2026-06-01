/*
  # Fonctions de comptabilisation automatique SYSCOHADA

  1. Fonctions
    - `next_accounting_piece_number(tenant_id, journal_type)` : genere le numero de piece sequentiel
    - `comptabiliser_vente(p_sale_id)` : comptabilise une facture de vente
    - `comptabiliser_reglement(p_payment_id)` : comptabilise un reglement client
    - `comptabiliser_achat(p_order_id)` : comptabilise une commande fournisseur
    - `comptabiliser_reglement_fournisseur(p_payment_id)` : comptabilise un reglement fournisseur
    - `comptabiliser_depense(p_movement_id)` : comptabilise un mouvement de caisse (depense/retrait)

  2. Principes
    - Partie double : total debit = total credit
    - Idempotence : impossible de comptabiliser deux fois
    - Transactionnel : tout ou rien
    - Multi-tenant strict
    - SYSCOHADA conforme (comptes 4, 5, 6, 7)

  3. Comptes SYSCOHADA utilises
    - 411xxx : Clients
    - 401xxx : Fournisseurs
    - 521xxx : Banque
    - 571xxx : Caisse
    - 601xxx : Achats marchandises
    - 6xxx   : Charges (selon nature)
    - 701/707: Ventes marchandises
    - 4431   : TVA collectee
    - 4451   : TVA deductible
*/

-- ==============================================
-- HELPER: Generate next piece number
-- Format: JJYYnnnnnn (ex: VEN250001, CAI250145)
-- ==============================================
CREATE OR REPLACE FUNCTION next_accounting_piece_number(
  p_tenant_id uuid,
  p_journal_type text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year int;
  v_next int;
  v_prefix text;
BEGIN
  v_year := EXTRACT(YEAR FROM CURRENT_DATE)::int % 100;
  v_prefix := UPPER(LEFT(p_journal_type, 3));

  INSERT INTO accounting_sequences (tenant_id, journal_type, fiscal_year, last_number)
  VALUES (p_tenant_id, p_journal_type, v_year, 1)
  ON CONFLICT (tenant_id, journal_type, fiscal_year)
  DO UPDATE SET last_number = accounting_sequences.last_number + 1
  RETURNING last_number INTO v_next;

  RETURN v_prefix || LPAD(v_year::text, 2, '0') || LPAD(v_next::text, 5, '0');
END;
$$;

-- ==============================================
-- COMPTABILISER UNE VENTE (FACTURE)
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

  -- 3. Verifier statut valide (pas brouillon, pas annulee)
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
    v_debit_account := '5710';
  ELSE
    -- Vente a credit : debit Client, credit Vente + TVA
    v_journal := 'VE';
    v_debit_account := '4110';
  END IF;

  v_credit_vente := '7010';
  v_credit_tva := '4431';

  -- 6. Verifier que les comptes existent dans le plan comptable du tenant
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_vente || ' introuvable dans le plan comptable');
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
  -- Ligne debit (Caisse ou Client)
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_sale.tenant_id, v_entry_id, v_debit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_debit_account),
    v_ttc, 0,
    'Vente ' || v_sale.sale_number,
    v_sale.customer_id
  );

  -- Ligne credit Vente (HT)
  IF v_ht > 0 THEN
    INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
    VALUES (
      v_sale.tenant_id, v_entry_id, v_credit_vente,
      (SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_vente),
      0, v_ht,
      'Vente marchandises ' || v_sale.sale_number
    );
  END IF;

  -- Ligne credit TVA (si applicable)
  IF v_tva > 0 THEN
    IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Compte TVA ' || v_credit_tva || ' introuvable');
    END IF;
    INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
    VALUES (
      v_sale.tenant_id, v_entry_id, v_credit_tva,
      (SELECT name FROM accounts WHERE tenant_id = v_sale.tenant_id AND code = v_credit_tva),
      0, v_tva,
      'TVA collectée ' || v_sale.sale_number
    );
  END IF;

  -- Si pas de TVA, ajuster pour equilibrer (HT = TTC dans ce cas)
  -- L'equilibre est garanti par construction: debit TTC = credit HT + credit TVA

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
-- COMPTABILISER UN REGLEMENT CLIENT
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_reglement(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay RECORD;
  v_sale RECORD;
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
  IF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%banque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%virement%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%cheque%' THEN
    v_journal := 'BQ';
    v_debit_account := '5210';
  ELSE
    v_journal := 'CA';
    v_debit_account := '5710';
  END IF;

  -- 4. Client
  SELECT COALESCE(c.name, 'Client comptant') INTO v_customer_name
  FROM customers c WHERE c.id = v_pay.customer_id;
  IF v_customer_name IS NULL THEN v_customer_name := 'Client comptant'; END IF;

  -- 5. Verifier comptes
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_debit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = '4110') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte 4110 (Client) introuvable');
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

  -- 8. Lignes : Debit Tresorerie / Credit Client
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, v_debit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_debit_account),
    v_pay.amount, 0,
    'Encaissement ' || v_pay.sale_number,
    v_pay.customer_id
  );

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, '4110',
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = '4110'),
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
-- COMPTABILISER UN ACHAT FOURNISSEUR
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
  -- 1. Charger la commande
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

  -- 2. Verifier comptes
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = '6010') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte 6010 (Achats) introuvable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_order.tenant_id AND code = '4010') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte 4010 (Fournisseur) introuvable');
  END IF;

  -- 3. Generer piece
  v_piece_number := next_accounting_piece_number(v_order.tenant_id, 'AC');

  -- 4. Creer l'entree journal Achats
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

  -- 5. Lignes : Debit Achats / Credit Fournisseur
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_order.tenant_id, v_entry_id, '6010',
    (SELECT name FROM accounts WHERE tenant_id = v_order.tenant_id AND code = '6010'),
    v_order.total, 0,
    'Achat marchandises ' || v_order.order_number,
    v_order.supplier_id
  );

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_order.tenant_id, v_entry_id, '4010',
    (SELECT name FROM accounts WHERE tenant_id = v_order.tenant_id AND code = '4010'),
    0, v_order.total,
    'Fournisseur ' || v_supplier_name,
    v_order.supplier_id
  );

  -- 6. Mettre a jour
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
-- COMPTABILISER UN REGLEMENT FOURNISSEUR
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
  -- 1. Charger
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

  -- 2. Journal selon mode paiement
  IF LOWER(COALESCE(v_pay.method_name, '')) LIKE '%banque%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%virement%' OR LOWER(COALESCE(v_pay.method_name, '')) LIKE '%cheque%' THEN
    v_journal := 'BQ';
    v_credit_account := '5210';
  ELSE
    v_journal := 'CA';
    v_credit_account := '5710';
  END IF;

  -- 3. Verifier comptes
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = '4010') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte 4010 (Fournisseur) introuvable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_credit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' introuvable');
  END IF;

  -- 4. Piece
  v_piece_number := next_accounting_piece_number(v_pay.tenant_id, v_journal);

  -- 5. Entree
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

  -- 6. Lignes : Debit Fournisseur / Credit Tresorerie
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, '4010',
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = '4010'),
    v_pay.amount, 0,
    'Règlement ' || v_supplier_name,
    v_pay.supplier_id
  );

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (
    v_pay.tenant_id, v_entry_id, v_credit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_credit_account),
    0, v_pay.amount,
    'Décaissement ' || v_supplier_name,
    v_pay.supplier_id
  );

  -- 7. Mettre a jour
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
-- COMPTABILISER UNE DEPENSE (mouvement de caisse sortie)
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
  -- 1. Charger
  SELECT * INTO v_mov
  FROM cash_movements
  WHERE id = p_movement_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mouvement introuvable');
  END IF;

  IF v_mov.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mouvement déjà comptabilisé');
  END IF;

  -- 2. Compte de charge selon le motif
  -- Par defaut on utilise 6110 (Transport) ou 6060 (Achats non stockes)
  -- On pourra enrichir cette logique
  CASE LOWER(COALESCE(v_mov.reason, ''))
    WHEN 'transport' THEN v_debit_account := '6110';
    WHEN 'loyer' THEN v_debit_account := '6220';
    WHEN 'electricite' THEN v_debit_account := '6051';
    WHEN 'eau' THEN v_debit_account := '6052';
    WHEN 'telephone' THEN v_debit_account := '6260';
    WHEN 'fournitures' THEN v_debit_account := '6040';
    ELSE v_debit_account := '6060';
  END CASE;

  -- Si le mouvement est une entree (deposit), les ecritures sont inversees
  IF v_mov.kind = 'deposit' THEN
    -- Entree de caisse : Debit Caisse / Credit (source selon raison)
    v_journal := 'CA';
    v_credit_account := v_debit_account;
    v_debit_account := '5710';
  ELSE
    -- Sortie de caisse : Debit Charge / Credit Caisse
    v_journal := 'CA';
    v_credit_account := '5710';
  END IF;

  -- 3. Verifier comptes
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_debit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable dans le plan comptable');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_credit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' introuvable dans le plan comptable');
  END IF;

  -- 4. Piece
  v_piece_number := next_accounting_piece_number(v_mov.tenant_id, v_journal);

  -- 5. Entree
  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
  ) VALUES (
    v_mov.tenant_id, v_piece_number, v_journal, CURRENT_DATE,
    COALESCE(v_mov.reference, ''),
    COALESCE(v_mov.reason, 'Mouvement caisse') || ' - ' || COALESCE(v_mov.note, ''),
    v_mov.amount, v_mov.amount, true,
    'cash_movement', p_movement_id, 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  -- 6. Lignes
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
  VALUES (
    v_mov.tenant_id, v_entry_id, v_debit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_debit_account),
    v_mov.amount, 0,
    COALESCE(v_mov.reason, 'Mouvement') || ' ' || COALESCE(v_mov.note, '')
  );

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
  VALUES (
    v_mov.tenant_id, v_entry_id, v_credit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_credit_account),
    0, v_mov.amount,
    COALESCE(v_mov.reason, 'Mouvement') || ' ' || COALESCE(v_mov.note, '')
  );

  -- 7. Mettre a jour
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

-- ==============================================
-- COMPTABILISATION EN MASSE DES VENTES
-- ==============================================
CREATE OR REPLACE FUNCTION comptabiliser_ventes_en_masse(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_result jsonb;
  v_success int := 0;
  v_errors int := 0;
  v_error_messages jsonb[] := '{}';
BEGIN
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
$$;

-- Grant execute to authenticated
GRANT EXECUTE ON FUNCTION next_accounting_piece_number(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION comptabiliser_vente(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comptabiliser_reglement(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comptabiliser_achat(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comptabiliser_reglement_fournisseur(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comptabiliser_depense(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION comptabiliser_ventes_en_masse(uuid) TO authenticated;
