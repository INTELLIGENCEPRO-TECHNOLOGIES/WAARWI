/*
# Fix credit_allocations column names in _apply_avoirs_internal and apply_customer_prepayments

## Summary
Both functions were inserting into credit_allocations using wrong column names:
- credit_type -> should be source_type
- credit_id   -> should be source_id
- sale_id     -> should be target_id
- Missing target_type ('sale') and customer_id columns

This caused intermittent "column credit_type does not exist" errors during
credit sales and prepayment creation.

## Modified Functions
- `_apply_avoirs_internal(p_customer_id, p_tenant_id)`: 3 INSERT statements fixed
- `apply_customer_prepayments(p_customer_id)`: 1 INSERT statement fixed

## Important Notes
1. The ON CONFLICT clause is updated to reference the actual unique index
   (source_id, target_id, source_type, target_type).
2. customer_id is now properly included in every INSERT.
3. target_type is always 'sale' since allocations target invoices.
*/

-- Fix _apply_avoirs_internal
CREATE OR REPLACE FUNCTION public._apply_avoirs_internal(p_customer_id uuid, p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
v_credit record; v_sale record; v_adj record;
v_available numeric; v_due numeric; v_to_apply numeric;
v_total_applied numeric := 0; v_applied_details jsonb := '[]'::jsonb;
v_origin_sale_id uuid; v_existing boolean; v_adj_remaining numeric;
v_new_paid numeric; v_new_status text; v_method text;
BEGIN
PERFORM 1 FROM public.customers WHERE id = p_customer_id AND tenant_id = p_tenant_id FOR UPDATE;

FOR v_credit IN
SELECT sr.* FROM public.sale_returns sr
WHERE sr.tenant_id = p_tenant_id AND sr.customer_id = p_customer_id
AND sr.refund_method = 'avoir' AND sr.status = 'approved'
AND (COALESCE(sr.total, 0) - COALESCE(sr.credit_used, 0)) > 0
ORDER BY sr.created_at ASC FOR UPDATE
LOOP
v_available := COALESCE(v_credit.total, 0) - COALESCE(v_credit.credit_used, 0);
IF v_available <= 0 THEN CONTINUE; END IF;

-- Priority 1: originating invoice (exclude cancelled AND deleted)
v_origin_sale_id := v_credit.sale_id;
IF v_origin_sale_id IS NOT NULL AND v_available > 0 THEN
SELECT * INTO v_sale FROM public.sales
WHERE id = v_origin_sale_id AND tenant_id = p_tenant_id
AND status <> 'cancelled' AND deleted_at IS NULL
FOR UPDATE;

IF FOUND AND COALESCE(v_sale.paid, 0) < COALESCE(v_sale.total, 0) THEN
v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
v_to_apply := LEAST(v_available, v_due);
IF v_to_apply > 0 THEN
SELECT COALESCE(pm.name, 'Avoir') INTO v_method FROM public.payment_methods pm
WHERE pm.tenant_id = p_tenant_id AND pm.payment_type = 'credit' LIMIT 1;
v_method := COALESCE(v_method, 'Avoir');

INSERT INTO public.sale_payments (tenant_id, sale_id, payment_method_id, method_name, amount, reference, affects_balance)
VALUES (p_tenant_id, v_sale.id, NULL, 'Avoir ' || v_credit.return_number, v_to_apply,
'Imputation avoir ' || v_credit.return_number, false);

v_new_paid := COALESCE(v_sale.paid, 0) + v_to_apply;
v_new_status := CASE WHEN v_new_paid >= COALESCE(v_sale.total, 0) THEN 'paid' ELSE 'partial' END;
UPDATE public.sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

UPDATE public.sale_returns SET credit_used = COALESCE(credit_used, 0) + v_to_apply
WHERE id = v_credit.id;

INSERT INTO public.credit_allocations (tenant_id, customer_id, source_type, source_id, target_type, target_id, amount)
VALUES (p_tenant_id, p_customer_id, 'avoir', v_credit.id, 'sale', v_sale.id, v_to_apply)
ON CONFLICT (source_id, target_id, source_type, target_type) DO NOTHING;

v_available := v_available - v_to_apply;
v_total_applied := v_total_applied + v_to_apply;
v_applied_details := v_applied_details || jsonb_build_object(
'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_to_apply, 'source', 'avoir');
END IF;
END IF;
END IF;

-- Priority 2: other unpaid invoices (FIFO, exclude cancelled AND deleted)
IF v_available > 0 THEN
FOR v_sale IN
SELECT s.* FROM public.sales s
WHERE s.tenant_id = p_tenant_id AND s.customer_id = p_customer_id
AND s.status <> 'cancelled' AND s.deleted_at IS NULL
AND COALESCE(s.paid, 0) < COALESCE(s.total, 0)
AND s.id <> COALESCE(v_origin_sale_id, '00000000-0000-0000-0000-000000000000'::uuid)
ORDER BY s.created_at ASC FOR UPDATE
LOOP
v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
v_to_apply := LEAST(v_available, v_due);
IF v_to_apply <= 0 THEN CONTINUE; END IF;

INSERT INTO public.sale_payments (tenant_id, sale_id, payment_method_id, method_name, amount, reference, affects_balance)
VALUES (p_tenant_id, v_sale.id, NULL, 'Avoir ' || v_credit.return_number, v_to_apply,
'Imputation avoir ' || v_credit.return_number, false);

v_new_paid := COALESCE(v_sale.paid, 0) + v_to_apply;
v_new_status := CASE WHEN v_new_paid >= COALESCE(v_sale.total, 0) THEN 'paid' ELSE 'partial' END;
UPDATE public.sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

UPDATE public.sale_returns SET credit_used = COALESCE(credit_used, 0) + v_to_apply
WHERE id = v_credit.id;

INSERT INTO public.credit_allocations (tenant_id, customer_id, source_type, source_id, target_type, target_id, amount)
VALUES (p_tenant_id, p_customer_id, 'avoir', v_credit.id, 'sale', v_sale.id, v_to_apply)
ON CONFLICT (source_id, target_id, source_type, target_type) DO NOTHING;

v_available := v_available - v_to_apply;
v_total_applied := v_total_applied + v_to_apply;
v_applied_details := v_applied_details || jsonb_build_object(
'sale_id', v_sale.id, 'sale_number', v_sale.sale_number, 'amount', v_to_apply, 'source', 'avoir');
EXIT WHEN v_available <= 0;
END LOOP;
END IF;

-- Priority 3: positive balance_adjustments
IF v_available > 0 THEN
FOR v_adj IN
SELECT ba.* FROM public.balance_adjustments ba
WHERE ba.tenant_id = p_tenant_id AND ba.entity_type = 'customer'
AND ba.entity_id = p_customer_id AND ba.amount > 0
AND (ba.amount - COALESCE(ba.amount_used, 0)) > 0
ORDER BY ba.created_at ASC FOR UPDATE
LOOP
v_adj_remaining := v_adj.amount - COALESCE(v_adj.amount_used, 0);
v_to_apply := LEAST(v_available, v_adj_remaining);
IF v_to_apply <= 0 THEN CONTINUE; END IF;

UPDATE public.balance_adjustments SET amount_used = COALESCE(amount_used, 0) + v_to_apply
WHERE id = v_adj.id;

UPDATE public.sale_returns SET credit_used = COALESCE(credit_used, 0) + v_to_apply
WHERE id = v_credit.id;

v_available := v_available - v_to_apply;
v_total_applied := v_total_applied + v_to_apply;
EXIT WHEN v_available <= 0;
END LOOP;
END IF;
END LOOP;

PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, p_tenant_id);

RETURN jsonb_build_object('total_applied', v_total_applied, 'details', v_applied_details);
END;
$$;


-- Fix apply_customer_prepayments
CREATE OR REPLACE FUNCTION public.apply_customer_prepayments(p_customer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
v_tenant_id uuid; v_prepay record; v_sale record;
v_available numeric; v_due numeric; v_take numeric;
v_new_paid numeric; v_new_status text; v_applied numeric := 0; v_method text;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;
IF p_customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;

FOR v_prepay IN
SELECT * FROM public.customer_prepayments
WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id AND amount_used < amount
ORDER BY created_at ASC FOR UPDATE
LOOP
v_available := v_prepay.amount - v_prepay.amount_used;
EXIT WHEN v_available <= 0;

FOR v_sale IN
SELECT * FROM public.sales
WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id
AND status <> 'cancelled' AND deleted_at IS NULL
AND COALESCE(paid, 0) < COALESCE(total, 0)
ORDER BY created_at ASC FOR UPDATE
LOOP
v_due := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));
v_take := LEAST(v_available, v_due);
IF v_take <= 0 THEN CONTINUE; END IF;

SELECT COALESCE(pm.name, 'Acompte') INTO v_method FROM public.payment_methods pm
WHERE pm.tenant_id = v_tenant_id AND pm.payment_type = 'credit' LIMIT 1;
v_method := COALESCE(v_method, 'Acompte');

INSERT INTO public.sale_payments (tenant_id, sale_id, payment_method_id, method_name, amount, reference, affects_balance)
VALUES (v_tenant_id, v_sale.id, NULL, 'Acompte · ' || COALESCE(v_prepay.method_name, 'Caisse'),
v_take, 'Imputation acompte ' || COALESCE(v_prepay.reference, ''), false);

v_new_paid := COALESCE(v_sale.paid, 0) + v_take;
v_new_status := CASE WHEN v_new_paid >= COALESCE(v_sale.total, 0) THEN 'paid' ELSE 'partial' END;
UPDATE public.sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

UPDATE public.customer_prepayments SET amount_used = amount_used + v_take WHERE id = v_prepay.id;

INSERT INTO public.credit_allocations (tenant_id, customer_id, source_type, source_id, target_type, target_id, amount)
VALUES (v_tenant_id, p_customer_id, 'prepayment', v_prepay.id, 'sale', v_sale.id, v_take)
ON CONFLICT (source_id, target_id, source_type, target_type) DO NOTHING;

v_available := v_available - v_take;
v_applied := v_applied + v_take;
EXIT WHEN v_available <= 0;
END LOOP;
END LOOP;

PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, v_tenant_id);
RETURN jsonb_build_object('applied', v_applied);
END;
$$;
