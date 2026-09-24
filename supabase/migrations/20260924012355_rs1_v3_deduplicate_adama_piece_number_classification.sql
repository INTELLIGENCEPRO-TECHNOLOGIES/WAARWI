/*
# RS1-v3: Deduplicate ADAMA 70k, piece_number for customer_payments, method_name on canonical movement

## Summary
Fixes the double-counted 70 000 FCFA in ADAMA CISSÉ's ledger by removing the phantom
sale_payment on V-00060 and its associated cash_movement. Adds a `piece_number` column
to `customer_payments` for traceability. Updates `register_customer_balance_payment` to
generate a REG-xxxxx piece number transactionally and populate `method_name` on the
cash_movement. Updates `get_customer_statement` to use the real piece_number.

## Changes

### 1. Schema: `customer_payments.piece_number`
- Adds nullable `piece_number text` column with partial unique index per tenant.

### 2. ADAMA repair (forward-only)
- Deletes phantom sale_payment f625e6be on V-00060 (reference "Règlement solde · ADAMA CISSE").
- Deletes phantom cash_movement 89903f35 ("Règlement V-00060").
- Sets V-00060 paid = recalculated from remaining sale_payments (expected 0), status = 'validated'.
- Sets method_name on canonical cash_movement e091f4e8.
- Assigns piece_number REG-00001 to existing customer_payment 0eff5450.
- Calls recalculate_customer_balance — expects exactly 540 000.
- Verifies session theoretical_amount unchanged.
- Seeds the tenant_doc_counters row for 'reglement_client' doc_kind.

### 3. `register_customer_balance_payment` rewrite
- Generates piece_number via `next_doc_number(v_tenant_id, 'reglement_client', 'REG')`.
- Stores piece_number in customer_payment row.
- Populates method_name on cash_movement from the payment method.
- Returns piece_number in the JSON result.

### 4. `get_customer_statement` update
- Customer payments UNION ALL now uses `COALESCE(cp.piece_number, '')` instead of `''::text`.

### 5. Security
- No new tables exposed. piece_number column inherits existing RLS.
- register_customer_balance_payment remains SECURITY DEFINER, granted to authenticated only.
*/

-- ============================================================
-- 1. Add piece_number to customer_payments
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_payments' AND column_name = 'piece_number'
  ) THEN
    ALTER TABLE customer_payments ADD COLUMN piece_number text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customer_payments_piece_number_tenant
ON customer_payments (tenant_id, piece_number) WHERE piece_number IS NOT NULL;

-- ============================================================
-- 2. ADAMA CISSÉ repair: remove phantom, fix V-00060, assign piece
-- ============================================================
DO $$
DECLARE
  v_tenant  uuid := '31f9910a-5e94-4dc1-8ab5-c204bbcdb7db';
  v_cust    uuid := 'e1e9fadc-3b3b-4542-bd83-3cb81ce711ef';
  v_sp_id   uuid := 'f625e6be-957b-4804-b1f6-8a64eaefe584';
  v_cm_phantom uuid := '89903f35-b1f6-4096-b21f-4f7e89b80e44';
  v_cm_canon   uuid := 'e091f4e8-afe5-4ad5-926f-4bfee257d79b';
  v_cp_id   uuid := '0eff5450-0edb-48a7-a7a2-b8efe952b1b9';
  v_sale_id uuid := '09a88664-3f8d-42d6-b3ee-d68e20572522';
  v_session uuid := 'de5213f4-b07f-46ba-a350-a21cb0635e3c';

  v_theo_before  numeric;
  v_theo_after   numeric;
  v_new_paid     numeric;
  v_balance      numeric;
  v_check_sp     int;
  v_check_cm     int;
BEGIN
  -- Capture session theoretical before
  SELECT theoretical_amount INTO STRICT v_theo_before FROM cash_sessions WHERE id = v_session;

  -- Verify preconditions
  SELECT COUNT(*) INTO v_check_sp FROM sale_payments WHERE id = v_sp_id AND amount = 70000;
  IF v_check_sp <> 1 THEN RAISE EXCEPTION 'Precondition failed: phantom sale_payment not found'; END IF;

  SELECT COUNT(*) INTO v_check_cm FROM cash_movements WHERE id = v_cm_phantom AND amount = 70000;
  IF v_check_cm <> 1 THEN RAISE EXCEPTION 'Precondition failed: phantom cash_movement not found'; END IF;

  -- Delete phantom sale_payment
  DELETE FROM sale_payments WHERE id = v_sp_id;

  -- Delete phantom cash_movement
  DELETE FROM cash_movements WHERE id = v_cm_phantom;

  -- Recalculate V-00060 paid from remaining sale_payments
  SELECT COALESCE(SUM(sp.amount), 0) INTO v_new_paid
  FROM sale_payments sp
  WHERE sp.sale_id = v_sale_id AND COALESCE(sp.affects_balance, true) = true;

  UPDATE sales SET
    paid = v_new_paid,
    status = CASE WHEN v_new_paid >= total THEN 'paid' WHEN v_new_paid > 0 THEN 'partial' ELSE 'validated' END
  WHERE id = v_sale_id;

  -- Set method_name on canonical cash_movement
  UPDATE cash_movements SET method_name = 'Espèces' WHERE id = v_cm_canon;

  -- Assign piece_number to existing customer_payment
  UPDATE customer_payments SET piece_number = 'REG-00001' WHERE id = v_cp_id;

  -- Ensure tenant_doc_counters has row for reglement_client starting at 1
  INSERT INTO tenant_doc_counters (tenant_id, doc_kind, last_number)
  VALUES (v_tenant, 'reglement_client', 1)
  ON CONFLICT (tenant_id, doc_kind) DO UPDATE SET last_number = GREATEST(tenant_doc_counters.last_number, 1);

  -- Recalculate customer balance using the existing function
  PERFORM recalculate_customer_balance(v_cust);

  -- Verify balance = 540000
  SELECT balance INTO v_balance FROM customers WHERE id = v_cust;
  IF v_balance <> 540000 THEN
    RAISE EXCEPTION 'Balance mismatch after recalculation: expected 540000, got %', v_balance;
  END IF;

  -- Verify session theoretical unchanged
  SELECT theoretical_amount INTO STRICT v_theo_after FROM cash_sessions WHERE id = v_session;
  IF v_theo_before IS DISTINCT FROM v_theo_after THEN
    RAISE EXCEPTION 'Session theoretical_amount changed: before=%, after=%', v_theo_before, v_theo_after;
  END IF;

  RAISE NOTICE 'ADAMA repair complete: phantom removed, V-00060 paid=%, balance=%, theo unchanged=%',
    v_new_paid, v_balance, v_theo_after;
END $$;


-- ============================================================
-- 3. Rewrite register_customer_balance_payment with piece_number + method_name
-- ============================================================
CREATE OR REPLACE FUNCTION register_customer_balance_payment(
  p_customer_id      uuid,
  p_payment_method_id uuid,
  p_method_name      text,
  p_amount           numeric,
  p_reference        text DEFAULT '',
  p_cash_session_id  uuid DEFAULT NULL,
  p_idempotency_key  text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
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
v_piece_number  text;
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

-- Generate piece_number transactionally
SELECT next_doc_number(v_tenant_id, 'reglement_client', 'REG') INTO v_piece_number;

-- Create customer_payment
INSERT INTO customer_payments (
  tenant_id, customer_id, amount, method, method_name,
  payment_method_id, reference, cash_session_id, site_id, user_id,
  idempotency_key, status, piece_number
) VALUES (
  v_tenant_id, p_customer_id, p_amount,
  v_pm.payment_type, COALESCE(p_method_name, v_pm.name),
  p_payment_method_id, COALESCE(p_reference, ''),
  p_cash_session_id, v_site_id, v_uid,
  p_idempotency_key, 'confirmed', v_piece_number
) RETURNING id INTO v_cp_id;

-- Create cash_movement with method_name
INSERT INTO cash_movements (
  tenant_id, kind, amount, reason, reference, customer_id,
  cash_session_id, site_id, user_id, payment_method_id, method_name
) VALUES (
  v_tenant_id, 'income', p_amount,
  'Règlement report de solde',
  COALESCE(p_reference, 'Règlement solde'),
  p_customer_id,
  p_cash_session_id, v_site_id, v_uid, p_payment_method_id,
  COALESCE(p_method_name, v_pm.name)
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
  'piece_number', v_piece_number,
  'amount', p_amount,
  'allocations', v_alloc_count
);
END;
$$;

REVOKE ALL ON FUNCTION register_customer_balance_payment FROM PUBLIC;
REVOKE ALL ON FUNCTION register_customer_balance_payment FROM anon;
GRANT EXECUTE ON FUNCTION register_customer_balance_payment TO authenticated;


-- ============================================================
-- 4. Update get_customer_statement to use piece_number
-- ============================================================
CREATE OR REPLACE FUNCTION get_customer_statement(
  p_customer_id uuid,
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public
AS $fn$
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
CASE WHEN ba.kind = 'carryover' THEN 'carryover' ELSE 'adjustment' END::text AS kind,
(ba.kind = 'carryover') AS is_carryover
FROM balance_adjustments ba
WHERE ba.tenant_id = v_tenant_id AND ba.entity_id = p_customer_id AND ba.entity_type = 'customer'
  AND ba.kind NOT IN ('reconciliation')

UNION ALL
-- Sales (invoices)
SELECT s.created_at, 2, s.id, s.sale_number,
  CASE s.doc_type WHEN 'invoice' THEN 'Facture' WHEN 'cash' THEN 'Ticket' ELSE 'Vente' END ||
  CASE WHEN s.status = 'deleted' THEN ' (supprimée)' ELSE '' END,
  s.total::numeric, 0::numeric, (s.status <> 'deleted'), 'sale'::text, false
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id
  AND s.status NOT IN ('cancelled','draft')
  AND s.deleted_at IS NULL

UNION ALL
-- Deleted sale reversals
SELECT s.deleted_at, 2, s.id || '-del', s.sale_number,
  'Annulation ' || CASE s.doc_type WHEN 'invoice' THEN 'Facture' WHEN 'cash' THEN 'Ticket' ELSE 'Vente' END,
  0::numeric, s.total::numeric, true, 'sale_delete'::text, false
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id
  AND s.deleted_at IS NOT NULL AND s.status <> 'cancelled'

UNION ALL
-- Sale payments
SELECT sp.created_at, 4, sp.id, s.sale_number,
  'Règlement' || CASE WHEN COALESCE(sp.method_name, '') <> '' THEN ' · ' || sp.method_name ELSE '' END,
  0::numeric, sp.amount::numeric, COALESCE(sp.affects_balance, true), 'sale_payment'::text, false
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id
WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id
  AND s.status NOT IN ('cancelled')
  AND s.deleted_at IS NULL

UNION ALL
-- Prepayments
SELECT cp.created_at, 5, cp.id, '',
  'Acompte' || CASE WHEN COALESCE(cp.method_name, '') <> '' THEN ' · ' || cp.method_name ELSE '' END,
  0::numeric, cp.amount::numeric, true, 'prepayment'::text, false
FROM customer_prepayments cp
WHERE cp.tenant_id = v_tenant_id AND cp.customer_id = p_customer_id

UNION ALL
-- Avoirs (credits from returns)
SELECT sr.created_at, 6, sr.id, sr.return_number,
  'Avoir' || CASE WHEN COALESCE(sr.return_number, '') <> '' THEN ' ' || sr.return_number ELSE '' END,
  0::numeric, sr.total::numeric, true, 'avoir'::text, false
FROM sale_returns sr
WHERE sr.tenant_id = v_tenant_id AND sr.customer_id = p_customer_id
  AND sr.status = 'approved' AND sr.refund_method = 'avoir'

UNION ALL
-- Customer withdrawals
SELECT cm.created_at, 7, cm.id, '',
  'Retrait' || CASE WHEN COALESCE(cm.method_name, '') <> '' THEN ' · ' || cm.method_name ELSE '' END,
  cm.amount::numeric, 0::numeric, true, 'withdrawal'::text, false
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
  AND cm.kind = 'customer_withdrawal'

UNION ALL
-- Customer loans
SELECT cm.created_at, 8, cm.id, '',
  'Prêt' || CASE WHEN COALESCE(cm.method_name, '') <> '' THEN ' · ' || cm.method_name ELSE '' END,
  cm.amount::numeric, 0::numeric, true, 'loan'::text, false
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
  AND cm.kind = 'customer_loan'

UNION ALL
-- Customer balance payments (confirmed)
SELECT cp.created_at, 9, cp.id, COALESCE(cp.piece_number, ''),
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
$fn$;
