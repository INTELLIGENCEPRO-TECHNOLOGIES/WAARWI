/*
# RS1-v2: Canonical balance payment model, report integration, ADAMA repair

## Summary
Complete rewrite of the balance-payment flow to follow the canonical model:
customer_payment + cash_movement + credit_allocations (FIFO on positive adjustments).
No negative balance_adjustments, no sale_payments, no balance_payment kind.

## Changes

### 1. register_customer_balance_payment — full rewrite
  - Authenticates user + tenant, locks customer + session FOR UPDATE
  - Validates site, payment_method belong to tenant
  - Computes report_due from positive eligible adjustments (remaining = amount - amount_used)
  - REJECTS if p_amount > report_due (never caps silently)
  - Idempotency guard on idempotency_key
  - Creates customer_payment, then cash_movement (kind='income'), then FIFO credit_allocations
  - Increases amount_used on targeted adjustments
  - Decreases customer.balance
  - Increases session theoretical_amount
  - Sets target_adjustment_id when single adjustment targeted

### 2. recalculate_customer_balance — subtract confirmed customer_payments
  - New term v_cust_pays: SUM of confirmed, non-cancelled customer_payments
  - Formula: sales - sale_payments - prepays - avoirs + withdrawals + loans + adjustments - customer_payments

### 3. get_customer_statement — add customer_payment credit lines
  - New UNION ALL for customer_payments (confirmed) as credit rows

### 4. get_customers_report — include customer_payments in encaissements
  - New UNION ALL in ep CTE for confirmed customer_payments via their cash_movement

### 5. get_tiers_balance (both overloads) — include customer_payments
  - 1-arg: reads from customers.balance (already correct after recalculate fix)
  - 2-arg (asof): new UNION ALL in ev CTE for confirmed customer_payments as negative events

### 6. comptabiliser_reglement_solde_client — tenant guard + revoke from authenticated
  - Adds explicit tenant ownership check on the payment
  - Revokes EXECUTE from authenticated (only callable internally by en_masse)

### 7. ADAMA CISSÉ repair (forward-only)
  - Creates cash_movement for existing 70k customer_payment
  - Links cash_movement_id and target_adjustment_id on customer_payment
  - Creates credit_allocation (source_type='customer_payment', target_type='adjustment')
  - Updates customer.balance 540000 → 470000 with strict guard
  - Does NOT modify amount_used (already 135000 = full)
  - Does NOT modify theoretical_amount (already includes the 70k)
  - Proves theoretical_amount unchanged before/after

### Security
  - register_customer_balance_payment: SECURITY DEFINER, EXECUTE to authenticated only
  - comptabiliser_reglement_solde_client: EXECUTE revoked from authenticated, only service_role/owner
  - No new tables, no constraint changes
*/

-- ============================================================
-- 1. register_customer_balance_payment — FULL REWRITE
-- ============================================================
CREATE OR REPLACE FUNCTION public.register_customer_balance_payment(
  p_customer_id       uuid,
  p_payment_method_id uuid,
  p_method_name       text,
  p_amount            numeric,
  p_reference         text DEFAULT '',
  p_cash_session_id   uuid DEFAULT NULL,
  p_idempotency_key   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn_rbp$
DECLARE
  v_tenant_id     uuid;
  v_uid           uuid;
  v_cust          record;
  v_sess          record;
  v_site_id       uuid;
  v_pm            record;
  v_report_due    numeric;
  v_cp_id         uuid;
  v_cm_id         uuid;
  v_remaining     numeric;
  v_take          numeric;
  v_adj           record;
  v_alloc_count   int := 0;
  v_single_adj_id uuid;
  v_existing      uuid;
BEGIN
  -- Auth
  v_uid := auth.uid();
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Utilisateur non authentifié'; END IF;
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Contexte tenant introuvable'; END IF;

  -- Validate amount
  IF COALESCE(p_amount, 0) <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

  -- Idempotency check
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing FROM customer_payments
    WHERE idempotency_key = p_idempotency_key AND tenant_id = v_tenant_id;
    IF FOUND THEN
      RETURN jsonb_build_object('success', true, 'idempotent', true, 'customer_payment_id', v_existing);
    END IF;
  END IF;

  -- Lock customer
  SELECT id, balance, tenant_id, site_id INTO v_cust
  FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable ou hors tenant'; END IF;

  -- Lock session
  IF p_cash_session_id IS NOT NULL THEN
    SELECT id, site_id, status, tenant_id INTO v_sess
    FROM cash_sessions WHERE id = p_cash_session_id AND tenant_id = v_tenant_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Session de caisse introuvable ou hors tenant'; END IF;
    IF v_sess.status <> 'open' THEN RAISE EXCEPTION 'Session de caisse non ouverte'; END IF;
    v_site_id := v_sess.site_id;
  ELSE
    v_site_id := v_cust.site_id;
  END IF;

  -- Validate site belongs to tenant
  IF v_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sites WHERE id = v_site_id AND tenant_id = v_tenant_id
  ) THEN RAISE EXCEPTION 'Site hors tenant'; END IF;

  -- Validate payment method
  SELECT id, name, payment_type, is_active INTO v_pm
  FROM payment_methods WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Mode de paiement introuvable ou hors tenant'; END IF;
  IF v_pm.is_active IS NOT TRUE THEN RAISE EXCEPTION 'Mode de paiement inactif'; END IF;
  IF v_pm.payment_type NOT IN ('cash','bank','mobile','card','check') THEN
    RAISE EXCEPTION 'Type de paiement non autorisé: %', v_pm.payment_type;
  END IF;

  -- Compute report_due from positive eligible adjustments
  SELECT COALESCE(SUM(GREATEST(ba.amount - ba.amount_used, 0)), 0)
  INTO v_report_due
  FROM balance_adjustments ba
  WHERE ba.entity_id = p_customer_id AND ba.entity_type = 'customer'
    AND ba.tenant_id = v_tenant_id
    AND ba.amount > 0
    AND ba.kind NOT IN ('reconciliation','cancel_reversal');

  -- Strict rejection (no silent cap)
  IF p_amount > v_report_due THEN
    RAISE EXCEPTION 'Montant (%) dépasse le report restant (%)', p_amount, v_report_due;
  END IF;

  -- Create customer_payment
  INSERT INTO customer_payments (
    tenant_id, customer_id, amount, method, method_name,
    payment_method_id, reference, cash_session_id, site_id, user_id,
    idempotency_key, status
  ) VALUES (
    v_tenant_id, p_customer_id, p_amount,
    v_pm.payment_type, COALESCE(p_method_name, v_pm.name),
    p_payment_method_id, COALESCE(p_reference, ''),
    p_cash_session_id, v_site_id, v_uid,
    p_idempotency_key, 'confirmed'
  ) RETURNING id INTO v_cp_id;

  -- Create cash_movement
  INSERT INTO cash_movements (
    tenant_id, kind, amount, reason, reference, customer_id,
    cash_session_id, site_id, user_id, payment_method_id
  ) VALUES (
    v_tenant_id, 'income', p_amount,
    'Règlement report de solde',
    COALESCE(p_reference, 'Règlement solde'),
    p_customer_id,
    p_cash_session_id, v_site_id, v_uid, p_payment_method_id
  ) RETURNING id INTO v_cm_id;

  -- Link cash_movement to customer_payment
  UPDATE customer_payments SET cash_movement_id = v_cm_id WHERE id = v_cp_id;

  -- FIFO allocation on positive adjustments
  v_remaining := p_amount;
  FOR v_adj IN
    SELECT ba.id, ba.amount, ba.amount_used,
      GREATEST(ba.amount - ba.amount_used, 0) AS avail
    FROM balance_adjustments ba
    WHERE ba.entity_id = p_customer_id AND ba.entity_type = 'customer'
      AND ba.tenant_id = v_tenant_id
      AND ba.amount > 0
      AND ba.kind NOT IN ('reconciliation','cancel_reversal')
      AND ba.amount > ba.amount_used
    ORDER BY ba.created_at
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_adj.avail);

    INSERT INTO credit_allocations (
      tenant_id, customer_id, source_type, source_id, target_type, target_id, amount
    ) VALUES (
      v_tenant_id, p_customer_id, 'customer_payment', v_cp_id, 'adjustment', v_adj.id, v_take
    );

    UPDATE balance_adjustments SET amount_used = amount_used + v_take
    WHERE id = v_adj.id;

    v_alloc_count := v_alloc_count + 1;
    IF v_alloc_count = 1 THEN v_single_adj_id := v_adj.id; END IF;
    v_remaining := v_remaining - v_take;
  END LOOP;

  -- Set target_adjustment_id if single adjustment
  IF v_alloc_count = 1 THEN
    UPDATE customer_payments SET target_adjustment_id = v_single_adj_id WHERE id = v_cp_id;
  END IF;

  -- Decrease customer balance
  UPDATE customers SET balance = balance - p_amount
  WHERE id = p_customer_id AND tenant_id = v_tenant_id;

  -- Increase session theoretical
  IF p_cash_session_id IS NOT NULL THEN
    UPDATE cash_sessions SET theoretical_amount = theoretical_amount + p_amount
    WHERE id = p_cash_session_id AND tenant_id = v_tenant_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'customer_payment_id', v_cp_id,
    'cash_movement_id', v_cm_id,
    'amount', p_amount,
    'allocations', v_alloc_count
  );
END;
$fn_rbp$;

REVOKE ALL ON FUNCTION public.register_customer_balance_payment(uuid,uuid,text,numeric,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_customer_balance_payment(uuid,uuid,text,numeric,text,uuid,text) FROM anon;
GRANT EXECUTE ON FUNCTION public.register_customer_balance_payment(uuid,uuid,text,numeric,text,uuid,text) TO authenticated;


-- ============================================================
-- 2. recalculate_customer_balance — add customer_payments term
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalculate_customer_balance(p_customer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn_rcb$
DECLARE
  v_tenant_id       uuid;
  v_stored          numeric;
  v_computed        numeric;
  v_delta           numeric;
  v_sales           numeric;
  v_payments        numeric;
  v_prepays         numeric;
  v_avoirs          numeric;
  v_withdrawals     numeric;
  v_loans           numeric;
  v_adjustments     numeric;
  v_cust_pays       numeric;
BEGIN
  v_tenant_id := public.current_tenant_id();
  IF v_tenant_id IS NULL THEN
    SELECT tenant_id INTO v_tenant_id FROM public.customers WHERE id = p_customer_id LIMIT 1;
  END IF;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Client introuvable: %', p_customer_id; END IF;

  SELECT balance INTO v_stored FROM public.customers
  WHERE id = p_customer_id AND tenant_id = v_tenant_id FOR UPDATE;
  IF v_stored IS NULL THEN v_stored := 0; END IF;

  SELECT COALESCE(SUM(total), 0) INTO v_sales
  FROM public.sales
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND status <> 'cancelled' AND deleted_at IS NULL;

  SELECT COALESCE(SUM(sp.amount), 0) INTO v_payments
  FROM public.sale_payments sp
  JOIN public.sales s ON s.id = sp.sale_id
  WHERE s.customer_id = p_customer_id AND s.tenant_id = v_tenant_id
    AND COALESCE(sp.affects_balance, true) = true;

  SELECT COALESCE(SUM(amount), 0) INTO v_prepays
  FROM public.customer_prepayments
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id;

  SELECT COALESCE(SUM(total), 0) INTO v_avoirs
  FROM public.sale_returns
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND status = 'approved' AND refund_method = 'avoir';

  SELECT COALESCE(SUM(amount), 0) INTO v_withdrawals
  FROM public.cash_movements
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND kind = 'customer_withdrawal';

  SELECT COALESCE(SUM(amount), 0) INTO v_loans
  FROM public.cash_movements
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND kind = 'customer_loan';

  SELECT COALESCE(SUM(amount), 0) INTO v_adjustments
  FROM public.balance_adjustments
  WHERE entity_id = p_customer_id AND tenant_id = v_tenant_id
    AND entity_type = 'customer'
    AND kind NOT IN ('reconciliation','cancel_reversal');

  -- Confirmed customer_payments (balance report payments)
  SELECT COALESCE(SUM(amount), 0) INTO v_cust_pays
  FROM public.customer_payments
  WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id
    AND status = 'confirmed';

  v_computed := v_sales - v_payments - v_prepays - v_avoirs
                + v_withdrawals + v_loans + v_adjustments - v_cust_pays;
  v_delta := v_computed - v_stored;

  IF v_delta = 0 THEN
    RETURN jsonb_build_object('customer_id', p_customer_id,
      'stored', v_stored, 'computed', v_computed, 'corrected', false);
  END IF;

  UPDATE public.customers SET balance = v_computed
  WHERE id = p_customer_id AND tenant_id = v_tenant_id;

  INSERT INTO public.balance_reconciliation_log (
    tenant_id, customer_id, previous_balance, computed_balance, delta, note, user_id
  ) VALUES (
    v_tenant_id, p_customer_id, v_stored, v_computed, v_delta,
    'Resynchronisation technique du solde en cache', auth.uid()
  );

  RETURN jsonb_build_object('customer_id', p_customer_id,
    'stored', v_stored, 'computed', v_computed, 'corrected', true, 'delta', v_delta);
END;
$fn_rcb$;


-- ============================================================
-- 3. get_customer_statement — add customer_payments credit line
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_customer_statement(
  p_customer_id uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn_stmt$
DECLARE
  v_tenant_id   uuid;
  v_tz          text;
  v_from_ts     timestamptz;
  v_to_excl     timestamptz;
  v_balance     numeric := 0;
  v_total_delta numeric := 0;
  v_base        numeric := 0;
  v_opening     numeric := 0;
  v_closing     numeric := 0;
  v_result      jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Contexte tenant introuvable'; END IF;

  SELECT COALESCE(balance, 0) INTO v_balance
  FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable'; END IF;

  SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz
  FROM tenants WHERE id = v_tenant_id;
  v_tz := COALESCE(v_tz, 'Africa/Dakar');

  v_from_ts := CASE WHEN p_from IS NOT NULL THEN (p_from::timestamp AT TIME ZONE v_tz) ELSE NULL END;
  v_to_excl := CASE WHEN p_to   IS NOT NULL THEN ((p_to + 1)::timestamp AT TIME ZONE v_tz) ELSE NULL END;

  WITH movements AS (
    -- Balance adjustments
    SELECT ba.created_at AS ts, 1 AS ord, ba.id AS row_id, ''::text AS piece,
      CASE
        WHEN ba.kind = 'cancel_reversal' THEN COALESCE(NULLIF(ba.note, ''), 'Contre-passation annulation')
        WHEN ba.kind = 'carryover' THEN COALESCE(NULLIF(ba.note, ''), 'Report de solde antérieur')
        WHEN ba.amount > 0 THEN COALESCE(NULLIF(ba.note, ''), 'Ajustement solde')
        ELSE COALESCE(NULLIF(ba.note, ''), 'Règlement solde')
      END AS label,
      CASE WHEN ba.kind = 'cancel_reversal' THEN GREATEST(ba.amount, 0)
           WHEN ba.amount > 0 THEN ba.amount ELSE 0 END AS debit,
      CASE WHEN ba.kind = 'cancel_reversal' THEN GREATEST(-ba.amount, 0)
           WHEN ba.amount < 0 THEN -ba.amount ELSE 0 END AS credit,
      (ba.kind <> 'cancel_reversal') AS affects,
      CASE WHEN ba.kind = 'cancel_reversal' THEN 'cancel'
           WHEN ba.kind = 'carryover' THEN 'adjustment'
           WHEN ba.amount > 0 THEN 'adjustment' ELSE 'payment' END AS kind,
      (ba.kind = 'carryover') AS is_carryover
    FROM balance_adjustments ba
    WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
      AND ba.entity_id = p_customer_id
      AND ba.kind IS DISTINCT FROM 'reconciliation' AND ba.amount <> 0

    UNION ALL
    -- Sales
    SELECT s.created_at, 2, s.id, s.sale_number,
      CASE WHEN s.status = 'cancelled' THEN 'Facture annulée'
           WHEN s.status = 'deleted' THEN 'Facture'
           ELSE 'Vente' END,
      s.total::numeric, 0::numeric,
      (s.status NOT IN ('cancelled', 'deleted')),
      CASE WHEN s.status IN ('cancelled', 'deleted') THEN 'cancel' ELSE 'sale' END,
      false
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id

    UNION ALL
    -- Deleted sale reversals
    SELECT COALESCE(s.deleted_at, s.created_at), 3, s.id, s.sale_number,
      'Suppression facture ' || s.sale_number, 0::numeric, s.total::numeric, false, 'cancel'::text, false
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id AND s.status = 'deleted'

    UNION ALL
    -- Sale payments
    SELECT sp.created_at, 4, sp.id, COALESCE(s.sale_number, ''),
      CASE WHEN sp.affects_balance = false THEN COALESCE(sp.method_name, 'Règlement par crédit')
           ELSE 'Règlement' || CASE WHEN sp.method_name IS NOT NULL THEN ' · ' || sp.method_name ELSE '' END END,
      0::numeric, sp.amount::numeric, COALESCE(sp.affects_balance, true),
      CASE WHEN sp.affects_balance = false THEN 'allocation' ELSE 'payment' END,
      false
    FROM sale_payments sp
    JOIN sales s ON s.id = sp.sale_id
    LEFT JOIN payment_methods pm ON pm.id = sp.payment_method_id
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id
      AND COALESCE(pm.payment_type, '') <> 'credit'
      AND NOT (COALESCE(sp.affects_balance, true) = true
              AND (sp.method_name LIKE 'Acompte ·%' OR sp.method_name LIKE 'Avoir %'))

    UNION ALL
    -- Prepayments
    SELECT pp.created_at, 5, pp.id, COALESCE(pp.reference, ''),
      'Acompte' || CASE WHEN pp.method_name IS NOT NULL THEN ' · ' || pp.method_name ELSE '' END,
      0::numeric, pp.amount::numeric, true, 'prepayment'::text, false
    FROM customer_prepayments pp
    WHERE pp.tenant_id = v_tenant_id AND pp.customer_id = p_customer_id AND pp.amount > 0

    UNION ALL
    -- Avoirs
    SELECT COALESCE(sr.refunded_at, sr.created_at), 6, sr.id, sr.return_number, 'Avoir'::text,
      0::numeric, sr.total::numeric, true, 'avoir'::text, false
    FROM sale_returns sr
    WHERE sr.tenant_id = v_tenant_id AND sr.customer_id = p_customer_id
      AND sr.status = 'approved' AND sr.refund_method = 'avoir'

    UNION ALL
    -- Withdrawals
    SELECT cm.created_at, 7, cm.id, COALESCE(cm.reference, ''),
      'Retrait caisse' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
      cm.amount::numeric, 0::numeric, true, 'withdrawal'::text, false
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
      AND cm.kind = 'customer_withdrawal'

    UNION ALL
    -- Loans
    SELECT cm.created_at, 8, cm.id, COALESCE(cm.reference, ''),
      'Prêt client' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
      cm.amount::numeric, 0::numeric, true, 'loan'::text, false
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
      AND cm.kind = 'customer_loan'

    UNION ALL
    -- Customer balance payments (confirmed)
    SELECT cp.created_at, 9, cp.id, ''::text,
      'Règlement report de solde' || CASE WHEN COALESCE(cp.method_name, '') <> '' THEN ' · ' || cp.method_name ELSE '' END,
      0::numeric, cp.amount::numeric, true, 'balance_payment'::text, false
    FROM customer_payments cp
    WHERE cp.tenant_id = v_tenant_id AND cp.customer_id = p_customer_id
      AND cp.status = 'confirmed'
  ),
  effective AS (
    SELECT ts, ord, row_id, piece, label, debit, credit, affects, kind,
      CASE
        WHEN is_carryover AND v_from_ts IS NULL THEN true
        WHEN is_carryover AND ts < v_from_ts THEN true
        ELSE false
      END AS is_opening_part
    FROM movements
  ),
  visible AS (
    SELECT * FROM effective WHERE NOT is_opening_part
  ),
  ordered AS (
    SELECT v.ts, v.ord, v.row_id, v.piece, v.label, v.kind, v.debit, v.credit, v.affects,
      SUM(CASE WHEN v.affects THEN v.debit - v.credit ELSE 0 END)
        OVER (ORDER BY v.ts, v.ord, v.row_id ROWS UNBOUNDED PRECEDING) AS cum
    FROM visible v
  )
  SELECT
    COALESCE((SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END) FROM movements), 0),
    jsonb_build_object(
      'balance', v_balance,
      'opening_delta', COALESCE((
        SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END)
        FROM effective
        WHERE is_opening_part
           OR (v_from_ts IS NOT NULL AND ts < v_from_ts AND affects)
      ), 0),
      'closing_delta', COALESCE((
        SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END)
        FROM movements WHERE v_to_excl IS NULL OR ts < v_to_excl
      ), 0),
      'total_debit', COALESCE((SELECT SUM(debit) FROM ordered o
        WHERE affects AND (v_from_ts IS NULL OR o.ts >= v_from_ts) AND (v_to_excl IS NULL OR o.ts < v_to_excl)), 0),
      'total_credit', COALESCE((SELECT SUM(credit) FROM ordered o
        WHERE affects AND (v_from_ts IS NULL OR o.ts >= v_from_ts) AND (v_to_excl IS NULL OR o.ts < v_to_excl)), 0),
      'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'ts', o.ts, 'piece', o.piece, 'label', o.label, 'kind', o.kind,
        'debit', o.debit, 'credit', o.credit, 'cum', o.cum, 'affects', o.affects
      ) ORDER BY o.ts, o.ord, o.row_id)
      FROM ordered o
      WHERE (v_from_ts IS NULL OR o.ts >= v_from_ts) AND (v_to_excl IS NULL OR o.ts < v_to_excl)),
      '[]'::jsonb)
    )
  INTO v_total_delta, v_result
  FROM (SELECT 1) _;

  v_base := v_balance - v_total_delta;
  v_opening := v_base + (v_result->>'opening_delta')::numeric;
  v_closing := v_base + (v_result->>'closing_delta')::numeric;

  v_result := jsonb_set(v_result, '{opening_balance}', to_jsonb(v_opening));
  v_result := jsonb_set(v_result, '{closing_balance}', to_jsonb(v_closing));
  v_result := jsonb_set(v_result, '{opening_debit}', to_jsonb(GREATEST(v_opening, 0)));
  v_result := jsonb_set(v_result, '{opening_credit}', to_jsonb(GREATEST(-v_opening, 0)));
  v_result := v_result - 'opening_delta' - 'closing_delta';

  v_result := jsonb_set(v_result, '{rows}', COALESCE((
    SELECT jsonb_agg(
      jsonb_set(r - 'cum', '{running}', to_jsonb(v_opening + (r->>'cum')::numeric)))
    FROM jsonb_array_elements(v_result->'rows') r), '[]'::jsonb));

  RETURN v_result;
END;
$fn_stmt$;


-- ============================================================
-- 4. get_customers_report — customer_payments in encaissements
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_customers_report(
  p_site_id uuid DEFAULT NULL, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE
)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn_cr$
DECLARE
  v_tenant_id uuid;
  v_tz        text;
  v_ts_from   timestamptz;
  v_ts_to     timestamptz;
  v_rows      jsonb;
  v_totals    jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
  ) THEN RAISE EXCEPTION 'Site not authorized'; END IF;

  SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz
  FROM tenants WHERE id = v_tenant_id;
  v_tz := COALESCE(v_tz, 'Africa/Dakar');
  v_ts_from := (p_from::timestamp AT TIME ZONE v_tz);
  v_ts_to   := ((p_to + 1)::timestamp AT TIME ZONE v_tz);

  WITH sp AS (
    SELECT s.customer_id AS cid,
      COUNT(*) AS nb,
      SUM(s.total - COALESCE(s.vat_amount, 0)) AS ca_ht,
      SUM(COALESCE(s.discount, 0)) AS remises,
      SUM(COALESCE((SELECT SUM(si.purchase_cost * si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0)) AS cost
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
      AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
      AND s.customer_id IS NOT NULL
    GROUP BY s.customer_id
  ),
  rp AS (
    SELECT sr.customer_id AS cid,
      SUM(sr.total) AS retours,
      SUM(COALESCE((SELECT SUM(sri.purchase_cost * sri.quantity) FROM sale_return_items sri WHERE sri.return_id = sr.id), 0)) AS ret_cost
    FROM sale_returns sr
    WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved'
      AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
      AND (p_site_id IS NULL OR sr.site_id = p_site_id)
      AND sr.customer_id IS NOT NULL
    GROUP BY sr.customer_id
  ),
  ep AS (
    SELECT cid, SUM(enc) AS enc FROM (
      SELECT cm.customer_id AS cid, SUM(cm.amount) AS enc
      FROM cash_movements cm
      WHERE cm.tenant_id = v_tenant_id AND cm.kind IN ('income', 'customer_prepayment')
        AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
        AND (p_site_id IS NULL OR cm.site_id = p_site_id)
        AND cm.customer_id IS NOT NULL
      GROUP BY cm.customer_id
      UNION ALL
      SELECT s.customer_id AS cid, SUM(spay.amount) AS enc
      FROM sale_payments spay
      JOIN sales s ON s.id = spay.sale_id
      WHERE spay.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
        AND COALESCE(spay.affects_balance, true) = true
        AND spay.created_at >= v_ts_from AND spay.created_at < v_ts_to
        AND (p_site_id IS NULL OR s.site_id = p_site_id)
        AND NOT EXISTS (
          SELECT 1 FROM cash_movements cm2
          WHERE cm2.tenant_id = v_tenant_id AND cm2.kind = 'income'
            AND cm2.customer_id = s.customer_id
            AND cm2.reference = spay.reference
            AND cm2.amount = spay.amount
            AND cm2.created_at >= v_ts_from AND cm2.created_at < v_ts_to
        )
      GROUP BY s.customer_id
    ) sub GROUP BY cid
  ),
  act AS (
    SELECT DISTINCT cid FROM (
      SELECT s.customer_id AS cid FROM sales s
      WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
        AND s.customer_id IS NOT NULL
        AND (CASE WHEN (s.doc_header ->> 'doc_date') ~ '^\d{4}-\d{2}-\d{2}'
             THEN ((s.doc_header ->> 'doc_date')::date)::timestamp AT TIME ZONE v_tz
             ELSE s.created_at END) >= v_ts_from
        AND (CASE WHEN (s.doc_header ->> 'doc_date') ~ '^\d{4}-\d{2}-\d{2}'
             THEN ((s.doc_header ->> 'doc_date')::date)::timestamp AT TIME ZONE v_tz
             ELSE s.created_at END) < v_ts_to
      UNION
      SELECT s.customer_id FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
      WHERE sp2.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
        AND sp2.created_at >= v_ts_from AND sp2.created_at < v_ts_to
      UNION
      SELECT sr.customer_id FROM sale_returns sr
      WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
        AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
      UNION
      SELECT cm.customer_id FROM cash_movements cm
      WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL
        AND cm.kind IN ('income','customer_prepayment','customer_loan','customer_withdrawal','refund')
        AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
      UNION
      SELECT ba.entity_id FROM balance_adjustments ba
      WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
        AND ba.kind NOT IN ('reconciliation','cancel_reversal')
        AND ba.created_at >= v_ts_from AND ba.created_at < v_ts_to
      UNION
      SELECT cp.customer_id FROM customer_payments cp
      WHERE cp.tenant_id = v_tenant_id AND cp.status = 'confirmed'
        AND cp.created_at >= v_ts_from AND cp.created_at < v_ts_to
    ) a
  ),
  ev AS (
    SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
    FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
    UNION ALL
    SELECT s.customer_id, sp2.created_at, -sp2.amount
    FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
    WHERE sp2.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL AND COALESCE(sp2.affects_balance, true) = true
    UNION ALL
    SELECT sr.customer_id, sr.created_at, -sr.total
    FROM sale_returns sr WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
    UNION ALL
    SELECT pp.customer_id, pp.created_at, -pp.amount
    FROM customer_prepayments pp WHERE pp.tenant_id = v_tenant_id AND pp.customer_id IS NOT NULL
    UNION ALL
    SELECT cm.customer_id, cm.created_at, cm.amount
    FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_withdrawal'
    UNION ALL
    SELECT cm.customer_id, cm.created_at, cm.amount
    FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_loan'
    UNION ALL
    SELECT ba.entity_id, ba.created_at, ba.amount
    FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer' AND ba.kind NOT IN ('reconciliation','cancel_reversal')
    UNION ALL
    -- Customer balance payments reduce balance
    SELECT cp.customer_id, cp.created_at, -cp.amount
    FROM customer_payments cp WHERE cp.tenant_id = v_tenant_id AND cp.status = 'confirmed'
  ),
  dc AS (
    SELECT cid,
      COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_from), 0) AS delta_from,
      COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_to), 0)   AS delta_after
    FROM ev GROUP BY cid
  ),
  real_rows AS (
    SELECT
      c.id AS customer_id, COALESCE(c.name, 'Client supprimé') AS name,
      (c.site_id IS NULL) AS is_shared,
      (act.cid IS NOT NULL) AS has_activity,
      COALESCE(sp.nb, 0) AS nb_ventes,
      COALESCE(sp.ca_ht, 0) AS ca_ht,
      COALESCE(sp.remises, 0) AS remises,
      COALESCE(rp.retours, 0) AS retours,
      COALESCE(sp.ca_ht, 0) - COALESCE(rp.retours, 0) AS ca_net,
      COALESCE(sp.cost, 0) - COALESCE(rp.ret_cost, 0) AS cost,
      (COALESCE(sp.ca_ht, 0) - COALESCE(rp.retours, 0)) - (COALESCE(sp.cost, 0) - COALESCE(rp.ret_cost, 0)) AS marge,
      COALESCE(ep.enc, 0) AS encaissements,
      COALESCE(c.balance, 0) - COALESCE(dc.delta_from, 0)  AS solde_anterieur,
      COALESCE(c.balance, 0) - COALESCE(dc.delta_after, 0) AS solde_a_date
    FROM customers c
    LEFT JOIN sp ON sp.cid = c.id
    LEFT JOIN rp ON rp.cid = c.id
    LEFT JOIN ep ON ep.cid = c.id
    LEFT JOIN dc ON dc.cid = c.id
    LEFT JOIN act ON act.cid = c.id
    WHERE c.tenant_id = v_tenant_id
      AND (
        sp.cid IS NOT NULL OR rp.cid IS NOT NULL OR ep.cid IS NOT NULL
        OR act.cid IS NOT NULL
        OR (COALESCE(c.balance, 0) <> 0 AND (p_site_id IS NULL OR c.site_id = p_site_id OR c.site_id IS NULL))
        OR (COALESCE(c.balance, 0) - COALESCE(dc.delta_after, 0)) <> 0
      )
  ),
  comptoir AS (
    SELECT
      NULL::uuid AS customer_id, 'Comptoir'::text AS name,
      false AS is_shared, true AS has_activity,
      COUNT(*) AS nb_ventes,
      SUM(s.total - COALESCE(s.vat_amount, 0)) AS ca_ht,
      SUM(COALESCE(s.discount, 0)) AS remises,
      0::numeric AS retours,
      SUM(s.total - COALESCE(s.vat_amount, 0)) AS ca_net,
      SUM(COALESCE((SELECT SUM(si.purchase_cost * si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0)) AS cost,
      SUM(s.total - COALESCE(s.vat_amount, 0)) - SUM(COALESCE((SELECT SUM(si.purchase_cost * si.quantity) FROM sale_items si WHERE si.sale_id = s.id), 0)) AS marge,
      0::numeric AS encaissements,
      0::numeric AS solde_anterieur,
      0::numeric AS solde_a_date
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
      AND s.created_at >= v_ts_from AND s.created_at < v_ts_to
      AND (p_site_id IS NULL OR s.site_id = p_site_id)
      AND s.customer_id IS NULL
    HAVING COUNT(*) > 0
  ),
  all_rows AS (
    SELECT customer_id, name, is_shared, nb_ventes, ca_ht, remises, retours, ca_net, cost, marge,
      encaissements, solde_anterieur, solde_a_date,
      GREATEST(solde_a_date, 0) AS montant_du,
      GREATEST(-solde_a_date, 0) AS credit_disponible,
      CASE WHEN NOT has_activity AND ABS(solde_anterieur) > 0.5 THEN 'prior_only' ELSE 'active' END AS status
    FROM real_rows
    UNION ALL
    SELECT customer_id, name, is_shared, nb_ventes, ca_ht, remises, retours, ca_net, cost, marge,
      encaissements, solde_anterieur, solde_a_date, 0::numeric, 0::numeric, 'active'
    FROM comptoir
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'customer_id', customer_id, 'name', name, 'is_shared', is_shared,
      'nb_ventes', nb_ventes, 'ca_ht', ca_ht, 'remises', remises, 'retours', retours,
      'ca_net', ca_net, 'cost', cost, 'marge', marge,
      'encaissements', encaissements, 'solde_anterieur', solde_anterieur,
      'solde_a_date', solde_a_date, 'montant_du', montant_du,
      'credit_disponible', credit_disponible, 'status', status
    ) ORDER BY ca_net DESC, montant_du DESC), '[]'::jsonb),
    jsonb_build_object(
      'nb_clients', COUNT(*),
      'ca_ht', COALESCE(SUM(ca_ht), 0),
      'remises', COALESCE(SUM(remises), 0),
      'retours', COALESCE(SUM(retours), 0),
      'ca_net', COALESCE(SUM(ca_net), 0),
      'marge', COALESCE(SUM(marge), 0),
      'encaissements', COALESCE(SUM(encaissements), 0),
      'montant_du', COALESCE(SUM(montant_du), 0),
      'credit_disponible', COALESCE(SUM(credit_disponible), 0)
    )
  INTO v_rows, v_totals
  FROM all_rows;

  RETURN jsonb_build_object('asOf', to_char(p_to, 'YYYY-MM-DD'), 'rows', v_rows, 'totals', v_totals);
END;
$fn_cr$;


-- ============================================================
-- 5a. get_tiers_balance (1-arg) — uses cached balance, no changes needed
--     since recalculate_customer_balance now accounts for customer_payments
--     The function reads customers.balance which is the cache. No change required.
-- ============================================================

-- ============================================================
-- 5b. get_tiers_balance (2-arg, asof) — add customer_payments to ev CTE
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_tiers_balance(
  p_site_id uuid DEFAULT NULL, p_as_of date DEFAULT CURRENT_DATE
)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
AS $fn_tb2$
DECLARE
  v_tenant_id uuid;
  v_tz        text;
  v_ts_asof   timestamptz;
  v_customers jsonb;
  v_suppliers jsonb;
  v_cust_tot  jsonb;
  v_sup_tot   jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_site_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id
  ) THEN RAISE EXCEPTION 'Site not authorized'; END IF;

  SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz
  FROM tenants WHERE id = v_tenant_id;
  v_tz := COALESCE(v_tz, 'Africa/Dakar');
  v_ts_asof := ((p_as_of + 1)::timestamp AT TIME ZONE v_tz);

  WITH ev AS (
    SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
    FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
    UNION ALL
    SELECT s.customer_id, sp.created_at, -sp.amount
    FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
    WHERE sp.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL AND COALESCE(sp.affects_balance, true) = true
    UNION ALL
    SELECT sr.customer_id, sr.created_at, -sr.total
    FROM sale_returns sr WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
    UNION ALL
    SELECT pp.customer_id, pp.created_at, -pp.amount
    FROM customer_prepayments pp WHERE pp.tenant_id = v_tenant_id AND pp.customer_id IS NOT NULL
    UNION ALL
    SELECT cm.customer_id, cm.created_at, cm.amount
    FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_withdrawal'
    UNION ALL
    SELECT cm.customer_id, cm.created_at, cm.amount
    FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_loan'
    UNION ALL
    SELECT ba.entity_id, ba.created_at, ba.amount
    FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer' AND ba.kind NOT IN ('reconciliation','cancel_reversal')
    UNION ALL
    -- Customer balance payments
    SELECT cp.customer_id, cp.created_at, -cp.amount
    FROM customer_payments cp WHERE cp.tenant_id = v_tenant_id AND cp.status = 'confirmed'
  ),
  dc AS (
    SELECT cid, COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_asof), 0) AS delta_after
    FROM ev GROUP BY cid
  ),
  cust AS (
    SELECT c.id, COALESCE(c.name, 'Client inconnu') AS name,
      COALESCE(c.balance, 0) - COALESCE(dc.delta_after, 0) AS net
    FROM customers c
    LEFT JOIN dc ON dc.cid = c.id
    WHERE c.tenant_id = v_tenant_id
      AND (p_site_id IS NULL OR c.site_id = p_site_id OR c.site_id IS NULL)
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'net', net,
      'due', GREATEST(net, 0), 'credit', GREATEST(-net, 0)
    ) ORDER BY net DESC) FILTER (WHERE net <> 0), '[]'::jsonb),
    jsonb_build_object(
      'due', COALESCE(SUM(GREATEST(net, 0)) FILTER (WHERE net <> 0), 0),
      'credit', COALESCE(SUM(GREATEST(-net, 0)) FILTER (WHERE net <> 0), 0)
    )
  INTO v_customers, v_cust_tot
  FROM cust;

  -- Suppliers (unchanged)
  WITH ev AS (
    SELECT so.supplier_id AS cid, so.created_at AS ts, so.total AS amt
    FROM supplier_orders so WHERE so.tenant_id = v_tenant_id AND so.status NOT IN ('cancelled', 'draft')
    UNION ALL
    SELECT spm.supplier_id, COALESCE(spm.paid_at, spm.created_at), -spm.amount
    FROM supplier_payments spm WHERE spm.tenant_id = v_tenant_id
    UNION ALL
    SELECT ba.entity_id, ba.created_at, ba.amount
    FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'supplier'
  ),
  dc AS (
    SELECT cid, COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_asof), 0) AS delta_after
    FROM ev GROUP BY cid
  ),
  sup AS (
    SELECT s.id, COALESCE(s.name, 'Fournisseur inconnu') AS name,
      COALESCE(s.balance, 0) - COALESCE(dc.delta_after, 0) AS net
    FROM suppliers s
    LEFT JOIN dc ON dc.cid = s.id
    WHERE s.tenant_id = v_tenant_id
      AND (p_site_id IS NULL OR s.site_id = p_site_id OR s.site_id IS NULL)
  )
  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'net', net,
      'due', GREATEST(net, 0), 'advance', GREATEST(-net, 0)
    ) ORDER BY net DESC) FILTER (WHERE net <> 0), '[]'::jsonb),
    jsonb_build_object(
      'due', COALESCE(SUM(GREATEST(net, 0)) FILTER (WHERE net <> 0), 0),
      'advance', COALESCE(SUM(GREATEST(-net, 0)) FILTER (WHERE net <> 0), 0)
    )
  INTO v_suppliers, v_sup_tot
  FROM sup;

  RETURN jsonb_build_object(
    'asOf', to_char(p_as_of, 'YYYY-MM-DD'),
    'customers', v_customers,
    'suppliers', v_suppliers,
    'totals', jsonb_build_object('customers', v_cust_tot, 'suppliers', v_sup_tot)
  );
END;
$fn_tb2$;


-- ============================================================
-- 6. comptabiliser_reglement_solde_client — tenant guard + internal only
-- ============================================================
CREATE OR REPLACE FUNCTION public.comptabiliser_reglement_solde_client(p_customer_payment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn_crs$
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
  v_caller_tenant     uuid;
BEGIN
  -- Tenant guard: only callable internally (from en_masse which already validated tenant)
  -- But add explicit check anyway
  v_caller_tenant := current_tenant_id();

  SELECT cp.* INTO v_cp FROM customer_payments cp
  WHERE cp.id = p_customer_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement solde introuvable');
  END IF;

  -- Verify tenant ownership
  IF v_caller_tenant IS NOT NULL AND v_cp.tenant_id IS DISTINCT FROM v_caller_tenant THEN
    RETURN jsonb_build_object('success', false, 'error', 'Règlement hors tenant courant');
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

  INSERT INTO journal_lines (
    tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
  ) VALUES (
    v_cp.tenant_id, v_entry_id, v_debit_account, v_acct_check.name,
    v_cp.amount, 0, 'Encaissement solde ' || v_customer_name, v_cp.customer_id
  );

  INSERT INTO journal_lines (
    tenant_id, entry_id, account_code, account_name, debit, credit, label, third_party_id
  ) VALUES (
    v_cp.tenant_id, v_entry_id, v_customer_account,
    (SELECT name FROM accounts WHERE tenant_id = v_cp.tenant_id AND code = v_customer_account LIMIT 1),
    0, v_cp.amount, 'Règlement solde ' || v_customer_name, v_cp.customer_id
  );

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
$fn_crs$;

-- Revoke direct access from authenticated — only callable internally by en_masse
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_solde_client(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_solde_client(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.comptabiliser_reglement_solde_client(uuid) FROM authenticated;


-- ============================================================
-- 7. ADAMA CISSÉ repair — forward-only
-- ============================================================
DO $repair$
DECLARE
  v_cp_id         uuid := '0eff5450-0edb-48a7-a7a2-b8efe952b1b9';
  v_customer_id   uuid := 'e1e9fadc-3b3b-4542-bd83-3cb81ce711ef';
  v_tenant_id     uuid := '31f9910a-5e94-4dc1-8ab5-c204bbcdb7db';
  v_session_id    uuid := 'de5213f4-b07f-46ba-a350-a21cb0635e3c';
  v_site_id       uuid := '91fcc3e8-f5bd-4fc8-8899-25bed82a44ee';
  v_user_id       uuid := '65a0b438-957b-4556-a296-00a851716220';
  v_pm_id         uuid := '698e5078-0249-4e8b-8f5c-d4491383b5d2';
  v_carryover_id  uuid := 'fe43e147-294e-4be6-9c13-f252b45cf831';
  v_amount        numeric := 70000;
  v_cm_id         uuid;
  v_cur_balance   numeric;
  v_cur_theo      numeric;
  v_cur_cm_id     uuid;
BEGIN
  -- Guard: customer_payment must exist and lack cash_movement_id
  SELECT cash_movement_id INTO v_cur_cm_id FROM customer_payments
  WHERE id = v_cp_id AND tenant_id = v_tenant_id AND status = 'confirmed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADAMA repair: customer_payment % introuvable', v_cp_id;
  END IF;
  IF v_cur_cm_id IS NOT NULL THEN
    RAISE NOTICE 'ADAMA repair: cash_movement_id déjà renseigné, skip (idempotent)';
    RETURN;
  END IF;

  -- Guard: balance must be exactly 540000
  SELECT balance INTO v_cur_balance FROM customers
  WHERE id = v_customer_id AND tenant_id = v_tenant_id;
  IF v_cur_balance IS DISTINCT FROM 540000 THEN
    RAISE EXCEPTION 'ADAMA repair: balance attendu 540000, trouvé %', v_cur_balance;
  END IF;

  -- Capture theoretical_amount before
  SELECT theoretical_amount INTO v_cur_theo FROM cash_sessions
  WHERE id = v_session_id AND tenant_id = v_tenant_id;
  IF v_cur_theo IS DISTINCT FROM 6944000 THEN
    RAISE EXCEPTION 'ADAMA repair: theoretical_amount attendu 6944000, trouvé %', v_cur_theo;
  END IF;

  -- Create cash_movement for existing payment
  INSERT INTO cash_movements (
    tenant_id, kind, amount, reason, reference,
    customer_id, cash_session_id, site_id, user_id, payment_method_id, created_at
  ) VALUES (
    v_tenant_id, 'income', v_amount,
    'Règlement report de solde',
    'Règlement solde · ADAMA CISSE',
    v_customer_id, v_session_id, v_site_id, v_user_id, v_pm_id,
    (SELECT created_at FROM customer_payments WHERE id = v_cp_id)
  ) RETURNING id INTO v_cm_id;

  -- Link to customer_payment
  UPDATE customer_payments SET
    cash_movement_id = v_cm_id,
    target_adjustment_id = v_carryover_id
  WHERE id = v_cp_id AND tenant_id = v_tenant_id;

  -- Create credit_allocation
  INSERT INTO credit_allocations (
    tenant_id, customer_id, source_type, source_id, target_type, target_id, amount,
    created_at
  ) VALUES (
    v_tenant_id, v_customer_id, 'customer_payment', v_cp_id,
    'adjustment', v_carryover_id, v_amount,
    (SELECT created_at FROM customer_payments WHERE id = v_cp_id)
  );

  -- Do NOT increase amount_used (carryover already at 135000/135000)
  -- Do NOT increase theoretical_amount (already includes the 70k from prior repair)

  -- Decrease customer balance 540000 → 470000
  UPDATE customers SET balance = balance - v_amount
  WHERE id = v_customer_id AND tenant_id = v_tenant_id
    AND balance = 540000;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADAMA repair: balance update guard failed';
  END IF;

  -- Prove theoretical_amount unchanged
  PERFORM 1 FROM cash_sessions
  WHERE id = v_session_id AND tenant_id = v_tenant_id
    AND theoretical_amount = v_cur_theo;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADAMA repair: theoretical_amount a changé!';
  END IF;

  RAISE NOTICE 'ADAMA repair complete: balance 540000→470000, cm=%, alloc created', v_cm_id;
END;
$repair$;