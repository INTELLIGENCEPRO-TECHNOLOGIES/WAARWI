/*
# Fix get_customer_statement: replace non-existent s.doc_type with s.source

The rs1_v3 migration rewrote `get_customer_statement` referencing `s.doc_type`
on the `sales` table, but that column does not exist. The actual column is
`source` with values 'pos', 'billing', 'quote'.

This caused a 42703 error ("column s.doc_type does not exist") making the
customer ledger ("grand livre") unavailable for every customer.

## Changes
- Replace `CASE s.doc_type WHEN 'invoice' THEN ... WHEN 'cash' THEN ...`
  with `CASE s.source WHEN 'billing' THEN 'Facture' WHEN 'pos' THEN 'Ticket' ELSE 'Vente' END`
  in both the Sales and Deleted-sale-reversals UNION branches.
*/

CREATE OR REPLACE FUNCTION get_customer_statement(
  p_customer_id uuid,
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
AS $$
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
  CASE s.source WHEN 'billing' THEN 'Facture' WHEN 'pos' THEN 'Ticket' ELSE 'Vente' END ||
  CASE WHEN s.status = 'deleted' THEN ' (supprimée)' ELSE '' END,
  s.total::numeric, 0::numeric, (s.status <> 'deleted'), 'sale'::text, false
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id
  AND s.status NOT IN ('cancelled','draft')
  AND s.deleted_at IS NULL

UNION ALL
-- Deleted sale reversals
SELECT s.deleted_at, 2, s.id || '-del', s.sale_number,
  'Annulation ' || CASE s.source WHEN 'billing' THEN 'Facture' WHEN 'pos' THEN 'Ticket' ELSE 'Vente' END,
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
$$;