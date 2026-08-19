/*
# Phase 2: Refund model — separate refunds from expenses

## Summary
Introduces `kind = 'refund'` for cash movements representing customer return refunds.
Previously these were stored as `kind = 'expense'`, mixing refunds with real operating
expenses. This migration:

1. Schema Change
   - Extends the CHECK constraint on `cash_movements.kind` to include 'refund'
   - Allowed values: expense, income, customer_prepayment, customer_withdrawal, customer_loan, refund

2. Historical Data Reclassification
   - Reclassifies 56 existing cash_movement rows from kind='expense' to kind='refund'
   - Targeted by reason pattern: 'Retour RET-%' or 'Remboursement retour%'
   - No other fields are modified (amount, date, session, reference, category all untouched)

3. RPC Updates
   - `record_cash_movement`: accepts 'refund' as a valid kind; treats it as a cash outflow
     (decreases session theoretical_amount) but does NOT set expense_category_id
   - `get_financial_summary`: replaces transitional pattern-matching with explicit
     kind='expense' for charges and kind='refund' is naturally excluded
   - `get_cash_flow`: replaces transitional pattern-matching with kind='refund' for
     refunds and kind='expense' for charges (clean separation)

4. Security
   - No RLS changes. Functions remain SECURITY INVOKER with authenticated-only EXECUTE.

5. Important Notes
   - Refund = treasury outflow only, NOT an operating expense
   - Refund does NOT reduce CA (returns already do that)
   - Future: a dedicated accounting entry for refunds may be added later
*/

-- ============================================================================
-- 1. Extend CHECK constraint to include 'refund'
-- ============================================================================
ALTER TABLE cash_movements DROP CONSTRAINT IF EXISTS cash_movements_kind_check;
ALTER TABLE cash_movements ADD CONSTRAINT cash_movements_kind_check
  CHECK (kind = ANY (ARRAY['expense','income','customer_prepayment','customer_withdrawal','customer_loan','refund']));

-- ============================================================================
-- 2. Reclassify historical refund rows (56 rows identified in audit)
-- ============================================================================
UPDATE cash_movements
SET kind = 'refund'
WHERE kind = 'expense'
  AND (reason ILIKE 'Retour RET-%' OR reason ILIKE 'Remboursement retour%');

-- ============================================================================
-- 3. Update record_cash_movement to accept 'refund'
-- ============================================================================
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

-- Validation for customer-related kinds
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

-- For withdrawal: check net position (acompte - debt) BEFORE inserting
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

-- For loan: check credit_limit if set
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

-- Insert the cash_movement row
-- Note: refund does NOT get an expense_category_id (it is not an operating expense)
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

-- Update session theoretical_amount
-- refund is a cash outflow (same as expense, withdrawal, loan)
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

-- Prepayment: create customer_prepayments row and auto-apply
IF p_kind = 'customer_prepayment' THEN
INSERT INTO customer_prepayments (
tenant_id, customer_id, cash_movement_id, cash_session_id,
amount, payment_method_id, method_name, reference
) VALUES (
v_tenant_id, p_customer_id, v_movement_id, p_cash_session_id,
p_amount, p_payment_method_id, COALESCE(p_method_name,''), COALESCE(p_reference,'')
) RETURNING id INTO v_prepay_id;

v_applied := apply_customer_prepayments(p_customer_id);

RETURN jsonb_build_object(
'movement_id', v_movement_id,
'prepayment_id', v_prepay_id,
'auto_applied', COALESCE((v_applied->>'applied')::numeric, 0)
);
END IF;

-- Withdrawal: consume prepayment credit FIFO (oldest first)
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

RETURN jsonb_build_object(
'movement_id', v_movement_id,
'withdrawn', p_amount - v_remaining
);
END IF;

-- Loan: increase customer debt (balance)
IF p_kind = 'customer_loan' THEN
UPDATE customers
SET balance = COALESCE(balance, 0) + p_amount
WHERE id = p_customer_id AND tenant_id = v_tenant_id;

RETURN jsonb_build_object(
'movement_id', v_movement_id,
'loan_amount', p_amount
);
END IF;

-- For refund and other kinds: just return the movement_id
-- Note: refund has no special side-effects beyond the cash outflow.
-- Future consideration: a dedicated accounting entry for refunds may be added later.
RETURN jsonb_build_object('movement_id', v_movement_id);
END;
$$;

-- ============================================================================
-- 4. Update get_financial_summary: use kind='expense' explicitly for charges
--    (refunds are now kind='refund', so they are naturally excluded)
-- ============================================================================
CREATE OR REPLACE FUNCTION get_financial_summary(
  p_site_id uuid DEFAULT NULL,
  p_from date DEFAULT CURRENT_DATE,
  p_to date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER STABLE
SET search_path = 'public'
AS $$
DECLARE
v_tenant_id        uuid;
v_ts_from          timestamptz;
v_ts_to            timestamptz;
v_ventes_validees  numeric := 0;
v_retours          numeric := 0;
v_cogs_ventes      numeric := 0;
v_cogs_retours     numeric := 0;
v_charges          numeric := 0;
v_nb_ventes        bigint  := 0;
v_nb_retours       bigint  := 0;
v_nb_ventes_retour bigint  := 0;
v_nb_annulations   bigint  := 0;
v_montant_annule   numeric := 0;
v_ca_net           numeric;
v_cogs_net         numeric;
v_marge_brute      numeric;
v_taux_marge       numeric;
v_resultat         numeric;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN
RAISE EXCEPTION 'Not authenticated';
END IF;

IF p_site_id IS NOT NULL THEN
IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
RAISE EXCEPTION 'Site not authorized';
END IF;
END IF;

v_ts_from := p_from::timestamptz;
v_ts_to   := (p_to + 1)::timestamptz;

-- Validated sales: revenue + COGS + count
SELECT COALESCE(SUM(s.total), 0),
COALESCE(SUM(item_cost.cost), 0),
COUNT(*)
INTO v_ventes_validees, v_cogs_ventes, v_nb_ventes
FROM sales s
LEFT JOIN LATERAL (
SELECT COALESCE(SUM(si.purchase_cost * si.quantity), 0) AS cost
FROM sale_items si WHERE si.sale_id = s.id
) item_cost ON true
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid', 'partial', 'validated')
AND s.created_at >= v_ts_from
AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id);

-- Approved returns: total + COGS + counts
SELECT COALESCE(SUM(sr.total), 0),
COALESCE(SUM(ret_cost.cost), 0),
COUNT(*),
COUNT(DISTINCT sr.sale_id)
INTO v_retours, v_cogs_retours, v_nb_retours, v_nb_ventes_retour
FROM sale_returns sr
LEFT JOIN LATERAL (
SELECT COALESCE(SUM(sri.purchase_cost * sri.quantity), 0) AS cost
FROM sale_return_items sri WHERE sri.return_id = sr.id
) ret_cost ON true
WHERE sr.tenant_id = v_tenant_id
AND sr.status = 'approved'
AND sr.created_at >= v_ts_from
AND sr.created_at < v_ts_to
AND (p_site_id IS NULL OR sr.site_id = p_site_id);

-- Cancelled sales (control indicators only)
SELECT COUNT(*), COALESCE(SUM(s.total), 0)
INTO v_nb_annulations, v_montant_annule
FROM sales s
WHERE s.tenant_id = v_tenant_id
AND s.status = 'cancelled'
AND s.created_at >= v_ts_from
AND s.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id);

-- Operating expenses: kind='expense' only (refunds are now kind='refund')
SELECT COALESCE(SUM(cm.amount), 0)
INTO v_charges
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.kind = 'expense'
AND cm.created_at >= v_ts_from
AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

-- Derived indicators
v_ca_net      := v_ventes_validees - v_retours;
v_cogs_net    := v_cogs_ventes - v_cogs_retours;
v_marge_brute := v_ca_net - v_cogs_net;
v_taux_marge  := CASE WHEN v_ca_net > 0 THEN ROUND((v_marge_brute / v_ca_net) * 100, 2) ELSE 0 END;
v_resultat    := v_marge_brute - v_charges;

RETURN jsonb_build_object(
'ventes_validees',       v_ventes_validees,
'retours',               v_retours,
'ca_net',                v_ca_net,
'cogs_ventes',           v_cogs_ventes,
'cogs_retours',          v_cogs_retours,
'cogs_net',              v_cogs_net,
'marge_brute',           v_marge_brute,
'taux_marge',            v_taux_marge,
'charges_exploitation',  v_charges,
'resultat_exploitation', v_resultat,
'nb_ventes',             v_nb_ventes,
'nb_retours',            v_nb_retours,
'nb_ventes_avec_retour', v_nb_ventes_retour,
'nb_annulations',        v_nb_annulations,
'montant_annule',        v_montant_annule
);
END;
$$;

-- ============================================================================
-- 5. Update get_cash_flow: use kind='refund' for refunds, kind='expense' for charges
-- ============================================================================
CREATE OR REPLACE FUNCTION get_cash_flow(
  p_site_id uuid DEFAULT NULL,
  p_from date DEFAULT CURRENT_DATE,
  p_to date DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER STABLE
SET search_path = 'public'
AS $$
DECLARE
v_tenant_id          uuid;
v_ts_from            timestamptz;
v_ts_to              timestamptz;
v_encaissements      numeric := 0;
v_autres_entrees     numeric := 0;
v_remboursements     numeric := 0;
v_charges            numeric := 0;
v_retraits_clients   numeric := 0;
v_prets_clients      numeric := 0;
v_flux_net           numeric;
v_by_method          jsonb;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN
RAISE EXCEPTION 'Not authenticated';
END IF;

IF p_site_id IS NOT NULL THEN
IF NOT EXISTS (SELECT 1 FROM sites WHERE id = p_site_id AND tenant_id = v_tenant_id) THEN
RAISE EXCEPTION 'Site not authorized';
END IF;
END IF;

v_ts_from := p_from::timestamptz;
v_ts_to   := (p_to + 1)::timestamptz;

-- Sale payments (encaissements from validated sales)
SELECT COALESCE(SUM(sp.amount), 0)
INTO v_encaissements
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid', 'partial', 'validated')
AND sp.created_at >= v_ts_from
AND sp.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id);

-- income + customer_prepayment = autres_entrees
SELECT COALESCE(SUM(cm.amount), 0)
INTO v_autres_entrees
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.kind IN ('income', 'customer_prepayment')
AND cm.created_at >= v_ts_from
AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

-- Refunds: now cleanly identified by kind='refund'
SELECT COALESCE(SUM(cm.amount), 0)
INTO v_remboursements
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.kind = 'refund'
AND cm.created_at >= v_ts_from
AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

-- Operating expenses: kind='expense' only
SELECT COALESCE(SUM(cm.amount), 0)
INTO v_charges
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.kind = 'expense'
AND cm.created_at >= v_ts_from
AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

-- Customer withdrawals
SELECT COALESCE(SUM(cm.amount), 0)
INTO v_retraits_clients
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.kind = 'customer_withdrawal'
AND cm.created_at >= v_ts_from
AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

-- Customer loans
SELECT COALESCE(SUM(cm.amount), 0)
INTO v_prets_clients
FROM cash_movements cm
WHERE cm.tenant_id = v_tenant_id
AND cm.kind = 'customer_loan'
AND cm.created_at >= v_ts_from
AND cm.created_at < v_ts_to
AND (p_site_id IS NULL OR cm.site_id = p_site_id);

-- Payment method breakdown
SELECT COALESCE(
jsonb_object_agg(method, total),
'{}'::jsonb
)
INTO v_by_method
FROM (
SELECT COALESCE(NULLIF(sp.method_name, ''), 'Espèces') AS method,
SUM(sp.amount) AS total
FROM sale_payments sp
JOIN sales s ON s.id = sp.sale_id
WHERE s.tenant_id = v_tenant_id
AND s.status IN ('paid', 'partial', 'validated')
AND sp.created_at >= v_ts_from
AND sp.created_at < v_ts_to
AND (p_site_id IS NULL OR s.site_id = p_site_id)
GROUP BY method
) sub;

v_flux_net := v_encaissements + v_autres_entrees - v_remboursements - v_charges - v_retraits_clients - v_prets_clients;

RETURN jsonb_build_object(
'encaissements_ventes', v_encaissements,
'autres_entrees',       v_autres_entrees,
'remboursements',       v_remboursements,
'charges',              v_charges,
'retraits_clients',     v_retraits_clients,
'prets_clients',        v_prets_clients,
'flux_net',             v_flux_net,
'par_methode',          v_by_method
);
END;
$$;

-- Maintain EXECUTE grants (authenticated only, as set in Phase 1)
REVOKE ALL ON FUNCTION record_cash_movement(uuid, uuid, text, numeric, text, text, text, uuid, uuid, text, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION record_cash_movement(uuid, uuid, text, numeric, text, text, text, uuid, uuid, text, uuid) TO authenticated;
