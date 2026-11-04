/*
# Supervision administrative complète des caisses (hors vente)

Permet à un responsable autorisé d'effectuer, sur la session ouverte d'un collaborateur,
les opérations de caisse existantes (mouvements, encaissements client, retours/remboursements,
régularisations), sans transférer la session et sans contourner les affectations de caisse.

1. Nouvelle table
   - `cash_supervision_requests` : registre d'idempotence et de traçabilité des opérations supervisées
     (tenant_id, request_key, cash_session_id, site_id, operation, actor_id, owner_id, result, created_at).
     RLS activée, aucune politique ni aucun droit client : lecture/écriture uniquement par les fonctions serveur.

2. Contrôles modifiés (exception étroite, jamais globale)
   - `_cs_supervision_active(session, site)` : vrai uniquement si le marqueur transactionnel
     `waarwi.cs_supervised_session` (ou l'ancien `waarwi.cs_supervised_expense`) désigne cette session
     ET que l'utilisateur connecté peut superviser ce magasin. Le marqueur n'est posé que par
     `_cs_supervision_begin`, interne et non exécutable par les clients.
   - `_cs_assert_operational`, `_trg_cs_open_guard`, `_cs_record_customer_withdrawal` utilisent ce test
     à la place de la vérification « propriétaire de la session ». Toutes les autres vérifications
     (session ouverte, magasin, caisse active et cohérente, permissions métier) sont conservées.

3. Nouvelles fonctions appelables (authenticated)
   - `cash_supervision_sessions(p_scope)` : sessions ouvertes ou clôturées récentes supervisables, avec droits effectifs.
   - `cash_supervision_record_movement` : dépense, entrée, acompte, retrait sur acompte, prêt client.
   - `cash_supervision_customer_payment` : encaissement client (facture ou report de solde).
   - `cash_supervision_sale_return` : retour avec remboursement immédiat, lien vers la vente d'origine conservé.
   - `cash_supervision_add_regularization` / `cash_supervision_delete_regularization`.
   Chaque fonction vérifie identité, tenant, mode multi-caisse, droit de supervision du magasin,
   permission métier, cohérence session/caisse, session ouverte (verrou), idempotence, puis journalise
   dans `audit_logs`. Aucune ne crée de vente.

4. Notes importantes
   1. L'auteur des écritures reste `auth.uid()` (l'administrateur) ; la session et son propriétaire ne changent pas.
   2. Aucune donnée historique n'est modifiée ; aucun réglage de tenant n'est changé.
   3. Le caissier ordinaire reste incapable d'écrire sur la session d'un collègue, y compris par appel direct.
*/

CREATE TABLE IF NOT EXISTS public.cash_supervision_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  cash_session_id uuid NOT NULL REFERENCES public.cash_sessions(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  operation text NOT NULL,
  actor_id uuid NOT NULL,
  owner_id uuid,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_cash_supervision_requests_session ON public.cash_supervision_requests(cash_session_id);
ALTER TABLE public.cash_supervision_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_supervision_requests FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public._cs_supervision_active(p_session_id uuid, p_site_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
SELECT auth.uid() IS NOT NULL AND p_session_id IS NOT NULL
  AND (COALESCE(current_setting('waarwi.cs_supervised_session', true), '') = p_session_id::text
    OR COALESCE(current_setting('waarwi.cs_supervised_expense', true), '') = p_session_id::text)
  AND public._cs_profile_can_supervise_site(auth.uid(), p_site_id);
$$;
REVOKE EXECUTE ON FUNCTION public._cs_supervision_active(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._cs_assert_operational(p_session_id uuid, p_tenant_id uuid, p_site_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_uid uuid := auth.uid();
v_s record;
BEGIN
IF v_uid IS NULL THEN RETURN; END IF;
IF COALESCE(current_setting('waarwi.cs_close_session', true), '') = p_session_id::text THEN RETURN; END IF;

SELECT cs.id, cs.tenant_id, cs.site_id, cs.user_id, cs.status, cs.cash_register_id,
r.is_active AS reg_active, r.site_id AS reg_site, r.tenant_id AS reg_tenant
INTO v_s
FROM cash_sessions cs
LEFT JOIN cash_registers r ON r.id = cs.cash_register_id
WHERE cs.id = p_session_id
FOR NO KEY UPDATE OF cs;

IF NOT FOUND OR v_s.tenant_id IS DISTINCT FROM p_tenant_id THEN
RAISE EXCEPTION 'Session de caisse introuvable' USING ERRCODE = '42501';
END IF;
IF v_s.status <> 'open' THEN
RAISE EXCEPTION 'Cette session de caisse est clôturée' USING ERRCODE = '42501';
END IF;
IF p_site_id IS NOT NULL AND v_s.site_id IS DISTINCT FROM p_site_id THEN
RAISE EXCEPTION 'Cette session de caisse appartient à un autre magasin' USING ERRCODE = '42501';
END IF;
IF v_s.reg_tenant IS DISTINCT FROM v_s.tenant_id OR v_s.reg_site IS DISTINCT FROM v_s.site_id THEN
RAISE EXCEPTION 'Caisse incohérente avec la session' USING ERRCODE = '42501';
END IF;
IF NOT v_s.reg_active THEN
RAISE EXCEPTION 'Cette caisse est désactivée' USING ERRCODE = '42501';
END IF;
IF public._cs_supervision_active(p_session_id, v_s.site_id) THEN
RETURN;
END IF;
IF v_s.user_id IS DISTINCT FROM v_uid THEN
RAISE EXCEPTION 'Cette session de caisse appartient à un autre opérateur. Ouvrez votre caisse avant d''enregistrer cet encaissement.' USING ERRCODE = '42501';
END IF;
IF NOT public._cs_profile_can_use_register(v_uid, v_s.cash_register_id) THEN
RAISE EXCEPTION 'Vous n''êtes pas autorisé à utiliser cette caisse' USING ERRCODE = '42501';
END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._trg_cs_open_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_uid uuid := auth.uid();
v_multi boolean;
v_changed text[];
BEGIN
IF NEW.status = 'open' AND (TG_OP = 'INSERT'
OR OLD.status IS DISTINCT FROM 'open'
OR NEW.site_id IS DISTINCT FROM OLD.site_id
OR NEW.user_id IS DISTINCT FROM OLD.user_id
OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
PERFORM public._cs_lock_open_keys(NEW.tenant_id, NEW.site_id, NEW.user_id);
v_multi := public._cs_multi_enabled(NEW.tenant_id);
IF NOT v_multi THEN
IF EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.site_id = NEW.site_id AND cs.status = 'open' AND cs.id <> NEW.id) THEN
RAISE EXCEPTION 'duplicate key value violates unique constraint "idx_cash_sessions_one_open_per_site"'
USING ERRCODE = '23505', CONSTRAINT = 'idx_cash_sessions_one_open_per_site',
DETAIL = 'Key (site_id)=(' || NEW.site_id::text || ') already exists.';
END IF;
ELSE
IF NEW.user_id IS NULL THEN
RAISE EXCEPTION 'Une session de caisse doit avoir un opérateur' USING ERRCODE = '23514';
END IF;
IF EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.user_id = NEW.user_id AND cs.status = 'open' AND cs.id <> NEW.id) THEN
RAISE EXCEPTION 'Vous avez déjà une session de caisse ouverte. Clôturez-la avant d''en ouvrir une autre.' USING ERRCODE = '23505';
END IF;
END IF;
END IF;

IF TG_OP = 'UPDATE' AND v_uid IS NOT NULL
AND COALESCE(current_setting('waarwi.cs_close_session', true), '') <> OLD.id::text
AND public._cs_multi_enabled(OLD.tenant_id) THEN
SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
FROM jsonb_each(to_jsonb(NEW)) n
WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key)
AND n.key NOT IN ('theoretical_amount', 'updated_at');
IF v_changed IS NOT NULL THEN
RAISE EXCEPTION 'En mode multi-caisse, une session ne peut être modifiée que par les opérations de caisse (%)', array_to_string(v_changed, ', ')
USING ERRCODE = '42501';
END IF;
IF NEW.theoretical_amount IS DISTINCT FROM OLD.theoretical_amount
AND (OLD.user_id IS DISTINCT FROM v_uid OR OLD.status <> 'open')
AND NOT (OLD.status = 'open' AND public._cs_supervision_active(OLD.id, OLD.site_id)) THEN
RAISE EXCEPTION 'Cette session de caisse appartient à un autre opérateur' USING ERRCODE = '42501';
END IF;
END IF;
RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public._cs_record_customer_withdrawal(p_cash_session_id uuid, p_site_id uuid, p_amount numeric, p_reason text, p_note text, p_reference text, p_customer_id uuid, p_payment_method_id uuid, p_method_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
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
WHERE cs.id = p_cash_session_id AND cs.tenant_id = v_tenant
AND (cs.user_id = v_uid OR public._cs_supervision_active(cs.id, cs.site_id))
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

-- Opens a supervised operation: all checks, lock, idempotent replay, then the transaction-local marker.
CREATE OR REPLACE FUNCTION public._cs_supervision_begin(p_session_id uuid, p_operation text, p_permissions text[], p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_uid uuid := auth.uid();
v_tenant uuid := public.current_tenant_id();
v_s record;
v_perm text;
v_key uuid;
v_prev record;
BEGIN
IF v_uid IS NULL OR v_tenant IS NULL THEN
RAISE EXCEPTION 'Vous n''avez pas l''autorisation de superviser cette caisse.' USING ERRCODE = '42501';
END IF;
IF NOT public._cs_multi_enabled(v_tenant) THEN
RAISE EXCEPTION 'La supervision des caisses est disponible uniquement en mode multi-caisse.' USING ERRCODE = '42501';
END IF;
IF COALESCE(btrim(p_idempotency_key), '') = '' THEN
RAISE EXCEPTION 'Clé d''idempotence obligatoire' USING ERRCODE = '22023';
END IF;

SELECT cs.id, cs.site_id, cs.user_id, cs.status, cs.cash_register_id,
  r.tenant_id AS reg_tenant, r.site_id AS reg_site
INTO v_s
FROM cash_sessions cs
LEFT JOIN cash_registers r ON r.id = cs.cash_register_id
WHERE cs.id = p_session_id AND cs.tenant_id = v_tenant
FOR NO KEY UPDATE OF cs;
IF NOT FOUND THEN
RAISE EXCEPTION 'Session de caisse introuvable' USING ERRCODE = '42501';
END IF;
IF NOT public._cs_profile_can_supervise_site(v_uid, v_s.site_id) THEN
RAISE EXCEPTION 'Vous n''avez pas l''autorisation de superviser cette caisse.' USING ERRCODE = '42501';
END IF;
FOREACH v_perm IN ARRAY p_permissions LOOP
IF NOT public._cr_profile_has_permission(v_uid, v_perm) THEN
RAISE EXCEPTION 'Permission refusée pour cette opération (%)', v_perm USING ERRCODE = '42501';
END IF;
END LOOP;
IF v_s.reg_tenant IS DISTINCT FROM v_tenant OR v_s.reg_site IS DISTINCT FROM v_s.site_id THEN
RAISE EXCEPTION 'Caisse incohérente avec la session' USING ERRCODE = '42501';
END IF;

v_key := md5('cs_sup:' || p_operation || ':' || v_uid::text || ':' || btrim(p_idempotency_key))::uuid;
PERFORM pg_advisory_xact_lock(hashtextextended(v_key::text, 0));
SELECT csr.cash_session_id, csr.result INTO v_prev
FROM cash_supervision_requests csr WHERE csr.tenant_id = v_tenant AND csr.request_key = v_key;
IF FOUND THEN
IF v_prev.cash_session_id IS DISTINCT FROM p_session_id THEN
RAISE EXCEPTION 'Requête déjà utilisée pour une autre session' USING ERRCODE = '23505';
END IF;
RETURN jsonb_build_object('replayed', true, 'result', v_prev.result);
END IF;

IF v_s.status <> 'open' THEN
RAISE EXCEPTION 'Cette session de caisse est clôturée' USING ERRCODE = '42501';
END IF;

PERFORM set_config('waarwi.cs_supervised_session', p_session_id::text, true);
RETURN jsonb_build_object('replayed', false, 'key', v_key, 'site_id', v_s.site_id,
  'owner_id', v_s.user_id, 'cash_register_id', v_s.cash_register_id);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._cs_supervision_begin(uuid, text, text[], text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._cs_supervision_end(p_session_id uuid, p_operation text, p_ctx jsonb, p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_uid uuid := auth.uid();
v_tenant uuid := public.current_tenant_id();
BEGIN
PERFORM set_config('waarwi.cs_supervised_session', '', true);
INSERT INTO cash_supervision_requests (tenant_id, request_key, cash_session_id, site_id, operation, actor_id, owner_id, result)
VALUES (v_tenant, (p_ctx->>'key')::uuid, p_session_id, (p_ctx->>'site_id')::uuid, p_operation, v_uid,
  (p_ctx->>'owner_id')::uuid, p_result);
INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
VALUES (v_tenant, v_uid, 'cash_session_supervised_' || p_operation, 'cash_registers', p_session_id,
  jsonb_build_object('owner', p_ctx->>'owner_id', 'cash_register_id', p_ctx->>'cash_register_id'), p_result);
RETURN p_result || jsonb_build_object('replayed', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public._cs_supervision_end(uuid, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.cash_supervision_sessions();
CREATE OR REPLACE FUNCTION public.cash_supervision_sessions(p_scope text DEFAULT 'open')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_uid uuid := auth.uid();
v_tenant uuid := public.current_tenant_id();
v_multi boolean;
v_settings jsonb;
v_rights jsonb;
v_rows jsonb;
BEGIN
IF v_uid IS NULL OR v_tenant IS NULL THEN
RAISE EXCEPTION 'Vous n''avez pas l''autorisation de superviser cette caisse.' USING ERRCODE = '42501';
END IF;
v_multi := public._cs_multi_enabled(v_tenant);
IF NOT v_multi OR NOT public._cs_profile_is_elevated(v_uid) THEN
RETURN jsonb_build_object('multi_enabled', v_multi, 'can_supervise', false, 'rights', '{}'::jsonb, 'sessions', '[]'::jsonb);
END IF;
SELECT COALESCE(t.settings, '{}'::jsonb) INTO v_settings FROM tenants t WHERE t.id = v_tenant;
v_rights := jsonb_build_object(
  'movement', public._cr_profile_has_permission(v_uid, 'pos_cash_movement'),
  'withdrawal', public._cr_profile_has_permission(v_uid, 'pos_cash_movement')
    AND public._cr_profile_has_permission(v_uid, 'pos_customer_withdrawal')
    AND COALESCE(v_settings->>'enable_customer_withdrawals', '') = 'true',
  'loan', public._cr_profile_has_permission(v_uid, 'pos_cash_movement')
    AND public._cr_profile_has_permission(v_uid, 'pos_customer_loan')
    AND COALESCE(v_settings->>'enable_customer_loans', '') = 'true',
  'customer_payment', public._cr_profile_has_permission(v_uid, 'access_pos'),
  'returns', public._cr_profile_has_permission(v_uid, 'pos_returns'),
  'close', public._cr_profile_has_permission(v_uid, 'manage_cash_sessions')
    AND public._cr_profile_has_permission(v_uid, 'pos_close_session'),
  'reprint', public._cr_profile_has_permission(v_uid, 'pos_reprint'),
  'stats', public._cr_profile_has_permission(v_uid, 'pos_view_session_stats'),
  'summary', public._cr_profile_has_permission(v_uid, 'pos_view_session_summary'),
  'x_report', public._cr_profile_has_permission(v_uid, 'pos_view_x_report')
);

SELECT COALESCE(jsonb_agg(row_data ORDER BY sort_site, sort_reg, sort_at DESC), '[]'::jsonb)
INTO v_rows
FROM (
  SELECT jsonb_build_object(
    'id', cs.id, 'site_id', cs.site_id, 'site_name', s.name,
    'cash_register_id', cs.cash_register_id, 'register_name', r.name, 'register_code', r.code,
    'user_id', cs.user_id, 'operator_name', COALESCE(NULLIF(p.full_name, ''), p.email, 'Opérateur'),
    'status', cs.status, 'opened_at', cs.opened_at, 'closed_at', cs.closed_at,
    'opening_amount', cs.opening_amount, 'theoretical_amount', cs.theoretical_amount,
    'closed_by_name', COALESCE(NULLIF(pc.full_name, ''), pc.email)
  ) AS row_data, s.name AS sort_site, r.name AS sort_reg, COALESCE(cs.closed_at, cs.opened_at) AS sort_at
  FROM cash_sessions cs
  JOIN cash_registers r ON r.id = cs.cash_register_id AND r.tenant_id = cs.tenant_id AND r.site_id = cs.site_id
  JOIN sites s ON s.id = cs.site_id AND s.tenant_id = cs.tenant_id
  LEFT JOIN profiles p ON p.id = cs.user_id
  LEFT JOIN profiles pc ON pc.id = cs.closed_by
  WHERE cs.tenant_id = v_tenant
    AND cs.user_id IS DISTINCT FROM v_uid
    AND public._cs_profile_can_supervise_site(v_uid, cs.site_id)
    AND CASE WHEN p_scope = 'closed'
      THEN cs.status <> 'open' AND cs.closed_at >= now() - interval '30 days'
      ELSE cs.status = 'open' END
  ORDER BY COALESCE(cs.closed_at, cs.opened_at) DESC
  LIMIT 200
) q;

RETURN jsonb_build_object('multi_enabled', true, 'can_supervise', true, 'rights', v_rights, 'sessions', v_rows);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cash_supervision_sessions(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_supervision_sessions(text) TO authenticated;

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
IF p_expense_category_id IS NULL THEN RAISE EXCEPTION 'Catégorie de dépense obligatoire' USING ERRCODE = '22023'; END IF;
IF NOT public.is_expense_category_available_for_site(p_expense_category_id, v_site) THEN
RAISE EXCEPTION 'Catégorie de dépense indisponible pour ce magasin' USING ERRCODE = '42501';
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

CREATE OR REPLACE FUNCTION public.cash_supervision_customer_payment(
  p_session_id uuid, p_customer_id uuid, p_sale_id uuid, p_payment_method_id uuid, p_method_name text,
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

IF p_sale_id IS NULL THEN
v_res := public.register_customer_balance_payment(p_customer_id, p_payment_method_id, p_method_name, p_amount,
  p_reference, p_session_id, 'sup:' || (v_ctx->>'key'));
ELSE
IF NOT EXISTS (SELECT 1 FROM sales s WHERE s.id = p_sale_id AND s.tenant_id = v_tenant
  AND s.customer_id = p_customer_id AND s.status <> 'cancelled') THEN
RAISE EXCEPTION 'Facture introuvable pour ce client' USING ERRCODE = '42501';
END IF;
v_res := public.register_customer_payment(p_customer_id, p_payment_method_id, p_method_name, p_amount,
  p_reference, p_session_id, p_sale_id);
END IF;
RETURN public._cs_supervision_end(p_session_id, 'customer_payment', v_ctx,
  COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('customer_id', p_customer_id, 'sale_id', p_sale_id, 'amount', p_amount));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cash_supervision_customer_payment(uuid, uuid, uuid, uuid, text, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_supervision_customer_payment(uuid, uuid, uuid, uuid, text, numeric, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_supervision_sale_return(
  p_session_id uuid, p_sale_id uuid, p_items jsonb, p_reason text, p_refund_method text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_tenant uuid := public.current_tenant_id();
v_ctx jsonb; v_res jsonb; v_site uuid; v_sale record;
BEGIN
v_ctx := public._cs_supervision_begin(p_session_id, 'sale_return', ARRAY['pos_returns'], p_idempotency_key);
IF (v_ctx->>'replayed')::boolean THEN RETURN (v_ctx->'result') || jsonb_build_object('replayed', true); END IF;
v_site := (v_ctx->>'site_id')::uuid;

SELECT s.id, s.cash_session_id INTO v_sale FROM sales s
WHERE s.id = p_sale_id AND s.tenant_id = v_tenant AND s.site_id = v_site;
IF NOT FOUND THEN
RAISE EXCEPTION 'Vente introuvable dans ce magasin' USING ERRCODE = '42501';
END IF;

v_res := public.process_sale_return(p_sale_id, v_site, p_session_id, p_items, p_reason, true, true,
  'sup:' || (v_ctx->>'key'), p_refund_method);
RETURN public._cs_supervision_end(p_session_id, 'sale_return', v_ctx,
  COALESCE(v_res, '{}'::jsonb) || jsonb_build_object('sale_id', p_sale_id, 'original_session_id', v_sale.cash_session_id));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cash_supervision_sale_return(uuid, uuid, jsonb, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_supervision_sale_return(uuid, uuid, jsonb, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_supervision_add_regularization(
  p_session_id uuid, p_reg_type text, p_amount numeric, p_reason text, p_note text, p_idempotency_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_tenant uuid := public.current_tenant_id();
v_ctx jsonb; v_id uuid;
BEGIN
v_ctx := public._cs_supervision_begin(p_session_id, 'regularization', ARRAY['manage_cash_sessions', 'pos_close_session'], p_idempotency_key);
IF (v_ctx->>'replayed')::boolean THEN RETURN (v_ctx->'result') || jsonb_build_object('replayed', true); END IF;
IF p_reg_type IS NULL OR p_reg_type NOT IN ('excedent', 'manquant', 'depot', 'retrait') THEN
RAISE EXCEPTION 'Type de régularisation invalide' USING ERRCODE = '22023';
END IF;
IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide' USING ERRCODE = '22023'; END IF;
INSERT INTO cash_regularizations (tenant_id, cash_session_id, reg_type, amount, reason, note, user_id)
VALUES (v_tenant, p_session_id, p_reg_type, p_amount, p_reason, p_note, auth.uid())
RETURNING id INTO v_id;
RETURN public._cs_supervision_end(p_session_id, 'regularization', v_ctx,
  jsonb_build_object('regularization_id', v_id, 'reg_type', p_reg_type, 'amount', p_amount));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cash_supervision_add_regularization(uuid, text, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_supervision_add_regularization(uuid, text, numeric, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_supervision_delete_regularization(p_session_id uuid, p_regularization_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_tenant uuid := public.current_tenant_id();
v_ctx jsonb; v_reg record;
BEGIN
v_ctx := public._cs_supervision_begin(p_session_id, 'regularization_delete', ARRAY['manage_cash_sessions', 'pos_close_session'], p_regularization_id::text);
IF (v_ctx->>'replayed')::boolean THEN RETURN (v_ctx->'result') || jsonb_build_object('replayed', true); END IF;
SELECT r.id, r.reg_type, r.amount INTO v_reg FROM cash_regularizations r
WHERE r.id = p_regularization_id AND r.tenant_id = v_tenant AND r.cash_session_id = p_session_id
FOR UPDATE;
IF NOT FOUND THEN RAISE EXCEPTION 'Régularisation introuvable pour cette session' USING ERRCODE = '42501'; END IF;
DELETE FROM cash_regularizations WHERE id = v_reg.id;
RETURN public._cs_supervision_end(p_session_id, 'regularization_delete', v_ctx,
  jsonb_build_object('regularization_id', v_reg.id, 'reg_type', v_reg.reg_type, 'amount', v_reg.amount));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cash_supervision_delete_regularization(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_supervision_delete_regularization(uuid, uuid) TO authenticated;
