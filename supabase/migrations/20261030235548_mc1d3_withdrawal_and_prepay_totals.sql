/*
# MC1-D.3 - Retraits sur acompte et totaux d'acomptes (mode multi-caisse)

Corrige les defauts constates en MC1-D.2V, UNIQUEMENT lorsque multi_cash_enabled = true.
Le mode desactive conserve exactement son comportement historique.

1. Nouvelles fonctions
   - _cs_record_customer_withdrawal(...) SECURITY DEFINER : retrait atomique complet
     (controles, verrous, plafond, mouvement de caisse dans la session personnelle,
     consommation FIFO de TOUS les acomptes du client, solde client). Toutes les
     verifications sont internes : un appel direct n'offre aucun contournement.
   - get_customer_prepay_available(uuid[]) SECURITY DEFINER : agregats d'acompte
     disponible par client (aucune ligne source retournee).
   - _cs_customer_statement_global(uuid, date, date) SECURITY DEFINER : solde
     d'ouverture / cloture globaux d'un client (agregats uniquement).
2. Fonctions modifiees (signatures et formats conserves)
   - record_cash_movement : en mode active, un retrait est delegue a
     _cs_record_customer_withdrawal. Toutes les autres branches sont inchangees.
   - apply_customer_prepayments : en mode active, la reference du reglement
     d'imputation n'inclut plus la reference privee de l'acompte source.
   - get_customer_statement : en mode active (appel API), ouverture et cloture sont
     globales, et une ligne agregee "Operations d'autres caisses (non detaillees)"
     reconcilie ouverture + mouvements visibles + ajustement = cloture.
     Cle ajoutee : hidden_adjustment.
3. Securite
   - credit_allocations : politique RESTRICTIVE de lecture ; en mode active une
     imputation de type 'prepay' n'est lisible que si l'acompte source l'est.
   - EXECUTE revoque de PUBLIC et anon sur les nouvelles fonctions, accorde a authenticated.
4. Notes
   - Aucune donnee existante modifiee, aucun backfill.
   - Le retrait n'a pas d'idempotence (constat, inchange).
*/

CREATE OR REPLACE FUNCTION public._cs_record_customer_withdrawal(
  p_cash_session_id uuid, p_site_id uuid, p_amount numeric,
  p_reason text, p_note text, p_reference text, p_customer_id uuid,
  p_payment_method_id uuid, p_method_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_tenant uuid := public.current_tenant_id();
  v_pm_type text; v_available numeric; v_balance numeric; v_net numeric;
  v_remaining numeric; v_take numeric; v_consumed numeric := 0;
  v_pp record; v_movement_id uuid; v_rows int;
BEGIN
  IF v_uid IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant introuvable' USING ERRCODE = '42501';
  END IF;
  IF NOT public._cs_multi_enabled(v_tenant) THEN
    RAISE EXCEPTION 'Opération réservée au mode multi-caisse' USING ERRCODE = '42501';
  END IF;
  IF p_cash_session_id IS NULL THEN
    RAISE EXCEPTION 'Ouvrez votre caisse avant d''enregistrer cet encaissement.' USING ERRCODE = '42501';
  END IF;
  PERFORM public._cs_assert_operational(p_cash_session_id, v_tenant, p_site_id);
  PERFORM 1 FROM public.cash_sessions cs
   WHERE cs.id = p_cash_session_id AND cs.tenant_id = v_tenant AND cs.user_id = v_uid
     AND cs.status = 'open' AND cs.site_id = p_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cette session de caisse appartient à un autre opérateur. Ouvrez votre caisse avant d''enregistrer cet encaissement.' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;
  IF NOT (public._cr_profile_has_permission(v_uid, 'pos_cash_movement')
          AND public._cr_profile_has_permission(v_uid, 'pos_customer_withdrawal')) THEN
    RAISE EXCEPTION 'Vous n''avez pas la permission d''effectuer un retrait sur acompte client' USING ERRCODE = '42501';
  END IF;
  IF p_customer_id IS NULL THEN RAISE EXCEPTION 'Client obligatoire'; END IF;
  PERFORM 1 FROM public.customers WHERE id = p_customer_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'Client introuvable' USING ERRCODE = '42501'; END IF;
  IF p_payment_method_id IS NOT NULL THEN
    SELECT payment_type INTO v_pm_type FROM public.payment_methods
     WHERE id = p_payment_method_id AND tenant_id = v_tenant;
    IF NOT FOUND THEN RAISE EXCEPTION 'Mode de règlement introuvable' USING ERRCODE = '42501'; END IF;
    IF COALESCE(v_pm_type, '') = 'credit' THEN
      RAISE EXCEPTION 'Le crédit client n''est pas un mode de règlement valide';
    END IF;
  END IF;

  -- Same lock order as apply_customer_prepayments (prepayments by created_at), then customer.
  SELECT COALESCE(SUM(l.amount - l.amount_used), 0) INTO v_available
    FROM (SELECT pp.amount, pp.amount_used FROM public.customer_prepayments pp
           WHERE pp.tenant_id = v_tenant AND pp.customer_id = p_customer_id AND pp.amount_used < pp.amount
           ORDER BY pp.created_at, pp.id FOR UPDATE) l;
  SELECT COALESCE(balance, 0) INTO v_balance FROM public.customers
   WHERE id = p_customer_id AND tenant_id = v_tenant FOR UPDATE;

  v_net := v_available - GREATEST(v_balance, 0);
  IF v_available <= 0 THEN
    RAISE EXCEPTION 'Le client n''a aucun acompte disponible';
  END IF;
  IF v_net <= 0 THEN
    RAISE EXCEPTION 'Le client a une dette de % qui couvre son acompte de %. Retrait impossible.', v_balance, v_available;
  END IF;
  IF p_amount > v_net THEN
    RAISE EXCEPTION 'Montant supérieur au retrait maximum (%). Le client a un acompte de % et une dette de % à déduire.', v_net, v_available, GREATEST(v_balance, 0);
  END IF;

  INSERT INTO public.cash_movements (tenant_id, cash_session_id, site_id, user_id, kind, amount,
    reason, note, reference, customer_id, payment_method_id, method_name, expense_category_id)
  VALUES (v_tenant, p_cash_session_id, p_site_id, v_uid, 'customer_withdrawal', p_amount,
    p_reason, p_note, p_reference, p_customer_id, p_payment_method_id, p_method_name, NULL)
  RETURNING id INTO v_movement_id;

  UPDATE public.cash_sessions SET theoretical_amount = COALESCE(theoretical_amount, 0) - p_amount
   WHERE id = p_cash_session_id AND tenant_id = v_tenant;

  v_remaining := p_amount;
  FOR v_pp IN
    SELECT pp.id, pp.amount, pp.amount_used FROM public.customer_prepayments pp
     WHERE pp.tenant_id = v_tenant AND pp.customer_id = p_customer_id AND pp.amount_used < pp.amount
     ORDER BY pp.created_at, pp.id FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_pp.amount - v_pp.amount_used);
    IF v_take <= 0 THEN CONTINUE; END IF;
    UPDATE public.customer_prepayments SET amount_used = amount_used + v_take
     WHERE id = v_pp.id AND amount_used + v_take <= amount;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN RAISE EXCEPTION 'Acompte modifié pendant le retrait. Opération annulée.'; END IF;
    v_remaining := v_remaining - v_take;
    v_consumed := v_consumed + v_take;
  END LOOP;

  IF v_consumed <> p_amount THEN
    RAISE EXCEPTION 'Acompte insuffisant pour ce retrait (% consommable sur %). Opération annulée.', v_consumed, p_amount;
  END IF;

  UPDATE public.customers SET balance = COALESCE(balance, 0) + v_consumed
   WHERE id = p_customer_id AND tenant_id = v_tenant;

  RETURN jsonb_build_object('movement_id', v_movement_id, 'withdrawn', v_consumed);
END;
$function$;

REVOKE ALL ON FUNCTION public._cs_record_customer_withdrawal(uuid, uuid, numeric, text, text, text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._cs_record_customer_withdrawal(uuid, uuid, numeric, text, text, text, uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_cash_movement(p_cash_session_id uuid, p_site_id uuid, p_kind text, p_amount numeric, p_reason text DEFAULT ''::text, p_note text DEFAULT ''::text, p_reference text DEFAULT ''::text, p_customer_id uuid DEFAULT NULL::uuid, p_payment_method_id uuid DEFAULT NULL::uuid, p_method_name text DEFAULT ''::text, p_expense_category_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid; v_movement_id uuid; v_prepay_id uuid; v_applied jsonb;
v_pm_type text; v_available numeric; v_balance numeric; v_net numeric;
v_remaining numeric; v_prepay record; v_take numeric; v_credit_limit numeric;
v_multi boolean;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Tenant introuvable'; END IF;
IF p_kind NOT IN ('expense','income','customer_prepayment','customer_withdrawal','customer_loan','refund') THEN
RAISE EXCEPTION 'Type de mouvement invalide';
END IF;
IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

v_multi := public._cs_cash_write_guard(p_cash_session_id, p_site_id);

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

-- Multi-cash: atomic withdrawal over the customer's full prepayment set, independent of row visibility.
IF p_kind = 'customer_withdrawal' AND v_multi THEN
RETURN public._cs_record_customer_withdrawal(p_cash_session_id, p_site_id, p_amount, p_reason, p_note,
p_reference, p_customer_id, p_payment_method_id, p_method_name);
END IF;

-- WITHDRAWAL CAP: available prepayments minus actual debt (ignore existing credit)
IF p_kind = 'customer_withdrawal' THEN
SELECT COALESCE(SUM(amount - amount_used), 0) INTO v_available
FROM customer_prepayments
WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id AND amount_used < amount;

SELECT COALESCE(balance, 0) INTO v_balance
FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id;

-- FIX: only deduct positive balance (debt). Negative balance (credit) should not inflate withdrawable amount.
v_net := COALESCE(v_available, 0) - GREATEST(COALESCE(v_balance, 0), 0);

IF v_available IS NULL OR v_available <= 0 THEN
RAISE EXCEPTION 'Le client n''a aucun acompte disponible';
END IF;
IF v_net <= 0 THEN
RAISE EXCEPTION 'Le client a une dette de % qui couvre son acompte de %. Retrait impossible.', v_balance, v_available;
END IF;
IF p_amount > v_net THEN
RAISE EXCEPTION 'Montant supérieur au retrait maximum (%). Le client a un acompte de % et une dette de % à déduire.', v_net, v_available, GREATEST(v_balance, 0);
END IF;
END IF;

-- LOAN CAP
IF p_kind = 'customer_loan' THEN
SELECT COALESCE(balance, 0), COALESCE(credit_limit, 0)
INTO v_balance, v_credit_limit
FROM customers WHERE id = p_customer_id AND tenant_id = v_tenant_id;

IF v_credit_limit > 0 AND (v_balance + p_amount) > v_credit_limit THEN
RAISE EXCEPTION 'Plafond crédit dépassé (%). Solde actuel : %. Maximum prêt possible : %.',
v_credit_limit, v_balance, GREATEST(0, v_credit_limit - v_balance);
END IF;
END IF;

INSERT INTO cash_movements (tenant_id, cash_session_id, site_id, user_id, kind, amount,
reason, note, reference, customer_id, payment_method_id, method_name, expense_category_id)
VALUES (v_tenant_id, p_cash_session_id, p_site_id, auth.uid(), p_kind, p_amount,
p_reason, p_note, p_reference, p_customer_id, p_payment_method_id, p_method_name, p_expense_category_id)
RETURNING id INTO v_movement_id;

IF p_cash_session_id IS NOT NULL THEN
IF p_kind IN ('expense','customer_withdrawal','customer_loan','refund') THEN
UPDATE cash_sessions SET theoretical_amount = COALESCE(theoretical_amount, 0) - p_amount
WHERE id = p_cash_session_id;
ELSE
UPDATE cash_sessions SET theoretical_amount = COALESCE(theoretical_amount, 0) + p_amount
WHERE id = p_cash_session_id;
END IF;
END IF;

-- PREPAYMENT
IF p_kind = 'customer_prepayment' THEN
INSERT INTO customer_prepayments (tenant_id, customer_id, amount, amount_used, method_name, reference, cash_movement_id, cash_session_id)
VALUES (v_tenant_id, p_customer_id, p_amount, 0, p_method_name, p_reference,
CASE WHEN v_multi THEN v_movement_id END, CASE WHEN v_multi THEN p_cash_session_id END)
RETURNING id INTO v_prepay_id;

UPDATE customers SET balance = COALESCE(balance, 0) - p_amount
WHERE id = p_customer_id AND tenant_id = v_tenant_id;

v_applied := apply_customer_prepayments(p_customer_id);
RETURN jsonb_build_object('movement_id', v_movement_id, 'prepayment_id', v_prepay_id,
'auto_applied', COALESCE((v_applied->>'applied')::numeric, 0));
END IF;

-- WITHDRAWAL: FIFO consume prepayments
IF p_kind = 'customer_withdrawal' THEN
v_remaining := p_amount;
FOR v_prepay IN
SELECT * FROM customer_prepayments
WHERE tenant_id = v_tenant_id AND customer_id = p_customer_id AND amount_used < amount
ORDER BY created_at ASC FOR UPDATE
LOOP
EXIT WHEN v_remaining <= 0;
v_take := LEAST(v_remaining, v_prepay.amount - v_prepay.amount_used);
IF v_take <= 0 THEN CONTINUE; END IF;
UPDATE customer_prepayments SET amount_used = amount_used + v_take WHERE id = v_prepay.id;
v_remaining := v_remaining - v_take;
END LOOP;
UPDATE customers SET balance = COALESCE(balance, 0) + p_amount
WHERE id = p_customer_id AND tenant_id = v_tenant_id;
RETURN jsonb_build_object('movement_id', v_movement_id, 'withdrawn', p_amount - v_remaining);
END IF;

-- LOAN
IF p_kind = 'customer_loan' THEN
UPDATE customers SET balance = COALESCE(balance, 0) + p_amount
WHERE id = p_customer_id AND tenant_id = v_tenant_id;
RETURN jsonb_build_object('movement_id', v_movement_id, 'loan_amount', p_amount);
END IF;

RETURN jsonb_build_object('movement_id', v_movement_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_customer_prepay_available(p_customer_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_tenant uuid := public.current_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant IS NULL THEN
    RAISE EXCEPTION 'Tenant introuvable' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_object_agg(s.customer_id, s.amt)
      FROM (SELECT pp.customer_id, SUM(GREATEST(0, pp.amount - pp.amount_used)) AS amt
              FROM public.customer_prepayments pp
             WHERE pp.tenant_id = v_tenant
               AND (p_customer_ids IS NULL OR pp.customer_id = ANY (p_customer_ids))
             GROUP BY pp.customer_id) s), '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_customer_prepay_available(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_customer_prepay_available(uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_customer_prepayments(p_customer_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
v_tenant_id uuid; v_prepay record; v_sale record;
v_available numeric; v_due numeric; v_take numeric;
v_new_paid numeric; v_new_status text; v_applied numeric := 0; v_method text;
v_multi boolean;
BEGIN
v_tenant_id := current_tenant_id();
IF v_tenant_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;
IF p_customer_id IS NULL THEN RETURN jsonb_build_object('applied', 0); END IF;
v_multi := public._cs_multi_enabled(v_tenant_id);

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
v_take, CASE WHEN v_multi THEN 'Imputation acompte' ELSE 'Imputation acompte ' || COALESCE(v_prepay.reference, '') END, false);

v_new_paid := COALESCE(v_sale.paid, 0) + v_take;
v_new_status := CASE WHEN v_new_paid >= COALESCE(v_sale.total, 0) THEN 'paid' ELSE 'partial' END;
UPDATE public.sales SET paid = v_new_paid, status = v_new_status WHERE id = v_sale.id;

UPDATE public.customer_prepayments SET amount_used = amount_used + v_take WHERE id = v_prepay.id;

INSERT INTO public.credit_allocations (tenant_id, customer_id, source_type, source_id, target_type, target_id, amount)
VALUES (v_tenant_id, p_customer_id, 'prepay', v_prepay.id, 'invoice', v_sale.id, v_take)
ON CONFLICT (source_id, target_id, source_type, target_type) DO NOTHING;

v_available := v_available - v_take;
v_applied := v_applied + v_take;
EXIT WHEN v_available <= 0;
END LOOP;
END LOOP;

PERFORM public._allocate_negative_adjustments_to_invoices(p_customer_id, v_tenant_id);
RETURN jsonb_build_object('applied', v_applied);
END;
$function$;

DROP POLICY IF EXISTS "mc1d3 select prepay allocation" ON public.credit_allocations;
CREATE POLICY "mc1d3 select prepay allocation" ON public.credit_allocations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT public._cs_multi_current()
    OR source_type IS DISTINCT FROM 'prepay'
    OR EXISTS (SELECT 1 FROM public.customer_prepayments pp WHERE pp.id = credit_allocations.source_id)
  );

CREATE OR REPLACE FUNCTION public._cs_customer_statement_global(p_customer_id uuid, p_from date, p_to date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_r jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.current_tenant_id() IS NULL THEN
    RAISE EXCEPTION 'Tenant introuvable' USING ERRCODE = '42501';
  END IF;
  v_r := public.get_customer_statement(p_customer_id, p_from, p_to);
  RETURN jsonb_build_object('opening', v_r->'opening_balance', 'closing', v_r->'closing_balance');
END;
$function$;

REVOKE ALL ON FUNCTION public._cs_customer_statement_global(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._cs_customer_statement_global(uuid, date, date) TO authenticated;
