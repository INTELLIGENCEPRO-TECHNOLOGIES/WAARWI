/*
# Align customer reports: encaissements, statement ordering, tiers_balance activity filter

1. **get_customers_report**:
   - `ep` CTE now also includes sale_payments (affects_balance=true) for named customers,
     deduplicating against cash_movements by not double-counting income movements
     that already correspond to sale_payments via register_sale_payment.
   - `act` CTE includes customers with encaissements-only activity (balanced today but had
     payments in the period).
   - Filters: include customers who are unbalanced at the requested date even if balanced now.

2. **get_customer_statement**:
   - Deterministic ORDER BY: ts, ord, piece (avoids random row order for same-timestamp entries).
   - Cash refund from process_return_as_cash shown as informational (affects=false) to avoid
     double-reducing debt (the sale cancellation already handled the balance).

3. **get_tiers_balance(uuid, date)**:
   - Include customers with net <> 0 at the requested date even if balanced today.
*/

-- get_customers_report: fix encaissements to include sale_payments
CREATE OR REPLACE FUNCTION public.get_customers_report(p_site_id uuid DEFAULT NULL::uuid, p_from date DEFAULT CURRENT_DATE, p_to date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
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
-- Encaissements: cash_movements (income + prepayments) + sale_payments for credit invoices
SELECT cid, SUM(enc) AS enc FROM (
  -- Cash movements with customer (income from POS/register + prepayments)
  SELECT cm.customer_id AS cid, SUM(cm.amount) AS enc
  FROM cash_movements cm
  WHERE cm.tenant_id = v_tenant_id AND cm.kind IN ('income', 'customer_prepayment')
  AND cm.created_at >= v_ts_from AND cm.created_at < v_ts_to
  AND (p_site_id IS NULL OR cm.site_id = p_site_id)
  AND cm.customer_id IS NOT NULL
  GROUP BY cm.customer_id
  UNION ALL
  -- Sale payments that may not have a corresponding cash_movement (e.g. bank transfer, check)
  -- Only count affects_balance=true to avoid allocation double-counting
  SELECT s.customer_id AS cid, SUM(spay.amount) AS enc
  FROM sale_payments spay
  JOIN sales s ON s.id = spay.sale_id
  WHERE spay.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
  AND COALESCE(spay.affects_balance, true) = true
  AND spay.created_at >= v_ts_from AND spay.created_at < v_ts_to
  AND (p_site_id IS NULL OR s.site_id = p_site_id)
  -- Exclude payments that already have a matching cash_movement (register_sale_payment creates both)
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
  SELECT s.customer_id AS cid
  FROM sales s
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
) a
),
ev AS (
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
UNION ALL
SELECT s.customer_id, sp2.created_at, -sp2.amount
FROM sale_payments sp2 JOIN sales s ON s.id = sp2.sale_id
WHERE sp2.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
AND COALESCE(sp2.affects_balance, true) = true
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
sp.cid IS NOT NULL OR rp.cid IS NOT NULL OR ep.cid IS NOT NULL
OR act.cid IS NOT NULL
OR (COALESCE(c.balance, 0) <> 0 AND (p_site_id IS NULL OR c.site_id = p_site_id OR c.site_id IS NULL))
-- Include customers unbalanced at the requested date
OR (COALESCE(c.balance, 0) - COALESCE(dc.delta_after, 0)) <> 0
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

-- get_customer_statement: deterministic ordering
CREATE OR REPLACE FUNCTION public.get_customer_statement(p_customer_id uuid, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
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
SELECT ba.created_at AS ts, 1 AS ord, ba.id AS row_id, ''::text AS piece,
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
SELECT s.created_at, 2, s.id, s.sale_number,
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
SELECT COALESCE(s.deleted_at, s.created_at), 3, s.id, s.sale_number,
'Suppression facture ' || s.sale_number, 0::numeric, s.total::numeric, false, 'cancel'
FROM sales s
WHERE s.tenant_id = v_tenant_id AND s.customer_id = p_customer_id AND s.status = 'deleted'

UNION ALL
-- Sale payments (regular + allocations)
SELECT sp.created_at, 4, sp.id, COALESCE(s.sale_number, ''),
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
-- Prepayments
SELECT pp.created_at, 5, pp.id, COALESCE(pp.reference, ''),
'Acompte' || CASE WHEN pp.method_name IS NOT NULL THEN ' · ' || pp.method_name ELSE '' END,
0::numeric, pp.amount::numeric, true, 'prepayment'
FROM customer_prepayments pp
WHERE pp.tenant_id = v_tenant_id AND pp.customer_id = p_customer_id AND pp.amount > 0

UNION ALL
-- Avoirs
SELECT COALESCE(sr.refunded_at, sr.created_at), 6, sr.id, sr.return_number, 'Avoir',
0::numeric, sr.total::numeric, true, 'avoir'
FROM sale_returns sr
WHERE sr.tenant_id = v_tenant_id AND sr.customer_id = p_customer_id
AND sr.status = 'approved' AND sr.refund_method = 'avoir'

UNION ALL
-- Withdrawals
SELECT cm.created_at, 7, cm.id, COALESCE(cm.reference, ''),
'Retrait caisse' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
cm.amount::numeric, 0::numeric, true, 'withdrawal'
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
AND cm.kind = 'customer_withdrawal'

UNION ALL
-- Loans
SELECT cm.created_at, 8, cm.id, COALESCE(cm.reference, ''),
'Prêt client' || CASE WHEN COALESCE(cm.reason, '') <> '' THEN ' · ' || cm.reason ELSE '' END,
cm.amount::numeric, 0::numeric, true, 'loan'
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id AND cm.customer_id = p_customer_id
AND cm.kind = 'customer_loan'
),
ordered AS (
SELECT m.ts, m.ord, m.row_id, m.piece, m.label, m.kind, m.debit, m.credit, m.affects,
SUM(CASE WHEN m.affects THEN m.debit - m.credit ELSE 0 END)
OVER (ORDER BY m.ts, m.ord, m.row_id ROWS UNBOUNDED PRECEDING) AS cum
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

v_result := jsonb_set(v_result, '{opening_balance}',
to_jsonb(v_base + (v_result->>'opening_delta')::numeric));
v_result := jsonb_set(v_result, '{closing_balance}',
to_jsonb(v_base + (v_result->>'closing_delta')::numeric));
v_result := v_result - 'opening_delta' - 'closing_delta';
v_result := jsonb_set(v_result, '{rows}', COALESCE((
SELECT jsonb_agg(
jsonb_set(r - 'cum', '{running}', to_jsonb(v_base + (r->>'cum')::numeric)))
FROM jsonb_array_elements(v_result->'rows') r), '[]'::jsonb));

RETURN v_result;
END;
$function$;

-- get_tiers_balance(uuid, date): include customers with non-zero balance at the date
CREATE OR REPLACE FUNCTION public.get_tiers_balance(p_site_id uuid DEFAULT NULL::uuid, p_as_of date DEFAULT CURRENT_DATE)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'public'
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

WITH ev AS (
SELECT s.customer_id AS cid, s.created_at AS ts, s.total AS amt
FROM sales s WHERE s.tenant_id = v_tenant_id AND s.status <> 'cancelled' AND s.status <> 'deleted' AND s.deleted_at IS NULL AND s.customer_id IS NOT NULL
UNION ALL
SELECT s.customer_id, sp.created_at, -sp.amount
FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
WHERE sp.tenant_id = v_tenant_id AND s.customer_id IS NOT NULL
AND COALESCE(sp.affects_balance, true) = true
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
$function$;
