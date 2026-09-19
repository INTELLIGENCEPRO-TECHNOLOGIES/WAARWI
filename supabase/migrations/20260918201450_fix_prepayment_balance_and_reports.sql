/*
# Fix prepayment balance, customer statement, customers report, and tiers balance

## Summary
This migration fixes the core prepayment bug and aligns all related reports.

## 1. record_cash_movement — Fix balance updates
The `customer_prepayment` branch was missing `UPDATE customers SET balance = balance - amount`.
This line existed in migration 20260820074129 but was lost when the function was redefined
in 20260817203255 (phase2 refund). The `customer_withdrawal` branch was also missing the
mirror operation (`balance + amount`).

### Changes
- `customer_prepayment`: after inserting into customer_prepayments and calling
  apply_customer_prepayments, decrease customers.balance by p_amount.
- `customer_withdrawal`: after consuming prepayment credit FIFO, increase
  customers.balance by p_amount (reverse of prepayment).
- All other branches (income, expense, customer_loan, refund) remain unchanged.
- Function signature unchanged (11 params + p_expense_category_id).

## 2. get_customer_statement — Tag prepayments distinctly
- Prepayment rows now emitted with kind = 'prepayment' instead of 'payment'.
- Ordering stabilized by (ts, ord, id) instead of (ts, ord).

## 3. get_customers_report — Include prepayments in encaissements
- The `ep` CTE now includes customer_prepayment movements alongside income.
- The `real_rows` filter includes customers with only an encaissement (no sale).
- The `ev` CTE for balance computation includes prepayments and withdrawals.
- Imputations (affects_balance=false) excluded from encaissements.

## 4. get_tiers_balance — Add missing event types
- Customer events now include prepayments (credit) and withdrawals/loans (debit).
- sale_payments filtered to affects_balance=true only.

## Security
No RLS changes. All functions keep their existing security mode.
*/

-- ============================================================
-- 1. Fix record_cash_movement
-- ============================================================
CREATE OR REPLACE FUNCTION record_cash_movement(
  p_cash_session_id uuid,
  p_site_id uuid,
  p_kind text,
  p_amount numeric,
  p_reason text DEFAULT '',
  p_note text DEFAULT '',
  p_reference text DEFAULT '',
  p_customer_id uuid DEFAULT NULL,
  p_payment_method_id uuid DEFAULT NULL,
  p_method_name text DEFAULT '',
  p_expense_category_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = 'public'
AS $$
DECLARE
v_tenant_id uuid;
v_movement_id uuid;
v_prepay_id uuid;
v_applied jsonb;
v_pm_type text;
v_available numeric;
v_balance numeric;
v_net numeric;
v_remaining numeric;
v_prepay record;
v_take numeric;
v_credit_limit numeric;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
IF p_kind NOT IN ('expense','income','customer_prepayment','customer_withdrawal','customer_loan','refund') THEN
RAISE EXCEPTION 'Type de mouvement invalide';
END IF;
IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

IF p_kind IN ('customer_prepayment','customer_withdrawal','customer_loan') THEN
IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
IF p_payment_method_id IS NOT NULL THEN
SELECT payment_type INTO v_pm_type FROM payment_methods
WHERE id = p_payment_method_id AND tenant_id = v_tenant_id;
IF COALESCE(v_pm_type,'') = 'credit' THEN
RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
END IF;
END IF;
END IF;

IF p_kind = 'customer_withdrawal' THEN
SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_available
FROM customer_prepayments
WHERE tenant_id = v_tenant_id
AND customer_id = p_customer_id
AND amount_used < amount;

SELECT COALESCE(balance, 0) INTO v_balance
FROM customers
WHERE id = p_customer_id AND tenant_id = v_tenant_id;

v_net := COALESCE(v_available, 0) - COALESCE(v_balance, 0);

IF v_available IS NULL OR v_available <= 0 THEN
RAISE EXCEPTION 'Le client n''a aucun acompte disponible';
END IF;
IF v_net <= 0 THEN
RAISE EXCEPTION 'Le client a une dette de % qui couvre son acompte de %. Retrait impossible.', v_balance, v_available;
END IF;
IF p_amount > v_net THEN
RAISE EXCEPTION 'Montant supérieur au retrait maximum (%). Le client a un acompte de % et une dette de % à déduire.', v_net, v_available, v_balance;
END IF;
END IF;

IF p_kind = 'customer_loan' THEN
SELECT COALESCE(balance, 0), COALESCE(credit_limit, 0)
INTO v_balance, v_credit_limit
FROM customers
WHERE id = p_customer_id AND tenant_id = v_tenant_id;

IF v_credit_limit > 0 AND (v_balance + p_amount) > v_credit_limit THEN
RAISE EXCEPTION 'Plafond crédit dépassé (%). Solde actuel : %. Maximum prêt possible : %.',
v_credit_limit, v_balance, GREATEST(0, v_credit_limit - v_balance);
END IF;
END IF;

INSERT INTO cash_movements (
tenant_id, cash_session_id, site_id, user_id, kind, amount,
reason, note, reference, customer_id, payment_method_id, method_name,
expense_category_id
) VALUES (
v_tenant_id, p_cash_session_id, p_site_id, auth.uid(), p_kind, p_amount,
COALESCE(p_reason,''), COALESCE(p_note,''), COALESCE(p_reference,''),
p_customer_id, p_payment_method_id, COALESCE(p_method_name,''),
CASE WHEN p_kind = 'expense' THEN p_expense_category_id ELSE NULL END
) RETURNING id INTO v_movement_id;

IF p_cash_session_id IS NOT NULL THEN
IF p_kind IN ('expense','customer_withdrawal','customer_loan','refund') THEN
UPDATE cash_sessions
SET theoretical_amount = COALESCE(theoretical_amount, 0) - p_amount
WHERE id = p_cash_session_id;
ELSE
UPDATE cash_sessions
SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
WHERE id = p_cash_session_id;
END IF;
END IF;

-- Prepayment: create row, decrease balance, then auto-apply to invoices
IF p_kind = 'customer_prepayment' THEN
INSERT INTO customer_prepayments (
tenant_id, customer_id, cash_movement_id, cash_session_id,
amount, payment_method_id, method_name, reference
) VALUES (
v_tenant_id, p_customer_id, v_movement_id, p_cash_session_id,
p_amount, p_payment_method_id, COALESCE(p_method_name,''), COALESCE(p_reference,'')
) RETURNING id INTO v_prepay_id;

-- KEY FIX: decrease customer balance (prepayment = credit for the customer)
UPDATE customers
SET balance = COALESCE(balance, 0) - p_amount
WHERE id = p_customer_id AND tenant_id = v_tenant_id;

v_applied := apply_customer_prepayments(p_customer_id);

RETURN jsonb_build_object(
'movement_id', v_movement_id,
'prepayment_id', v_prepay_id,
'auto_applied', COALESCE((v_applied->>'applied')::numeric, 0)
);
END IF;

-- Withdrawal: consume prepayment credit FIFO then increase balance
IF p_kind = 'customer_withdrawal' THEN
v_remaining := p_amount;
FOR v_prepay IN
SELECT * FROM customer_prepayments
WHERE tenant_id = v_tenant_id
AND customer_id = p_customer_id
AND amount_used < amount
ORDER BY created_at ASC
FOR UPDATE
LOOP
EXIT WHEN v_remaining <= 0;
v_take := LEAST(v_remaining, v_prepay.amount - v_prepay.amount_used);
IF v_take <= 0 THEN CONTINUE; END IF;

UPDATE customer_prepayments
SET amount_used = amount_used + v_take
WHERE id = v_prepay.id;

v_remaining := v_remaining - v_take;
END LOOP;

-- KEY FIX: increase customer balance (withdrawal reverses prepayment credit)
UPDATE customers
SET balance = COALESCE(balance, 0) + p_amount
WHERE id = p_customer_id AND tenant_id = v_tenant_id;

RETURN jsonb_build_object(
'movement_id', v_movement_id,
'withdrawn', p_amount - v_remaining
);
END IF;

-- Loan: increase customer debt
IF p_kind = 'customer_loan' THEN
UPDATE customers
SET balance = COALESCE(balance, 0) + p_amount
WHERE id = p_customer_id AND tenant_id = v_tenant_id;

RETURN jsonb_build_object(
'movement_id', v_movement_id,
'loan_amount', p_amount
);
END IF;

RETURN jsonb_build_object('movement_id', v_movement_id);
END;
$$;

-- ============================================================
-- 2. Fix get_customer_statement — tag prepayments as 'prepayment'
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_customer_statement(
  p_customer_id uuid,
  p_from date DEFAULT NULL,
  p_to date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id   uuid;
  v_tz          text;
  v_from_ts     timestamptz;
  v_to_excl     timestamptz;
  v_balance     numeric := 0;
  v_total_delta numeric := 0;
  v_base        numeric := 0;
  v_result      jsonb;
BEGIN
  v_tenant_id := current_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Contexte tenant introuvable';
  END IF;

  SELECT COALESCE(balance, 0) INTO v_balance
  FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client introuvable';
  END IF;

  SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
  v_tz := COALESCE(v_tz, 'Africa/Dakar');

  v_from_ts := CASE WHEN p_from IS NOT NULL THEN (p_from::timestamp AT TIME ZONE v_tz) ELSE NULL END;
  v_to_excl := CASE WHEN p_to IS NOT NULL THEN ((p_to + 1)::timestamp AT TIME ZONE v_tz) ELSE NULL END;

  WITH movements AS (
    -- Balance adjustments (exclude reconciliation markers)
    SELECT ba.id, ba.created_at AS ts, 1 AS ord, ''::text AS piece,
           CASE
             WHEN ba.kind = 'cancel_reversal' THEN COALESCE(NULLIF(ba.note, ''), 'Contre-passation annulation')
             WHEN ba.amount > 0 THEN COALESCE(NULLIF(ba.note, ''), 'Report de solde')
             ELSE COALESCE(NULLIF(ba.note, ''), 'Règlement solde')
           END AS label,
           CASE WHEN ba.kind = 'cancel_reversal' THEN GREATEST(ba.amount, 0)
                WHEN ba.amount > 0 THEN ba.amount ELSE 0 END AS debit,
           CASE WHEN ba.kind = 'cancel_reversal' THEN GREATEST(-ba.amount, 0)
                WHEN ba.amount < 0 THEN -ba.amount ELSE 0 END AS credit,
           (ba.kind <> 'cancel_reversal') AS affects,
           CASE WHEN ba.kind = 'cancel_reversal' THEN 'cancel'
                WHEN ba.amount > 0 THEN 'adjustment' ELSE 'payment' END AS kind
    FROM balance_adjustments ba
    WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
      AND ba.entity_id = p_customer_id
      AND ba.kind IS DISTINCT FROM 'reconciliation' AND ba.amount <> 0

    UNION ALL
    -- Sales
    SELECT s.id, s.created_at, 2, s.sale_number,
           CASE WHEN s.status = 'cancelled' THEN 'Facture annulée'
                WHEN s.status = 'deleted' THEN 'Facture'
                ELSE 'Vente' END,
           s.total::numeric, 0::numeric,
           (s.status NOT IN ('cancelled', 'deleted')),
           CASE WHEN s.status IN ('cancelled', 'deleted') THEN 'cancel' ELSE 'sale' END
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id

    UNION ALL
    -- Deleted sale reversals
    SELECT s.id, COALESCE(s.deleted_at, s.created_at), 3, s.sale_number,
           'Suppression facture ' || s.sale_number, 0::numeric, s.total::numeric, false, 'cancel'
    FROM sales s
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id AND s.status = 'deleted'

    UNION ALL
    -- Sale payments (regular + allocations)
    SELECT sp.id, sp.created_at, 4, COALESCE(s.sale_number, ''),
           CASE WHEN sp.affects_balance = false THEN COALESCE(sp.method_name, 'Règlement par crédit')
                ELSE 'Règlement' || CASE WHEN sp.method_name IS NOT NULL THEN ' · ' || sp.method_name ELSE '' END END,
           0::numeric, sp.amount::numeric, COALESCE(sp.affects_balance, true),
           CASE WHEN sp.affects_balance = false THEN 'allocation' ELSE 'payment' END
    FROM sale_payments sp
    JOIN sales s ON s.id = sp.sale_id
    LEFT JOIN payment_methods pm ON pm.id = sp.payment_method_id
    WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id
      AND COALESCE(pm.payment_type, '') <> 'credit'
      AND NOT (COALESCE(sp.affects_balance, true) = true
               AND (sp.method_name LIKE 'Acompte ·%' OR sp.method_name LIKE 'Avoir %'))

    UNION ALL
    -- Prepayments (tagged as 'prepayment' not 'payment')
    SELECT pp.id, pp.created_at, 5, COALESCE(pp.reference, ''),
           'Acompte' || CASE WHEN pp.method_name IS NOT NULL THEN ' · ' || pp.method_name ELSE '' END,
           0::numeric, pp.amount::numeric, true, 'prepayment'
    FROM customer_prepayments pp
    WHERE pp.tenant_id = v_tenant_id AND pp.customer_id = p_customer_id AND pp.amount > 0

    UNION ALL
    -- Avoirs
    SELECT sr.id, COALESCE(sr.refunded_at, sr.created_at), 6, sr.return_number, 'Avoir',
           0::numeric, sr.total::numeric, true, 'avoir'
    FROM sale_returns sr
    WHERE sr.tenant_id = v_tenant_id AND sr.customer_id = p_customer_id
      AND sr.status = 'approved' AND sr.refund_method = 'avoir'

    UNION ALL
    -- Withdrawals
    SELECT cm.id, cm.created_at, 7, COALESCE(cm.reference, ''),
           'Retrait caisse' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
           cm.amount::numeric, 0::numeric, true, 'withdrawal'
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
      AND cm.kind = 'customer_withdrawal'

    UNION ALL
    -- Loans
    SELECT cm.id, cm.created_at, 8, COALESCE(cm.reference, ''),
           'Prêt client' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
           cm.amount::numeric, 0::numeric, true, 'loan'
    FROM cash_movements cm
    WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
      AND cm.kind = 'customer_loan'
  ),
  ordered AS (
    SELECT m.*,
           SUM(CASE WHEN m.affects THEN m.debit - m.credit ELSE 0 END)
             OVER (ORDER BY m.ts, m.ord, m.id ROWS UNBOUNDED PRECEDING) AS cum
    FROM movements m
  )
  SELECT
    COALESCE((SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END) FROM movements), 0),
    jsonb_build_object(
      'balance', v_balance,
      'opening_delta', COALESCE((
          SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END)
          FROM movements WHERE v_from_ts IS NOT NULL AND ts < v_from_ts), 0),
      'closing_delta', COALESCE((
          SELECT SUM(CASE WHEN affects THEN debit - credit ELSE 0 END)
          FROM movements WHERE v_to_excl IS NULL OR ts < v_to_excl), 0),
      'total_debit', COALESCE((SELECT SUM(debit) FROM ordered o
          WHERE (v_from_ts IS NULL OR o.ts >= v_from_ts) AND (v_to_excl IS NULL OR o.ts < v_to_excl)), 0),
      'total_credit', COALESCE((SELECT SUM(credit) FROM ordered o
          WHERE (v_from_ts IS NULL OR o.ts >= v_from_ts) AND (v_to_excl IS NULL OR o.ts < v_to_excl)), 0),
      'movements', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'ts', to_char(o.ts AT TIME ZONE v_tz, 'YYYY-MM-DD"T"HH24:MI:SS'),
          'piece', o.piece, 'label', o.label,
          'debit', o.debit, 'credit', o.credit,
          'affects', o.affects, 'kind', o.kind, 'cum', o.cum
        ) ORDER BY o.ts, o.ord, o.id)
        FROM ordered o
        WHERE (v_from_ts IS NULL OR o.ts >= v_from_ts) AND (v_to_excl IS NULL OR o.ts < v_to_excl)
      ), '[]'::jsonb)
    )
  INTO v_total_delta, v_result;

  v_base := v_balance - v_total_delta;

  RETURN jsonb_build_object(
    'customer_id', p_customer_id,
    'balance', v_balance,
    'opening_balance', v_base + COALESCE((v_result->>'opening_delta')::numeric, 0),
    'closing_balance', v_base + COALESCE((v_result->>'closing_delta')::numeric, 0),
    'total_debit', COALESCE((v_result->>'total_debit')::numeric, 0),
    'total_credit', COALESCE((v_result->>'total_credit')::numeric, 0),
    'movements', COALESCE(v_result->'movements', '[]'::jsonb)
  );
END;
$function$;

-- ============================================================
-- 3. Fix get_customers_report — include prepayments in encaissements
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_customers_report(p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
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
-- FIX: include both income and customer_prepayment movements as encaissements
SELECT cm.customer_id AS cid, SUM(cm.amount) AS enc
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.kind IN ('income', 'customer_prepayment')
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id)
AND cm.customer_id IS NOT NULL
GROUP BY cm.customer_id
),
act AS (
SELECT DISTINCT s.customer_id AS cid
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL
AND s.customer_id IS NOT NULL
AND (
CASE
WHEN (s.doc_header ->> 'doc_date') ~ '^\d{4}-\d{2}-\d{2}'
THEN ((s.doc_header ->> 'doc_date')::date)::timestamp AT TIME ZONE v_tz
ELSE s.created_at
END
) >= v_ts_from
AND (
CASE
WHEN (s.doc_header ->> 'doc_date') ~ '^\d{4}-\d{2}-\d{2}'
THEN ((s.doc_header ->> 'doc_date')::date)::timestamp AT TIME ZONE v_tz
ELSE s.created_at
END
) < v_ts_to
UNION
SELECT DISTINCT s.customer_id
FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
WHERE sp2.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
AND sp2.created_at >= v_ts_from AND sp2.created_at < v_ts_to
UNION
SELECT DISTINCT sr.customer_id
FROM sale_returns sr
WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
AND sr.created_at >= v_ts_from AND sr.created_at < v_ts_to
UNION
SELECT DISTINCT cm.customer_id
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL
AND cm.kind IN ('income','customer_prepayment','customer_loan','customer_withdrawal','refund')
AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
UNION
SELECT DISTINCT ba.entity_id
FROM balance_adjustments ba
WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
AND ba.kind NOT IN ('reconciliation','cancel_reversal')
AND ba.created_at >= v_ts_from AND ba.created_at < v_ts_to
),
ev AS (
-- Balance events: sales add debt
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
UNION ALL
-- Payments reduce debt (only affects_balance=true)
SELECT s.customer_id, sp2.created_at, -sp2.amount
FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
WHERE sp2.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
AND COALESCE(sp2.affects_balance, true) = true
UNION ALL
-- Avoirs reduce debt
SELECT sr.customer_id, sr.created_at, -sr.total
FROM sale_returns sr WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
UNION ALL
-- Prepayments reduce debt (credit)
SELECT pp.customer_id, pp.created_at, -pp.amount
FROM customer_prepayments pp WHERE pp.tenant_id = v_tenant_id AND pp.customer_id IS NOT NULL
UNION ALL
-- Withdrawals increase debt (reverse of prepayment)
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_withdrawal'
UNION ALL
-- Loans increase debt
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_loan'
UNION ALL
-- Adjustments (exclude technical)
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
AND ba.kind NOT IN ('reconciliation','cancel_reversal')
),
dc AS (
SELECT cid,
COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_from), 0) AS delta_from,
COALESCE(SUM(amt) FILTER (WHERE ts >= v_ts_to), 0)   AS delta_after
FROM ev GROUP BY cid
),
real_rows AS (
SELECT
c.id AS customer_id,
COALESCE(c.name, 'Client supprimé') AS name,
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
-- FIX: include customers with encaissements (prepayments/payments) even without sales
sp.cid IS NOT NULL OR rp.cid IS NOT NULL OR ep.cid IS NOT NULL
OR (COALESCE(c.balance, 0) <> 0 AND (p_site_id IS NULL OR c.site_id = p_site_id OR c.site_id IS NULL))
)
),
comptoir AS (
SELECT
NULL::uuid AS customer_id,
'Comptoir'::text AS name,
false AS is_shared,
true AS has_activity,
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
CASE WHEN NOT has_activity AND ABS(solde_anterieur) > 0.5
THEN 'prior_only' ELSE 'active' END AS status
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
$function$;

-- ============================================================
-- 4. Fix get_tiers_balance — add prepayment/withdrawal/loan events
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_tiers_balance(
  p_site_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
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

SELECT COALESCE(NULLIF(settings->>'timezone', ''), 'Africa/Dakar') INTO v_tz FROM tenants WHERE id = v_tenant_id;
v_tz := COALESCE(v_tz, 'Africa/Dakar');
v_ts_asof := ((p_as_of + 1)::timestamp AT TIME ZONE v_tz);

-- Clients: all balance events
WITH ev AS (
-- Sales add debt
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
UNION ALL
-- Payments reduce debt (only real payments, not allocations)
SELECT s.customer_id, sp.created_at, -sp.amount
FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
WHERE sp.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
AND COALESCE(sp.affects_balance, true) = true
UNION ALL
-- Avoirs reduce debt
SELECT sr.customer_id, sr.created_at, -sr.total
FROM sale_returns sr WHERE sr.tenant_id = v_tenant_id AND sr.status = 'approved' AND sr.customer_id IS NOT NULL
UNION ALL
-- Prepayments reduce debt
SELECT pp.customer_id, pp.created_at, -pp.amount
FROM customer_prepayments pp WHERE pp.tenant_id = v_tenant_id AND pp.customer_id IS NOT NULL
UNION ALL
-- Withdrawals increase debt
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_withdrawal'
UNION ALL
-- Loans increase debt
SELECT cm.customer_id, cm.created_at, cm.amount
FROM cash_movements cm WHERE cm.tenant_id = v_tenant_id AND cm.customer_id IS NOT NULL AND cm.kind = 'customer_loan'
UNION ALL
-- Balance adjustments (exclude technical)
SELECT ba.entity_id, ba.created_at, ba.amount
FROM balance_adjustments ba WHERE ba.tenant_id = v_tenant_id AND ba.entity_type = 'customer'
AND ba.kind NOT IN ('reconciliation','cancel_reversal')
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
'due', COALESCE(SUM(GREATEST(net, 0)), 0),
'credit', COALESCE(SUM(GREATEST(-net, 0)), 0)
)
INTO v_customers, v_cust_tot
FROM cust;

-- Fournisseurs (unchanged)
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
'due', COALESCE(SUM(GREATEST(net, 0)), 0),
'advance', COALESCE(SUM(GREATEST(-net, 0)), 0)
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
$function$;

REVOKE ALL ON FUNCTION public.get_tiers_balance(uuid, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_tiers_balance(uuid, date) TO authenticated;
