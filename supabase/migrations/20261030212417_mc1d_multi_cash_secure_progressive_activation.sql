/*
# MC1-D — Activation sécurisée et progressive du multi-caisse

## Résumé
Ajoute un réglage par tenant (désactivé par défaut pour tous) qui permet, une fois activé
depuis Paramètres > Caisses, d'ouvrir plusieurs caisses simultanément dans un même magasin,
chaque collaborateur travaillant exclusivement dans sa propre session.
Tant que le réglage est désactivé, le comportement historique est strictement conservé.

## 1. Nouvelle table
- `cash_register_settings` (tenant_id PK/FK, multi_cash_enabled false par défaut, enabled_at,
  enabled_by, updated_at, updated_by). RLS active, aucune politique, aucun droit
  PUBLIC/anon/authenticated, SELECT seul pour service_role. Écriture uniquement par RPC.
  Une ligne `false` créée pour chaque tenant existant ; ligne absente = désactivé.
  Inscrite dans `_br_table_registry` (structure, preserve, ordre 15).

## 2. Table modifiée
- `cash_sessions.open_request_id` (text, nullable) : clé d'idempotence de l'ouverture.

## 3. Contrainte « une session ouverte par magasin »
- Le trigger `trg_cs_open_guard` (verrous advisory transactionnels) remplace
  `idx_cash_sessions_one_open_per_site`, supprimé dans cette même migration :
  mode désactivé = une session ouverte par magasin (même erreur 23505) ;
  mode activé = une par caisse (index par caisse conservé) et une par utilisateur.

## 4. Contrôles centraux (mode activé uniquement)
- Trigger `trg_cs_row_guard` sur les tables portant une session : session ouverte, cohérente,
  caisse active, appartenant à l'appelant autorisé ; rattachement existant immuable.
- `close_cash_session_v2` : contrôle propriétaire/superviseur ajouté en tête.
- `get_session_financial_summary` : refus si la session n'est pas consultable.

## 5. RLS
- Politiques RESTRICTIVES ajoutées (politiques existantes inchangées), toujours vraies en mode désactivé.

## 6. Nouvelles RPC
- cash_multi_status, cash_multi_set_enabled, cash_session_open, cash_session_close,
  cash_pos_context, my_operational_cash_session.

## Notes
1. Aucun tenant n'est activé. 2. Aucune donnée existante n'est modifiée ni supprimée.
*/

CREATE TABLE IF NOT EXISTS public.cash_register_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  multi_cash_enabled boolean NOT NULL DEFAULT false,
  enabled_at timestamptz,
  enabled_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);
ALTER TABLE public.cash_register_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_register_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cash_register_settings TO service_role;

INSERT INTO public.cash_register_settings (tenant_id)
SELECT t.id FROM public.tenants t
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO public._br_table_registry (schema_name, table_name, tenant_link, tenant_id_column, category, restore_order, reset_behavior)
VALUES ('public','cash_register_settings','direct','tenant_id','structure',15,'preserve')
ON CONFLICT (schema_name, table_name) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='cash_sessions' AND column_name='open_request_id') THEN
    ALTER TABLE public.cash_sessions ADD COLUMN open_request_id text DEFAULT (CASE WHEN false THEN NULL::text END);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_open_request_unique
  ON public.cash_sessions (user_id, open_request_id) WHERE open_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_sessions_user_open
  ON public.cash_sessions (user_id) WHERE status = 'open';

CREATE OR REPLACE FUNCTION public._cs_multi_enabled(p_tenant_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT s.multi_cash_enabled FROM cash_register_settings s WHERE s.tenant_id = p_tenant_id), false);
$$;

CREATE OR REPLACE FUNCTION public._cs_multi_current()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._cs_multi_enabled(public.current_tenant_id());
$$;

CREATE OR REPLACE FUNCTION public._cs_profile_is_elevated(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
    SELECT COALESCE(p.is_active, true) AND p.tenant_id IS NOT NULL AND (
      public._cr_profile_is_tenant_admin(p.id)
      OR (p.role = 'manager'
          AND public._cr_profile_has_permission(p.id, 'manage_cash_sessions')
          AND public._cr_profile_has_permission(p.id, 'view_cash_sessions')))
    FROM profiles p WHERE p.id = p_profile_id), false);
$$;

CREATE OR REPLACE FUNCTION public._cs_profile_can_supervise_site(p_profile_id uuid, p_site_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._cs_profile_is_elevated(p_profile_id) AND public._cr_profile_can_access_site(p_profile_id, p_site_id);
$$;

CREATE OR REPLACE FUNCTION public._cs_supervised_site_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN public._cs_profile_is_elevated(auth.uid()) THEN public._cr_profile_site_ids(auth.uid()) ELSE '{}'::uuid[] END;
$$;

CREATE OR REPLACE FUNCTION public._cs_is_elevated()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._cs_profile_is_elevated(auth.uid());
$$;

CREATE OR REPLACE FUNCTION public._cs_profile_can_use_register(p_profile_id uuid, p_register_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM cash_registers r
    JOIN profiles p ON p.id = p_profile_id AND p.tenant_id = r.tenant_id
    JOIN sites s ON s.id = r.site_id AND s.tenant_id = r.tenant_id
    WHERE r.id = p_register_id AND r.is_active AND COALESCE(p.is_active, true)
      AND public._cr_profile_can_access_site(p.id, r.site_id)
      AND public._cr_profile_has_permission(p.id, 'access_pos')
      AND public._cr_profile_has_permission(p.id, 'pos_open_session')
      AND (public._cs_profile_is_elevated(p.id)
           OR EXISTS (SELECT 1 FROM cash_register_assignments a
                      WHERE a.cash_register_id = r.id AND a.user_id = p.id AND a.is_active AND a.tenant_id = r.tenant_id))
  );
$$;

CREATE OR REPLACE FUNCTION public._cs_session_payload(p_session_id uuid, p_reused boolean)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(cs) || jsonb_build_object(
    'register_code', r.code, 'register_name', r.name, 'site_name', s.name, 'reused', p_reused)
  FROM cash_sessions cs
  JOIN cash_registers r ON r.id = cs.cash_register_id
  JOIN sites s ON s.id = cs.site_id
  WHERE cs.id = p_session_id;
$$;

CREATE OR REPLACE FUNCTION public._cs_lock_open_keys(p_tenant_id uuid, p_site_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('cash_sessions:mode:' || p_tenant_id::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('cash_sessions:open:site:' || p_site_id::text, 0));
  IF p_user_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('cash_sessions:open:user:' || p_user_id::text, 0));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._cs_assert_operational(p_session_id uuid, p_tenant_id uuid, p_site_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  IF v_s.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Cette session de caisse appartient à un autre opérateur. Ouvrez votre caisse avant d''enregistrer cet encaissement.' USING ERRCODE = '42501';
  END IF;
  IF NOT public._cs_profile_can_use_register(v_uid, v_s.cash_register_id) THEN
    RAISE EXCEPTION 'Vous n''êtes pas autorisé à utiliser cette caisse' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._cs_assert_can_close(p_session_id uuid, p_idempotency_key text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s record;
BEGIN
  IF v_uid IS NULL THEN RETURN; END IF;
  SELECT cs.id, cs.tenant_id, cs.site_id, cs.user_id INTO v_s FROM cash_sessions cs WHERE cs.id = p_session_id;
  IF NOT FOUND OR NOT public._cs_multi_enabled(v_s.tenant_id) THEN RETURN; END IF;
  IF v_s.tenant_id IS DISTINCT FROM public.current_tenant_id() THEN
    RAISE EXCEPTION 'Session de caisse introuvable ou déjà clôturée' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(btrim(p_idempotency_key), '') = '' THEN
    RAISE EXCEPTION 'Clé d''idempotence obligatoire pour la clôture' USING ERRCODE = '22023';
  END IF;
  IF v_s.user_id = v_uid THEN
    IF NOT public._cr_profile_has_permission(v_uid, 'pos_close_session') THEN
      RAISE EXCEPTION 'Permission refusée : clôture de session' USING ERRCODE = '42501';
    END IF;
  ELSIF public._cs_profile_can_supervise_site(v_uid, v_s.site_id)
        AND (public._cr_profile_is_tenant_admin(v_uid)
             OR (public._cr_profile_has_permission(v_uid, 'manage_cash_sessions')
                 AND public._cr_profile_has_permission(v_uid, 'pos_close_session'))) THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Vous ne pouvez pas clôturer la session de caisse d''un autre opérateur' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('waarwi.cs_close_session', p_session_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public._cs_assert_session_readable(p_session_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_s record;
BEGIN
  IF v_uid IS NULL OR p_session_id IS NULL THEN RETURN; END IF;
  SELECT cs.tenant_id, cs.site_id, cs.user_id INTO v_s FROM cash_sessions cs WHERE cs.id = p_session_id;
  IF NOT FOUND OR NOT public._cs_multi_enabled(v_s.tenant_id) THEN RETURN; END IF;
  IF v_s.tenant_id IS DISTINCT FROM public.current_tenant_id()
     OR NOT (v_s.user_id = v_uid OR public._cs_profile_can_supervise_site(v_uid, v_s.site_id)) THEN
    RAISE EXCEPTION 'Accès refusé à cette session de caisse' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._trg_cs_open_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
       AND (OLD.user_id IS DISTINCT FROM v_uid OR OLD.status <> 'open') THEN
      RAISE EXCEPTION 'Cette session de caisse appartient à un autre opérateur' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cs_open_guard ON public.cash_sessions;
CREATE TRIGGER trg_cs_open_guard
  BEFORE INSERT OR UPDATE ON public.cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public._trg_cs_open_guard();

DROP INDEX IF EXISTS public.idx_cash_sessions_one_open_per_site;

CREATE OR REPLACE FUNCTION public._trg_cs_row_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb;
  v_tenant uuid;
  v_col text;
  v_ns uuid;
  v_os uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  v_tenant := NULLIF(v_new ->> 'tenant_id', '')::uuid;
  IF NOT public._cs_multi_enabled(v_tenant) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN v_old := to_jsonb(OLD); END IF;
  FOREACH v_col IN ARRAY TG_ARGV LOOP
    v_ns := NULLIF(v_new ->> v_col, '')::uuid;
    v_os := CASE WHEN TG_OP = 'UPDATE' THEN NULLIF(v_old ->> v_col, '')::uuid END;
    IF TG_OP = 'UPDATE' AND v_os IS NOT NULL AND v_ns IS DISTINCT FROM v_os THEN
      RAISE EXCEPTION 'Le rattachement d''une opération à sa session de caisse ne peut pas être modifié' USING ERRCODE = '42501';
    END IF;
    IF v_ns IS NOT NULL AND (TG_OP = 'INSERT' OR v_os IS NULL) THEN
      PERFORM public._cs_assert_operational(v_ns, v_tenant, NULLIF(v_new ->> 'site_id', '')::uuid);
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_t text;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['sales','sale_payments','cash_movements','cash_regularizations','cash_control_lines',
                             'customer_payments','customer_prepayments','held_carts','vault_movements'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_cs_row_guard ON public.%I', v_t);
    EXECUTE format('CREATE TRIGGER trg_cs_row_guard BEFORE INSERT OR UPDATE OF cash_session_id ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION public._trg_cs_row_guard(''cash_session_id'')', v_t);
  END LOOP;
  DROP TRIGGER IF EXISTS trg_cs_row_guard ON public.sale_returns;
  CREATE TRIGGER trg_cs_row_guard BEFORE INSERT OR UPDATE OF cash_session_id, refund_cash_session_id ON public.sale_returns
    FOR EACH ROW EXECUTE FUNCTION public._trg_cs_row_guard('cash_session_id', 'refund_cash_session_id');
END $$;

DO $$
DECLARE
  v_def text;
BEGIN
  v_def := pg_get_functiondef('public.close_cash_session_v2(uuid,jsonb,text,numeric,text)'::regprocedure);
  IF position('_cs_assert_can_close' IN v_def) = 0 THEN
    v_def := regexp_replace(v_def, E'\\$function\\$(.*?)\\nBEGIN\\n',
      E'$function$\\1\nBEGIN\nPERFORM public._cs_assert_can_close(p_session_id, p_idempotency_key);\n');
    IF position('_cs_assert_can_close' IN v_def) = 0 THEN RAISE EXCEPTION 'Injection close_cash_session_v2 impossible'; END IF;
    EXECUTE v_def;
  END IF;

  v_def := pg_get_functiondef('public.get_session_financial_summary(uuid)'::regprocedure);
  IF position('_cs_assert_session_readable' IN v_def) = 0 THEN
    v_def := regexp_replace(v_def, E'\\$function\\$(.*?)\\nBEGIN\\n',
      E'$function$\\1\nBEGIN\nPERFORM public._cs_assert_session_readable(p_cash_session_id);\n');
    IF position('_cs_assert_session_readable' IN v_def) = 0 THEN RAISE EXCEPTION 'Injection get_session_financial_summary impossible'; END IF;
    EXECUTE v_def;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._cs_multi_anomalies(p_tenant_id uuid, p_target boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v jsonb := '[]'::jsonb;
  v_items jsonb;
BEGIN
  IF p_target THEN
    SELECT jsonb_agg(x.label) INTO v_items FROM (
      SELECT COALESCE(NULLIF(p.full_name, ''), p.email, p.id::text) AS label
      FROM profiles p
      WHERE p.tenant_id = p_tenant_id AND COALESCE(p.is_active, true) AND p.role IS NOT NULL
        AND public._cr_profile_has_permission(p.id, 'access_pos')
        AND public._cr_profile_has_permission(p.id, 'pos_open_session')
        AND NOT EXISTS (SELECT 1 FROM cash_registers r
                        WHERE r.tenant_id = p_tenant_id AND r.is_active
                          AND public._cs_profile_can_use_register(p.id, r.id))
      ORDER BY 1 LIMIT 50) x;
    IF v_items IS NOT NULL THEN
      v := v || jsonb_build_array(jsonb_build_object('code', 'profile_without_register',
        'label', 'Collaborateurs POS sans caisse active affectée', 'items', v_items));
    END IF;

    SELECT jsonb_agg(x.label) INTO v_items FROM (
      SELECT s.name || ' · ' || r.code || ' · ' || COALESCE(op.full_name, op.email, '?') AS label
      FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.cash_register_id
      JOIN sites s ON s.id = cs.site_id LEFT JOIN profiles op ON op.id = cs.user_id
      WHERE cs.tenant_id = p_tenant_id AND cs.status = 'open' AND NOT r.is_active
      ORDER BY 1 LIMIT 50) x;
    IF v_items IS NOT NULL THEN
      v := v || jsonb_build_array(jsonb_build_object('code', 'open_session_inactive_register',
        'label', 'Sessions ouvertes sur une caisse désactivée', 'items', v_items));
    END IF;

    SELECT jsonb_agg(x.label) INTO v_items FROM (
      SELECT s.name || ' · ' || r.code || ' · ' || COALESCE(op.full_name, op.email, 'opérateur inconnu') AS label
      FROM cash_sessions cs JOIN cash_registers r ON r.id = cs.cash_register_id
      JOIN sites s ON s.id = cs.site_id LEFT JOIN profiles op ON op.id = cs.user_id
      WHERE cs.tenant_id = p_tenant_id AND cs.status = 'open' AND r.is_active
        AND (cs.user_id IS NULL OR NOT public._cs_profile_can_use_register(cs.user_id, cs.cash_register_id))
      ORDER BY 1 LIMIT 50) x;
    IF v_items IS NOT NULL THEN
      v := v || jsonb_build_array(jsonb_build_object('code', 'open_session_owner_not_assigned',
        'label', 'Sessions ouvertes dont l''opérateur n''est pas affecté à la caisse', 'items', v_items));
    END IF;

    SELECT jsonb_agg(x.label) INTO v_items FROM (
      SELECT COALESCE(op.full_name, op.email, cs.user_id::text) || ' (' || count(*) || ' sessions)' AS label
      FROM cash_sessions cs LEFT JOIN profiles op ON op.id = cs.user_id
      WHERE cs.tenant_id = p_tenant_id AND cs.status = 'open' AND cs.user_id IS NOT NULL
      GROUP BY cs.user_id, op.full_name, op.email HAVING count(*) > 1
      ORDER BY 1 LIMIT 50) x;
    IF v_items IS NOT NULL THEN
      v := v || jsonb_build_array(jsonb_build_object('code', 'user_multiple_open_sessions',
        'label', 'Collaborateurs ayant plusieurs sessions ouvertes', 'items', v_items));
    END IF;

    SELECT jsonb_agg(x.label) INTO v_items FROM (
      SELECT COALESCE(s.name, '?') || ' · ' || COALESCE(r.code, '?') AS label
      FROM cash_sessions cs LEFT JOIN cash_registers r ON r.id = cs.cash_register_id
      LEFT JOIN sites s ON s.id = cs.site_id
      WHERE cs.tenant_id = p_tenant_id AND cs.status = 'open'
        AND (r.id IS NULL OR r.tenant_id <> cs.tenant_id OR r.site_id <> cs.site_id OR s.tenant_id IS DISTINCT FROM cs.tenant_id)
      UNION ALL
      SELECT COALESCE(s.name, '?') || ' · ' || r.code
      FROM cash_registers r LEFT JOIN sites s ON s.id = r.site_id
      WHERE r.tenant_id = p_tenant_id AND s.tenant_id IS DISTINCT FROM r.tenant_id
      ORDER BY 1 LIMIT 50) x;
    IF v_items IS NOT NULL THEN
      v := v || jsonb_build_array(jsonb_build_object('code', 'tenant_site_incoherence',
        'label', 'Caisses ou sessions incohérentes avec leur magasin', 'items', v_items));
    END IF;

    SELECT jsonb_agg(x.label) INTO v_items FROM (
      SELECT s.name AS label FROM sites s
      WHERE s.tenant_id = p_tenant_id AND s.is_active
        AND NOT EXISTS (SELECT 1 FROM cash_registers r WHERE r.site_id = s.id AND r.tenant_id = p_tenant_id AND r.is_active)
      ORDER BY 1 LIMIT 50) x;
    IF v_items IS NOT NULL THEN
      v := v || jsonb_build_array(jsonb_build_object('code', 'site_without_register',
        'label', 'Magasins sans caisse active', 'items', v_items));
    END IF;
  ELSE
    SELECT jsonb_agg(x.label) INTO v_items FROM (
      SELECT s.name || ' (' || count(*) || ' sessions ouvertes)' AS label
      FROM cash_sessions cs JOIN sites s ON s.id = cs.site_id
      WHERE cs.tenant_id = p_tenant_id AND cs.status = 'open'
      GROUP BY s.id, s.name HAVING count(*) > 1
      ORDER BY 1 LIMIT 50) x;
    IF v_items IS NOT NULL THEN
      v := v || jsonb_build_array(jsonb_build_object('code', 'site_multiple_open_sessions',
        'label', 'Magasins ayant plusieurs sessions ouvertes : clôturez-les avant de désactiver', 'items', v_items));
    END IF;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public._cs_caller_can_toggle(p_profile_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._cr_profile_is_tenant_admin(p_profile_id)
      OR (public._cr_profile_has_permission(p_profile_id, 'manage_cash_sessions')
          AND public._cr_profile_has_permission(p_profile_id, 'manage_settings'));
$$;

CREATE OR REPLACE FUNCTION public.cash_multi_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me public.profiles;
  v_enabled boolean;
  v_enabled_at timestamptz;
  v_enabled_by text;
BEGIN
  v_me := public._cr_require_caller();
  IF NOT public._cs_caller_can_toggle(v_me.id) THEN
    RAISE EXCEPTION 'Permission refusée : gestion des caisses' USING ERRCODE = '42501';
  END IF;
  SELECT st.multi_cash_enabled, st.enabled_at, p.full_name
  INTO v_enabled, v_enabled_at, v_enabled_by
  FROM cash_register_settings st LEFT JOIN profiles p ON p.id = st.enabled_by
  WHERE st.tenant_id = v_me.tenant_id;

  RETURN jsonb_build_object(
    'multi_enabled', COALESCE(v_enabled, false),
    'enabled_at', v_enabled_at,
    'enabled_by_name', v_enabled_by,
    'can_toggle', true,
    'sites_count', (SELECT count(*) FROM sites s WHERE s.tenant_id = v_me.tenant_id AND s.is_active),
    'active_registers_count', (SELECT count(*) FROM cash_registers r WHERE r.tenant_id = v_me.tenant_id AND r.is_active),
    'open_sessions_count', (SELECT count(*) FROM cash_sessions cs WHERE cs.tenant_id = v_me.tenant_id AND cs.status = 'open'),
    'blocking_enable', public._cs_multi_anomalies(v_me.tenant_id, true),
    'blocking_disable', public._cs_multi_anomalies(v_me.tenant_id, false)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_multi_set_enabled(p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me public.profiles;
  v_cur boolean;
  v_anom jsonb;
BEGIN
  v_me := public._cr_require_caller();
  IF p_enabled IS NULL THEN RAISE EXCEPTION 'Valeur invalide' USING ERRCODE = '22023'; END IF;
  IF NOT public._cs_caller_can_toggle(v_me.id) THEN
    RAISE EXCEPTION 'Permission refusée : gestion des caisses' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cash_sessions:mode:' || v_me.tenant_id::text, 0));
  INSERT INTO cash_register_settings (tenant_id) VALUES (v_me.tenant_id) ON CONFLICT (tenant_id) DO NOTHING;
  SELECT st.multi_cash_enabled INTO v_cur FROM cash_register_settings st WHERE st.tenant_id = v_me.tenant_id FOR UPDATE;
  IF v_cur = p_enabled THEN
    RETURN public.cash_multi_status();
  END IF;

  v_anom := public._cs_multi_anomalies(v_me.tenant_id, p_enabled);
  IF jsonb_array_length(v_anom) > 0 THEN
    RAISE EXCEPTION '% impossible : %',
      CASE WHEN p_enabled THEN 'Activation' ELSE 'Désactivation' END,
      (SELECT string_agg(a ->> 'label', ' ; ') FROM jsonb_array_elements(v_anom) a)
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE cash_register_settings SET
    multi_cash_enabled = p_enabled,
    enabled_at = CASE WHEN p_enabled THEN now() ELSE enabled_at END,
    enabled_by = CASE WHEN p_enabled THEN v_me.id ELSE enabled_by END,
    updated_at = now(),
    updated_by = v_me.id
  WHERE tenant_id = v_me.tenant_id;

  INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
  VALUES (v_me.tenant_id, v_me.id,
          CASE WHEN p_enabled THEN 'multi_cash_enabled' ELSE 'multi_cash_disabled' END,
          'cash_registers', v_me.tenant_id,
          jsonb_build_object('multi_cash_enabled', v_cur),
          jsonb_build_object('multi_cash_enabled', p_enabled));

  RETURN public.cash_multi_status();
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_session_open(p_cash_register_id uuid, p_opening_amount numeric DEFAULT 0,
  p_opening_note text DEFAULT '', p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me public.profiles;
  v_reg record;
  v_multi boolean;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
  v_sid uuid;
  v_other record;
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
$$;

CREATE OR REPLACE FUNCTION public.cash_session_close(p_session_id uuid, p_control_lines jsonb,
  p_closing_note text DEFAULT '', p_vault_deposit_amount numeric DEFAULT 0, p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me public.profiles;
  v_s record;
  v_res jsonb;
  v_key text := NULLIF(btrim(COALESCE(p_idempotency_key, '')), '');
BEGIN
  v_me := public._cr_require_caller();
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Clé d''idempotence obligatoire pour la clôture' USING ERRCODE = '22023';
  END IF;
  SELECT cs.id, cs.status, cs.user_id, cs.close_request_id, cs.closing_amount, cs.theoretical_amount, cs.variance
  INTO v_s FROM cash_sessions cs
  WHERE cs.id = p_session_id AND cs.tenant_id = v_me.tenant_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session de caisse introuvable ou déjà clôturée' USING ERRCODE = '42501';
  END IF;
  IF v_s.status <> 'open' THEN
    IF v_s.close_request_id = v_key THEN
      RETURN jsonb_build_object('success', true, 'replayed', true, 'counted_total', v_s.closing_amount,
        'theoretical_total', v_s.theoretical_amount, 'variance', v_s.variance);
    END IF;
    RAISE EXCEPTION 'Session de caisse introuvable ou déjà clôturée' USING ERRCODE = '42501';
  END IF;

  v_res := public.close_cash_session_v2(p_session_id, p_control_lines, p_closing_note, p_vault_deposit_amount, v_key);
  PERFORM set_config('waarwi.cs_close_session', p_session_id::text, true);
  UPDATE cash_sessions SET close_request_id = v_key WHERE id = p_session_id;

  IF v_s.user_id IS DISTINCT FROM v_me.id THEN
    INSERT INTO audit_logs (tenant_id, user_id, action, module, reference_id, old_value, new_value)
    VALUES (v_me.tenant_id, v_me.id, 'cash_session_admin_closed', 'cash_registers', p_session_id,
            jsonb_build_object('owner', v_s.user_id), v_res);
  END IF;
  RETURN v_res || jsonb_build_object('replayed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.cash_pos_context(p_site_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
      'operator_name', CASE WHEN os.id IS NOT NULL AND os.user_id <> v_me.id THEN op.full_name END
    ) ORDER BY r.is_default DESC, lower(r.code)), '[]'::jsonb)
  INTO v_regs
  FROM cash_registers r
  LEFT JOIN LATERAL (SELECT cs.id, cs.user_id FROM cash_sessions cs
                     WHERE cs.cash_register_id = r.id AND cs.status = 'open'
                     ORDER BY cs.opened_at DESC LIMIT 1) os ON true
  LEFT JOIN profiles op ON op.id = os.user_id
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
$$;

CREATE OR REPLACE FUNCTION public.my_operational_cash_session(p_site_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_me public.profiles;
  v_multi boolean;
  v_sid uuid;
BEGIN
  v_me := public._cr_require_caller();
  v_multi := public._cs_multi_enabled(v_me.tenant_id);
  IF NOT v_multi THEN
    SELECT cs.id INTO v_sid FROM cash_sessions cs
    WHERE cs.tenant_id = v_me.tenant_id AND cs.site_id = p_site_id AND cs.status = 'open'
    ORDER BY cs.opened_at DESC LIMIT 1;
  ELSE
    SELECT cs.id INTO v_sid FROM cash_sessions cs
    WHERE cs.tenant_id = v_me.tenant_id AND cs.site_id = p_site_id AND cs.status = 'open' AND cs.user_id = v_me.id
      AND public._cs_profile_can_use_register(v_me.id, cs.cash_register_id)
    ORDER BY cs.opened_at DESC LIMIT 1;
  END IF;
  RETURN jsonb_build_object('multi_enabled', v_multi,
    'session', CASE WHEN v_sid IS NOT NULL THEN public._cs_session_payload(v_sid, true) END);
END;
$$;

DO $$
DECLARE
  m   text := '(SELECT NOT public._cs_multi_current())';
  sup text := 'site_id = ANY ((SELECT public._cs_supervised_site_ids())::uuid[])';
  vis text := ' IN (SELECT cs.id FROM public.cash_sessions cs)';
  own text := ' IN (SELECT cs.id FROM public.cash_sessions cs WHERE cs.user_id = auth.uid())';
  elev text := '(SELECT public._cs_is_elevated())';
  e_generic text;
  e_generic_own text;
  e_ret text;
  r record;
BEGIN
  e_generic := format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE (user_id = auth.uid() OR %s) END))', m, vis, sup);
  e_generic_own := format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE (user_id = auth.uid() OR %s) END))', m, own, sup);
  e_ret := format('(%s OR (cash_session_id IS NOT NULL AND cash_session_id%s) OR (refund_cash_session_id IS NOT NULL AND refund_cash_session_id%s) OR (cash_session_id IS NULL AND refund_cash_session_id IS NULL AND (user_id = auth.uid() OR %s)))', m, vis, vis, sup);

  FOR r IN SELECT * FROM (VALUES
    ('cash_sessions','SELECT', format('(%s OR user_id = auth.uid() OR %s)', m, sup)),
    ('cash_sessions','INSERT', m),
    ('cash_sessions','UPDATE', format('(%s OR user_id = auth.uid())', m)),
    ('sales','SELECT', e_generic), ('sales','INSERT', e_generic), ('sales','UPDATE', e_generic),
    ('sale_items','SELECT', format('(%s OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id))', m)),
    ('sale_items','INSERT', format('(%s OR EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_items.sale_id))', m)),
    ('sale_payments','SELECT', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_payments.sale_id) END))', m, vis)),
    ('sale_payments','INSERT', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE EXISTS (SELECT 1 FROM public.sales s WHERE s.id = sale_payments.sale_id) END))', m, own)),
    ('sale_returns','SELECT', e_ret), ('sale_returns','INSERT', e_ret), ('sale_returns','UPDATE', e_ret),
    ('sale_return_items','SELECT', format('(%s OR EXISTS (SELECT 1 FROM public.sale_returns sr WHERE sr.id = sale_return_items.return_id))', m)),
    ('sale_return_items','INSERT', format('(%s OR EXISTS (SELECT 1 FROM public.sale_returns sr WHERE sr.id = sale_return_items.return_id))', m)),
    ('customer_payments','SELECT', e_generic),
    ('held_carts','SELECT', e_generic), ('held_carts','INSERT', e_generic_own),
    ('held_carts','UPDATE', e_generic_own), ('held_carts','DELETE', e_generic_own),
    ('cash_movements','SELECT', e_generic), ('cash_movements','INSERT', e_generic_own),
    ('cash_movements','UPDATE', e_generic_own), ('cash_movements','DELETE', e_generic_own),
    ('cash_regularizations','SELECT', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE (user_id = auth.uid() OR %s) END))', m, vis, elev)),
    ('cash_regularizations','INSERT', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE user_id = auth.uid() END))', m, own)),
    ('cash_regularizations','UPDATE', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE user_id = auth.uid() END))', m, own)),
    ('cash_regularizations','DELETE', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE user_id = auth.uid() END))', m, own)),
    ('cash_control_lines','SELECT', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE %s END))', m, vis, elev)),
    ('cash_control_lines','INSERT', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE %s END))', m, own, elev)),
    ('cash_control_lines','UPDATE', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE %s END))', m, own, elev)),
    ('cash_control_lines','DELETE', format('(%s OR (CASE WHEN cash_session_id IS NOT NULL THEN cash_session_id%s ELSE %s END))', m, own, elev))
  ) AS v(tbl, cmd, expr) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'mc1d ' || lower(r.cmd), r.tbl);
    IF r.cmd IN ('SELECT', 'DELETE') THEN
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR %s TO authenticated USING (%s)',
                     'mc1d ' || lower(r.cmd), r.tbl, r.cmd, r.expr);
    ELSIF r.cmd = 'INSERT' THEN
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (%s)',
                     'mc1d ' || lower(r.cmd), r.tbl, r.expr);
    ELSE
      EXECUTE format('CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',
                     'mc1d ' || lower(r.cmd), r.tbl, r.expr, r.expr);
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public._cs_multi_enabled(uuid)', 'public._cs_profile_is_elevated(uuid)',
    'public._cs_profile_can_supervise_site(uuid,uuid)', 'public._cs_profile_can_use_register(uuid,uuid)',
    'public._cs_session_payload(uuid,boolean)', 'public._cs_lock_open_keys(uuid,uuid,uuid)',
    'public._cs_assert_operational(uuid,uuid,uuid)', 'public._cs_assert_can_close(uuid,text)',
    'public._cs_multi_anomalies(uuid,boolean)', 'public._cs_caller_can_toggle(uuid)',
    'public._trg_cs_open_guard()', 'public._trg_cs_row_guard()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;

  FOREACH f IN ARRAY ARRAY[
    'public._cs_multi_current()', 'public._cs_supervised_site_ids()', 'public._cs_is_elevated()',
    'public._cs_assert_session_readable(uuid)',
    'public.cash_multi_status()', 'public.cash_multi_set_enabled(boolean)',
    'public.cash_session_open(uuid,numeric,text,text)', 'public.cash_session_close(uuid,jsonb,text,numeric,text)',
    'public.cash_pos_context(uuid)', 'public.my_operational_cash_session(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
