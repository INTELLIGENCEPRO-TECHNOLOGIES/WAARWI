/*
# Supervision des caisses : alignement sur les règles du POS

1. `cash_supervision_customer_payment` reçoit un indicateur explicite `p_balance`
   (report de solde) au lieu de déduire ce mode d'une facture absente, pour reproduire exactement
   le choix proposé par la modale d'encaissement client du POS (facture précise, règlement global, report de solde).
2. `cash_supervision_record_movement` : la catégorie de dépense n'est obligatoire que si le magasin
   dispose d'au moins une catégorie disponible (même règle que le POS). Une catégorie fournie doit
   toujours être disponible pour le magasin.

Sécurité : mêmes contrôles qu'avant (identité, tenant, droit de supervision, permission, session ouverte,
idempotence, audit). Aucune donnée modifiée.
*/

DROP FUNCTION IF EXISTS public.cash_supervision_customer_payment(uuid, uuid, uuid, uuid, text, numeric, text, text);

CREATE OR REPLACE FUNCTION public.cash_supervision_customer_payment(
  p_session_id uuid, p_customer_id uuid, p_sale_id uuid, p_balance boolean, p_payment_method_id uuid, p_method_name text,
  p_amount numeric, p_reference text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_tenant uuid := public.current_tenant_id();
v_ctx jsonb; v_res jsonb;
BEGIN
v_ctx := public._cs_supervision_begin(p_session_id, 'customer_payment', ARRAY['access_pos'], p_idempotency_key);
IF (v_ctx->>'replayed')::boolean THEN RETURN (v_ctx->'result') || jsonb_build_object('replayed', true); END IF;

IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide' USING ERRCODE = '22023'; END IF;
IF NOT EXISTS (SELECT 1 FROM customers c WHERE c.id = p_customer_id AND c.tenant_id = v_tenant) THEN
RAISE EXCEPTION 'Client introuvable' USING ERRCODE = '42501';
END IF;
IF NOT EXISTS (SELECT 1 FROM payment_methods pm WHERE pm.id = p_payment_method_id AND pm.tenant_id = v_tenant) THEN
RAISE EXCEPTION 'Mode de règlement introuvable' USING ERRCODE = '42501';
END IF;

IF COALESCE(p_balance, false) THEN
v_res := public.register_customer_balance_payment(p_customer_id, p_payment_method_id, p_method_name, p_amount,
  p_reference, p_session_id, 'sup:' || (v_ctx->>'key'));
ELSE
IF p_sale_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = p_sale_id AND s.tenant_id = v_tenant
  AND s.customer_id = p_customer_id AND s.status <> 'cancelled') THEN
RAISE EXCEPTION 'Facture introuvable pour ce client' USING ERRCODE = '42501';
END IF;
v_res := public.register_customer_payment(p_customer_id, p_payment_method_id, p_method_name, p_amount,
  p_reference, p_session_id, p_sale_id);
END IF;
RETURN public._cs_supervision_end(p_session_id, 'customer_payment', v_ctx,
  COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('customer_id', p_customer_id, 'sale_id', p_sale_id,
    'balance', COALESCE(p_balance, false), 'amount', p_amount));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cash_supervision_customer_payment(uuid, uuid, uuid, boolean, uuid, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_supervision_customer_payment(uuid, uuid, uuid, boolean, uuid, text, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_supervision_record_movement(
  p_session_id uuid, p_kind text, p_amount numeric, p_reason text, p_note text, p_reference text,
  p_customer_id uuid, p_payment_method_id uuid, p_method_name text, p_expense_category_id uuid, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_tenant uuid := public.current_tenant_id();
v_perms text[] := ARRAY['pos_cash_movement'];
v_ctx jsonb; v_res jsonb; v_settings jsonb; v_site uuid;
BEGIN
IF p_kind IS NULL OR p_kind NOT IN ('expense','income','customer_prepayment','customer_withdrawal','customer_loan') THEN
RAISE EXCEPTION 'Type de mouvement invalide' USING ERRCODE = '22023';
END IF;
IF p_kind = 'customer_withdrawal' THEN v_perms := v_perms || 'pos_customer_withdrawal'::text; END IF;
IF p_kind = 'customer_loan' THEN v_perms := v_perms || 'pos_customer_loan'::text; END IF;

v_ctx := public._cs_supervision_begin(p_session_id, 'movement', v_perms, p_idempotency_key);
IF (v_ctx->>'replayed')::boolean THEN RETURN (v_ctx->'result') || jsonb_build_object('replayed', true); END IF;
v_site := (v_ctx->>'site_id')::uuid;

IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide' USING ERRCODE = '22023'; END IF;
IF p_kind IN ('customer_withdrawal', 'customer_loan') THEN
SELECT COALESCE(t.settings, '{}'::jsonb) INTO v_settings FROM tenants t WHERE t.id = v_tenant;
IF COALESCE(v_settings->>(CASE p_kind WHEN 'customer_withdrawal' THEN 'enable_customer_withdrawals' ELSE 'enable_customer_loans' END), '') <> 'true' THEN
RAISE EXCEPTION 'Cette opération n''est pas activée pour votre entreprise' USING ERRCODE = '42501';
END IF;
END IF;
IF p_kind = 'expense' THEN
IF p_expense_category_id IS NOT NULL THEN
IF NOT public.is_expense_category_available_for_site(p_expense_category_id, v_site) THEN
RAISE EXCEPTION 'Catégorie de dépense indisponible pour ce magasin' USING ERRCODE = '42501';
END IF;
ELSIF EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = v_tenant
  AND public.is_expense_category_available_for_site(ec.id, v_site)) THEN
RAISE EXCEPTION 'Sélectionnez un type de dépense' USING ERRCODE = '22023';
END IF;
END IF;
IF p_payment_method_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM payment_methods pm WHERE pm.id = p_payment_method_id AND pm.tenant_id = v_tenant) THEN
RAISE EXCEPTION 'Mode de règlement introuvable' USING ERRCODE = '42501';
END IF;
IF p_customer_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM customers c WHERE c.id = p_customer_id AND c.tenant_id = v_tenant) THEN
RAISE EXCEPTION 'Client introuvable' USING ERRCODE = '42501';
END IF;

v_res := public.record_cash_movement(p_session_id, v_site, p_kind, p_amount, p_reason, p_note, p_reference,
  p_customer_id, p_payment_method_id, p_method_name, CASE WHEN p_kind = 'expense' THEN p_expense_category_id END);
RETURN public._cs_supervision_end(p_session_id, 'movement', v_ctx,
  COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('kind', p_kind, 'amount', p_amount));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cash_supervision_record_movement(uuid, text, numeric, text, text, text, uuid, uuid, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_supervision_record_movement(uuid, text, numeric, text, text, text, uuid, uuid, text, uuid, text) TO authenticated;
