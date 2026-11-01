/*
# MC1-D.2 - Encaissements sans session (correction finale)

Corrige uniquement les defauts constates par MC1-D.1V. Aucun effet quand
multi_cash_enabled = false : chaque nouveau controle commence par ce test.

1. Nouvelle fonction `_cs_cash_write_guard(session, site)` (SECURITY DEFINER)
   - Appelee par record_cash_movement (qui s'execute avec les droits de l'appelant).
   - Mode desactive : retourne false, ne fait rien.
   - Mode active : session NULL refusee (message commun, 42501), sinon
     _cs_assert_operational (session personnelle, ouverte, bon tenant, bon magasin).
   - EXECUTE : authenticated et service_role uniquement.

2. record_cash_movement
   - Appel du garde avant toute ecriture.
   - En mode active, l'acompte cree porte cash_session_id et cash_movement_id.

3. register_customer_balance_payment
   - En mode active : session obligatoire + _cs_assert_operational avant toute ecriture
     (apres le controle d'idempotence, qui n'ecrit rien).

4. register_sale_payment, register_customer_payment, register_supplier_payment, cancel_sale(5 args)
   - En mode active seulement : message commun pour la session manquante.
   - cancel_sale refund_cash : en mode active, _cs_assert_operational avant toute modification.
   - Formats conserves (exception ou JSON d'erreur selon la fonction), signatures inchangees.

5. customer_prepayments
   - Politiques RESTRICTIVE mc1d1 remplacees par mc1d2 :
     SELECT : session visible ; session NULL => profil eleve, client de ses magasins.
     INSERT : session obligatoire et personnelle.
     UPDATE : session personnelle ; session NULL => profil eleve.
   - Nouveau trigger : cash_session_id immuable en mode active.

## Methode
Les fonctions existantes sont modifiees a partir de leur definition deployee
(pg_get_functiondef) par remplacements exacts ; chaque remplacement verifie son
nombre d'occurrences et fait echouer la migration sinon.

## Notes
1. Aucun backfill : les acomptes historiques sans session restent NULL.
2. Aucune permission metier ni donnee existante modifiee.
3. L'imputation des acomptes (apply_customer_prepayments, SECURITY DEFINER) est inchangee.
*/

CREATE OR REPLACE FUNCTION public._cs_cash_write_guard(p_session_id uuid, p_site_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_tenant uuid := public.current_tenant_id();
BEGIN
IF v_tenant IS NULL OR NOT public._cs_multi_enabled(v_tenant) THEN RETURN false; END IF;
IF auth.uid() IS NULL THEN RETURN true; END IF;
IF p_session_id IS NULL THEN
RAISE EXCEPTION 'Ouvrez votre caisse avant d''enregistrer cet encaissement.' USING ERRCODE = '42501';
END IF;
PERFORM public._cs_assert_operational(p_session_id, v_tenant, p_site_id);
RETURN true;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._cs_cash_write_guard(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._cs_cash_write_guard(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._trg_cs_prepay_session_immutable()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
IF auth.uid() IS NULL THEN RETURN NEW; END IF;
IF NOT public._cs_multi_enabled(NEW.tenant_id) THEN RETURN NEW; END IF;
IF NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id THEN
RAISE EXCEPTION 'Le rattachement d''un acompte à sa session de caisse ne peut pas être modifié' USING ERRCODE = '42501';
END IF;
RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public._trg_cs_prepay_session_immutable() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cs_prepay_session_immutable ON public.customer_prepayments;
CREATE TRIGGER trg_cs_prepay_session_immutable
BEFORE UPDATE OF cash_session_id ON public.customer_prepayments
FOR EACH ROW EXECUTE FUNCTION public._trg_cs_prepay_session_immutable();

CREATE OR REPLACE FUNCTION pg_temp.mc1d2_patch(p_sig regprocedure, p_old text, p_new text, p_expected int)
RETURNS void LANGUAGE plpgsql AS $p$
DECLARE d text; n int;
BEGIN
d := pg_get_functiondef(p_sig);
IF position(p_new in d) > 0 AND p_old <> p_new AND position(p_old in d) = 0 THEN RETURN; END IF;
n := (length(d) - length(replace(d, p_old, ''))) / length(p_old);
IF n <> p_expected THEN
RAISE EXCEPTION 'mc1d2: % occurrence(s) au lieu de % dans %', n, p_expected, p_sig;
END IF;
EXECUTE replace(d, p_old, p_new);
END;
$p$;

-- 1. record_cash_movement
SELECT pg_temp.mc1d2_patch('public.record_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid,uuid,text,uuid)',
$q$v_remaining numeric; v_prepay record; v_take numeric; v_credit_limit numeric;
BEGIN$q$,
$q$v_remaining numeric; v_prepay record; v_take numeric; v_credit_limit numeric;
v_multi boolean;
BEGIN$q$, 1);

SELECT pg_temp.mc1d2_patch('public.record_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid,uuid,text,uuid)',
$q$IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

IF p_kind IN$q$,
$q$IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Montant invalide'; END IF;

v_multi := public._cs_cash_write_guard(p_cash_session_id, p_site_id);

IF p_kind IN$q$, 1);

SELECT pg_temp.mc1d2_patch('public.record_cash_movement(uuid,uuid,text,numeric,text,text,text,uuid,uuid,text,uuid)',
$q$INSERT INTO customer_prepayments (tenant_id, customer_id, amount, amount_used, method_name, reference)
VALUES (v_tenant_id, p_customer_id, p_amount, 0, p_method_name, p_reference)$q$,
$q$INSERT INTO customer_prepayments (tenant_id, customer_id, amount, amount_used, method_name, reference, cash_movement_id, cash_session_id)
VALUES (v_tenant_id, p_customer_id, p_amount, 0, p_method_name, p_reference,
CASE WHEN v_multi THEN v_movement_id END, CASE WHEN v_multi THEN p_cash_session_id END)$q$, 1);

-- 2. register_customer_balance_payment
SELECT pg_temp.mc1d2_patch('public.register_customer_balance_payment(uuid,uuid,text,numeric,text,uuid,text)',
$q$-- Lock customer
$q$,
$q$IF public._cs_multi_enabled(v_tenant_id) THEN
IF p_cash_session_id IS NULL THEN
RAISE EXCEPTION 'Ouvrez votre caisse avant d''enregistrer cet encaissement.' USING ERRCODE = '42501';
END IF;
PERFORM public._cs_assert_operational(p_cash_session_id, v_tenant_id, NULL);
END IF;

-- Lock customer
$q$, 1);

-- 3. Messages de session manquante (mode active uniquement)
SELECT pg_temp.mc1d2_patch(s::regprocedure,
$q$RAISE EXCEPTION 'La caisse doit être ouverte d''abord'$q$,
$q$RAISE EXCEPTION '%', CASE WHEN public._cs_multi_current() THEN 'Ouvrez votre caisse avant d''enregistrer cet encaissement.' ELSE 'La caisse doit être ouverte d''abord' END$q$, 2)
FROM unnest(ARRAY[
'public.register_sale_payment(uuid,uuid,text,numeric,text,uuid)',
'public.register_customer_payment(uuid,uuid,text,numeric,text,uuid,uuid)',
'public.register_supplier_payment(uuid,uuid,text,numeric,text,uuid,uuid,boolean)']) s;

-- 4. cancel_sale refund_cash
SELECT pg_temp.mc1d2_patch('public.cancel_sale(uuid,uuid,text,text,uuid)',
$q$RETURN jsonb_build_object('success', false, 'error', 'Aucune session de caisse ouverte : remboursement impossible.', 'requires_open_session', true);$q$,
$q$RETURN jsonb_build_object('success', false, 'error', CASE WHEN public._cs_multi_current() THEN 'Ouvrez votre caisse avant d''enregistrer cet encaissement.' ELSE 'Aucune session de caisse ouverte : remboursement impossible.' END, 'requires_open_session', true);$q$, 1);

SELECT pg_temp.mc1d2_patch('public.cancel_sale(uuid,uuid,text,text,uuid)',
$q$'La session de caisse indiquée n''est pas ouverte pour ce point de vente : remboursement impossible.', 'requires_open_session', true);
END IF;
$q$,
$q$'La session de caisse indiquée n''est pas ouverte pour ce point de vente : remboursement impossible.', 'requires_open_session', true);
END IF;
IF public._cs_multi_enabled(v_tenant_id) THEN
PERFORM public._cs_assert_operational(p_cash_session_id, v_tenant_id, v_sale.site_id);
END IF;
$q$, 1);

DROP FUNCTION pg_temp.mc1d2_patch(regprocedure, text, text, int);

-- 5. customer_prepayments
DROP POLICY IF EXISTS "mc1d1 select" ON public.customer_prepayments;
DROP POLICY IF EXISTS "mc1d1 insert" ON public.customer_prepayments;
DROP POLICY IF EXISTS "mc1d1 update" ON public.customer_prepayments;
DROP POLICY IF EXISTS "mc1d2 select" ON public.customer_prepayments;
DROP POLICY IF EXISTS "mc1d2 insert" ON public.customer_prepayments;
DROP POLICY IF EXISTS "mc1d2 update" ON public.customer_prepayments;

CREATE POLICY "mc1d2 select" ON public.customer_prepayments AS RESTRICTIVE FOR SELECT TO authenticated
USING (
(SELECT NOT public._cs_multi_current()) OR
CASE WHEN cash_session_id IS NOT NULL
THEN cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs)
ELSE (SELECT public._cs_is_elevated()) AND EXISTS (
SELECT 1 FROM public.customers c WHERE c.id = customer_prepayments.customer_id
AND (c.site_id IS NULL OR c.site_id = ANY ((SELECT public._cs_supervised_site_ids())::uuid[])))
END);

CREATE POLICY "mc1d2 insert" ON public.customer_prepayments AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (
(SELECT NOT public._cs_multi_current()) OR
(cash_session_id IS NOT NULL AND cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid())));

CREATE POLICY "mc1d2 update" ON public.customer_prepayments AS RESTRICTIVE FOR UPDATE TO authenticated
USING (
(SELECT NOT public._cs_multi_current()) OR
CASE WHEN cash_session_id IS NOT NULL
THEN cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid())
ELSE (SELECT public._cs_is_elevated()) END)
WITH CHECK (
(SELECT NOT public._cs_multi_current()) OR
CASE WHEN cash_session_id IS NOT NULL
THEN cash_session_id IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid())
ELSE (SELECT public._cs_is_elevated()) END);
