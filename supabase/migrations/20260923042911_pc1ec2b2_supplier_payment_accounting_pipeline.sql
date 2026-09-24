/*
# PC1E-C2-B2 — Supplier payment accounting pipeline overhaul

## Changes
- PART 1: B1.1 hardening — IS DISTINCT FROM in 4 auxiliary functions + tenant guard in triggers
- PART 2: register_supplier_payment — rewrite with validations, funding_source='cash', excluded cash_movements
- PART 3: register_supplier_payment_from_vault — idempotency validation, use PM.name
- PART 4: comptabiliser_reglement_fournisseur — full rewrite, zero hardcoded codes
- PART 5: comptabiliser_reglements_fournisseurs_en_masse — categorized skip counts
- PART 6: comptabiliser_depense — supplier_id and excluded guards
- PART 7: Data fix — exclude 4 supplier-linked cash_movements (1,510,000 FCFA)
- PART 8: Data fix — backfill funding_source='cash' on 26 NULL-funded supplier_payments
*/

-- ============================================================
-- PART 1: B1.1 Hardening — 4 auxiliary account functions
-- ============================================================

-- 1a. get_or_create_customer_account
CREATE OR REPLACE FUNCTION public.get_or_create_customer_account(
  p_tenant_id uuid, p_customer_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_code text; v_name text; v_collective text; v_prefix text; v_next_num int; v_acct record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'Access denied: caller tenant does not match p_tenant_id %', p_tenant_id;
    END IF;
  END IF;

  SELECT c.account_code, c.name INTO v_code, v_name
    FROM customers c WHERE c.id = p_customer_id AND c.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Customer % not found in tenant %', p_customer_id, p_tenant_id; END IF;

  v_collective := resolve_account(p_tenant_id, 'CUSTOMER_CONTROL');
  IF v_collective IS NULL THEN RAISE EXCEPTION 'No CUSTOMER_CONTROL mapping for tenant %', p_tenant_id; END IF;
  v_prefix := left(v_collective, 3);

  IF v_code IS NOT NULL AND v_code <> '' THEN
    IF v_code !~ '^\d{7}$' THEN RAISE EXCEPTION 'Customer % has malformed account_code %', p_customer_id, v_code; END IF;
    IF left(v_code, 3) <> v_prefix THEN RAISE EXCEPTION 'Customer % account_code % wrong prefix %', p_customer_id, v_code, v_prefix; END IF;
    SELECT a.class, a.account_type, a.is_active INTO v_acct FROM accounts a WHERE a.tenant_id = p_tenant_id AND a.code = v_code;
    IF NOT FOUND THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active) VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true);
    ELSE
      IF v_acct.class IS DISTINCT FROM 4 OR v_acct.account_type IS DISTINCT FROM 'auxiliary' OR v_acct.is_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Account % incompatible (class=%, type=%, active=%)', v_code, v_acct.class, v_acct.account_type, v_acct.is_active;
      END IF;
    END IF;
    RETURN v_code;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || v_prefix));
  SELECT COALESCE(MAX(suffix), 0) + 1 INTO v_next_num FROM (
    SELECT CAST(SUBSTRING(c2.account_code FROM 4) AS int) AS suffix FROM customers c2
      WHERE c2.tenant_id = p_tenant_id AND c2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL SELECT CAST(SUBSTRING(s2.account_code FROM 4) AS int) FROM suppliers s2
      WHERE s2.tenant_id = p_tenant_id AND s2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL SELECT CAST(SUBSTRING(a2.code FROM 4) AS int) FROM accounts a2
      WHERE a2.tenant_id = p_tenant_id AND a2.code ~ ('^' || v_prefix || '\d{4}$')
  ) combined;
  IF v_next_num > 9999 THEN RAISE EXCEPTION 'Auxiliary code overflow tenant % prefix %', p_tenant_id, v_prefix; END IF;
  v_code := v_prefix || LPAD(v_next_num::text, 4, '0');
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active) VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true);
  UPDATE customers SET account_code = v_code WHERE id = p_customer_id AND tenant_id = p_tenant_id;
  RETURN v_code;
END;
$function$;
ALTER FUNCTION public.get_or_create_customer_account(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_or_create_customer_account(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_customer_account(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_or_create_customer_account(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_account(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_or_create_customer_account(uuid, uuid) TO service_role;

-- 1b. get_or_create_supplier_account
CREATE OR REPLACE FUNCTION public.get_or_create_supplier_account(
  p_tenant_id uuid, p_supplier_id uuid
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_code text; v_name text; v_collective text; v_prefix text; v_next_num int; v_acct record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF current_tenant_id() IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'Access denied: caller tenant does not match p_tenant_id %', p_tenant_id;
    END IF;
  END IF;

  SELECT s.account_code, s.name INTO v_code, v_name
    FROM suppliers s WHERE s.id = p_supplier_id AND s.tenant_id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Supplier % not found in tenant %', p_supplier_id, p_tenant_id; END IF;

  v_collective := resolve_account(p_tenant_id, 'SUPPLIER_CONTROL');
  IF v_collective IS NULL THEN RAISE EXCEPTION 'No SUPPLIER_CONTROL mapping for tenant %', p_tenant_id; END IF;
  v_prefix := left(v_collective, 3);

  IF v_code IS NOT NULL AND v_code <> '' THEN
    IF v_code !~ '^\d{7}$' THEN RAISE EXCEPTION 'Supplier % has malformed account_code %', p_supplier_id, v_code; END IF;
    IF left(v_code, 3) <> v_prefix THEN RAISE EXCEPTION 'Supplier % account_code % wrong prefix %', p_supplier_id, v_code, v_prefix; END IF;
    SELECT a.class, a.account_type, a.is_active INTO v_acct FROM accounts a WHERE a.tenant_id = p_tenant_id AND a.code = v_code;
    IF NOT FOUND THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active) VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true);
    ELSE
      IF v_acct.class IS DISTINCT FROM 4 OR v_acct.account_type IS DISTINCT FROM 'auxiliary' OR v_acct.is_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Account % incompatible (class=%, type=%, active=%)', v_code, v_acct.class, v_acct.account_type, v_acct.is_active;
      END IF;
    END IF;
    RETURN v_code;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || v_prefix));
  SELECT COALESCE(MAX(suffix), 0) + 1 INTO v_next_num FROM (
    SELECT CAST(SUBSTRING(c2.account_code FROM 4) AS int) AS suffix FROM customers c2
      WHERE c2.tenant_id = p_tenant_id AND c2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL SELECT CAST(SUBSTRING(s2.account_code FROM 4) AS int) FROM suppliers s2
      WHERE s2.tenant_id = p_tenant_id AND s2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL SELECT CAST(SUBSTRING(a2.code FROM 4) AS int) FROM accounts a2
      WHERE a2.tenant_id = p_tenant_id AND a2.code ~ ('^' || v_prefix || '\d{4}$')
  ) combined;
  IF v_next_num > 9999 THEN RAISE EXCEPTION 'Auxiliary code overflow tenant % prefix %', p_tenant_id, v_prefix; END IF;
  v_code := v_prefix || LPAD(v_next_num::text, 4, '0');
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active) VALUES (p_tenant_id, v_code, v_name, 4, 'auxiliary', true);
  UPDATE suppliers SET account_code = v_code WHERE id = p_supplier_id AND tenant_id = p_tenant_id;
  RETURN v_code;
END;
$function$;
ALTER FUNCTION public.get_or_create_supplier_account(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.get_or_create_supplier_account(uuid, uuid) TO service_role;

-- 1c. assign_customer_account_code (trigger)
CREATE OR REPLACE FUNCTION public.assign_customer_account_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_collective text; v_prefix text; v_next_num int; v_acct record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.tenant_id IS DISTINCT FROM current_tenant_id() THEN
      RAISE EXCEPTION 'Access denied: tenant mismatch for %', TG_TABLE_NAME;
    END IF;
  END IF;

  IF NEW.account_code IS NOT NULL AND NEW.account_code <> '' THEN
    v_collective := resolve_account(NEW.tenant_id, 'CUSTOMER_CONTROL');
    IF v_collective IS NULL THEN RAISE EXCEPTION 'No CUSTOMER_CONTROL mapping for tenant %', NEW.tenant_id; END IF;
    v_prefix := left(v_collective, 3);
    IF NEW.account_code !~ '^\d{7}$' THEN RAISE EXCEPTION 'Customer account_code % malformed', NEW.account_code; END IF;
    IF left(NEW.account_code, 3) <> v_prefix THEN RAISE EXCEPTION 'Customer account_code % wrong prefix %', NEW.account_code, v_prefix; END IF;
    SELECT a.class, a.account_type, a.is_active INTO v_acct FROM accounts a WHERE a.tenant_id = NEW.tenant_id AND a.code = NEW.account_code;
    IF NOT FOUND THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active) VALUES (NEW.tenant_id, NEW.account_code, NEW.name, 4, 'auxiliary', true);
    ELSE
      IF v_acct.class IS DISTINCT FROM 4 OR v_acct.account_type IS DISTINCT FROM 'auxiliary' OR v_acct.is_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Account % incompatible (class=%, type=%, active=%)', NEW.account_code, v_acct.class, v_acct.account_type, v_acct.is_active;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  v_collective := resolve_account(NEW.tenant_id, 'CUSTOMER_CONTROL');
  IF v_collective IS NULL THEN RAISE EXCEPTION 'No CUSTOMER_CONTROL mapping for tenant %', NEW.tenant_id; END IF;
  v_prefix := left(v_collective, 3);
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || ':' || v_prefix));
  SELECT COALESCE(MAX(suffix), 0) + 1 INTO v_next_num FROM (
    SELECT CAST(SUBSTRING(c2.account_code FROM 4) AS int) AS suffix FROM customers c2
      WHERE c2.tenant_id = NEW.tenant_id AND c2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL SELECT CAST(SUBSTRING(s2.account_code FROM 4) AS int) FROM suppliers s2
      WHERE s2.tenant_id = NEW.tenant_id AND s2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL SELECT CAST(SUBSTRING(a2.code FROM 4) AS int) FROM accounts a2
      WHERE a2.tenant_id = NEW.tenant_id AND a2.code ~ ('^' || v_prefix || '\d{4}$')
  ) combined;
  IF v_next_num > 9999 THEN RAISE EXCEPTION 'Auxiliary code overflow tenant % prefix %', NEW.tenant_id, v_prefix; END IF;
  NEW.account_code := v_prefix || LPAD(v_next_num::text, 4, '0');
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active) VALUES (NEW.tenant_id, NEW.account_code, NEW.name, 4, 'auxiliary', true);
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.assign_customer_account_code() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_customer_account_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_customer_account_code() FROM anon;
REVOKE ALL ON FUNCTION public.assign_customer_account_code() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_customer_account_code() TO postgres;
GRANT EXECUTE ON FUNCTION public.assign_customer_account_code() TO service_role;

-- 1d. assign_supplier_account_code (trigger)
CREATE OR REPLACE FUNCTION public.assign_supplier_account_code()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_collective text; v_prefix text; v_next_num int; v_acct record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    IF NEW.tenant_id IS DISTINCT FROM current_tenant_id() THEN
      RAISE EXCEPTION 'Access denied: tenant mismatch for %', TG_TABLE_NAME;
    END IF;
  END IF;

  IF NEW.account_code IS NOT NULL AND NEW.account_code <> '' THEN
    v_collective := resolve_account(NEW.tenant_id, 'SUPPLIER_CONTROL');
    IF v_collective IS NULL THEN RAISE EXCEPTION 'No SUPPLIER_CONTROL mapping for tenant %', NEW.tenant_id; END IF;
    v_prefix := left(v_collective, 3);
    IF NEW.account_code !~ '^\d{7}$' THEN RAISE EXCEPTION 'Supplier account_code % malformed', NEW.account_code; END IF;
    IF left(NEW.account_code, 3) <> v_prefix THEN RAISE EXCEPTION 'Supplier account_code % wrong prefix %', NEW.account_code, v_prefix; END IF;
    SELECT a.class, a.account_type, a.is_active INTO v_acct FROM accounts a WHERE a.tenant_id = NEW.tenant_id AND a.code = NEW.account_code;
    IF NOT FOUND THEN
      INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active) VALUES (NEW.tenant_id, NEW.account_code, NEW.name, 4, 'auxiliary', true);
    ELSE
      IF v_acct.class IS DISTINCT FROM 4 OR v_acct.account_type IS DISTINCT FROM 'auxiliary' OR v_acct.is_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Account % incompatible (class=%, type=%, active=%)', NEW.account_code, v_acct.class, v_acct.account_type, v_acct.is_active;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  v_collective := resolve_account(NEW.tenant_id, 'SUPPLIER_CONTROL');
  IF v_collective IS NULL THEN RAISE EXCEPTION 'No SUPPLIER_CONTROL mapping for tenant %', NEW.tenant_id; END IF;
  v_prefix := left(v_collective, 3);
  PERFORM pg_advisory_xact_lock(hashtext(NEW.tenant_id::text || ':' || v_prefix));
  SELECT COALESCE(MAX(suffix), 0) + 1 INTO v_next_num FROM (
    SELECT CAST(SUBSTRING(c2.account_code FROM 4) AS int) AS suffix FROM customers c2
      WHERE c2.tenant_id = NEW.tenant_id AND c2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL SELECT CAST(SUBSTRING(s2.account_code FROM 4) AS int) FROM suppliers s2
      WHERE s2.tenant_id = NEW.tenant_id AND s2.account_code ~ ('^' || v_prefix || '\d{4}$')
    UNION ALL SELECT CAST(SUBSTRING(a2.code FROM 4) AS int) FROM accounts a2
      WHERE a2.tenant_id = NEW.tenant_id AND a2.code ~ ('^' || v_prefix || '\d{4}$')
  ) combined;
  IF v_next_num > 9999 THEN RAISE EXCEPTION 'Auxiliary code overflow tenant % prefix %', NEW.tenant_id, v_prefix; END IF;
  NEW.account_code := v_prefix || LPAD(v_next_num::text, 4, '0');
  INSERT INTO accounts (tenant_id, code, name, class, account_type, is_active) VALUES (NEW.tenant_id, NEW.account_code, NEW.name, 4, 'auxiliary', true);
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.assign_supplier_account_code() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.assign_supplier_account_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assign_supplier_account_code() FROM anon;
REVOKE ALL ON FUNCTION public.assign_supplier_account_code() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assign_supplier_account_code() TO postgres;
GRANT EXECUTE ON FUNCTION public.assign_supplier_account_code() TO service_role;

-- ============================================================
-- PART 2: register_supplier_payment — rewrite
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_supplier_payment(
  p_supplier_id uuid, p_payment_method_id uuid, p_method_name text, p_amount numeric,
  p_reference text DEFAULT '', p_cash_session_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL, p_from_cash boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid; v_pm record; v_remaining numeric; v_order record;
  v_due numeric; v_take numeric; v_applied numeric := 0;
  v_applied_orders jsonb := '[]'::jsonb; v_site_id uuid; v_new_paid numeric; v_session record;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM suppliers WHERE id = p_supplier_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Fournisseur introuvable dans ce tenant';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  SELECT pm.id, pm.name, pm.payment_type INTO v_pm
    FROM payment_methods pm WHERE pm.id = p_payment_method_id AND pm.tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mode de paiement introuvable dans ce tenant'; END IF;
  IF v_pm.payment_type = 'credit' THEN RAISE EXCEPTION 'Le crédit n''est pas un mode de règlement fournisseur valide'; END IF;

  IF p_order_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM supplier_orders WHERE id = p_order_id AND tenant_id = v_tenant_id AND supplier_id = p_supplier_id) THEN
      RAISE EXCEPTION 'Commande introuvable dans ce tenant';
    END IF;
  END IF;

  IF p_from_cash THEN
    IF p_cash_session_id IS NULL THEN RAISE EXCEPTION 'La caisse doit être ouverte d''abord'; END IF;
    SELECT cs.id, cs.status, cs.site_id,
      COALESCE(cs.opening_amount,0)+COALESCE(cs.theoretical_amount,0) AS bal
      INTO v_session FROM cash_sessions cs WHERE cs.id = p_cash_session_id FOR UPDATE;
    IF v_session.id IS NULL OR v_session.status <> 'open' THEN RAISE EXCEPTION 'La caisse doit être ouverte d''abord'; END IF;
    IF v_session.bal < p_amount THEN RAISE EXCEPTION 'Solde caisse insuffisant'; END IF;
    v_site_id := v_session.site_id;
  END IF;

  v_remaining := p_amount;

  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM supplier_orders
      WHERE id = p_order_id AND tenant_id = v_tenant_id AND supplier_id = p_supplier_id AND status NOT IN ('cancelled','draft');
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
    v_due := GREATEST(0, COALESCE(v_order.total,0) - COALESCE(v_order.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      v_new_paid := COALESCE(v_order.paid,0) + v_take;
      UPDATE supplier_orders SET paid = v_new_paid WHERE id = v_order.id;
      INSERT INTO supplier_payments (tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference, funding_source, site_id)
        VALUES (v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id, v_pm.name, v_take, COALESCE(p_reference,''),
          CASE WHEN p_from_cash THEN 'cash' ELSE NULL END, CASE WHEN p_from_cash THEN v_site_id ELSE NULL END);
      IF p_from_cash AND p_cash_session_id IS NOT NULL THEN
        INSERT INTO cash_movements (tenant_id, cash_session_id, site_id, user_id, kind, amount, reason, note, reference, supplier_id, payment_method_id, method_name, accounting_status)
          VALUES (v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'expense', v_take,
            'Règlement commande ' || v_order.order_number, '', COALESCE(p_reference,''),
            p_supplier_id, p_payment_method_id, v_pm.name, 'excluded');
        PERFORM increment_session_theoretical(p_cash_session_id, -v_take);
      END IF;
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_orders := v_applied_orders || jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'amount', v_take);
    END IF;
  END IF;

  FOR v_order IN
    SELECT * FROM supplier_orders
    WHERE tenant_id = v_tenant_id AND supplier_id = p_supplier_id
      AND status NOT IN ('cancelled','draft') AND COALESCE(paid,0) < COALESCE(total,0)
      AND (p_order_id IS NULL OR id <> p_order_id) ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(0, COALESCE(v_order.total,0) - COALESCE(v_order.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      v_new_paid := COALESCE(v_order.paid,0) + v_take;
      UPDATE supplier_orders SET paid = v_new_paid WHERE id = v_order.id;
      INSERT INTO supplier_payments (tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference, funding_source, site_id)
        VALUES (v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id, v_pm.name, v_take, COALESCE(p_reference,''),
          CASE WHEN p_from_cash THEN 'cash' ELSE NULL END, CASE WHEN p_from_cash THEN v_site_id ELSE NULL END);
      IF p_from_cash AND p_cash_session_id IS NOT NULL THEN
        INSERT INTO cash_movements (tenant_id, cash_session_id, site_id, user_id, kind, amount, reason, note, reference, supplier_id, payment_method_id, method_name, accounting_status)
          VALUES (v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'expense', v_take,
            'Règlement commande ' || v_order.order_number, '', COALESCE(p_reference,''),
            p_supplier_id, p_payment_method_id, v_pm.name, 'excluded');
        PERFORM increment_session_theoretical(p_cash_session_id, -v_take);
      END IF;
      v_remaining := v_remaining - v_take;
      v_applied := v_applied + v_take;
      v_applied_orders := v_applied_orders || jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'amount', v_take);
    END IF;
  END LOOP;

  IF v_remaining > 0 THEN
    INSERT INTO supplier_payments (tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference, funding_source, site_id)
      VALUES (v_tenant_id, p_supplier_id, NULL, p_payment_method_id, v_pm.name, v_remaining, COALESCE(p_reference,''),
        CASE WHEN p_from_cash THEN 'cash' ELSE NULL END, CASE WHEN p_from_cash THEN v_site_id ELSE NULL END);
    UPDATE suppliers SET balance = GREATEST(0, COALESCE(balance,0) - v_remaining) WHERE id = p_supplier_id AND tenant_id = v_tenant_id;
    INSERT INTO balance_adjustments (tenant_id, entity_type, entity_id, previous_balance, new_balance, amount, note, user_id)
      VALUES (v_tenant_id, 'supplier', p_supplier_id,
        (SELECT COALESCE(balance,0)+v_remaining FROM suppliers WHERE id=p_supplier_id AND tenant_id=v_tenant_id),
        (SELECT COALESCE(balance,0) FROM suppliers WHERE id=p_supplier_id AND tenant_id=v_tenant_id),
        -v_remaining, 'Règlement solde · ' || v_pm.name, auth.uid());
    IF p_from_cash AND p_cash_session_id IS NOT NULL THEN
      INSERT INTO cash_movements (tenant_id, cash_session_id, site_id, user_id, kind, amount, reason, note, reference, supplier_id, payment_method_id, method_name, accounting_status)
        VALUES (v_tenant_id, p_cash_session_id, v_site_id, auth.uid(), 'expense', v_remaining,
          'Règlement solde fournisseur', '', COALESCE(p_reference,''),
          p_supplier_id, p_payment_method_id, v_pm.name, 'excluded');
      PERFORM increment_session_theoretical(p_cash_session_id, -v_remaining);
    END IF;
  END IF;

  PERFORM recompute_supplier_balance(p_supplier_id);
  RETURN jsonb_build_object('applied', v_applied, 'unapplied', v_remaining, 'orders', v_applied_orders);
END;
$function$;
ALTER FUNCTION public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean) TO service_role;

-- ============================================================
-- PART 3: register_supplier_payment_from_vault — rewrite
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_supplier_payment_from_vault(
  p_supplier_id uuid, p_payment_method_id uuid, p_method_name text, p_amount numeric,
  p_reference text DEFAULT '', p_site_id uuid DEFAULT NULL,
  p_order_id uuid DEFAULT NULL, p_idempotency_key text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid; v_pm record; v_vault RECORD; v_bal_before numeric; v_bal_after numeric;
  v_movement_id uuid; v_existing record; v_remaining numeric; v_order RECORD;
  v_due numeric; v_take numeric; v_applied numeric := 0;
  v_applied_orders jsonb := '[]'::jsonb; v_new_paid numeric; v_is_admin boolean;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
  IF NOT vault_module_enabled() THEN RAISE EXCEPTION 'Le module Coffre n''est pas activé'; END IF;
  v_is_admin := EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('admin','super_admin'));
  IF NOT (v_is_admin OR vault_has_permission('vault_pay_supplier')) THEN
    RAISE EXCEPTION 'Permission refusée : règlement fournisseur depuis le coffre';
  END IF;
  IF p_supplier_id IS NULL THEN RAISE EXCEPTION 'Fournisseur obligatoire'; END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;
  IF p_site_id IS NULL THEN RAISE EXCEPTION 'Site obligatoire'; END IF;
  IF NOT vault_site_accessible(p_site_id) THEN RAISE EXCEPTION 'Site non autorisé'; END IF;

  SELECT pm.id, pm.name, pm.payment_type INTO v_pm
    FROM payment_methods pm WHERE pm.id = p_payment_method_id AND pm.tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mode de paiement introuvable dans ce tenant'; END IF;

  IF p_idempotency_key IS NOT NULL AND p_idempotency_key <> '' THEN
    SELECT vm.id, vm.supplier_id, vm.site_id, vm.amount INTO v_existing
      FROM vault_movements vm WHERE vm.tenant_id = v_tenant_id AND vm.idempotency_key = p_idempotency_key;
    IF v_existing.id IS NOT NULL THEN
      IF v_existing.supplier_id IS DISTINCT FROM p_supplier_id THEN
        RAISE EXCEPTION 'Clé d''idempotence réutilisée avec un fournisseur différent';
      END IF;
      IF v_existing.site_id IS DISTINCT FROM p_site_id THEN
        RAISE EXCEPTION 'Clé d''idempotence réutilisée avec un site différent';
      END IF;
      IF v_existing.amount IS DISTINCT FROM p_amount THEN
        RAISE EXCEPTION 'Clé d''idempotence réutilisée avec un montant différent';
      END IF;
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'vault_movement_id', v_existing.id);
    END IF;
  END IF;

  SELECT * INTO v_vault FROM vaults WHERE tenant_id = v_tenant_id AND site_id = p_site_id AND is_active FOR UPDATE;
  IF v_vault.id IS NULL THEN RAISE EXCEPTION 'Aucun coffre actif pour ce site'; END IF;
  IF COALESCE(v_vault.current_balance,0) < p_amount THEN RAISE EXCEPTION 'Solde du coffre insuffisant'; END IF;
  v_bal_before := COALESCE(v_vault.current_balance,0);
  v_bal_after := v_bal_before - p_amount;

  INSERT INTO vault_movements (tenant_id, vault_id, site_id, direction, kind, amount,
    balance_before, balance_after, supplier_id, payment_method_id,
    reference, note, created_by, idempotency_key)
  VALUES (v_tenant_id, v_vault.id, p_site_id, 'out', 'supplier_payment', p_amount,
    v_bal_before, v_bal_after, p_supplier_id, p_payment_method_id,
    COALESCE(p_reference,''), 'Règlement fournisseur depuis le coffre', auth.uid(), NULLIF(p_idempotency_key,''))
  RETURNING id INTO v_movement_id;
  UPDATE vaults SET current_balance = v_bal_after, updated_at = now() WHERE id = v_vault.id;

  v_remaining := p_amount;

  IF p_order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM supplier_orders
      WHERE id = p_order_id AND tenant_id = v_tenant_id AND supplier_id = p_supplier_id AND status NOT IN ('cancelled','draft');
    IF v_order.id IS NULL THEN RAISE EXCEPTION 'Commande introuvable'; END IF;
    v_due := GREATEST(0, COALESCE(v_order.total,0)-COALESCE(v_order.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      v_new_paid := COALESCE(v_order.paid,0)+v_take;
      UPDATE supplier_orders SET paid = v_new_paid WHERE id = v_order.id;
      INSERT INTO supplier_payments (tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference, funding_source, vault_id, vault_movement_id, site_id)
        VALUES (v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id, v_pm.name, v_take, COALESCE(p_reference,''), 'vault', v_vault.id, v_movement_id, p_site_id);
      v_remaining := v_remaining - v_take; v_applied := v_applied + v_take;
      v_applied_orders := v_applied_orders || jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'amount', v_take);
    END IF;
  END IF;

  FOR v_order IN SELECT * FROM supplier_orders
    WHERE tenant_id = v_tenant_id AND supplier_id = p_supplier_id AND status NOT IN ('cancelled','draft')
      AND COALESCE(paid,0) < COALESCE(total,0) AND (p_order_id IS NULL OR id <> p_order_id) ORDER BY created_at ASC
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_due := GREATEST(0, COALESCE(v_order.total,0)-COALESCE(v_order.paid,0));
    v_take := LEAST(v_remaining, v_due);
    IF v_take > 0 THEN
      v_new_paid := COALESCE(v_order.paid,0)+v_take;
      UPDATE supplier_orders SET paid = v_new_paid WHERE id = v_order.id;
      INSERT INTO supplier_payments (tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference, funding_source, vault_id, vault_movement_id, site_id)
        VALUES (v_tenant_id, p_supplier_id, v_order.id, p_payment_method_id, v_pm.name, v_take, COALESCE(p_reference,''), 'vault', v_vault.id, v_movement_id, p_site_id);
      v_remaining := v_remaining - v_take; v_applied := v_applied + v_take;
      v_applied_orders := v_applied_orders || jsonb_build_object('order_id', v_order.id, 'order_number', v_order.order_number, 'amount', v_take);
    END IF;
  END LOOP;

  IF v_remaining > 0 THEN
    INSERT INTO supplier_payments (tenant_id, supplier_id, order_id, payment_method_id, method_name, amount, reference, funding_source, vault_id, vault_movement_id, site_id)
      VALUES (v_tenant_id, p_supplier_id, NULL, p_payment_method_id, v_pm.name, v_remaining, COALESCE(p_reference,''), 'vault', v_vault.id, v_movement_id, p_site_id);
    UPDATE suppliers SET balance = GREATEST(0, COALESCE(balance,0)-v_remaining) WHERE id = p_supplier_id AND tenant_id = v_tenant_id;
    INSERT INTO balance_adjustments (tenant_id, entity_type, entity_id, previous_balance, new_balance, amount, note, user_id)
      VALUES (v_tenant_id, 'supplier', p_supplier_id,
        (SELECT COALESCE(balance,0)+v_remaining FROM suppliers WHERE id=p_supplier_id AND tenant_id=v_tenant_id),
        (SELECT COALESCE(balance,0) FROM suppliers WHERE id=p_supplier_id AND tenant_id=v_tenant_id),
        -v_remaining, 'Règlement solde (coffre) · ' || v_pm.name, auth.uid());
  END IF;

  PERFORM recompute_supplier_balance(p_supplier_id);
  RETURN jsonb_build_object('success', true, 'applied', v_applied, 'unapplied', v_remaining, 'orders', v_applied_orders, 'vault_movement_id', v_movement_id, 'vault_balance', v_bal_after);
END;
$function$;
ALTER FUNCTION public.register_supplier_payment_from_vault(uuid,uuid,text,numeric,text,uuid,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.register_supplier_payment_from_vault(uuid,uuid,text,numeric,text,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_supplier_payment_from_vault(uuid,uuid,text,numeric,text,uuid,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_supplier_payment_from_vault(uuid,uuid,text,numeric,text,uuid,uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_supplier_payment_from_vault(uuid,uuid,text,numeric,text,uuid,uuid,text) TO service_role;

-- ============================================================
-- PART 4: comptabiliser_reglement_fournisseur — full rewrite
-- ============================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglement_fournisseur(p_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sp record; v_supplier_name text; v_supplier_account text; v_pm record;
  v_journal text; v_credit_account text; v_vault_account text;
  v_order_status text; v_order_acct_status text; v_credit_active boolean;
  v_entry_id uuid; v_piece_number text; v_entry_date date;
BEGIN
  SELECT sp.* INTO v_sp FROM supplier_payments sp WHERE sp.id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Règlement fournisseur introuvable'); END IF;
  IF v_sp.accounting_status = 'accounted' THEN RETURN jsonb_build_object('success', false, 'error', 'Règlement déjà comptabilisé'); END IF;
  IF v_sp.amount <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Montant invalide (<=0)'); END IF;
  IF v_sp.supplier_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'supplier_id manquant'); END IF;

  SELECT s.name INTO v_supplier_name FROM suppliers s WHERE s.id = v_sp.supplier_id AND s.tenant_id = v_sp.tenant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Fournisseur introuvable dans le tenant'); END IF;

  v_supplier_account := get_or_create_supplier_account(v_sp.tenant_id, v_sp.supplier_id);

  IF v_sp.order_id IS NOT NULL THEN
    SELECT so.status, so.accounting_status INTO v_order_status, v_order_acct_status
      FROM supplier_orders so WHERE so.id = v_sp.order_id AND so.tenant_id = v_sp.tenant_id;
    IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Commande fournisseur liée introuvable'); END IF;
    IF v_order_status IN ('cancelled','draft') THEN RETURN jsonb_build_object('success', false, 'error', 'Commande annulée ou brouillon'); END IF;
    IF v_order_acct_status IS DISTINCT FROM 'accounted' THEN RETURN jsonb_build_object('success', false, 'error', 'Achat lié non encore comptabilisé'); END IF;
  END IF;

  IF v_sp.payment_method_id IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'payment_method_id manquant'); END IF;
  SELECT pm.payment_type, pm.account_code, pm.name INTO v_pm
    FROM payment_methods pm WHERE pm.id = v_sp.payment_method_id AND pm.tenant_id = v_sp.tenant_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Mode de paiement introuvable dans le tenant'); END IF;

  IF v_sp.funding_source = 'vault' THEN
    SELECT NULLIF(TRIM(v.account_code),'') INTO v_vault_account
      FROM vaults v WHERE v.id = v_sp.vault_id AND v.tenant_id = v_sp.tenant_id;
    IF v_vault_account IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'Compte coffre non configuré'); END IF;
    IF NOT EXISTS (SELECT 1 FROM vault_movements vm WHERE vm.id = v_sp.vault_movement_id AND vm.tenant_id = v_sp.tenant_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Mouvement de coffre introuvable');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM vault_movements vm WHERE vm.id = v_sp.vault_movement_id AND vm.tenant_id = v_sp.tenant_id AND vm.site_id IS NOT DISTINCT FROM v_sp.site_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Incohérence site règlement/mouvement coffre');
    END IF;
    v_journal := 'CA';
    v_credit_account := v_vault_account;
  ELSE
    CASE v_pm.payment_type
      WHEN 'cash' THEN v_journal := 'CA';
      WHEN 'bank' THEN v_journal := 'BQ';
      WHEN 'mobile' THEN v_journal := 'BQ';
      WHEN 'card' THEN v_journal := 'BQ';
      WHEN 'check' THEN v_journal := 'BQ';
      ELSE RETURN jsonb_build_object('success', false, 'error', 'Type paiement non pris en charge: ' || COALESCE(v_pm.payment_type,'NULL'));
    END CASE;
    v_credit_account := v_pm.account_code;
    IF v_credit_account IS NULL OR TRIM(v_credit_account) = '' THEN
      RETURN jsonb_build_object('success', false, 'error', 'Compte trésorerie non configuré sur le mode de paiement');
    END IF;
  END IF;

  SELECT a.is_active INTO v_credit_active FROM accounts a WHERE a.tenant_id = v_sp.tenant_id AND a.code = v_credit_account;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' introuvable dans le plan comptable'); END IF;
  IF v_credit_active IS DISTINCT FROM true THEN RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' inactif'); END IF;

  v_entry_date := COALESCE(v_sp.paid_at::date, v_sp.created_at::date, CURRENT_DATE);
  v_piece_number := next_accounting_piece_number(v_sp.tenant_id, v_journal);

  INSERT INTO journal_entries (tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by)
  VALUES (v_sp.tenant_id, v_piece_number, v_journal, v_entry_date,
    COALESCE((SELECT order_number FROM supplier_orders WHERE id = v_sp.order_id AND tenant_id = v_sp.tenant_id),''),
    'Règlement fournisseur ' || COALESCE(v_supplier_name,'Fournisseur'),
    v_sp.amount, v_sp.amount, true, 'supplier_payment', p_payment_id, 'posted', now(), auth.uid())
  RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (v_sp.tenant_id, v_entry_id, v_supplier_account,
    (SELECT name FROM accounts WHERE tenant_id = v_sp.tenant_id AND code = v_supplier_account LIMIT 1),
    v_sp.amount, 0, 'Règlement ' || COALESCE(v_supplier_name,'Fournisseur'), v_sp.supplier_id);

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id)
  VALUES (v_sp.tenant_id, v_entry_id, v_credit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_sp.tenant_id AND code = v_credit_account LIMIT 1),
    0, v_sp.amount, 'Décaissement ' || COALESCE(v_supplier_name,'Fournisseur'), v_sp.supplier_id);

  UPDATE supplier_payments SET accounting_status = 'accounted', accounting_entry_id = v_entry_id
    WHERE id = p_payment_id AND tenant_id = v_sp.tenant_id;

  RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id, 'piece_number', v_piece_number, 'journal', v_journal, 'total', v_sp.amount);
END;
$function$;
ALTER FUNCTION public.comptabiliser_reglement_fournisseur(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_fournisseur(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_fournisseur(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_fournisseur(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglement_fournisseur(uuid) TO postgres;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglement_fournisseur(uuid) TO service_role;

-- ============================================================
-- PART 5: comptabiliser_reglements_fournisseurs_en_masse — full rewrite
-- ============================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(p_tenant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pay record; v_result jsonb; v_success int := 0; v_errors int := 0;
  v_error_details jsonb[] := '{}';
  v_skipped_invalid int; v_skipped_order_not_accounted int;
  v_skipped_vault_unconfigured int; v_skipped_treasury_unconfigured int;
BEGIN
  IF auth.uid() IS NULL OR current_tenant_id() IS NULL OR p_tenant_id IS DISTINCT FROM current_tenant_id() THEN
    RAISE EXCEPTION 'Acces refuse au tenant demande';
  END IF;

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
      AND sp.funding_source = 'vault' AND (v.account_code IS NULL OR TRIM(v.account_code) = '');

  SELECT count(*) INTO v_skipped_treasury_unconfigured FROM supplier_payments sp
    LEFT JOIN payment_methods pm ON pm.id = sp.payment_method_id AND pm.tenant_id = sp.tenant_id
    WHERE sp.tenant_id = p_tenant_id AND (sp.accounting_status = 'not_accounted' OR sp.accounting_status IS NULL)
      AND sp.amount > 0 AND sp.supplier_id IS NOT NULL AND sp.payment_method_id IS NOT NULL
      AND sp.funding_source IS DISTINCT FROM 'vault'
      AND (pm.account_code IS NULL OR TRIM(pm.account_code) = '');

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
    'skipped_invalid', v_skipped_invalid, 'skipped_order_not_accounted', v_skipped_order_not_accounted,
    'skipped_vault_unconfigured', v_skipped_vault_unconfigured, 'skipped_treasury_unconfigured', v_skipped_treasury_unconfigured,
    'error_details', to_jsonb(v_error_details));
END;
$function$;
ALTER FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_reglements_fournisseurs_en_masse(uuid) TO service_role;

-- ============================================================
-- PART 6: comptabiliser_depense — add supplier and excluded guards
-- ============================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_depense(p_movement_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_mov RECORD; v_entry_id uuid; v_piece_number text; v_journal text;
  v_debit_account text; v_credit_account text;
  v_resolved_expense text; v_resolved_income text; v_resolved_cash text;
BEGIN
  SELECT * INTO v_mov FROM cash_movements WHERE id = p_movement_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Mouvement introuvable'); END IF;
  IF v_mov.accounting_status = 'accounted' THEN RETURN jsonb_build_object('success', false, 'error', 'Mouvement déjà comptabilisé'); END IF;

  IF v_mov.accounting_status = 'excluded' THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'Mouvement exclu de la comptabilisation');
  END IF;

  IF v_mov.supplier_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'Mouvement lié à un fournisseur: comptabilisé via supplier_payments');
  END IF;

  BEGIN v_resolved_expense := resolve_account(v_mov.tenant_id, 'MISC_EXPENSE');
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', 'Résolution MISC_EXPENSE échouée: ' || SQLERRM); END;
  BEGIN v_resolved_income := resolve_account(v_mov.tenant_id, 'MISC_INCOME');
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', 'Résolution MISC_INCOME échouée: ' || SQLERRM); END;
  BEGIN v_resolved_cash := resolve_account(v_mov.tenant_id, 'CASH_DEFAULT');
  EXCEPTION WHEN OTHERS THEN RETURN jsonb_build_object('success', false, 'error', 'Résolution CASH_DEFAULT échouée: ' || SQLERRM); END;

  IF v_mov.kind = 'deposit' THEN v_journal := 'CA'; v_debit_account := v_resolved_cash; v_credit_account := v_resolved_income;
  ELSE v_journal := 'CA'; v_debit_account := v_resolved_expense; v_credit_account := v_resolved_cash; END IF;

  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_debit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_debit_account || ' introuvable'); END IF;
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_credit_account) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Compte ' || v_credit_account || ' introuvable'); END IF;

  v_piece_number := next_accounting_piece_number(v_mov.tenant_id, v_journal);
  INSERT INTO journal_entries (tenant_id, entry_number, journal_type, entry_date, reference, description,
    total_debit, total_credit, is_balanced, source_type, source_id, status, posted_at, posted_by)
  VALUES (v_mov.tenant_id, v_piece_number, v_journal, CURRENT_DATE, COALESCE(v_mov.reference,''),
    COALESCE(v_mov.reason,'Mouvement caisse') || CASE WHEN v_mov.note IS NOT NULL AND v_mov.note != '' THEN ' - ' || v_mov.note ELSE '' END,
    v_mov.amount, v_mov.amount, true, 'cash_movement', p_movement_id, 'posted', now(), auth.uid())
  RETURNING id INTO v_entry_id;

  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
  VALUES (v_mov.tenant_id, v_entry_id, v_debit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_debit_account LIMIT 1),
    v_mov.amount, 0, COALESCE(v_mov.reason,'Mouvement') || CASE WHEN v_mov.note IS NOT NULL AND v_mov.note != '' THEN ' ' || v_mov.note ELSE '' END);
  INSERT INTO journal_lines (tenant_id, entry_id, account_code, account_name, debit, credit, label)
  VALUES (v_mov.tenant_id, v_entry_id, v_credit_account,
    (SELECT name FROM accounts WHERE tenant_id = v_mov.tenant_id AND code = v_credit_account LIMIT 1),
    0, v_mov.amount, COALESCE(v_mov.reason,'Mouvement') || CASE WHEN v_mov.note IS NOT NULL AND v_mov.note != '' THEN ' ' || v_mov.note ELSE '' END);

  UPDATE cash_movements SET accounting_status = 'accounted', accounting_entry_id = v_entry_id WHERE id = p_movement_id;
  RETURN jsonb_build_object('success', true, 'entry_id', v_entry_id, 'piece_number', v_piece_number, 'journal', v_journal, 'total', v_mov.amount);
END;
$function$;
REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_depense(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.comptabiliser_depense(uuid) TO service_role;

-- ============================================================
-- PART 7: Data fix — exclude 4 supplier-linked cash_movements
-- ============================================================
DO $$
DECLARE v_count int; v_total numeric;
BEGIN
  SELECT count(*), COALESCE(sum(amount),0) INTO v_count, v_total
    FROM cash_movements WHERE supplier_id IS NOT NULL AND accounting_status = 'not_accounted';
  IF v_count <> 4 OR v_total <> 1510000 THEN
    RAISE EXCEPTION 'Precheck failed: expected 4/1510000, got %/%', v_count, v_total;
  END IF;
END $$;

UPDATE cash_movements SET accounting_status = 'excluded'
  WHERE supplier_id IS NOT NULL AND accounting_status = 'not_accounted';

-- ============================================================
-- PART 8: Data fix — backfill funding_source='cash' on NULL-funded
-- ============================================================
UPDATE supplier_payments SET funding_source = 'cash' WHERE funding_source IS NULL;
