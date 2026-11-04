/*
# MC1F — Supervision administrative des caisses affectées

## Résumé
Permet à un profil autorisé (administrateur du tenant, ou gérant habilité sur le magasin) de
superviser la session ouverte d'un autre opérateur SANS ouvrir de session ni changer le propriétaire :
consultation, dépense de caisse (point d'entrée dédié) et clôture (chemin existant `cash_session_close`).

## 1. Colonnes ajoutées (traçabilité, forward-only, aucun historique réattribué)
- `cash_sessions.closed_by` (uuid, nullable) : auteur réel de la clôture. Renseigné uniquement par trigger
  au passage open -> closed ; immuable ensuite ; les sessions déjà clôturées restent NULL.
- `cash_movements.request_id` (uuid, nullable) + index unique partiel (tenant_id, request_id) :
  anti double-soumission des dépenses supervisées.

## 2. Fonctions
- `_cs_assert_operational` : même contrôle qu'avant ; ajoute UNE exception étroite : si le drapeau
  transactionnel `waarwi.cs_supervised_expense` vaut exactement l'id de la session ET que l'appelant
  supervise le magasin, les contrôles propriétaire/affectation sont levés — les contrôles tenant, statut
  ouvert, magasin, cohérence caisse et caisse active restent appliqués. Le drapeau n'est posé que par
  `cash_supervision_record_expense`, puis remis à vide immédiatement après l'écriture.
- `cash_supervision_sessions()` : liste des sessions ouvertes d'autres opérateurs sur les magasins supervisés.
- `cash_supervision_record_expense(...)` : dépense sur la session supervisée ; réutilise `record_cash_movement`
  (même calcul du solde théorique, même ligne de mouvement, même traitement comptable) ; `user_id` = superviseur.
- `_trg_cs_closed_by()` : trigger de traçabilité du clôtureur.

## 3. Sécurité
- Aucune permission ni affectation modifiée. Aucun contournement pour vente, encaissement, remboursement.
- Nouvelles RPC : EXECUTE révoqué à PUBLIC/anon, accordé à authenticated uniquement.
- Supervision disponible uniquement en mode multi-caisses (mode désactivé inchangé).
*/

ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS closed_by uuid;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS cash_movements_tenant_request_uidx
  ON public.cash_movements (tenant_id, request_id) WHERE request_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._trg_cs_closed_by()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.closed_by := NULL;
  ELSIF OLD.status = 'open' AND NEW.status = 'closed' THEN
    NEW.closed_by := auth.uid();
  ELSE
    NEW.closed_by := OLD.closed_by;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._trg_cs_closed_by() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_cs_closed_by ON public.cash_sessions;
CREATE TRIGGER trg_cs_closed_by BEFORE INSERT OR UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public._trg_cs_closed_by();

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
IF COALESCE(current_setting('waarwi.cs_supervised_expense', true), '') = p_session_id::text
AND public._cs_profile_can_supervise_site(v_uid, v_s.site_id) THEN
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

CREATE OR REPLACE FUNCTION public.cash_supervision_sessions()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_uid uuid := auth.uid();
v_tenant uuid := public.current_tenant_id();
v_multi boolean;
v_admin boolean;
v_exp boolean;
v_close boolean;
v_rows jsonb;
BEGIN
IF v_uid IS NULL OR v_tenant IS NULL THEN
RAISE EXCEPTION 'Vous n''avez pas l''autorisation de superviser cette caisse.' USING ERRCODE = '42501';
END IF;
v_multi := public._cs_multi_enabled(v_tenant);
IF NOT v_multi OR NOT public._cs_profile_is_elevated(v_uid) THEN
RETURN jsonb_build_object('multi_enabled', v_multi, 'can_supervise', false, 'sessions', '[]'::jsonb);
END IF;
v_admin := public._cr_profile_is_tenant_admin(v_uid);
v_exp := public._cr_profile_has_permission(v_uid, 'pos_cash_movement')
  AND (v_admin OR public._cr_profile_has_permission(v_uid, 'manage_cash_sessions'));
v_close := v_admin OR (public._cr_profile_has_permission(v_uid, 'manage_cash_sessions')
  AND public._cr_profile_has_permission(v_uid, 'pos_close_session'));

SELECT COALESCE(jsonb_agg(jsonb_build_object(
  'id', cs.id, 'site_id', cs.site_id, 'site_name', s.name,
  'cash_register_id', cs.cash_register_id, 'register_name', r.name, 'register_code', r.code,
  'user_id', cs.user_id, 'operator_name', COALESCE(NULLIF(p.full_name, ''), p.email, 'Opérateur'),
  'opened_at', cs.opened_at, 'opening_amount', cs.opening_amount,
  'can_expense', v_exp, 'can_close', v_close
) ORDER BY s.name, r.name, cs.opened_at), '[]'::jsonb)
INTO v_rows
FROM cash_sessions cs
JOIN cash_registers r ON r.id = cs.cash_register_id AND r.tenant_id = cs.tenant_id AND r.site_id = cs.site_id
JOIN sites s ON s.id = cs.site_id AND s.tenant_id = cs.tenant_id
LEFT JOIN profiles p ON p.id = cs.user_id
WHERE cs.tenant_id = v_tenant AND cs.status = 'open' AND cs.user_id IS DISTINCT FROM v_uid
  AND public._cs_profile_can_supervise_site(v_uid, cs.site_id);

RETURN jsonb_build_object('multi_enabled', true, 'can_supervise', true, 'sessions', v_rows);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cash_supervision_sessions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_supervision_sessions() TO authenticated;

CREATE OR REPLACE FUNCTION public.cash_supervision_record_expense(
  p_session_id uuid, p_amount numeric, p_expense_category_id uuid DEFAULT NULL,
  p_reason text DEFAULT '', p_note text DEFAULT '', p_reference text DEFAULT '',
  p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
v_uid uuid := auth.uid();
v_tenant uuid := public.current_tenant_id();
v_key uuid;
v_existing record;
v_s record;
v_reason text;
v_res jsonb;
v_mid uuid;
BEGIN
IF v_uid IS NULL OR v_tenant IS NULL THEN
RAISE EXCEPTION 'Vous n''avez pas l''autorisation de superviser cette caisse.' USING ERRCODE = '42501';
END IF;
IF NOT public._cs_multi_enabled(v_tenant) THEN
RAISE EXCEPTION 'La supervision de caisse n''est disponible qu''en mode multi-caisses.' USING ERRCODE = '42501';
END IF;
IF COALESCE(btrim(p_idempotency_key), '') = '' THEN
RAISE EXCEPTION 'Clé d''idempotence obligatoire' USING ERRCODE = '22023';
END IF;
v_key := md5('cs_sup_expense:' || v_uid::text || ':' || btrim(p_idempotency_key))::uuid;
PERFORM pg_advisory_xact_lock(hashtextextended(v_key::text, 0));

SELECT id, cash_session_id INTO v_existing FROM cash_movements
WHERE tenant_id = v_tenant AND request_id = v_key;
IF FOUND THEN
  IF v_existing.cash_session_id IS DISTINCT FROM p_session_id THEN
    RAISE EXCEPTION 'Clé d''idempotence déjà utilisée pour une autre session' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('movement_id', v_existing.id, 'replayed', true);
END IF;

SELECT cs.id, cs.tenant_id, cs.site_id, cs.user_id, cs.status,
  r.is_active AS reg_active, r.site_id AS reg_site, r.tenant_id AS reg_tenant
INTO v_s
FROM cash_sessions cs LEFT JOIN cash_registers r ON r.id = cs.cash_register_id
WHERE cs.id = p_session_id
FOR UPDATE OF cs;

IF NOT FOUND OR v_s.tenant_id IS DISTINCT FROM v_tenant
   OR NOT public._cs_profile_can_supervise_site(v_uid, v_s.site_id) THEN
RAISE EXCEPTION 'Vous n''avez pas l''autorisation de superviser cette caisse.' USING ERRCODE = '42501';
END IF;
IF v_s.user_id = v_uid THEN
RAISE EXCEPTION 'Cette session est la vôtre : enregistrez la dépense depuis votre caisse.' USING ERRCODE = '42501';
END IF;
IF v_s.status <> 'open' THEN
RAISE EXCEPTION 'Cette session est clôturée. Aucune dépense ne peut y être enregistrée.' USING ERRCODE = '42501';
END IF;
IF v_s.reg_tenant IS DISTINCT FROM v_tenant OR v_s.reg_site IS DISTINCT FROM v_s.site_id THEN
RAISE EXCEPTION 'Caisse incohérente avec la session' USING ERRCODE = '42501';
END IF;
IF NOT COALESCE(v_s.reg_active, false) THEN
RAISE EXCEPTION 'Cette caisse est désactivée' USING ERRCODE = '42501';
END IF;
IF NOT (public._cr_profile_has_permission(v_uid, 'pos_cash_movement')
  AND (public._cr_profile_is_tenant_admin(v_uid) OR public._cr_profile_has_permission(v_uid, 'manage_cash_sessions'))) THEN
RAISE EXCEPTION 'Vous n''avez pas la permission d''enregistrer une dépense sur cette caisse.' USING ERRCODE = '42501';
END IF;
IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000 THEN
RAISE EXCEPTION 'Montant invalide' USING ERRCODE = '22023';
END IF;

IF p_expense_category_id IS NOT NULL THEN
  IF NOT public.is_expense_category_available_for_site(p_expense_category_id, v_s.site_id) THEN
    RAISE EXCEPTION 'Type de dépense indisponible pour ce magasin' USING ERRCODE = '22023';
  END IF;
  SELECT name INTO v_reason FROM expense_categories WHERE id = p_expense_category_id AND tenant_id = v_tenant;
ELSE
  IF EXISTS (SELECT 1 FROM expense_categories ec WHERE ec.tenant_id = v_tenant
             AND public.is_expense_category_available_for_site(ec.id, v_s.site_id)) THEN
    RAISE EXCEPTION 'Sélectionnez un type de dépense' USING ERRCODE = '22023';
  END IF;
  v_reason := btrim(COALESCE(p_reason, ''));
  IF v_reason = '' THEN RAISE EXCEPTION 'Motif obligatoire' USING ERRCODE = '22023'; END IF;
END IF;

PERFORM set_config('waarwi.cs_supervised_expense', p_session_id::text, true);
v_res := public.record_cash_movement(p_session_id, v_s.site_id, 'expense', p_amount, v_reason,
  left(COALESCE(p_note, ''), 1000), left(COALESCE(p_reference, ''), 200), NULL, NULL, '', p_expense_category_id);
PERFORM set_config('waarwi.cs_supervised_expense', '', true);

v_mid := NULLIF(v_res ->> 'movement_id', '')::uuid;
IF v_mid IS NULL THEN RAISE EXCEPTION 'Dépense non enregistrée'; END IF;
UPDATE cash_movements SET request_id = v_key WHERE id = v_mid;

INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
VALUES (v_tenant, v_uid, 'cash_session_supervised_expense', 'cash_registers', p_session_id,
  jsonb_build_object('owner', v_s.user_id),
  jsonb_build_object('movement_id', v_mid, 'amount', p_amount, 'expense_category_id', p_expense_category_id));

RETURN jsonb_build_object('movement_id', v_mid, 'replayed', false);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.cash_supervision_record_expense(uuid, numeric, uuid, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cash_supervision_record_expense(uuid, numeric, uuid, text, text, text, text) TO authenticated;