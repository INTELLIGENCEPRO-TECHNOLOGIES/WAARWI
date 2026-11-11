/*
# Essai manuel ciblé de la sauvegarde v3 (tenant unique, propriétaire unique)

## Résumé
Permet au seul propriétaire autorisé d'un seul tenant de lancer lui-même une sauvegarde v3 manuelle
depuis Paramètres → Sauvegardes, puis d'en suivre l'avancement. Réutilise la file `_br_backup_jobs`,
la capture hors HTTP (`_br_capture_executor_run`), l'export par blocs, le stockage privé et la vérification
du lot C. Rien ne s'exécute tant que le bouton n'a pas été cliqué.

## 1. Nouvelle table
- `_br_v3_manual_test_target` (singleton, id = 1) : `tenant_id` et `user_id` autorisés, `armed`,
  `job_id` (dernier travail d'essai), `requested_at`, `runner_token` (jeton aléatoire interne, jamais exposé),
  `functions_base_url` (adresse des fonctions du projet). Aucune ligne n'est insérée par cette migration :
  la cible est configurée séparément pour le projet concerné. La table est déclarée `excluded` dans
  `_br_table_registry` (métadonnée de sauvegarde, jamais capturée ni restaurée).

## 2. Nouvelles fonctions
- `br_v3_manual_test_request()` (authenticated) : vérifie identité, rattachement au tenant, statut de propriétaire
  et les deux UUID autorisés ; renvoie le travail actif existant (double clic / rafraîchissement) ou en crée un via
  `_br_v3_request_capture` ; programme les deux tâches temporaires de l'essai.
- `br_v3_manual_test_status()` (authenticated) : mêmes contrôles ; état lisible, durée, blocs, motif d'échec.
- `_br_v3_mt_capture_claim()` : prise CIBLÉE du seul travail d'essai (tenant + job_id vérifiés sous verrou),
  puis capture par l'exécuteur existant. Ne prend jamais un autre travail.
- `_br_v3_mt_export_claim(text)` (service_role) : copie ciblée de `_br_v3_export_claim` limitée à l'archive
  du travail d'essai. Le claim général reste désactivé (`_br_v3_export_config.enabled = false`).
- `_br_v3_mt_runner_ok(text)` (service_role) : contrôle du jeton interne de l'appel cron → Edge.
- `_br_v3_mt_schedule(boolean)`, `_br_v3_mt_runner_token()`, `_br_v3_mt_authorize()`, `_br_v3_mt_state(uuid)` : internes.

## 3. Tâches temporaires
`br_v3_trial_capture` et `br_v3_trial_export` (chaque minute) créées uniquement au clic, supprimées
automatiquement dès que le travail d'essai est terminé (succès ou échec).

## 4. Sécurité
RLS active sans politique sur la nouvelle table ; aucun droit anon/authenticated/service_role.
EXECUTE retiré à PUBLIC/anon ; seuls les deux RPC d'essai sont ouverts à authenticated.
Restauration, réinitialisation et import inchangés (BR020 actif). Exécuteur général et export général
restent désactivés. Aucun changement de permissions métier.
*/

CREATE TABLE IF NOT EXISTS public._br_v3_manual_test_target (
  id                 smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  tenant_id          uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL,
  armed              boolean NOT NULL DEFAULT false,
  job_id             uuid,
  requested_at       timestamptz,
  runner_token       text NOT NULL DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  functions_base_url text CHECK (functions_base_url IS NULL OR functions_base_url ~ '^https://[a-z0-9.-]+/functions/v1$'),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public._br_v3_manual_test_target ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._br_v3_manual_test_target FROM PUBLIC, anon, authenticated, service_role;

-- Table de configuration de l'essai, jamais capturée ni restaurée (sinon contrôle de dérive en échec).
INSERT INTO public._br_table_registry
  (schema_name, table_name, tenant_link, tenant_id_column, category, restore_order, reset_behavior, is_mandatory, exclusion_reason)
SELECT 'public', '_br_v3_manual_test_target', 'excluded', 'tenant_id', 'backup_system', 0, 'preserve', false,
       'v3 manual test target — backup configuration, never restored as tenant data'
WHERE NOT EXISTS (SELECT 1 FROM public._br_table_registry r
                  WHERE r.schema_name = 'public' AND r.table_name = '_br_v3_manual_test_target');

CREATE OR REPLACE FUNCTION public._br_v3_mt_authorize()
RETURNS public._br_v3_manual_test_target LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'BRT-401: authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO t FROM public._br_v3_manual_test_target WHERE id = 1;
  IF NOT FOUND OR NOT t.armed OR t.user_id IS DISTINCT FROM v_uid
     OR NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.tenant_id = t.tenant_id)
     OR NOT EXISTS (SELECT 1 FROM public.tenants x WHERE x.id = t.tenant_id AND x.owner_user_id = v_uid) THEN
    RAISE EXCEPTION 'BRT-403: manual v3 test not allowed for this account' USING ERRCODE = '42501';
  END IF;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_mt_runner_token()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT t.runner_token FROM public._br_v3_manual_test_target t WHERE t.id = 1 AND t.armed;
$$;

CREATE OR REPLACE FUNCTION public._br_v3_mt_runner_ok(p_token text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((SELECT t.armed AND t.job_id IS NOT NULL AND p_token IS NOT NULL
                          AND md5(t.runner_token) = md5(p_token)
                   FROM public._br_v3_manual_test_target t WHERE t.id = 1), false);
$$;

CREATE OR REPLACE FUNCTION public._br_v3_mt_schedule(p_enable boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
  v_timeout integer;
BEGIN
  IF NOT coalesce(p_enable, false) THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'br_v3_trial_capture') THEN
      PERFORM cron.unschedule('br_v3_trial_capture');
    END IF;
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'br_v3_trial_export') THEN
      PERFORM cron.unschedule('br_v3_trial_export');
    END IF;
    RETURN jsonb_build_object('scheduled', false);
  END IF;
  SELECT * INTO t FROM public._br_v3_manual_test_target WHERE id = 1;
  IF NOT FOUND OR NOT t.armed OR t.functions_base_url IS NULL THEN
    RAISE EXCEPTION 'BRT-409: manual test runner not configured' USING ERRCODE = '55000';
  END IF;
  SELECT c.capture_timeout_seconds INTO v_timeout FROM public._br_capture_executor_config c WHERE c.id;
  PERFORM cron.schedule('br_v3_trial_capture', '* * * * *',
    format('SELECT public._br_v3_mt_capture_claim(); COMMIT; SET LOCAL statement_timeout = %L; SELECT public._br_capture_executor_run();',
           v_timeout || 's'));
  PERFORM cron.schedule('br_v3_trial_export', '* * * * *',
    format($f$SELECT net.http_post(url := %L, headers := jsonb_build_object('Content-Type', 'application/json', 'X-Trial-Token', public._br_v3_mt_runner_token()), body := '{"action":"run_trial_export"}'::jsonb, timeout_milliseconds := 150000)$f$,
           t.functions_base_url || '/backup-export-v3'));
  RETURN jsonb_build_object('scheduled', true);
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_mt_state(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j public._br_backup_jobs%ROWTYPE;
  a public._br_v3_archives%ROWTYPE;
  v_state text;
  v_end timestamptz;
  v_code text;
  v_reason text;
BEGIN
  IF p_job_id IS NULL THEN
    RETURN jsonb_build_object('state', 'none');
  END IF;
  SELECT * INTO j FROM public._br_backup_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'none');
  END IF;
  SELECT * INTO a FROM public._br_v3_archives x WHERE x.job_id = j.id
  ORDER BY (x.status = 'verified') DESC, x.created_at DESC LIMIT 1;

  v_state := CASE
    WHEN j.status = 'succeeded' AND a.status = 'verified' AND a.manifest_path IS NOT NULL
         AND a.blocks_verified = a.block_count THEN 'verified'
    WHEN j.status IN ('failed', 'cancelled') THEN 'failed'
    WHEN j.status = 'pending' THEN 'pending'
    WHEN j.status IN ('leased', 'processing') THEN 'capturing'
    ELSE 'exporting' END;
  IF v_state IN ('verified', 'failed') THEN
    v_end := coalesce(a.verified_at, j.finished_at, a.finished_at);
  END IF;
  IF v_state = 'failed' OR (v_state = 'pending' AND j.attempts > 0) THEN
    v_code := coalesce(j.error_code, CASE WHEN a.status IN ('failed', 'abandoned') THEN a.error_code END);
  ELSIF v_state = 'exporting' AND a.transient_errors > 0 THEN
    v_code := a.error_code;
  END IF;
  v_reason := CASE
    WHEN v_code IS NULL THEN NULL
    WHEN v_code = 'BRJ-051' THEN 'La structure de la base a changé : capture refusée par sécurité.'
    WHEN v_code IN ('BRJ-043', 'CAPTURE_CANCELED') THEN 'La capture a dépassé la durée autorisée.'
    WHEN v_code = 'LEASE_EXPIRED' THEN 'Le traitement a été interrompu avant la fin.'
    WHEN v_code = 'BRJ-060' THEN 'Les sauvegardes sont suspendues pour cette entreprise.'
    WHEN v_code = 'BRV-044' THEN 'La clé de chiffrement est indisponible.'
    WHEN v_code LIKE 'BRV-03%' THEN 'La vérification d''un bloc stocké a échoué.'
    WHEN v_code LIKE 'BRV-04%' THEN 'La publication du manifeste a échoué.'
    WHEN v_code = 'JOB_DETACHED' THEN 'La capture a été remplacée pendant l''export.'
    WHEN v_code LIKE 'BRV-%' THEN 'L''export des blocs a échoué.'
    ELSE 'La sauvegarde a rencontré une erreur.' END;

  RETURN jsonb_build_object(
    'state', v_state,
    'job_id', j.id,
    'requested_at', j.created_at,
    'finished_at', v_end,
    'duration_ms', CASE WHEN v_end IS NOT NULL THEN (extract(epoch FROM v_end - j.created_at) * 1000)::bigint END,
    'block_count', coalesce(a.block_count, CASE WHEN a.id IS NOT NULL THEN a.next_block_no - 1 END),
    'blocks_verified', a.blocks_verified,
    'attempts', j.attempts,
    'max_attempts', j.max_attempts,
    'retry_at', CASE WHEN v_state = 'pending' AND j.attempts > 0 THEN j.next_attempt_at END,
    'error_code', CASE WHEN v_code ~ '^[A-Z_]{2,20}(-[0-9A-Z]{3,5})?$' THEN v_code END,
    'reason', v_reason);
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_mt_capture_claim()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
  j public._br_backup_jobs%ROWTYPE;
  cfg public._br_capture_executor_config%ROWTYPE;
  v_slot smallint;
  v_con text;
  v_lease integer;
  v_worker text := 'trial:' || pg_backend_pid();
BEGIN
  PERFORM set_config('waarwi.br_executor_claim', '', false);
  SELECT * INTO t FROM public._br_v3_manual_test_target WHERE id = 1;
  IF NOT FOUND OR NOT t.armed OR t.job_id IS NULL THEN
    RETURN jsonb_build_object('state', 'idle');
  END IF;
  SELECT * INTO j FROM public._br_backup_jobs x WHERE x.id = t.job_id AND x.tenant_id = t.tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'idle');
  END IF;
  IF j.status IN ('succeeded', 'failed', 'cancelled') THEN
    PERFORM public._br_v3_mt_schedule(false);
    RETURN jsonb_build_object('state', 'finished', 'status', j.status);
  END IF;
  IF j.status IN ('leased', 'processing') AND j.lease_expires_at < now() THEN
    IF public._br_job_try_reconcile(j.id, 'recover_expired') IS NULL THEN
      PERFORM public._br_job_apply_failure(j.id, 'LEASE_EXPIRED', 'Lease expired before completion', 300,
                                           'lease_expired_recovered');
    END IF;
    SELECT * INTO j FROM public._br_backup_jobs x WHERE x.id = t.job_id;
  END IF;
  IF j.status <> 'pending' OR j.next_attempt_at > now() THEN
    RETURN jsonb_build_object('state', 'idle', 'status', j.status);
  END IF;

  SELECT * INTO cfg FROM public._br_capture_executor_config c WHERE c.id;
  v_lease := cfg.capture_timeout_seconds + cfg.lease_margin_seconds;
  FOR v_slot IN
    SELECT s.slot_no FROM public._br_capture_slots s
    WHERE NOT EXISTS (SELECT 1 FROM public._br_backup_jobs o WHERE o.slot_no = s.slot_no)
    ORDER BY s.slot_no
  LOOP
    BEGIN
      UPDATE public._br_backup_jobs x
         SET status = 'leased', attempts = x.attempts + 1, claim_fence = x.claim_fence + 1,
             slot_no = v_slot, worker_id = v_worker, lease_token = gen_random_uuid(),
             lease_started_at = now(), lease_expires_at = now() + make_interval(secs => v_lease),
             heartbeat_at = now(), error_class = NULL
       WHERE x.id = t.job_id AND x.tenant_id = t.tenant_id AND x.status = 'pending'
      RETURNING x.* INTO j;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('state', 'idle');
      END IF;
      PERFORM public._br_job_log(j.id, j.tenant_id, 'leased', 'pending', 'leased', j.attempts, v_worker,
        jsonb_build_object('lease_seconds', v_lease, 'claim_fence', j.claim_fence, 'slot_no', j.slot_no,
                           'manual_test', true));
      PERFORM public._br_job_mark_processing(j.id, j.lease_token);
      PERFORM set_config('waarwi.br_executor_claim',
        jsonb_build_object('job_id', j.id, 'lease_token', j.lease_token)::text, false);
      RETURN jsonb_build_object('state', 'claimed', 'job_id', j.id, 'attempt', j.attempts);
    EXCEPTION WHEN unique_violation THEN
      GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
      IF v_con = 'uq_br_backup_jobs_slot' THEN
        CONTINUE;
      ELSIF v_con = 'uq_br_backup_jobs_one_active_per_tenant' THEN
        RETURN jsonb_build_object('state', 'busy');
      ELSE
        RAISE;
      END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('state', 'no_slot');
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_mt_export_claim(p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
  cfg public._br_v3_export_config%ROWTYPE;
  a public._br_v3_archives%ROWTYPE;
  j public._br_backup_jobs%ROWTYPE;
  v_id uuid;
  v_chk jsonb;
  v_reg text;
BEGIN
  IF p_worker_id IS NULL OR char_length(p_worker_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'BRV-001: invalid worker_id' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO t FROM public._br_v3_manual_test_target WHERE id = 1;
  IF NOT FOUND OR NOT t.armed OR t.job_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT * INTO cfg FROM public._br_v3_export_config WHERE id = 1;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  FOR a IN SELECT * FROM public._br_v3_archives x
           WHERE x.job_id = t.job_id AND x.tenant_id = t.tenant_id
             AND x.status IN ('exporting','verifying','publishing')
             AND (x.export_lease_expires_at IS NULL OR x.export_lease_expires_at <= clock_timestamp())
           ORDER BY x.created_at, x.id
           FOR UPDATE SKIP LOCKED
  LOOP
    IF NOT public._br_v3_binding_ok(a) THEN
      PERFORM public._br_v3_terminate(a.id, 'abandoned', 'JOB_DETACHED', 'Job or generation changed during export');
      CONTINUE;
    END IF;
    IF a.export_claims >= cfg.max_export_claims THEN
      PERFORM public._br_v3_terminate(a.id, 'failed', 'BRV-046', 'Too many export attempts');
      CONTINUE;
    END IF;
    v_id := a.id;
    EXIT;
  END LOOP;

  IF v_id IS NULL THEN
    SELECT * INTO j FROM public._br_backup_jobs x
    WHERE x.id = t.job_id AND x.tenant_id = t.tenant_id
      AND x.status = 'capture_ready' AND x.capture_generation_id IS NOT NULL
    FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      v_chk := public._br_capture_verify_staging(j.capture_generation_id, true);
      IF coalesce((v_chk->>'ok')::boolean, false) THEN
        SELECT md5(string_agg(r.schema_name || '.' || r.table_name || ':' || r.tenant_link || ':' ||
                              coalesce(r.tenant_id_column, '') || ':' || coalesce(r.parent_table, '') || ':' ||
                              r.restore_order, '|' ORDER BY r.schema_name, r.table_name))
          INTO v_reg FROM public._br_table_registry r;
        v_id := gen_random_uuid();
        INSERT INTO public._br_v3_archives (id, tenant_id, job_id, generation_id, storage_bucket, storage_prefix,
          registry_fingerprint, block_target_bytes, row_max_bytes, max_rows_per_block)
        VALUES (v_id, j.tenant_id, j.id, j.capture_generation_id, cfg.storage_bucket,
          format('tenants/%s/archives/%s/', j.tenant_id, v_id), v_reg,
          cfg.block_target_bytes, cfg.row_max_bytes, cfg.max_rows_per_block);
        UPDATE public._br_backup_jobs SET status = 'exporting', heartbeat_at = now() WHERE id = j.id;
        PERFORM public._br_job_log(j.id, j.tenant_id, 'export_started', 'capture_ready', 'exporting', j.attempts,
          p_worker_id, jsonb_build_object('archive_id', v_id, 'generation_id', j.capture_generation_id,
                                          'manual_test', true));
      END IF;
    END IF;
  END IF;

  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public._br_v3_archives
     SET export_fence = export_fence + 1, export_lease_token = gen_random_uuid(),
         export_lease_expires_at = clock_timestamp() + make_interval(secs => cfg.lease_seconds),
         export_worker_id = p_worker_id, export_claims = export_claims + 1
   WHERE id = v_id
  RETURNING * INTO a;

  RETURN jsonb_build_object('archive_id', a.id, 'tenant_id', a.tenant_id, 'job_id', a.job_id,
    'generation_id', a.generation_id, 'status', a.status, 'export_fence', a.export_fence,
    'lease_token', a.export_lease_token, 'lease_expires_at', a.export_lease_expires_at,
    'storage_bucket', a.storage_bucket, 'storage_prefix', a.storage_prefix, 'key_id', a.key_id,
    'next_block_no', a.next_block_no, 'blocks_verified', a.blocks_verified, 'block_count', a.block_count,
    'block_target_bytes', a.block_target_bytes, 'row_max_bytes', a.row_max_bytes,
    'max_blocks_per_invocation', cfg.max_blocks_per_invocation);
END $$;

CREATE OR REPLACE FUNCTION public.br_v3_manual_test_request()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
  v_status text;
  v_req jsonb;
  v_job uuid;
BEGIN
  t := public._br_v3_mt_authorize();
  PERFORM 1 FROM public._br_v3_manual_test_target WHERE id = 1 FOR UPDATE;
  t := public._br_v3_mt_authorize();
  IF t.job_id IS NOT NULL THEN
    SELECT j.status INTO v_status FROM public._br_backup_jobs j WHERE j.id = t.job_id AND j.tenant_id = t.tenant_id;
    IF v_status IS NOT NULL AND v_status NOT IN ('succeeded', 'failed', 'cancelled') THEN
      PERFORM public._br_v3_mt_schedule(true);
      RETURN public._br_v3_mt_state(t.job_id) || jsonb_build_object('created', false);
    END IF;
  END IF;
  v_req := public._br_v3_request_capture(t.tenant_id,
    'manual_test:' || to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYYMMDD"T"HH24MISSMS'), 'platform_manual', 3);
  v_job := (v_req->>'job_id')::uuid;
  UPDATE public._br_v3_manual_test_target SET job_id = v_job, requested_at = now(), updated_at = now() WHERE id = 1;
  PERFORM public._br_v3_mt_schedule(true);
  RETURN public._br_v3_mt_state(v_job) || jsonb_build_object('created', coalesce((v_req->>'created')::boolean, false));
END $$;

CREATE OR REPLACE FUNCTION public.br_v3_manual_test_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_manual_test_target%ROWTYPE;
BEGIN
  t := public._br_v3_mt_authorize();
  RETURN public._br_v3_mt_state(t.job_id);
END $$;

REVOKE ALL ON FUNCTION
  public._br_v3_mt_authorize(),
  public._br_v3_mt_runner_token(),
  public._br_v3_mt_runner_ok(text),
  public._br_v3_mt_schedule(boolean),
  public._br_v3_mt_state(uuid),
  public._br_v3_mt_capture_claim(),
  public._br_v3_mt_export_claim(text),
  public.br_v3_manual_test_request(),
  public.br_v3_manual_test_status()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public._br_v3_mt_runner_ok(text), public._br_v3_mt_export_claim(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.br_v3_manual_test_request(), public.br_v3_manual_test_status() TO authenticated;
