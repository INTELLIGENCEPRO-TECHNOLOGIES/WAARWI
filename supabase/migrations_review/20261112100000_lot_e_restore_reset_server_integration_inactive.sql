/*
# Lot E — intégration serveur de la restauration v3 et de la réinitialisation globales (INACTIVE)

Prérequis : migration lot D (20261112090000_lot_d_safe_restore_reset_inactive.sql).
Livrée pour revue, NON appliquée en production.

1. Nouvelles fonctions (service_role uniquement, appelées par l'Edge Function backup-export-v3)
   - `_br_rs_api_request(acteur, opération, archive)` : 'reset' ou 'restore_v3' ; tenant déduit du profil de l'acteur
     (jamais du corps de la requête) ; BR020 vérifié en premier.
   - `_br_rs_api_execute(acteur, travail)` : BR020, acteur propriétaire/super_admin du tenant du travail, archive v3
     vérifiée capturée après la demande (sauvegarde de sécurité exploitable), sinon BRR-080 sans aucune mutation.
   - `_br_rs_api_status`, `_br_rs_api_abandon`, `_br_rs_api_next_v3_load`, `_br_rs_api_request_safety`.
2. Exécuteur planifiable
   - `_br_rs_executor_next(worker)` (procédure) : récupération, BR020, puis un travail demandé via `_br_rs_executor`.
   - `_br_rs_executor_schedule(bool)` : crée/supprime la tâche pg_cron 'br_restore_executor'. JAMAIS appelée ici.
3. Colonne `_br_restore_jobs.safety_archive_id` (archive v3 de sécurité retenue à la demande d'exécution).

Sécurité
1. Aucune fonction accordée à anon/authenticated ; l'exécuteur et sa planification ne sont accordés à aucun rôle d'API.
2. Aucune activation : `_br_restore_config.enabled` reste false, aucun cron, aucun crochet installé, BR020 inchangé.
3. Portée : tous les magasins du tenant (`all_sites`). Opérations par magasin reportées.
*/

ALTER TABLE public._br_restore_jobs ADD COLUMN IF NOT EXISTS safety_archive_id uuid;

CREATE OR REPLACE FUNCTION public._br_rs_api_tenant(p_actor uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.tenant_id FROM public.profiles p WHERE p.id = p_actor AND coalesce(p.is_active, true);
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_request(p_actor uuid, p_operation text, p_archive uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid;
BEGIN
  PERFORM public._br_rs_assert_server();
  PERFORM public._br_assert_destructive_available();
  v_tenant := public._br_rs_api_tenant(p_actor);
  IF v_tenant IS NULL OR NOT public._br_rs_actor_ok(p_actor, v_tenant) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;
  IF p_operation = 'reset' THEN
    RETURN public._br_rs_request_reset(v_tenant, p_actor);
  ELSIF p_operation = 'restore_v3' THEN
    IF p_archive IS NULL THEN RAISE EXCEPTION 'BRR-404: source not found' USING ERRCODE = 'P0002'; END IF;
    RETURN public._br_rs_request_restore(v_tenant, p_actor, 3, p_archive);
  END IF;
  RAISE EXCEPTION 'BRR-010: unsupported operation' USING ERRCODE = '22023';
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_api_safety_archive(p_tenant uuid, p_since timestamptz) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.id FROM public._br_v3_archives a JOIN public._br_capture_generations g ON g.id = a.generation_id
  WHERE a.tenant_id = p_tenant AND a.status = 'verified' AND g.captured_at >= p_since
  ORDER BY g.captured_at DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public._br_rs_api_execute(p_actor uuid, p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; v_safety uuid; v_r jsonb;
BEGIN
  PERFORM public._br_rs_assert_server();
  PERFORM public._br_assert_destructive_available();
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job;
  IF NOT FOUND OR j.tenant_id IS DISTINCT FROM public._br_rs_api_tenant(p_actor) THEN
    RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002';
  END IF;
  v_safety := public._br_rs_api_safety_archive(j.tenant_id, j.created_at);
  IF v_safety IS NULL THEN
    RAISE EXCEPTION 'BRR-080: a verified v3 safety archive captured after the request is required'
      USING ERRCODE = '55000';
  END IF;
  v_r := public._br_rs_request_execute(p_job, p_actor);
  UPDATE public._br_restore_jobs SET safety_archive_id = v_safety WHERE id = p_job;
  RETURN v_r || jsonb_build_object('safety_archive_id', v_safety);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_api_status(p_actor uuid, p_job uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid; j public._br_restore_jobs%ROWTYPE;
BEGIN
  PERFORM public._br_rs_assert_server();
  v_tenant := public._br_rs_api_tenant(p_actor);
  IF v_tenant IS NULL OR NOT public._br_rs_actor_ok(p_actor, v_tenant) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO j FROM public._br_restore_jobs r
  WHERE r.tenant_id = v_tenant AND (p_job IS NULL OR r.id = p_job)
  ORDER BY r.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('job', NULL, 'scope', 'all_sites'); END IF;
  RETURN jsonb_build_object('scope', 'all_sites', 'job', jsonb_build_object(
    'id', j.id, 'operation', j.operation, 'status', j.status, 'source_archive_id', j.source_archive_id,
    'execute_requested', j.execute_requested_at IS NOT NULL, 'safety_archive_id', j.safety_archive_id,
    'error_code', j.error_code, 'created_at', j.created_at, 'finished_at', j.finished_at,
    'maintenance', EXISTS (SELECT 1 FROM public._br_tenant_maintenance m WHERE m.job_id = j.id)));
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_api_abandon(p_actor uuid, p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._br_rs_assert_server();
  IF NOT EXISTS (SELECT 1 FROM public._br_restore_jobs j
                 WHERE j.id = p_job AND j.tenant_id = public._br_rs_api_tenant(p_actor)) THEN
    RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN public._br_rs_abandon(p_job, p_actor);
END $$;

-- Demande la capture v3 de sécurité du tenant du travail (non destructive, hors BR020).
CREATE OR REPLACE FUNCTION public._br_rs_api_request_safety(p_actor uuid, p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job;
  IF NOT FOUND OR j.tenant_id IS DISTINCT FROM public._br_rs_api_tenant(p_actor)
     OR NOT public._br_rs_actor_ok(p_actor, j.tenant_id) THEN
    RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002';
  END IF;
  IF j.status NOT IN ('preparing','prepared') THEN
    RAISE EXCEPTION 'BRR-003: job is %', j.status USING ERRCODE = '55000';
  END IF;
  RETURN public._br_v3_request_capture(j.tenant_id, 'pre-op:' || j.id::text, 'platform_manual');
END $$;

-- Prochain travail v3 à charger (worker Edge déclenché par le planificateur) : non loué, en préparation.
CREATE OR REPLACE FUNCTION public._br_rs_api_next_v3_load() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT j.id FROM public._br_restore_jobs j
  WHERE j.status = 'preparing' AND j.source_format = 3
    AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= clock_timestamp())
  ORDER BY j.created_at LIMIT 1;
$$;

-- Commande pg_cron exacte : CALL public._br_rs_executor_next('pg_cron') (instruction unique, COMMIT internes).
CREATE OR REPLACE PROCEDURE public._br_rs_executor_next(p_worker text DEFAULT 'pg_cron')
LANGUAGE plpgsql AS $$
DECLARE v_job uuid; v_res jsonb;
BEGIN
  PERFORM public._br_rs_recover();
  COMMIT;
  PERFORM public._br_assert_destructive_available();
  SELECT j.id INTO v_job FROM public._br_restore_jobs j
  WHERE j.status = 'prepared' AND j.execute_requested_at IS NOT NULL
    AND (j.lease_expires_at IS NULL OR j.lease_expires_at <= clock_timestamp())
  ORDER BY j.execute_requested_at LIMIT 1;
  IF v_job IS NULL THEN RETURN; END IF;
  CALL public._br_rs_executor(v_job, left(coalesce(p_worker, 'pg_cron'), 64) || ':' || pg_backend_pid(), v_res);
END $$;

-- Activation future, à appeler explicitement (jamais par cette migration).
CREATE OR REPLACE FUNCTION public._br_rs_executor_schedule(p_enable boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_enabled boolean;
BEGIN
  IF p_enable IS NULL THEN RAISE EXCEPTION 'BRR-001: p_enable required' USING ERRCODE = '22023'; END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'br_restore_executor') THEN
    PERFORM cron.unschedule('br_restore_executor');
  END IF;
  IF NOT p_enable THEN RETURN jsonb_build_object('scheduled', false); END IF;
  SELECT c.enabled INTO v_enabled FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  IF NOT coalesce((public._br_lotd_hooks_status() ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'BRR-070: write gate and trigger guards are not installed' USING ERRCODE = '55000';
  END IF;
  PERFORM cron.schedule('br_restore_executor', '* * * * *', 'CALL public._br_rs_executor_next(''pg_cron'')');
  RETURN jsonb_build_object('scheduled', true);
END $$;

DO $$
BEGIN
  REVOKE ALL ON FUNCTION public._br_rs_api_tenant(uuid), public._br_rs_api_request(uuid, text, uuid),
    public._br_rs_api_safety_archive(uuid, timestamptz), public._br_rs_api_execute(uuid, uuid),
    public._br_rs_api_status(uuid, uuid), public._br_rs_api_abandon(uuid, uuid), public._br_rs_api_next_v3_load(),
    public._br_rs_api_request_safety(uuid, uuid), public._br_rs_executor_schedule(boolean)
  FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON PROCEDURE public._br_rs_executor_next(text) FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON FUNCTION public._br_rs_executor_schedule(boolean) FROM service_role;
  GRANT EXECUTE ON FUNCTION public._br_rs_api_request(uuid, text, uuid), public._br_rs_api_execute(uuid, uuid),
    public._br_rs_api_status(uuid, uuid), public._br_rs_api_abandon(uuid, uuid), public._br_rs_api_next_v3_load(),
    public._br_rs_api_request_safety(uuid, uuid)
  TO service_role;
END $$;
