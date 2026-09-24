/*
# Restore get_customer_statement from rs1_v2 with piece_number adaptation

## Problem
The previous fix (fix_customer_statement_doc_type_column) rewrote the function
but introduced two regressions:
1. Lost STABLE volatility — deployed as VOLATILE instead of STABLE
2. Lost SET search_path = public
3. Mixed uuid and text in row_id column (s.id || '-del' returns text, all
   other branches return uuid) causing UNION ALL type mismatch errors

## Error before fix
`column s.doc_type does not exist` (42703) — then after the doc_type fix,
the function still had wrong volatility and missing search_path.

## Solution
Restore the exact last working version from migration
20260924004218_rs1_v2_canonical_balance_payment_and_adama_repair.sql.

Single authorized adaptation: customer_payments piece column uses
`COALESCE(cp.piece_number, '')` instead of `''::text` to surface the
REG-xxxxx piece number in the ledger.

Preserves: same signature, RETURNS jsonb, LANGUAGE plpgsql STABLE
SECURITY INVOKER, SET search_path = public, existing privileges.
*/

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
    -- Customer balance payments (confirmed) — piece_number adaptation
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
$fn_stmt$;