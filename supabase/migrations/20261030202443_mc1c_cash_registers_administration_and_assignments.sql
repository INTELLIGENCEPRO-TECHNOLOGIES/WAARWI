/*
# MC1-C : Administration des caisses et affectation des collaborateurs

## Résumé
Ajoute les fonctions serveur sécurisées permettant aux administrateurs de gérer les caisses
d'un magasin (création, renommage, activation, caisse par défaut) et d'affecter explicitement
les collaborateurs à chaque caisse. Initialise les affectations existantes sur la Caisse 1.
N'active PAS plusieurs sessions simultanées : l'index `idx_cash_sessions_one_open_per_site`
est conservé et le POS n'est pas modifié.

## 1. Helpers privés (SECURITY DEFINER, search_path = public, pg_temp, aucun EXECUTE pour
PUBLIC / anon / authenticated / service_role)
- `_cr_profile_has_permission(profile, key)` : reproduit exactement `usePermissions()` :
  super_admin = tout ; admin = tout sauf les clés propriétaire (réservées au propriétaire du
  tenant) ; autres rôles = `role_permissions.permissions ->> key` strictement `true`,
  clés propriétaire forcées à faux. `profiles.permissions` n'est pas utilisé.
- `_cr_profile_site_ids(profile)` / `_cr_profile_can_access_site(profile, site)` :
  reproduisent exactement `current_user_accessible_site_ids()` pour un profil donné.
- `_cr_require_caller()` : exige une authentification, un profil rattaché à un tenant et actif.
- `_cr_caller_can_manage_registers(site)` : manage_cash_sessions + accès au magasin.
- `_cr_caller_can_manage_assignments(site)` : manage_cash_sessions ET manage_users + accès.

## 2. RPC (EXECUTE accordé uniquement à `authenticated`)
- `cash_registers_admin_list(site)` : liste d'administration (sans aucun montant).
- `cash_register_upsert(id, site, code, nom, actif, par_defaut)` : création / modification
  idempotente, verrouillage du magasin et de ses caisses, audit.
- `cash_register_set_assignments(caisse, profils[])` : remplacement atomique des affectations
  (désactivation des omises, jamais de suppression), audit.
- `cash_register_eligible_users(caisse)` : collaborateurs éligibles et état d'affectation.
- `my_cash_registers(site)` : caisses accessibles à l'appelant (pour le futur POS).

## 3. Données
- Initialisation : chaque profil actif disposant de `access_pos` ET `pos_open_session` est
  affecté à la caisse par défaut de chaque magasin actif auquel il a accès
  (`ON CONFLICT DO NOTHING`). Une entrée d'audit par caisse concernée est créée
  (module `cash_registers`, action `cash_register_assignments_initialized`).
  Ces affectations définissent uniquement les droits futurs, sans reconstituer l'historique.

## 4. Non modifié
Aucune table transactionnelle, aucune politique RLS, aucune fonction existante, aucun index
existant, aucune session historique.
*/

CREATE OR REPLACE FUNCTION public._cr_profile_has_permission(p_profile_id uuid, p_key text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN p.tenant_id IS NULL OR p.role IS NULL THEN false
      WHEN p.role = 'super_admin' THEN true
      WHEN p.role = 'admin' THEN
        CASE WHEN p_key = ANY (ARRAY['backup_create','backup_restore','backup_reset_operations','backup_import','backup_download','backup_delete','backup_manage_schedule'])
          THEN EXISTS (SELECT 1 FROM tenants t WHERE t.id = p.tenant_id AND t.owner_user_id = p.id)
          ELSE true END
      WHEN p_key = ANY (ARRAY['backup_create','backup_restore','backup_reset_operations','backup_import','backup_download','backup_delete','backup_manage_schedule']) THEN false
      ELSE COALESCE((SELECT (rp.permissions -> p_key) = 'true'::jsonb FROM role_permissions rp WHERE rp.tenant_id = p.tenant_id AND rp.role = p.role), false)
    END
    FROM profiles p WHERE p.id = p_profile_id
  ), false);
$$;

CREATE OR REPLACE FUNCTION public._cr_profile_site_ids(p_profile_id uuid)
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT array_agg(s.id)
    FROM profiles p
    JOIN sites s ON s.tenant_id = p.tenant_id AND s.is_active = true
    WHERE p.id = p_profile_id
      AND p.tenant_id IS NOT NULL
      AND (
        p.role = 'super_admin'
        OR p.site_access_mode = 'all'
        OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = p.tenant_id AND t.owner_user_id = p.id)
        OR (p.assigned_site_ids IS NOT NULL AND array_length(p.assigned_site_ids, 1) > 0
            AND (s.id = ANY (p.assigned_site_ids) OR s.parent_site_id = ANY (p.assigned_site_ids)))
      )
  ), '{}'::uuid[]);
$$;

CREATE OR REPLACE FUNCTION public._cr_profile_can_access_site(p_profile_id uuid, p_site_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p_site_id IS NOT NULL AND p_site_id = ANY (public._cr_profile_site_ids(p_profile_id));
$$;

CREATE OR REPLACE FUNCTION public._cr_require_caller()
RETURNS public.profiles
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentification requise' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_me FROM profiles p WHERE p.id = auth.uid();
  IF NOT FOUND OR v_me.tenant_id IS NULL OR v_me.role IS NULL THEN
    RAISE EXCEPTION 'Profil introuvable' USING ERRCODE = '42501';
  END IF;
  IF NOT COALESCE(v_me.is_active, true) THEN
    RAISE EXCEPTION 'Compte désactivé' USING ERRCODE = '42501';
  END IF;
  RETURN v_me;
END;
$$;

CREATE OR REPLACE FUNCTION public._cr_caller_can_manage_registers(p_site_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN sites s ON s.id = p_site_id AND s.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND p.tenant_id IS NOT NULL
      AND COALESCE(p.is_active, true)
      AND public._cr_profile_can_access_site(p.id, p_site_id)
      AND public._cr_profile_has_permission(p.id, 'manage_cash_sessions')
  );
$$;

CREATE OR REPLACE FUNCTION public._cr_caller_can_manage_assignments(p_site_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public._cr_caller_can_manage_registers(p_site_id)
     AND public._cr_profile_has_permission(auth.uid(), 'manage_users');
$$;

CREATE OR REPLACE FUNCTION public.cash_registers_admin_list(p_site_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me public.profiles;
  v_users boolean;
  v_rows jsonb;
BEGIN
  v_me := public._cr_require_caller();
  IF NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = p_site_id AND s.tenant_id = v_me.tenant_id)
     OR NOT public._cr_profile_can_access_site(v_me.id, p_site_id) THEN
    RAISE EXCEPTION 'Magasin introuvable ou non autorisé' USING ERRCODE = '42501';
  END IF;
  IF NOT public._cr_caller_can_manage_registers(p_site_id) THEN
    RAISE EXCEPTION 'Permission refusée : la gestion des caisses est requise' USING ERRCODE = '42501';
  END IF;
  v_users := public._cr_caller_can_manage_assignments(p_site_id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', r.id,
      'code', r.code,
      'name', r.name,
      'is_active', r.is_active,
      'is_default', r.is_default,
      'active_assignment_count', (SELECT count(*) FROM cash_register_assignments a WHERE a.cash_register_id = r.id AND a.is_active),
      'has_open_session', os.id IS NOT NULL,
      'open_session_user_id', os.user_id,
      'open_session_user_name', op.full_name,
      'open_session_opened_at', os.opened_at,
      'assignees', CASE WHEN v_users THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('user_id', ap.id, 'full_name', ap.full_name, 'email', ap.email, 'role', ap.role)
                           ORDER BY lower(COALESCE(ap.full_name, ap.email, '')))
          FROM cash_register_assignments a
          JOIN profiles ap ON ap.id = a.user_id AND ap.tenant_id = a.tenant_id
          WHERE a.cash_register_id = r.id AND a.is_active), '[]'::jsonb)
        ELSE NULL END
    ) ORDER BY r.is_default DESC, lower(r.code)), '[]'::jsonb)
  INTO v_rows
  FROM cash_registers r
  LEFT JOIN LATERAL (
    SELECT cs.id, cs.user_id, cs.opened_at FROM cash_sessions cs
    WHERE cs.cash_register_id = r.id AND cs.status = 'open'
    ORDER BY cs.opened_at DESC LIMIT 1
  ) os ON true
  LEFT JOIN profiles op ON op.id = os.user_id
  WHERE r.tenant_id = v_me.tenant_id AND r.site_id = p_site_id;

  RETURN jsonb_build_object('can_manage_assignments', v_users, 'registers', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_register_upsert(
  p_register_id uuid,
  p_site_id uuid,
  p_code text,
  p_name text,
  p_is_active boolean DEFAULT true,
  p_is_default boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me public.profiles;
  v_old public.cash_registers;
  v_prev public.cash_registers;
  v_exists boolean;
  v_code text := btrim(COALESCE(p_code, ''));
  v_name text := btrim(COALESCE(p_name, ''));
  v_active boolean := COALESCE(p_is_active, true);
  v_default boolean := COALESCE(p_is_default, false);
  v_prev_id uuid;
BEGIN
  v_me := public._cr_require_caller();
  IF p_register_id IS NULL OR p_site_id IS NULL THEN
    RAISE EXCEPTION 'Paramètres manquants';
  END IF;

  PERFORM 1 FROM sites s WHERE s.id = p_site_id AND s.tenant_id = v_me.tenant_id FOR NO KEY UPDATE;
  IF NOT FOUND OR NOT public._cr_profile_can_access_site(v_me.id, p_site_id) THEN
    RAISE EXCEPTION 'Magasin introuvable ou non autorisé' USING ERRCODE = '42501';
  END IF;
  IF NOT public._cr_caller_can_manage_registers(p_site_id) THEN
    RAISE EXCEPTION 'Permission refusée : la gestion des caisses est requise' USING ERRCODE = '42501';
  END IF;

  PERFORM 1 FROM cash_registers r WHERE r.tenant_id = v_me.tenant_id AND r.site_id = p_site_id FOR NO KEY UPDATE;

  IF v_code = '' THEN RAISE EXCEPTION 'Le code de la caisse est obligatoire'; END IF;
  IF length(v_code) > 20 THEN RAISE EXCEPTION 'Le code de la caisse ne doit pas dépasser 20 caractères'; END IF;
  IF v_name = '' THEN RAISE EXCEPTION 'Le nom de la caisse est obligatoire'; END IF;
  IF length(v_name) > 60 THEN RAISE EXCEPTION 'Le nom de la caisse ne doit pas dépasser 60 caractères'; END IF;
  IF v_default AND NOT v_active THEN
    RAISE EXCEPTION 'Une caisse par défaut doit être active';
  END IF;

  SELECT * INTO v_old FROM cash_registers r WHERE r.id = p_register_id FOR NO KEY UPDATE;
  v_exists := FOUND;
  IF v_exists THEN
    IF v_old.tenant_id <> v_me.tenant_id THEN
      RAISE EXCEPTION 'Caisse introuvable' USING ERRCODE = '42501';
    END IF;
    IF v_old.site_id <> p_site_id THEN
      RAISE EXCEPTION 'Le magasin d''une caisse existante ne peut pas être modifié';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM cash_registers r
             WHERE r.site_id = p_site_id AND r.id <> p_register_id
               AND lower(btrim(r.code)) = lower(v_code)) THEN
    RAISE EXCEPTION 'Le code « % » est déjà utilisé par une autre caisse de ce magasin', v_code;
  END IF;

  IF v_exists THEN
    IF v_old.is_default AND NOT v_active THEN
      RAISE EXCEPTION 'La caisse par défaut ne peut pas être désactivée. Définissez d''abord une autre caisse par défaut';
    END IF;
    IF v_old.is_default AND NOT v_default THEN
      RAISE EXCEPTION 'Le magasin doit conserver une caisse par défaut. Définissez une autre caisse par défaut à la place';
    END IF;
    IF v_old.is_active AND NOT v_active AND EXISTS (
      SELECT 1 FROM cash_sessions cs WHERE cs.cash_register_id = v_old.id AND cs.status = 'open') THEN
      RAISE EXCEPTION 'Cette caisse a une session ouverte : elle ne peut pas être désactivée';
    END IF;
    IF v_old.code = v_code AND v_old.name = v_name AND v_old.is_active = v_active AND v_old.is_default = v_default THEN
      RETURN jsonb_build_object('id', v_old.id, 'created', false, 'changed', false, 'previous_default_id', NULL);
    END IF;
  END IF;

  IF v_default THEN
    SELECT * INTO v_prev FROM cash_registers r
    WHERE r.site_id = p_site_id AND r.is_default AND r.id <> p_register_id;
    IF FOUND THEN
      v_prev_id := v_prev.id;
      UPDATE cash_registers SET is_default = false, updated_at = now() WHERE id = v_prev.id;
      INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
      VALUES (v_me.tenant_id, v_me.id, 'cash_register_updated', 'cash_registers', v_prev.id,
              jsonb_build_object('is_default', true),
              jsonb_build_object('is_default', false, 'replaced_by', p_register_id));
    END IF;
  END IF;

  IF v_exists THEN
    UPDATE cash_registers
       SET code = v_code, name = v_name, is_active = v_active, is_default = v_default, updated_at = now()
     WHERE id = v_old.id;
    INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
    VALUES (v_me.tenant_id, v_me.id, 'cash_register_updated', 'cash_registers', v_old.id,
            jsonb_build_object('code', v_old.code, 'name', v_old.name, 'is_active', v_old.is_active, 'is_default', v_old.is_default),
            jsonb_build_object('code', v_code, 'name', v_name, 'is_active', v_active, 'is_default', v_default));
  ELSE
    INSERT INTO cash_registers (id, tenant_id, site_id, code, name, is_active, is_default, created_by)
    VALUES (p_register_id, v_me.tenant_id, p_site_id, v_code, v_name, v_active, v_default, v_me.id);
    INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
    VALUES (v_me.tenant_id, v_me.id, 'cash_register_created', 'cash_registers', p_register_id, NULL,
            jsonb_build_object('site_id', p_site_id, 'code', v_code, 'name', v_name, 'is_active', v_active, 'is_default', v_default));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cash_registers r WHERE r.site_id = p_site_id AND r.is_default AND r.is_active) THEN
    RAISE EXCEPTION 'Le magasin doit conserver une caisse par défaut active';
  END IF;

  RETURN jsonb_build_object('id', p_register_id, 'created', NOT v_exists, 'changed', true, 'previous_default_id', v_prev_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_register_set_assignments(p_register_id uuid, p_user_ids uuid[])
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_me public.profiles;
  v_reg public.cash_registers;
  v_p public.profiles;
  v_ids uuid[] := COALESCE(p_user_ids, '{}'::uuid[]);
  v_uid uuid;
  v_label text;
  v_old uuid[];
  v_added uuid[];
  v_removed uuid[];
BEGIN
  v_me := public._cr_require_caller();
  SELECT * INTO v_reg FROM cash_registers r
  WHERE r.id = p_register_id AND r.tenant_id = v_me.tenant_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caisse introuvable' USING ERRCODE = '42501';
  END IF;
  IF NOT public._cr_profile_can_access_site(v_me.id, v_reg.site_id) THEN
    RAISE EXCEPTION 'Magasin introuvable ou non autorisé' USING ERRCODE = '42501';
  END IF;
  IF NOT public._cr_caller_can_manage_registers(v_reg.site_id) THEN
    RAISE EXCEPTION 'Permission refusée : la gestion des caisses est requise' USING ERRCODE = '42501';
  END IF;
  IF NOT public._cr_caller_can_manage_assignments(v_reg.site_id) THEN
    RAISE EXCEPTION 'Permission refusée : la gestion des utilisateurs est requise pour affecter des collaborateurs' USING ERRCODE = '42501';
  END IF;

  IF array_position(v_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Identifiant de collaborateur invalide';
  END IF;
  IF cardinality(v_ids) <> (SELECT count(DISTINCT x) FROM unnest(v_ids) x) THEN
    RAISE EXCEPTION 'Un collaborateur figure plusieurs fois dans la demande';
  END IF;

  FOREACH v_uid IN ARRAY v_ids LOOP
    SELECT * INTO v_p FROM profiles p WHERE p.id = v_uid AND p.tenant_id = v_me.tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Collaborateur introuvable dans votre entreprise';
    END IF;
    v_label := COALESCE(NULLIF(btrim(v_p.full_name), ''), NULLIF(btrim(v_p.email), ''), 'Collaborateur');
    IF NOT COALESCE(v_p.is_active, true) THEN
      RAISE EXCEPTION '% : ce compte est désactivé', v_label;
    END IF;
    IF NOT public._cr_profile_can_access_site(v_uid, v_reg.site_id) THEN
      RAISE EXCEPTION '% n''a pas accès à ce magasin', v_label;
    END IF;
    IF NOT (public._cr_profile_has_permission(v_uid, 'access_pos') AND public._cr_profile_has_permission(v_uid, 'pos_open_session')) THEN
      RAISE EXCEPTION '% ne dispose pas des permissions « Accès au POS » et « Ouvrir une session »', v_label;
    END IF;
  END LOOP;

  SELECT COALESCE(array_agg(a.user_id), '{}'::uuid[]) INTO v_old
  FROM cash_register_assignments a WHERE a.cash_register_id = v_reg.id AND a.is_active;

  v_added := ARRAY(SELECT unnest(v_ids) EXCEPT SELECT unnest(v_old));
  v_removed := ARRAY(SELECT unnest(v_old) EXCEPT SELECT unnest(v_ids));

  FOREACH v_uid IN ARRAY v_removed LOOP
    IF EXISTS (SELECT 1 FROM cash_sessions cs
               WHERE cs.cash_register_id = v_reg.id AND cs.user_id = v_uid AND cs.status = 'open') THEN
      SELECT COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.email), ''), 'Ce collaborateur') INTO v_label
      FROM profiles p WHERE p.id = v_uid;
      RAISE EXCEPTION '% a une session ouverte sur cette caisse : son affectation ne peut pas être retirée', v_label;
    END IF;
  END LOOP;

  IF cardinality(v_added) = 0 AND cardinality(v_removed) = 0 THEN
    RETURN jsonb_build_object('changed', false, 'added', 0, 'removed', 0, 'active_count', cardinality(v_old));
  END IF;

  INSERT INTO cash_register_assignments (tenant_id, cash_register_id, user_id, is_active, assigned_by)
  SELECT v_me.tenant_id, v_reg.id, x, true, v_me.id FROM unnest(v_added) x
  ON CONFLICT (cash_register_id, user_id)
  DO UPDATE SET is_active = true, assigned_by = EXCLUDED.assigned_by, updated_at = now();

  UPDATE cash_register_assignments
     SET is_active = false, assigned_by = v_me.id, updated_at = now()
   WHERE cash_register_id = v_reg.id AND user_id = ANY (v_removed) AND is_active;

  INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
  VALUES (v_me.tenant_id, v_me.id, 'cash_register_assignments_updated', 'cash_registers', v_reg.id,
          jsonb_build_object('user_ids', to_jsonb(v_old)),
          jsonb_build_object('user_ids', to_jsonb(v_ids), 'added', to_jsonb(v_added), 'removed', to_jsonb(v_removed)));

  RETURN jsonb_build_object('changed', true, 'added', cardinality(v_added), 'removed', cardinality(v_removed), 'active_count', cardinality(v_ids));
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_register_eligible_users(p_register_id uuid)
RETURNS TABLE (user_id uuid, full_name text, email text, role text, assignment_status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me public.profiles;
  v_reg public.cash_registers;
BEGIN
  v_me := public._cr_require_caller();
  SELECT * INTO v_reg FROM cash_registers r WHERE r.id = p_register_id AND r.tenant_id = v_me.tenant_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Caisse introuvable' USING ERRCODE = '42501';
  END IF;
  IF NOT public._cr_profile_can_access_site(v_me.id, v_reg.site_id) THEN
    RAISE EXCEPTION 'Magasin introuvable ou non autorisé' USING ERRCODE = '42501';
  END IF;
  IF NOT public._cr_caller_can_manage_assignments(v_reg.site_id) THEN
    RAISE EXCEPTION 'Permission refusée : la gestion des caisses et des utilisateurs est requise' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT p.id, p.full_name, p.email, p.role,
         CASE WHEN a.is_active THEN 'active' WHEN a.id IS NOT NULL THEN 'inactive' ELSE 'none' END
  FROM profiles p
  LEFT JOIN cash_register_assignments a ON a.cash_register_id = v_reg.id AND a.user_id = p.id
  WHERE p.tenant_id = v_me.tenant_id
    AND p.role IS NOT NULL
    AND COALESCE(p.is_active, true)
    AND public._cr_profile_can_access_site(p.id, v_reg.site_id)
    AND public._cr_profile_has_permission(p.id, 'access_pos')
    AND public._cr_profile_has_permission(p.id, 'pos_open_session')
  ORDER BY lower(COALESCE(NULLIF(p.full_name, ''), p.email, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.my_cash_registers(p_site_id uuid)
RETURNS TABLE (
  id uuid, code text, name text, is_default boolean, access_type text,
  has_open_session boolean, is_my_session boolean, open_session_id uuid,
  open_session_user_name text, open_session_opened_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_me public.profiles;
  v_elevated boolean;
BEGIN
  v_me := public._cr_require_caller();
  IF NOT EXISTS (SELECT 1 FROM sites s WHERE s.id = p_site_id AND s.tenant_id = v_me.tenant_id)
     OR NOT public._cr_profile_can_access_site(v_me.id, p_site_id) THEN
    RAISE EXCEPTION 'Magasin introuvable ou non autorisé' USING ERRCODE = '42501';
  END IF;
  IF NOT (public._cr_profile_has_permission(v_me.id, 'access_pos') AND public._cr_profile_has_permission(v_me.id, 'pos_open_session')) THEN
    RAISE EXCEPTION 'Permission refusée : accès au POS et ouverture de session requis' USING ERRCODE = '42501';
  END IF;
  v_elevated := v_me.role IN ('super_admin', 'admin') OR public._cr_profile_has_permission(v_me.id, 'manage_cash_sessions');

  RETURN QUERY
  SELECT r.id, r.code, r.name, r.is_default,
         CASE WHEN a.id IS NOT NULL THEN 'assigned' ELSE 'elevated' END,
         os.id IS NOT NULL,
         COALESCE(os.user_id = v_me.id, false),
         CASE WHEN os.user_id = v_me.id THEN os.id END,
         op.full_name,
         os.opened_at
  FROM cash_registers r
  LEFT JOIN cash_register_assignments a ON a.cash_register_id = r.id AND a.user_id = v_me.id AND a.is_active
  LEFT JOIN LATERAL (
    SELECT cs.id, cs.user_id, cs.opened_at FROM cash_sessions cs
    WHERE cs.cash_register_id = r.id AND cs.status = 'open'
    ORDER BY cs.opened_at DESC LIMIT 1
  ) os ON true
  LEFT JOIN profiles op ON op.id = os.user_id
  WHERE r.tenant_id = v_me.tenant_id AND r.site_id = p_site_id AND r.is_active
    AND (v_elevated OR a.id IS NOT NULL)
  ORDER BY r.is_default DESC, lower(r.code);
END;
$$;

REVOKE ALL ON FUNCTION public._cr_profile_has_permission(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cr_profile_site_ids(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cr_profile_can_access_site(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cr_require_caller() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cr_caller_can_manage_registers(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cr_caller_can_manage_assignments(uuid) FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.cash_registers_admin_list(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cash_register_upsert(uuid, uuid, text, text, boolean, boolean) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cash_register_set_assignments(uuid, uuid[]) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.cash_register_eligible_users(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.my_cash_registers(uuid) FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.cash_registers_admin_list(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_register_upsert(uuid, uuid, text, text, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_register_set_assignments(uuid, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cash_register_eligible_users(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_cash_registers(uuid) TO authenticated;

WITH eligible AS (
  SELECT p.tenant_id, p.id AS user_id, r.id AS register_id
  FROM profiles p
  JOIN cash_registers r ON r.tenant_id = p.tenant_id AND r.is_default
  WHERE p.tenant_id IS NOT NULL
    AND p.role IS NOT NULL
    AND COALESCE(p.is_active, true)
    AND public._cr_profile_has_permission(p.id, 'access_pos')
    AND public._cr_profile_has_permission(p.id, 'pos_open_session')
    AND r.site_id = ANY (public._cr_profile_site_ids(p.id))
), ins AS (
  INSERT INTO cash_register_assignments (tenant_id, cash_register_id, user_id, is_active, assigned_by)
  SELECT tenant_id, register_id, user_id, true, NULL FROM eligible
  ON CONFLICT (cash_register_id, user_id) DO NOTHING
  RETURNING tenant_id, cash_register_id, user_id
)
INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
SELECT tenant_id, NULL, 'cash_register_assignments_initialized', 'cash_registers', cash_register_id, NULL,
       jsonb_build_object('phase', 'MC1-C', 'count', count(*), 'user_ids', jsonb_agg(user_id ORDER BY user_id),
                          'note', 'Affectation initiale à la caisse par défaut : droits futurs uniquement, sans reconstitution historique')
FROM ins
GROUP BY tenant_id, cash_register_id;
