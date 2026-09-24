/*
# PC1E-C1.1 — Harden three client payment accounting functions

Strict corrective over PC1E-C1. No data repair, no real accounting entries.

## Functions modified

### 1. apply_credit_to_sale(uuid, uuid, numeric)
- Reject NULL / <= 0 p_amount
- Reject cancelled (status='cancelled') or deleted (deleted_at IS NOT NULL) sales
- Require non-NULL customer_id on both avoir and sale, and they must match
- True idempotence: look up (p_credit_id, p_sale_id) in both sale_payments AND
  credit_allocations BEFORE any write
  - Both exist with coherent amounts → return success + already_applied, no mutation
  - One exists but not the other, or amounts diverge → return error, no repair
  - Neither exists → single INSERT into each table (no ON CONFLICT upsert)
- All UPDATE statements include tenant_id = v_tenant_id

### 2. comptabiliser_reglement(uuid)
- Require sale_payments.status = 'confirmed'
- Reject cancelled or deleted sales
- Whitelist payment_type: cash → CA, bank/mobile/card/check → BQ
- Explicitly reject credit, NULL, or unknown payment_type
- Verify customer account is active (not just existing)
- Add tenant filter to customer lookup and final UPDATE of sale_payments

### 3. comptabiliser_reglements_clients_en_masse(uuid)
- Main loop selects ONLY eligible rows (affects_balance, confirmed, sale accounted +
  not cancelled + not deleted, paid <= total)
- Three separate read-only SELECTs compute skipped_no_balance, skipped_overpaid,
  skipped_unconfirmed
- Return skipped_unconfirmed in JSON
- Preserve C2.1 guard, signature, and privileges

## Security
- Privileges unchanged: apply_credit_to_sale → postgres + authenticated + service_role;
  comptabiliser_reglement → postgres + service_role;
  comptabiliser_reglements_clients_en_masse → postgres + authenticated + service_role
- All three: SECURITY DEFINER, search_path=public, anon REVOKED
*/

-- ============================================================
-- 1. apply_credit_to_sale
-- ============================================================
CREATE OR REPLACE FUNCTION public.apply_credit_to_sale(
  p_credit_id uuid,
  p_sale_id uuid,
  p_amount numeric
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id   uuid;
  v_credit      record;
  v_sale        record;
  v_available   numeric;
  v_remaining   numeric;
  v_to_apply    numeric;
  v_existing_sp record;
  v_existing_ca record;
BEGIN
  -- Amount validation
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Montant invalide : NULL ou inférieur/égal à zéro');
  END IF;

  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tenant introuvable');
  END IF;

  -- Lock the avoir
  SELECT * INTO v_credit
  FROM sale_returns
  WHERE id = p_credit_id AND tenant_id = v_tenant_id AND refund_method = 'avoir'
  FOR UPDATE;

  IF v_credit.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Avoir introuvable');
  END IF;
  IF v_credit.status <> 'approved' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Avoir non disponible');
  END IF;
  IF v_credit.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', 'L''avoir n''a pas de client associé');
  END IF;

  v_available := COALESCE(v_credit.total, 0) - COALESCE(v_credit.credit_used, 0);
  IF v_available <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Avoir entièrement utilisé');
  END IF;

  -- Lock the sale
  SELECT * INTO v_sale
  FROM sales
  WHERE id = p_sale_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF v_sale.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Facture introuvable');
  END IF;

  -- Reject cancelled or deleted sales
  IF v_sale.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Facture annulée');
  END IF;
  IF v_sale.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Facture supprimée');
  END IF;

  -- Customer must exist on the sale
  IF v_sale.customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', 'La facture n''a pas de client associé');
  END IF;

  -- Same-customer guard
  IF v_credit.customer_id IS DISTINCT FROM v_sale.customer_id THEN
    RETURN jsonb_build_object('success', false,
      'error', 'L''avoir et la facture n''appartiennent pas au même client');
  END IF;

  -- ---- Idempotence check ----
  SELECT id, amount INTO v_existing_sp
  FROM sale_payments
  WHERE tenant_id = v_tenant_id
    AND sale_id = p_sale_id
    AND source_return_id = p_credit_id
    AND affects_balance = false
  LIMIT 1;

  SELECT id, amount INTO v_existing_ca
  FROM credit_allocations
  WHERE tenant_id = v_tenant_id
    AND source_id = p_credit_id
    AND target_id = p_sale_id
    AND source_type = 'avoir'
    AND target_type = 'invoice'
  LIMIT 1;

  IF v_existing_sp.id IS NOT NULL AND v_existing_ca.id IS NOT NULL THEN
    -- Both exist: check coherence
    IF v_existing_sp.amount = v_existing_ca.amount THEN
      RETURN jsonb_build_object('success', true,
        'already_applied', true,
        'amount', v_existing_sp.amount);
    ELSE
      RETURN jsonb_build_object('success', false,
        'error', 'Incohérence : sale_payment.amount=' || v_existing_sp.amount
          || ' vs credit_allocation.amount=' || v_existing_ca.amount
          || '. Correction manuelle requise.');
    END IF;
  END IF;

  IF v_existing_sp.id IS NOT NULL AND v_existing_ca.id IS NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Incohérence : sale_payment existe mais credit_allocation manquante pour ce couple. Correction manuelle requise.');
  END IF;

  IF v_existing_sp.id IS NULL AND v_existing_ca.id IS NOT NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Incohérence : credit_allocation existe mais sale_payment manquant pour ce couple. Correction manuelle requise.');
  END IF;

  -- ---- Neither exists: proceed with single inserts ----
  v_remaining := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
  v_to_apply  := LEAST(p_amount, v_available, v_remaining);
  IF v_to_apply <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Rien à appliquer');
  END IF;

  -- Create sale_payment with affects_balance=false and source_return_id
  INSERT INTO sale_payments (
    tenant_id, sale_id, payment_method_id, method_name, amount,
    reference, affects_balance, source_return_id
  ) VALUES (
    v_tenant_id, p_sale_id, NULL,
    'Avoir ' || v_credit.return_number,
    v_to_apply,
    v_credit.return_number,
    false,
    p_credit_id
  );

  -- Update credit_used on the avoir
  UPDATE sale_returns
  SET credit_used = COALESCE(credit_used, 0) + v_to_apply
  WHERE id = p_credit_id AND tenant_id = v_tenant_id;

  -- Update sale paid/status
  UPDATE sales
  SET paid   = COALESCE(paid, 0) + v_to_apply,
      status = CASE
        WHEN COALESCE(paid, 0) + v_to_apply >= total THEN 'paid'
        ELSE 'partial'
      END
  WHERE id = p_sale_id AND tenant_id = v_tenant_id;

  -- Single insert into credit_allocations (no ON CONFLICT upsert)
  INSERT INTO credit_allocations (
    tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
  ) VALUES (
    v_tenant_id, v_sale.customer_id, 'avoir', p_credit_id, 'invoice', p_sale_id, v_to_apply
  );

  RETURN jsonb_build_object('success', true, 'applied', v_to_apply);
END;
$function$;

-- Privileges: unchanged from PC1E-C1
REVOKE ALL ON FUNCTION public.apply_credit_to_sale(uuid, uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_credit_to_sale(uuid, uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.apply_credit_to_sale(uuid, uuid, numeric)
  TO postgres, authenticated, service_role;


-- ============================================================
-- 2. comptabiliser_reglement
-- ============================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglement(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay               record;
  v_sale              record;
  v_pm                record;
  v_entry_id          uuid;
  v_piece_number      text;
  v_journal           text;
  v_debit_account     text;
  v_customer_account  text;
  v_customer_name     text;
  v_acct_check        record;
  v_cust_acct_check   record;
BEGIN
  -- Lock and fetch the payment
  SELECT sp.*
  INTO v_pay
  FROM sale_payments sp
  WHERE sp.id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement introuvable');
  END IF;

  -- Skip non-balance-affecting payments (prepayments, avoirs, credit allocations)
  IF v_pay.affects_balance = false THEN
    RETURN jsonb_build_object('success', true, 'skipped', true,
      'reason', 'affects_balance=false');
  END IF;

  -- Require confirmed status
  IF v_pay.status IS NULL OR v_pay.status <> 'confirmed' THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Règlement non confirmé (status=' || COALESCE(v_pay.status, 'NULL') || ')');
  END IF;

  -- Already accounted guard
  IF v_pay.accounting_status = 'accounted' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement déjà comptabilisé');
  END IF;

  -- Amount guard
  IF COALESCE(v_pay.amount, 0) <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Montant du règlement invalide');
  END IF;

  -- Fetch and validate the sale (same tenant)
  SELECT s.*
  INTO v_sale
  FROM sales s
  WHERE s.id = v_pay.sale_id AND s.tenant_id = v_pay.tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Vente introuvable ou tenant incohérent');
  END IF;

  -- Reject cancelled or deleted sales
  IF v_sale.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Vente annulée, comptabilisation refusée');
  END IF;
  IF v_sale.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Vente supprimée, comptabilisation refusée');
  END IF;

  -- Overpaid sale guard
  IF round(v_sale.paid, 2) > round(v_sale.total, 2) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Vente en trop-perçu (paid > total), correction requise',
      'sale_number', v_sale.sale_number);
  END IF;

  -- Fetch payment method (same tenant) with account_code
  SELECT pm.*
  INTO v_pm
  FROM payment_methods pm
  WHERE pm.id = v_pay.payment_method_id AND pm.tenant_id = v_pay.tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Mode de paiement introuvable pour ce tenant');
  END IF;

  -- Whitelist payment_type: cash→CA, bank/mobile/card/check→BQ
  IF v_pm.payment_type = 'cash' THEN
    v_journal := 'CA';
  ELSIF v_pm.payment_type IN ('bank', 'mobile', 'card', 'check') THEN
    v_journal := 'BQ';
  ELSE
    RETURN jsonb_build_object('success', false, 'error',
      'Type de paiement non autorisé pour comptabilisation: '
      || COALESCE(v_pm.payment_type, 'NULL'));
  END IF;

  IF v_pm.account_code IS NULL OR v_pm.account_code = '' THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Mode de paiement sans code comptable configuré: ' || COALESCE(v_pm.name, ''));
  END IF;

  -- Verify the treasury account exists and is active in the same tenant
  SELECT a.code, a.name, a.is_active
  INTO v_acct_check
  FROM accounts a
  WHERE a.tenant_id = v_pay.tenant_id AND a.code = v_pm.account_code;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Compte de trésorerie ' || v_pm.account_code || ' introuvable pour ce tenant');
  END IF;
  IF v_acct_check.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Compte de trésorerie ' || v_pm.account_code || ' inactif');
  END IF;

  v_debit_account := v_pm.account_code;

  -- Customer account: auxiliary if customer exists, otherwise CUSTOMER_CONTROL via resolve_account
  IF v_sale.customer_id IS NOT NULL THEN
    BEGIN
      v_customer_account := get_or_create_customer_account(v_pay.tenant_id, v_sale.customer_id);
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error',
        'Erreur création compte auxiliaire client: ' || SQLERRM);
    END;
  ELSE
    BEGIN
      v_customer_account := resolve_account(v_pay.tenant_id, 'CUSTOMER_CONTROL');
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('success', false, 'error',
        'Erreur résolution CUSTOMER_CONTROL: ' || SQLERRM);
    END;
  END IF;

  -- Verify customer account exists AND is active
  SELECT a.code, a.is_active
  INTO v_cust_acct_check
  FROM accounts a
  WHERE a.tenant_id = v_pay.tenant_id AND a.code = v_customer_account;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Compte client ' || v_customer_account || ' introuvable');
  END IF;
  IF v_cust_acct_check.is_active IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error',
      'Compte client ' || v_customer_account || ' inactif');
  END IF;

  -- Customer name for description
  SELECT COALESCE(c.name, 'Client comptant')
  INTO v_customer_name
  FROM customers c
  WHERE c.id = v_sale.customer_id AND c.tenant_id = v_pay.tenant_id;
  IF v_customer_name IS NULL THEN
    v_customer_name := 'Client comptant';
  END IF;

  -- Piece number
  v_piece_number := next_accounting_piece_number(v_pay.tenant_id, v_journal);

  -- Create journal entry (date = payment created_at, not CURRENT_DATE)
  INSERT INTO journal_entries (
    tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by
  ) VALUES (
    v_pay.tenant_id, v_piece_number, v_journal,
    COALESCE(v_pay.created_at::date, CURRENT_DATE),
    v_sale.sale_number,
    'Règlement ' || v_customer_name || ' - ' || v_sale.sale_number,
    v_pay.amount, v_pay.amount, true,
    'payment', p_payment_id, 'posted', now(), auth.uid()
  ) RETURNING id INTO v_entry_id;

  -- Debit: Treasury
  INSERT INTO journal_lines (
    tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
  ) VALUES (
    v_pay.tenant_id, v_entry_id, v_debit_account,
    v_acct_check.name,
    v_pay.amount, 0,
    'Encaissement ' || v_sale.sale_number || ' ' || v_customer_name,
    v_sale.customer_id
  );

  -- Credit: Customer auxiliary
  INSERT INTO journal_lines (
    tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
  ) VALUES (
    v_pay.tenant_id, v_entry_id, v_customer_account,
    (SELECT name FROM accounts WHERE tenant_id = v_pay.tenant_id AND code = v_customer_account LIMIT 1),
    0, v_pay.amount,
    'Règlement ' || v_customer_name,
    v_sale.customer_id
  );

  -- Mark payment as accounted (with tenant filter)
  UPDATE sale_payments SET
    accounting_status   = 'accounted',
    accounting_entry_id = v_entry_id
  WHERE id = p_payment_id AND tenant_id = v_pay.tenant_id;

  RETURN jsonb_build_object(
    'success', true,
    'entry_id', v_entry_id,
    'piece_number', v_piece_number,
    'journal', v_journal,
    'total', v_pay.amount
  );
END;
$function$;

-- Privileges: unchanged from PC1E-C1
REVOKE ALL ON FUNCTION public.comptabiliser_reglement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglement(uuid)
  TO postgres, service_role;


-- ============================================================
-- 3. comptabiliser_reglements_clients_en_masse
-- ============================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglements_clients_en_masse(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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
  -- C2.1 tenant guard
  IF auth.uid() IS NULL OR current_tenant_id() IS NULL
     OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'Acces refuse au tenant demande';
  END IF;

  -- Count skipped categories via read-only SELECTs
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

  -- Main loop: only eligible rows
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

-- Privileges: unchanged from PC1E-C1
REVOKE ALL ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglements_clients_en_masse(uuid)
  TO postgres, authenticated, service_role;
