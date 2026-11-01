/*
# MC1-C.1 — Correction des droits d'administration et d'accès aux caisses

1. Problème
- Le rôle `cashier` possède réellement `manage_cash_sessions = true` dans la plupart des tenants.
  MC1-C utilisait cette permission seule pour l'administration des caisses et pour l'accès
  élevé de `my_cash_registers`, ce qui aurait ouvert toutes les caisses aux caissiers.

2. Nouvelles règles
- Nouveau helper privé `_cr_profile_is_tenant_admin(uuid)` : super_admin, admin ou propriétaire du tenant.
- `_cr_caller_can_manage_registers(site)` : accès au magasin ET (admin du tenant OU
  manage_cash_sessions + manage_settings).
- `_cr_caller_can_manage_assignments(site)` : accès au magasin ET (admin du tenant OU
  manage_cash_sessions + manage_settings + manage_users).
- `my_cash_registers` : accès élevé réservé à admin du tenant OU manager avec
  manage_cash_sessions + view_cash_sessions. Tous les autres : affectations actives uniquement.

3. Sécurité
- Helpers : EXECUTE retiré à PUBLIC, anon, authenticated, service_role.
- `my_cash_registers` : EXECUTE à authenticated uniquement (inchangé).

4. Notes
- Aucune table, politique, permission de rôle, affectation, caisse ou session modifiée.
- `cash_registers_admin_list`, `cash_register_upsert`, `cash_register_set_assignments`,
  `cash_register_eligible_users` héritent de la correction via les helpers.
*/

CREATE OR REPLACE FUNCTION public._cr_profile_is_tenant_admin(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((
    SELECT p.tenant_id IS NOT NULL AND (
      p.role IN ('super_admin', 'admin')
      OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = p.tenant_id AND t.owner_user_id = p.id)
    )
    FROM profiles p WHERE p.id = p_profile_id
  ), false);
$$;

CREATE OR REPLACE FUNCTION public._cr_caller_can_manage_registers(p_site_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN sites s ON s.id = p_site_id AND s.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND p.tenant_id IS NOT NULL
      AND COALESCE(p.is_active, true)
      AND public._cr_profile_can_access_site(p.id, p_site_id)
      AND (
        public._cr_profile_is_tenant_admin(p.id)
        OR (public._cr_profile_has_permission(p.id, 'manage_cash_sessions')
            AND public._cr_profile_has_permission(p.id, 'manage_settings'))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public._cr_caller_can_manage_assignments(p_site_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    JOIN sites s ON s.id = p_site_id AND s.tenant_id = p.tenant_id
    WHERE p.id = auth.uid()
      AND p.tenant_id IS NOT NULL
      AND COALESCE(p.is_active, true)
      AND public._cr_profile_can_access_site(p.id, p_site_id)
      AND (
        public._cr_profile_is_tenant_admin(p.id)
        OR (public._cr_profile_has_permission(p.id, 'manage_cash_sessions')
            AND public._cr_profile_has_permission(p.id, 'manage_settings')
            AND public._cr_profile_has_permission(p.id, 'manage_users'))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.my_cash_registers(p_site_id uuid)
RETURNS TABLE(id uuid, code text, name text, is_default boolean, access_type text, has_open_session boolean, is_my_session boolean, open_session_id uuid, open_session_user_name text, open_session_opened_at timestamptz)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
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
  v_elevated := public._cr_profile_is_tenant_admin(v_me.id)
    OR (v_me.role = 'manager'
        AND public._cr_profile_has_permission(v_me.id, 'manage_cash_sessions')
        AND public._cr_profile_has_permission(v_me.id, 'view_cash_sessions'));

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

REVOKE ALL ON FUNCTION public._cr_profile_is_tenant_admin(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cr_caller_can_manage_registers(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._cr_caller_can_manage_assignments(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.my_cash_registers(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.my_cash_registers(uuid) TO authenticated;
