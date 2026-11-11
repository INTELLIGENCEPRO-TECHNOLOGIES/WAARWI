/*
# Lot B.1 — Exécuteur serveur de capture v3, hors requête HTTP (INACTIF)

## Résumé
La capture v3 ne s'exécute plus dans un appel HTTP. Une requête HTTP (service_role) ne fait que
DEMANDER un travail (`_br_v3_request_capture`, inchangée). L'exécution est confiée à un exécuteur
serveur prévu pour pg_cron, qui :
  1. réserve un job (transaction 1, validée par un COMMIT explicite dans la commande cron) ;
  2. fixe `statement_timeout` AVANT la capture (SET LOCAL), puis capture (transaction 2) ;
  3. enregistre succès, échec transitoire, dépassement de capacité ou erreur permanente.
Aucune tâche cron n'est créée. L'exécuteur est désactivé (`enabled = false`).

## 1. Nouvelle table `_br_capture_executor_config` (singleton, sans tenant)
- `enabled` (false par défaut) : l'exécuteur ne réserve rien tant que false.
- `capture_timeout_seconds` (900) : limite de durée de l'instruction de capture.
- `lease_margin_seconds` (120) : bail = limite + marge, donc le bail couvre toujours la capture.
- `max_capacity_failures` (2) : nombre de dépassements de durée/capacité avant échec définitif.
- `retry_backoff_seconds` (300).

## 2. `_br_backup_jobs`
- Nouvelle colonne `capacity_failures` (0) : dépassements de durée/capacité cumulés.
- `error_class` accepte désormais `capacity` (en plus de transient/permanent).

## 3. Fonctions
- `_br_capture_run` remplacée : suppression du `SET statement_timeout` de fonction (sans effet sur le
  minuteur de l'appelant) ; la capture exige une limite finie déjà fixée par l'appelant et un bail
  restant >= limite + 30 s (BRJ-044 / BRJ-041).
- Nouvelles : `_br_capture_executor_claim`, `_br_capture_executor_run`, `_br_capture_executor_command`,
  `_br_capture_executor_schedule` (activation future explicite, jamais appelée ici).

## 4. Sécurité
- RLS activée sur la table de configuration ; service_role : lecture seule.
- Les fonctions d'exécution ne sont accordées à AUCUN rôle d'API (seul le propriétaire, utilisé par pg_cron).
- `_br_capture_run` n'est plus exécutable par service_role : HTTP ne peut plus lancer de capture.

## 5. Notes
1. Aucune donnée existante modifiée ; aucune sauvegarde créée ; aucune tâche cron créée.
2. Réinitialisation, restauration et import restent bloqués (BR020), inchangé.
3. Rejouable sans effet.
*/

CREATE TABLE IF NOT EXISTS public._br_capture_executor_config (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled boolean NOT NULL DEFAULT false,
  capture_timeout_seconds integer NOT NULL DEFAULT 900 CHECK (capture_timeout_seconds BETWEEN 1 AND 3300),
  lease_margin_seconds integer NOT NULL DEFAULT 120 CHECK (lease_margin_seconds BETWEEN 60 AND 600),
  max_capacity_failures smallint NOT NULL DEFAULT 2 CHECK (max_capacity_failures BETWEEN 1 AND 5),
  retry_backoff_seconds integer NOT NULL DEFAULT 300 CHECK (retry_backoff_seconds BETWEEN 10 AND 3600),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT _br_capture_executor_config_lease_chk CHECK (capture_timeout_seconds + lease_margin_seconds <= 3600)
);
INSERT INTO public._br_capture_executor_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public._br_capture_executor_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public._br_capture_executor_config FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public._br_capture_executor_config TO service_role;
DROP POLICY IF EXISTS "service_role_select_executor_config" ON public._br_capture_executor_config;
CREATE POLICY "service_role_select_executor_config" ON public._br_capture_executor_config
  FOR SELECT TO service_role USING (true);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='_br_backup_jobs' AND column_name='capacity_failures') THEN
    ALTER TABLE public._br_backup_jobs ADD COLUMN capacity_failures smallint NOT NULL DEFAULT 0;
  END IF;
END $$;
ALTER TABLE public._br_backup_jobs DROP CONSTRAINT IF EXISTS _br_backup_jobs_error_class_chk;
ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_error_class_chk
  CHECK (error_class IS NULL OR error_class IN ('transient','permanent','capacity'));

CREATE OR REPLACE FUNCTION public._br_capture_run(p_job_id uuid, p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET work_mem = '64MB' AS $$
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
  v_timeout_ms bigint;
  v_drift jsonb;
  v_g uuid;
  v_gen_id uuid;
  v_gen_no integer;
  v_rec record;
  v_rel regclass;
  v_ord text;
  v_key text;
  v_fk text;
  v_pk text;
  v_ptcol text;
  v_n integer;
  v_parts text[] := '{}';
  v_tables text[] := '{}';
  v_keys text[] := '{}';
  v_total bigint;
  v_tables_n integer;
  v_global text;
  v_fp text;
BEGIN
  v_job := public._br_job_lock_owned(p_job_id, p_lease_token, true);
  IF v_job.status <> 'processing' THEN
    RAISE EXCEPTION 'BRJ-011: job % is not in processing state', p_job_id USING ERRCODE = '55000';
  END IF;
  -- Le minuteur de l'instruction appelante est déjà armé : seule cette valeur borne la capture.
  SELECT s.setting::bigint INTO v_timeout_ms FROM pg_settings s WHERE s.name = 'statement_timeout';
  IF coalesce(v_timeout_ms, 0) <= 0 THEN
    RAISE EXCEPTION 'BRJ-044: capture requires a finite statement_timeout fixed by the caller' USING ERRCODE = '55000';
  END IF;
  IF v_job.lease_expires_at - clock_timestamp() < make_interval(secs => v_timeout_ms / 1000.0 + 30) THEN
    RAISE EXCEPTION 'BRJ-041: remaining lease shorter than statement_timeout + 30 s' USING ERRCODE = '55000';
  END IF;

  v_drift := public.br_check_schema_drift();
  IF coalesce((v_drift->>'drift_detected')::boolean, true) THEN
    RAISE EXCEPTION 'BRJ-051: schema drift detected, capture refused' USING ERRCODE = '55000';
  END IF;

  FOR v_g IN SELECT g.id FROM public._br_capture_generations g
             WHERE g.job_id = p_job_id AND g.status IN ('capturing','capture_ready') LOOP
    PERFORM public._br_capture_supersede(v_g, 'new_generation');
  END LOOP;

  SELECT coalesce(max(g.generation_no), 0) + 1 INTO v_gen_no
  FROM public._br_capture_generations g WHERE g.job_id = p_job_id;

  INSERT INTO public._br_capture_generations (tenant_id, job_id, generation_no, claim_fence, status, capture_isolation)
  VALUES (v_job.tenant_id, p_job_id, v_gen_no, v_job.claim_fence, 'capturing', current_setting('transaction_isolation'))
  RETURNING id INTO v_gen_id;

  FOR v_rec IN
    SELECT r.table_name, r.tenant_link, r.tenant_id_column, r.parent_table
    FROM public._br_table_registry r
    WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect')
    ORDER BY r.table_name
  LOOP
    v_rel := to_regclass(format('public.%I', v_rec.table_name));
    IF v_rel IS NULL THEN
      RAISE EXCEPTION 'BRJ-050: registered table % is missing', v_rec.table_name USING ERRCODE = '55000';
    END IF;
    SELECT o.order_sql, o.order_key INTO v_ord, v_key FROM public._br_capture_order(v_rel, 't') o;

    IF v_rec.tenant_link = 'direct' THEN
      IF v_rec.tenant_id_column IS NULL THEN
        RAISE EXCEPTION 'BRJ-050: tenant column missing for %', v_rec.table_name USING ERRCODE = '55000';
      END IF;
      v_parts := v_parts || format(
        'SELECT %L::text AS tn, row_number() OVER (ORDER BY %s) AS ord, to_jsonb(t) AS rd FROM public.%I t WHERE t.%I = $2',
        v_rec.table_name, v_ord, v_rec.table_name, v_rec.tenant_id_column);
    ELSE
      SELECT count(*) INTO v_n FROM pg_constraint c
      WHERE c.conrelid = v_rel AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
        AND c.confrelid = to_regclass(format('public.%I', v_rec.parent_table));
      IF v_n <> 1 THEN
        RAISE EXCEPTION 'BRJ-050: cannot resolve parent link for %', v_rec.table_name USING ERRCODE = '55000';
      END IF;
      SELECT a.attname::text, pa.attname::text INTO v_fk, v_pk
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
      WHERE c.conrelid = v_rel AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
        AND c.confrelid = to_regclass(format('public.%I', v_rec.parent_table));
      SELECT r2.tenant_id_column INTO v_ptcol FROM public._br_table_registry r2
      WHERE r2.schema_name = 'public' AND r2.table_name = v_rec.parent_table AND r2.tenant_link = 'direct';
      IF v_ptcol IS NULL THEN
        RAISE EXCEPTION 'BRJ-050: parent % is not a direct tenant table', v_rec.parent_table USING ERRCODE = '55000';
      END IF;
      v_parts := v_parts || format(
        'SELECT %L::text AS tn, row_number() OVER (ORDER BY %s) AS ord, to_jsonb(t) AS rd FROM public.%I t JOIN public.%I p ON p.%I = t.%I WHERE p.%I = $2',
        v_rec.table_name, v_ord, v_rec.table_name, v_rec.parent_table, v_pk, v_fk, v_ptcol);
    END IF;
    v_tables := v_tables || v_rec.table_name::text;
    v_keys := v_keys || v_key;
  END LOOP;

  IF cardinality(v_parts) = 0 THEN
    RAISE EXCEPTION 'BRJ-050: no tenant table registered' USING ERRCODE = '55000';
  END IF;

  -- UNE seule instruction pour toutes les tables : un seul instantané MVCC.
  EXECUTE format(
    'INSERT INTO public._br_capture_rows (generation_id, tenant_id, table_name, ord, row_data) SELECT $1, $2, x.tn, x.ord, x.rd FROM (%s) x',
    array_to_string(v_parts, E'\nUNION ALL\n'))
  USING v_gen_id, v_job.tenant_id;
  GET DIAGNOSTICS v_total = ROW_COUNT;

  INSERT INTO public._br_capture_progress (generation_id, tenant_id, table_name, order_key, rows_captured, checksum)
  SELECT v_gen_id, v_job.tenant_id, k.tn, k.okey, coalesce(s.cnt, 0), s.chk
  FROM unnest(v_tables, v_keys) AS k(tn, okey)
  LEFT JOIN (
    SELECT r.table_name, count(*) AS cnt, md5(string_agg(md5(r.row_data::text), '' ORDER BY r.ord)) AS chk
    FROM public._br_capture_rows r WHERE r.generation_id = v_gen_id GROUP BY r.table_name
  ) s ON s.table_name = k.tn;

  SELECT md5(string_agg(p.table_name || ':' || p.rows_captured || ':' || coalesce(p.checksum, '-'), '|' ORDER BY p.table_name)),
         count(*)
    INTO v_global, v_tables_n
  FROM public._br_capture_progress p WHERE p.generation_id = v_gen_id;

  SELECT md5(string_agg(c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod), ','
                        ORDER BY c.relname, a.attnum))
    INTO v_fp
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  WHERE n.nspname = 'public' AND c.relname = ANY (v_tables) AND a.attnum > 0 AND NOT a.attisdropped;

  IF clock_timestamp() >= v_job.lease_expires_at THEN
    RAISE EXCEPTION 'BRJ-042: lease expired during capture' USING ERRCODE = '55000';
  END IF;

  UPDATE public._br_capture_generations
     SET status = 'capture_ready', captured_at = clock_timestamp(), table_count = v_tables_n,
         total_rows = v_total, global_checksum = v_global, schema_fingerprint = v_fp
   WHERE id = v_gen_id;

  UPDATE public._br_backup_jobs
     SET status = 'capture_ready', capture_generation_id = v_gen_id, lease_token = NULL, lease_expires_at = NULL,
         heartbeat_at = now(), error_code = NULL, error_message = NULL, error_class = NULL
   WHERE id = p_job_id;

  PERFORM public._br_job_log(p_job_id, v_job.tenant_id, 'capture_ready', 'processing', 'capture_ready',
    v_job.attempts, v_job.worker_id,
    jsonb_build_object('generation_id', v_gen_id, 'generation_no', v_gen_no, 'claim_fence', v_job.claim_fence,
                       'total_rows', v_total, 'table_count', v_tables_n));

  RETURN jsonb_build_object('job_id', p_job_id, 'generation_id', v_gen_id, 'generation_no', v_gen_no,
    'claim_fence', v_job.claim_fence, 'status', 'capture_ready', 'restorable', false,
    'total_rows', v_total, 'table_count', v_tables_n, 'global_checksum', v_global);
END $$;

-- Transaction 1 de la commande cron : réservation validée avant toute capture.
CREATE OR REPLACE FUNCTION public._br_capture_executor_claim(p_worker_label text DEFAULT 'pg_cron')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cfg public._br_capture_executor_config%ROWTYPE;
  v_job_id uuid;
  v_token uuid;
  v_attempt integer;
  v_exp timestamptz;
BEGIN
  PERFORM set_config('waarwi.br_executor_claim', '', false);
  SELECT * INTO v_cfg FROM public._br_capture_executor_config WHERE id;
  IF NOT FOUND OR NOT v_cfg.enabled THEN
    RETURN jsonb_build_object('state', 'disabled');
  END IF;

  SELECT c.job_id, c.lease_token, c.attempt, c.lease_expires_at INTO v_job_id, v_token, v_attempt, v_exp
  FROM public._br_job_claim(left(coalesce(nullif(p_worker_label, ''), 'pg_cron'), 64) || ':' || pg_backend_pid(),
                            v_cfg.capture_timeout_seconds + v_cfg.lease_margin_seconds) c;
  IF v_job_id IS NULL THEN
    RETURN jsonb_build_object('state', 'idle');
  END IF;
  PERFORM public._br_job_mark_processing(v_job_id, v_token);

  -- Portée session : survit au COMMIT qui suit, invisible des autres sessions.
  PERFORM set_config('waarwi.br_executor_claim',
    jsonb_build_object('job_id', v_job_id, 'lease_token', v_token)::text, false);
  RETURN jsonb_build_object('state', 'claimed', 'job_id', v_job_id, 'attempt', v_attempt, 'lease_expires_at', v_exp);
END $$;

-- Transaction 2 : la limite (SET LOCAL statement_timeout) est fixée par la commande AVANT cet appel.
CREATE OR REPLACE FUNCTION public._br_capture_executor_run()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_raw text := current_setting('waarwi.br_executor_claim', true);
  v_claim jsonb;
  v_job_id uuid;
  v_token uuid;
  v_cfg public._br_capture_executor_config%ROWTYPE;
  v_job public._br_backup_jobs%ROWTYPE;
  v_timeout_ms bigint;
  v_t0 timestamptz;
  v_ms bigint;
  v_res jsonb;
  v_state text;
  v_msg text;
  v_code text;
  v_cf integer;
  v_perm boolean;
BEGIN
  PERFORM set_config('waarwi.br_executor_claim', '', false);
  IF coalesce(v_raw, '') = '' THEN
    RETURN jsonb_build_object('state', 'idle');
  END IF;
  v_claim := v_raw::jsonb;
  v_job_id := (v_claim->>'job_id')::uuid;
  v_token := (v_claim->>'lease_token')::uuid;
  SELECT * INTO v_cfg FROM public._br_capture_executor_config WHERE id;

  SELECT s.setting::bigint INTO v_timeout_ms FROM pg_settings s WHERE s.name = 'statement_timeout';
  IF coalesce(v_timeout_ms, 0) <= 0 OR v_timeout_ms > v_cfg.capture_timeout_seconds * 1000::bigint THEN
    v_res := public._br_job_fail(v_job_id, v_token, 'BRJ-044',
      format('statement_timeout not fixed before capture (got %s ms, expected <= %s s)', v_timeout_ms, v_cfg.capture_timeout_seconds),
      false, v_cfg.retry_backoff_seconds);
    RETURN v_res || jsonb_build_object('state', 'refused');
  END IF;

  v_t0 := clock_timestamp();
  BEGIN
    v_res := public._br_capture_run(v_job_id, v_token);
    RETURN v_res || jsonb_build_object('state', 'capture_ready',
      'duration_ms', (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::bigint);
  EXCEPTION
    WHEN query_canceled THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
      v_state := 'canceled';
    WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_code = RETURNED_SQLSTATE;
      v_state := 'error';
  END;
  v_ms := (extract(epoch FROM clock_timestamp() - v_t0) * 1000)::bigint;

  -- Bail perdu (repris par un autre exécuteur ou expiré) : ne rien écrire.
  IF v_msg LIKE 'BRJ-010%' OR v_msg LIKE 'BRJ-042%' THEN
    RETURN jsonb_build_object('state', 'lease_lost', 'job_id', v_job_id, 'error', left(v_msg, 200));
  END IF;
  BEGIN
    v_job := public._br_job_lock_owned(v_job_id, v_token, true);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('state', 'lease_lost', 'job_id', v_job_id, 'error', left(v_msg, 200));
  END;

  IF (v_state = 'canceled' AND v_msg LIKE '%statement timeout%')
     OR v_code IN ('53000','53100','53200','53300','53400','54000') THEN
    v_cf := v_job.capacity_failures + 1;
    v_perm := v_cf >= v_cfg.max_capacity_failures;
    UPDATE public._br_backup_jobs SET capacity_failures = v_cf WHERE id = v_job_id;
    v_res := public._br_job_fail(v_job_id, v_token, 'BRJ-043',
      format('capacity: %s after %s ms (limit %s ms); overrun %s/%s; attempt %s/%s',
             left(v_msg, 200), v_ms, v_timeout_ms, v_cf, v_cfg.max_capacity_failures, v_job.attempts, v_job.max_attempts),
      v_perm, v_cfg.retry_backoff_seconds);
    UPDATE public._br_backup_jobs SET error_class = 'capacity' WHERE id = v_job_id;
    RETURN v_res || jsonb_build_object('state', 'capacity_exceeded', 'capacity_failures', v_cf,
      'duration_ms', v_ms, 'error_class', 'capacity');
  END IF;

  IF v_state = 'canceled' THEN
    v_code := 'CAPTURE_CANCELED';
    v_perm := false;
  ELSE
    v_perm := v_msg LIKE 'BRJ-05%' OR v_code LIKE '42%' OR v_code IN ('22023','P0002');
    v_code := coalesce(substring(v_msg FROM '^(BRJ-[0-9]{3})'), 'SQL-' || v_code);
  END IF;
  v_res := public._br_job_fail(v_job_id, v_token, v_code,
    format('%s (after %s ms, attempt %s/%s)', left(v_msg, 1500), v_ms, v_job.attempts, v_job.max_attempts),
    v_perm, v_cfg.retry_backoff_seconds);
  RETURN v_res || jsonb_build_object('state', 'failed_attempt', 'duration_ms', v_ms);
END $$;

-- Commande pg_cron exacte : COMMIT explicite entre réservation et capture, limite fixée avant la capture.
CREATE OR REPLACE FUNCTION public._br_capture_executor_command()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT format('SELECT public._br_capture_executor_claim(%L); COMMIT; SET LOCAL statement_timeout = %L; SELECT public._br_capture_executor_run();',
                'pg_cron', c.capture_timeout_seconds || 's')
  FROM public._br_capture_executor_config c WHERE c.id;
$$;

-- Activation future, à appeler explicitement (jamais par cette migration).
CREATE OR REPLACE FUNCTION public._br_capture_executor_schedule(p_enable boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_enabled boolean;
BEGIN
  IF p_enable IS NULL THEN
    RAISE EXCEPTION 'BRJ-001: p_enable required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'br_capture_executor') THEN
    PERFORM cron.unschedule('br_capture_executor');
  END IF;
  IF NOT p_enable THEN
    RETURN jsonb_build_object('scheduled', false);
  END IF;
  SELECT c.enabled INTO v_enabled FROM public._br_capture_executor_config c WHERE c.id;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRJ-045: executor disabled in _br_capture_executor_config' USING ERRCODE = '55000';
  END IF;
  PERFORM cron.schedule('br_capture_executor', '* * * * *', public._br_capture_executor_command());
  RETURN jsonb_build_object('scheduled', true, 'command', public._br_capture_executor_command());
END $$;

REVOKE ALL ON FUNCTION
  public._br_capture_executor_claim(text),
  public._br_capture_executor_run(),
  public._br_capture_executor_command(),
  public._br_capture_executor_schedule(boolean)
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public._br_capture_run(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
