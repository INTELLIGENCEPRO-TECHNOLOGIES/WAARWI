/*
# RS1 Section F — Accounting for customer balance payments

## New functions
1. `comptabiliser_reglement_solde_client(p_customer_payment_id uuid)` — SECURITY DEFINER
   Creates a journal entry for a customer_payment record:
   - Debit: Treasury account (from payment_method.account_code)
   - Credit: Customer auxiliary account (from get_or_create_customer_account)
   - Journal type: CA for cash, BQ for bank/mobile/card/check
   - Marks customer_payment as accounted

2. Extends `comptabiliser_reglements_clients_en_masse` to also process unaccounted
   customer_payments after processing sale_payments.

## Security
- Both functions require manage_accounting permission
- SECURITY DEFINER with locked search_path
- EXECUTE granted to authenticated and service_role only
*/

-- ============================================================
-- 1. comptabiliser_reglement_solde_client (single item)
-- ============================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglement_solde_client(p_customer_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cp               record;
  v_pm               record;
  v_entry_id          uuid;
  v_piece_number      text;
  v_journal           text;
  v_debit_account     text;
  v_customer_account  text;
  v_customer_name     text;
  v_acct_check        record;
  v_cust_acct_check   record;
BEGIN
  IF NOT current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Permission manage_accounting requise';
  END IF;

  SELECT cp.* INTO v_cp FROM customer_payments cp
    WHERE cp.id = p_customer_payment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement solde introuvable');
  END IF;

  IF v_cp.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Règlement solde non confirmé (status=' || COALESCE(v_cp.status, 'NULL') || ')');
  END IF;

  IF v_cp.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Déjà comptabilisé');
  END IF;

  IF COALESCE(v_cp.amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Montant invalide');
  END IF;

  -- Payment method
  SELECT pm.* INTO v_pm FROM payment_methods pm
    WHERE pm.id = v_cp.payment_method_id AND pm.tenant_id = v_cp.tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Mode de paiement introuvable');
  END IF;

  IF v_pm.payment_type = 'cash' THEN v_journal := 'CA';
  ELSIF v_pm.payment_type IN ('bank', 'mobile', 'card', 'check') THEN v_journal := 'BQ';
  ELSE
    RETURN jsonb_build_object('success', false, 'error',
      'Type de paiement non autorisé: ' || COALESCE(v_pm.payment_type, 'NULL'));
  END IF;

  IF COALESCE(v_pm.account_code, '') = '' THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Mode de paiement sans code comptable: ' || COALESCE(v_pm.name, ''));
  END IF;

  -- Verify treasury account
  SELECT a.code, a.name, a.is_active INTO v_acct_check
    FROM accounts a WHERE a.tenant_id = v_cp.tenant_id AND a.code = v_pm.account_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Compte trésorerie ' || v_pm.account_code || ' introuvable');
  END IF;
  IF v_acct_check.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Compte trésorerie ' || v_pm.account_code || ' inactif');
  END IF;

  v_debit_account := v_pm.account_code;

  -- Customer auxiliary account
  BEGIN
    v_customer_account := get_or_create_customer_account(v_cp.tenant_id, v_cp.customer_id);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Erreur compte auxiliaire client: ' || SQLERRM);
  END;

  SELECT a.code, a.is_active INTO v_cust_acct_check
    FROM accounts a WHERE a.tenant_id = v_cp.tenant_id AND a.code = v_customer_account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Compte client ' || v_customer_account || ' introuvable');
  END IF;
  IF v_cust_acct_check.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Compte client ' || v_customer_account || ' inactif');
  END IF;

  SELECT COALESCE(c.name, 'Client') INTO v_customer_name
    FROM customers c WHERE c.id = v_cp.customer_id AND c.tenant_id = v_cp.tenant_id;

  v_piece_number := next_accounting_piece_number(v_cp.tenant_id, v_journal);

  -- Create journal entry
  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
  ) VALUES (
    v_cp.tenant_id, v_piece_number, v_journal,
    COALESCE(v_cp.created_at::date, CURRENT_DATE),
    COALESCE(v_cp.reference, ''),
    'Règlement solde ' || v_customer_name,
    v_cp.amount, v_cp.amount, true,
    'customer_payment', p_customer_payment_id, 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  -- Debit: Treasury
  INSERT INTO journal_lines (
    tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
  ) VALUES (
    v_cp.tenant_id, v_entry_id, v_debit_account, v_acct_check.name,
    v_cp.amount, 0,
    'Encaissement solde ' || v_customer_name,
    v_cp.customer_id
  );

  -- Credit: Customer auxiliary
  INSERT INTO journal_lines (
    tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
  ) VALUES (
    v_cp.tenant_id, v_entry_id, v_customer_account,
    (SELECT name FROM accounts WHERE tenant_id = v_cp.tenant_id AND code = v_customer_account LIMIT 1),
    0, v_cp.amount,
    'Règlement solde ' || v_customer_name,
    v_cp.customer_id
  );

  -- Mark as accounted
  UPDATE customer_payments SET
    accounting_status = 'accounted',
    accounting_entry_id = v_entry_id,
    accounted_at = now()
  WHERE id = p_customer_payment_id AND tenant_id = v_cp.tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number,
    'journal', v_journal,
    'total', v_cp.amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.comptabiliser_reglement_solde_client(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_solde_client(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglement_solde_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglement_solde_client(uuid) TO service_role;

-- ============================================================
-- 2. Extend comptabiliser_reglements_clients_en_masse to handle customer_payments
-- ============================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglements_clients_en_masse(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay                 record;
  v_result              jsonb;
  v_success             int := 0;
  v_errors              int := 0;
  v_skipped_no_bal      int := 0;
  v_skipped_overpaid    int := 0;
  v_skipped_unconfirmed int := 0;
  v_bal_success         int := 0;
  v_bal_errors          int := 0;
  v_error_messages      jsonb[] := '{}';
BEGIN
  IF auth.uid() IS NULL OR current_tenant_id() IS NULL
     OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'Acces refuse au tenant demande';
  END IF;

  IF NOT current_user_can_manage_accounting() THEN
    RAISE EXCEPTION 'Permission manage_accounting requise';
  END IF;

  -- ---- Sale payments (existing logic) ----

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

  -- ---- Customer balance payments (NEW) ----

  FOR v_pay IN
    SELECT cp.id
    FROM customer_payments cp
    WHERE cp.tenant_id = p_tenant_id
      AND cp.status = 'confirmed'
      AND (cp.accounting_status = 'not_accounted' OR cp.accounting_status IS NULL)
    ORDER BY cp.created_at
  LOOP
    v_result := comptabiliser_reglement_solde_client(v_pay.id);
    IF (v_result->>'success')::boolean THEN
      v_bal_success := v_bal_success + 1;
    ELSE
      v_bal_errors := v_bal_errors + 1;
      v_error_messages := array_append(v_error_messages,
        jsonb_build_object('customer_payment_id', v_pay.id, 'error', v_result->>'error'));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'accounted', v_success,
    'errors', v_errors,
    'skipped_no_balance', v_skipped_no_bal,
    'skipped_overpaid', v_skipped_overpaid,
    'skipped_unconfirmed', v_skipped_unconfirmed,
    'balance_payments_accounted', v_bal_success,
    'balance_payments_errors', v_bal_errors,
    'error_details', to_jsonb(v_error_messages)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) TO service_role;
