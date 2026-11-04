/*
# Ouverture de caisse : respect strict des affectations (mode multi-caisse)

1. Constat
   - `cash_session_open` s'appuyait sur `_cs_profile_can_use_register`, qui laisse passer
     les profils élevés (admin / responsable) même sans affectation.
   - `cash_pos_context` présentait donc ces caisses comme ouvrables.

2. Nouvelles fonctions internes (non appelables par les clients)
   - `_cs_register_assignee_names(register)` : noms des collaborateurs activement affectés
     (affectation active, profil actif du même tenant, ayant accès au magasin de la caisse),
     formatés « A », « A et B », « A, B et C ». Sans nom : « un autre collaborateur ».
     Retourne NULL si la caisse n'a aucune affectation active.
   - `_cs_profile_is_assigned_to_register(profil, caisse)` : affectation active de ce profil.

3. Fonctions modifiées (mêmes signatures)
   - `cash_session_open` : en mode multi-caisse uniquement, si la caisse a des affectations
     actives et que l'appelant n'en fait pas partie, refus 42501
     « Cette caisse est assignée à X. Vous ne pouvez pas l'ouvrir. », y compris pour un
     profil élevé. Contrôle effectué avant toute création de session, après les verrous
     et le contrôle d'idempotence existants. Une session déjà ouverte par l'appelant sur
     cette caisse reste récupérable.
   - `cash_pos_context` : chaque caisse expose `assigned_to` (noms ou null) et `locked`
     (true si l'appelant ne peut pas l'ouvrir à cause des affectations).

4. Inchangé
   - Mode multi-caisse désactivé : comportement historique.
   - Caisses sans affectation active : règles actuelles.
   - `_cs_profile_can_use_register` (utilisé aussi pour les sessions existantes), politiques,
     triggers, permissions, affectations et données.
*/

CREATE OR REPLACE FUNCTION public._cs_register_assignee_names(p_register_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
WITH n AS (
  SELECT DISTINCT COALESCE(NULLIF(btrim(p.full_name), ''), 'un autre collaborateur') AS nm
  FROM cash_registers r
  JOIN cash_register_assignments a
    ON a.cash_register_id = r.id AND a.tenant_id = r.tenant_id AND a.is_active
  JOIN profiles p
    ON p.id = a.user_id AND p.tenant_id = r.tenant_id AND COALESCE(p.is_active, true)
  WHERE r.id = p_register_id
    AND public._cr_profile_can_access_site(p.id, r.site_id)
), o AS (
  SELECT nm, row_number() OVER (ORDER BY (nm = 'un autre collaborateur'), lower(nm)) AS rn,
         count(*) OVER () AS total
  FROM n
)
SELECT CASE
  WHEN max(total) IS NULL THEN NULL
  WHEN max(total) = 1 THEN max(nm)
  ELSE string_agg(nm, ', ' ORDER BY rn) FILTER (WHERE rn < total)
       || ' et ' || max(nm) FILTER (WHERE rn = total)
END
FROM o;
$function$;

CREATE OR REPLACE FUNCTION public._cs_profile_is_assigned_to_register(p_profile_id uuid, p_register_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT EXISTS (
  SELECT 1 FROM cash_register_assignments a
  JOIN cash_registers r ON r.id = a.cash_register_id AND r.tenant_id = a.tenant_id
  WHERE a.cash_register_id = p_register_id AND a.user_id = p_profile_id AND a.is_active
);
$function$;

REVOKE EXECUTE ON FUNCTION public._cs_register_assignee_names(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._cs_profile_is_assigned_to_register(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cash_session_open(p_cash_register_id uuid, p_opening_amount numeric DEFAULT 0, p_opening_note text DEFAULT ''::text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_me public.profiles;
v_reg record;
v_multi boolean;
v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
v_sid uuid;
v_other record;
v_assignees text;
BEGIN
v_me := public._cr_require_caller();
IF p_opening_amount IS NULL OR p_opening_amount < 0 THEN
RAISE EXCEPTION 'Fonds de caisse invalide' USING ERRCODE = '22023';
END IF;
SELECT r.id, r.site_id, r.is_active, r.code INTO v_reg
FROM cash_registers r WHERE r.id = p_cash_register_id AND r.tenant_id = v_me.tenant_id;
IF NOT FOUND THEN RAISE EXCEPTION 'Caisse introuvable' USING ERRCODE = '42501'; END IF;
IF NOT public._cr_profile_can_access_site(v_me.id, v_reg.site_id) THEN
RAISE EXCEPTION 'Magasin non autorisé' USING ERRCODE = '42501';
END IF;
IF NOT (public._cr_profile_has_permission(v_me.id, 'access_pos')
AND public._cr_profile_has_permission(v_me.id, 'pos_open_session')) THEN
RAISE EXCEPTION 'Vous n''avez pas la permission d''ouvrir une session' USING ERRCODE = '42501';
END IF;

PERFORM public._cs_lock_open_keys(v_me.tenant_id, v_reg.site_id, v_me.id);
v_multi := public._cs_multi_enabled(v_me.tenant_id);

IF v_key IS NOT NULL THEN
SELECT cs.id INTO v_sid FROM cash_sessions cs WHERE cs.user_id = v_me.id AND cs.open_request_id = v_key;
IF FOUND THEN RETURN public._cs_session_payload(v_sid, true); END IF;
END IF;

IF NOT v_multi THEN
SELECT cs.id INTO v_sid FROM cash_sessions cs
WHERE cs.tenant_id = v_me.tenant_id AND cs.site_id = v_reg.site_id AND cs.status = 'open'
ORDER BY cs.opened_at DESC LIMIT 1;
IF FOUND THEN RETURN public._cs_session_payload(v_sid, true); END IF;
ELSE
IF NOT v_reg.is_active THEN
RAISE EXCEPTION 'Cette caisse est désactivée' USING ERRCODE = '42501';
END IF;
v_assignees := public._cs_register_assignee_names(v_reg.id);
IF v_assignees IS NOT NULL
AND NOT public._cs_profile_is_assigned_to_register(v_me.id, v_reg.id)
AND NOT EXISTS (SELECT 1 FROM cash_sessions cs
  WHERE cs.cash_register_id = v_reg.id AND cs.user_id = v_me.id AND cs.status = 'open') THEN
RAISE EXCEPTION 'Cette caisse est assignée à %. Vous ne pouvez pas l''ouvrir.', v_assignees USING ERRCODE = '42501';
END IF;
IF NOT public._cs_profile_can_use_register(v_me.id, v_reg.id) THEN
RAISE EXCEPTION 'Vous n''êtes pas affecté à cette caisse. Contactez votre administrateur.' USING ERRCODE = '42501';
END IF;
SELECT cs.id, cs.cash_register_id, r.code, s.name AS site_name INTO v_other
FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.cash_register_id JOIN sites s ON s.id = cs.site_id
WHERE cs.user_id = v_me.id AND cs.status = 'open'
ORDER BY cs.opened_at DESC LIMIT 1;
IF FOUND THEN
IF v_other.cash_register_id = v_reg.id THEN
RETURN public._cs_session_payload(v_other.id, true);
END IF;
RAISE EXCEPTION 'Vous avez déjà une session ouverte sur % (%). Clôturez-la avant d''ouvrir une autre caisse.', v_other.code, v_other.site_name
USING ERRCODE = '23505';
END IF;
PERFORM 1 FROM cash_registers r WHERE r.id = v_reg.id FOR UPDATE;
IF EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.cash_register_id = v_reg.id AND cs.status = 'open') THEN
RAISE EXCEPTION 'Cette caisse est déjà utilisée par un autre opérateur' USING ERRCODE = '23505';
END IF;
END IF;

INSERT INTO cash_sessions (tenant_id, site_id, cash_register_id, user_id, opening_amount, opening_note, status, open_request_id)
VALUES (v_me.tenant_id, v_reg.site_id, v_reg.id, v_me.id, p_opening_amount, COALESCE(p_opening_note, ''), 'open', v_key)
RETURNING id INTO v_sid;
RETURN public._cs_session_payload(v_sid, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cash_pos_context(p_site_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_me public.profiles;
v_multi boolean;
v_elev boolean;
v_mine uuid;
v_site_sess uuid;
v_other jsonb;
v_regs jsonb;
BEGIN
v_me := public._cr_require_caller();
IF NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = p_site_id AND s.tenant_id = v_me.tenant_id) THEN
RAISE EXCEPTION 'Magasin introuvable' USING ERRCODE = '42501';
END IF;
v_multi := public._cs_multi_enabled(v_me.tenant_id);

IF NOT v_multi THEN
SELECT cs.id INTO v_site_sess FROM cash_sessions cs
WHERE cs.tenant_id = v_me.tenant_id AND cs.site_id = p_site_id AND cs.status = 'open'
ORDER BY cs.opened_at DESC LIMIT 1;
RETURN jsonb_build_object('multi_enabled', false,
'site_session', CASE WHEN v_site_sess IS NOT NULL THEN public._cs_session_payload(v_site_sess, true) END);
END IF;

IF NOT public._cr_profile_can_access_site(v_me.id, p_site_id) THEN
RAISE EXCEPTION 'Magasin non autorisé' USING ERRCODE = '42501';
END IF;
v_elev := public._cs_profile_is_elevated(v_me.id);

SELECT cs.id INTO v_mine FROM cash_sessions cs
WHERE cs.user_id = v_me.id AND cs.site_id = p_site_id AND cs.status = 'open'
ORDER BY cs.opened_at DESC LIMIT 1;

SELECT jsonb_build_object('site_id', cs.site_id, 'site_name', s.name, 'register_code', r.code, 'register_name', r.name)
INTO v_other
FROM cash_sessions cs JOIN sites s ON s.id = cs.site_id JOIN cash_registers r ON r.id = cs.cash_register_id
WHERE cs.user_id = v_me.id AND cs.status = 'open' AND cs.site_id <> p_site_id
ORDER BY cs.opened_at DESC LIMIT 1;

SELECT COALESCE(jsonb_agg(jsonb_build_object(
'id', r.id, 'code', r.code, 'name', r.name, 'is_default', r.is_default,
'status', CASE WHEN os.id IS NULL THEN 'free' WHEN os.user_id = v_me.id THEN 'mine' ELSE 'busy' END,
'operator_name', CASE WHEN os.id IS NOT NULL AND os.user_id <> v_me.id THEN op.full_name END,
'assigned_to', asg.names,
'locked', (asg.names IS NOT NULL AND os.user_id IS DISTINCT FROM v_me.id
  AND NOT public._cs_profile_is_assigned_to_register(v_me.id, r.id))
) ORDER BY r.is_default DESC, lower(r.code)), '[]'::jsonb)
INTO v_regs
FROM cash_registers r
LEFT JOIN LATERAL (SELECT cs.id, cs.user_id FROM cash_sessions cs
WHERE cs.cash_register_id = r.id AND cs.status = 'open'
ORDER BY cs.opened_at DESC LIMIT 1) os ON true
LEFT JOIN profiles op ON op.id = os.user_id
LEFT JOIN LATERAL (SELECT public._cs_register_assignee_names(r.id) AS names) asg ON true
WHERE r.tenant_id = v_me.tenant_id AND r.site_id = p_site_id AND r.is_active
AND public._cs_profile_can_use_register(v_me.id, r.id);

RETURN jsonb_build_object(
'multi_enabled', true,
'is_elevated', v_elev,
'can_open', public._cr_profile_has_permission(v_me.id, 'access_pos') AND public._cr_profile_has_permission(v_me.id, 'pos_open_session'),
'registers', v_regs,
'my_session', CASE WHEN v_mine IS NOT NULL THEN public._cs_session_payload(v_mine, true) END,
'other_session', v_other);
END;
$function$;
