/*
# Lot A — A1/A2 : contrôles serveur des sauvegardes et blocage temporaire des actions destructives

1. Nouvelles fonctions
- `_br_is_verified_server()` : vrai uniquement pour une identité serveur réellement authentifiée :
  - rôle Postgres effectif `service_role` (posé par PostgREST après vérification de la clé de service ;
    non usurpable : SET ROLE exige l'appartenance au rôle) ;
  - ou connexion directe à la base (pg_cron, migrations) : session_user hors rôles PostgREST ET rôle
    effectif hors anon/authenticated.
  N'utilise PAS `request.jwt.claims` (modifiable par la session) : `is_trusted_backend()` n'est pas réutilisée.
- `_br_can_manage_backups(tenant)` : propriétaire du tenant (tenants.owner_user_id) ou super_admin, rattaché au tenant.
  Réutilise `current_tenant_id()`, `current_user_is_owner()`, `is_super_admin()`.
- `_br_assert_backup_admin(tenant)` : lève 42501 sinon (serveur vérifié autorisé).
- `_br_assert_destructive_available()` : refuse toujours (SQLSTATE BR020, indice BR-020) avec le message
  « Cette opération est temporairement indisponible pendant la sécurisation du système de sauvegarde. »

2. Fonctions modifiées (corps déployé conservé, garde insérée comme toute première instruction)
- `br_reset_operations()`, `br_restore_backup(uuid)`, `br_import_payload(jsonb)` : blocage destructif
  avant verrou, sauvegarde de sécurité ou toute écriture. S'applique à tous les profils, super_admin inclus.
- `br_create_backup(text,text)` : propriétaire ou super_admin uniquement ; les types `auto` et
  `platform_manual` (entrant dans la rotation centralisée) sont réservés au serveur vérifié.
- `br_preflight_restore(uuid)` : propriétaire ou super_admin ; refus net (BR-404, sans détail)
  d'une sauvegarde d'un autre tenant ou inexistante.

3. Condition de levée du blocage destructif
- Uniquement par une migration ultérieure redéfinissant `_br_assert_destructive_available()`, après
  validation du lot D (restauration isolée via staging + swap transactionnel testée).

4. Notes
- Aucune activation tenant, aucun mode multi-caisse, aucune `role_permissions` modifiés.
- Injection idempotente : chaque fonction n'est modifiée que si la garde est absente ; échec explicite si
  la structure attendue (ligne BEGIN) est introuvable.
*/

CREATE OR REPLACE FUNCTION public._br_is_verified_server()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(current_setting('role', true), 'none') = 'service_role'
      OR (session_user::text NOT IN ('authenticator','anon','authenticated','service_role')
          AND coalesce(current_setting('role', true), 'none') NOT IN ('anon','authenticated'));
$$;

CREATE OR REPLACE FUNCTION public._br_can_manage_backups(p_tenant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT auth.uid() IS NOT NULL
     AND p_tenant IS NOT NULL
     AND p_tenant = public.current_tenant_id()
     AND (public.is_super_admin() OR public.current_user_is_owner());
$$;

CREATE OR REPLACE FUNCTION public._br_assert_backup_admin(p_tenant uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public._br_is_verified_server() THEN RETURN; END IF;
  IF NOT public._br_can_manage_backups(p_tenant) THEN
    RAISE EXCEPTION 'BR-403: Action réservée au propriétaire du compte ou au super administrateur'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._br_assert_destructive_available()
RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'Cette opération est temporairement indisponible pendant la sécurisation du système de sauvegarde.'
    USING ERRCODE = 'BR020', HINT = 'BR-020';
END;
$$;

REVOKE EXECUTE ON FUNCTION public._br_is_verified_server() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._br_can_manage_backups(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public._br_assert_backup_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._br_assert_destructive_available() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._br_can_manage_backups(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._br_is_verified_server() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._br_assert_backup_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._br_assert_destructive_available() TO service_role;

DO $mig$
DECLARE
  v_targets text[][] := ARRAY[
    ARRAY['public.br_reset_operations()', '_br_assert_destructive_available',
          E'\nPERFORM public._br_assert_destructive_available();'],
    ARRAY['public.br_restore_backup(uuid)', '_br_assert_destructive_available',
          E'\nPERFORM public._br_assert_destructive_available();'],
    ARRAY['public.br_import_payload(jsonb)', '_br_assert_destructive_available',
          E'\nPERFORM public._br_assert_destructive_available();'],
    ARRAY['public.br_create_backup(text,text)', '_br_assert_backup_admin',
          E'\nPERFORM public._br_assert_backup_admin(public.current_tenant_id());'
          || E'\nIF p_kind IN (''auto'',''platform_manual'') AND NOT public._br_is_verified_server() THEN'
          || E'\n  RAISE EXCEPTION ''BR-021: Type de sauvegarde réservé au planificateur'' USING ERRCODE = ''42501'';'
          || E'\nEND IF;'],
    ARRAY['public.br_preflight_restore(uuid)', '_br_assert_backup_admin',
          E'\nPERFORM public._br_assert_backup_admin(public.current_tenant_id());'
          || E'\nIF NOT EXISTS (SELECT 1 FROM public.tenant_backups tb WHERE tb.id = p_backup_id AND tb.tenant_id = public.current_tenant_id()) THEN'
          || E'\n  RAISE EXCEPTION ''BR-404: Sauvegarde introuvable'' USING ERRCODE = ''P0002'';'
          || E'\nEND IF;']
  ];
  i int;
  v_def text;
  v_body_start int;
  v_pos int;
BEGIN
  FOR i IN 1 .. array_length(v_targets, 1) LOOP
    v_def := pg_get_functiondef(v_targets[i][1]::regprocedure);
    IF position(v_targets[i][2] IN v_def) > 0 THEN
      CONTINUE;
    END IF;
    v_body_start := position('$function$' IN v_def);
    v_pos := position(E'\nBEGIN\n' IN substr(v_def, v_body_start));
    IF v_body_start = 0 OR v_pos = 0 THEN
      RAISE EXCEPTION 'Lot A: structure inattendue pour %', v_targets[i][1];
    END IF;
    v_pos := v_body_start + v_pos - 1 + length(E'\nBEGIN');
    v_def := substr(v_def, 1, v_pos - 1) || v_targets[i][3] || substr(v_def, v_pos);
    EXECUTE v_def;
  END LOOP;
END
$mig$;
