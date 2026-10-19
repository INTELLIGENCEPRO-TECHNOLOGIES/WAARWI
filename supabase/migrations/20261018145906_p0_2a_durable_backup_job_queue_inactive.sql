/*
# P0-2A — File durable de jobs de sauvegarde (additive, INACTIVE)

## Résumé
Infrastructure permettant un job indépendant par tenant, avec bail expirant, jeton de bail
non prédictible, reprise après interruption, idempotence stricte et réconciliation lorsqu'une
sauvegarde se termine après un timeout HTTP. RIEN n'est connecté : aucun CRON, aucune Edge
Function, aucune sauvegarde réelle, aucun LWS. Aucune fonction V1/V2/restauration/LWS modifiée.

## 1. Nouvelles tables
- `_br_backup_jobs` : un job = (tenant, type de sauvegarde, période).
  id, tenant_id (FK tenants CASCADE), backup_kind (auto|platform_manual), period_key
  (ex. '2026-10-19' pour l'auto quotidien), scheduled_for, origin (auto|manual|retry),
  status (pending|leased|processing|succeeded|failed|cancelled), attempts, max_attempts,
  next_attempt_at, worker_id, lease_token (uuid aléatoire), lease_started_at,
  lease_expires_at, heartbeat_at, started_at, finished_at, backup_id (FK tenant_backups
  SET NULL, pour ne jamais bloquer la rétention), error_code, error_message, created_at, updated_at.
  Idempotence : UNIQUE (tenant_id, backup_kind, period_key). Aucune contrainte globale par
  tenant : l'historique complet est conservé.
- `_br_backup_job_events` : journal append-only (UPDATE interdit ; DELETE/TRUNCATE interdits
  sauf purge explicite `SET LOCAL br.allow_event_purge = 'on'`). Aucun payload, secret,
  archive ni jeton de bail n'y est écrit. Pas de FK : le journal survit aux jobs.

## 2. Table modifiée
- `tenant_backups.job_id` (uuid NULL, FK `_br_backup_jobs` ON DELETE SET NULL) + index unique
  partiel `WHERE job_id IS NOT NULL`. Les sauvegardes existantes restent à NULL.
  Garantit qu'un job ne peut produire qu'une seule sauvegarde liée.

## 3. Fonctions (SECURITY DEFINER, search_path fixé)
API service_role : `_br_jobs_enqueue_period`, `_br_job_claim`, `_br_job_renew_lease`,
`_br_job_mark_processing`, `_br_job_complete_success`, `_br_job_complete_failure`,
`_br_jobs_recover_expired`, `_br_job_reconcile`.
Internes (postgres uniquement) : `_br_job_log`, `_br_job_lock_owned`, `_br_job_try_reconcile`,
`_br_job_apply_failure`, triggers.

## 4. Frontières transactionnelles (contrat pour P0-2B)
1. T1 `_br_job_claim` : pending -> leased, attempts+1, nouveau jeton ; COMMIT avant tout travail.
2. T2 `_br_job_mark_processing` : leased -> processing ; COMMIT.
3. T3 (P0-2B) : création de la sauvegarde ET `tenant_backups.job_id = job` dans la MÊME
   transaction SQL. Si la sauvegarde est validée, le lien l'est aussi, même si l'appel HTTP
   a expiré. Si une 2e exécution tente de lier le même job, l'index unique annule sa
   transaction : aucun doublon.
4. T4 `_br_job_complete_success` / `_br_job_complete_failure` (jeton exigé).
   `complete_failure` réconcilie d'abord : si une sauvegarde vérifiée liée existe -> succeeded.
5. Si T4 n'arrive jamais : `_br_jobs_recover_expired` réconcilie ou replanifie avec backoff.
Le jeton est remplacé à chaque prise : un ancien worker ne peut ni renouveler ni finaliser.
Bail par défaut 900 s (> statement_timeout 300 s de la sauvegarde étendue).

## 5. Sécurité
RLS activée sans politique (refus par défaut, cohérent avec les tables `_br_*`).
REVOKE ALL pour PUBLIC/anon/authenticated ; service_role : SELECT uniquement sur les tables,
EXECUTE uniquement sur l'API. Écritures exclusivement via les fonctions.

## 6. Registre de sauvegarde
Les deux tables sont enregistrées `tenant_link='excluded'`, catégorie `backup_system`,
`reset_behavior='preserve'` comme les autres tables `_br_*` : ce sont des métadonnées
d'exploitation, jamais restaurées comme données métier. L'empreinte de schéma V2 ne prend en
compte que les tables non exclues : elle est inchangée. L'enregistrement est obligatoire, sinon
`br_check_schema_drift` détecterait une table non enregistrée (colonne tenant_id) et bloquerait
toutes les sauvegardes (BR-002).
*/

-- ============ Tables ============
CREATE TABLE IF NOT EXISTS public._br_backup_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  backup_kind      text NOT NULL DEFAULT 'auto' CHECK (backup_kind IN ('auto','platform_manual')),
  period_key       text NOT NULL CHECK (char_length(period_key) BETWEEN 1 AND 64),
  scheduled_for    timestamptz NOT NULL,
  origin           text NOT NULL DEFAULT 'auto' CHECK (origin IN ('auto','manual','retry')),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','leased','processing','succeeded','failed','cancelled')),
  attempts         integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 3,
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  worker_id        text CHECK (worker_id IS NULL OR char_length(worker_id) BETWEEN 1 AND 128),
  lease_token      uuid,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  heartbeat_at     timestamptz,
  started_at       timestamptz,
  finished_at      timestamptz,
  backup_id        uuid REFERENCES public.tenant_backups(id) ON DELETE SET NULL,
  error_code       text CHECK (error_code IS NULL OR char_length(error_code) <= 64),
  error_message    text CHECK (error_message IS NULL OR char_length(error_message) <= 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT _br_backup_jobs_attempts_chk
    CHECK (attempts >= 0 AND max_attempts BETWEEN 1 AND 10 AND attempts <= max_attempts),
  CONSTRAINT _br_backup_jobs_lease_chk CHECK (
    (status IN ('leased','processing') AND lease_token IS NOT NULL
       AND lease_expires_at IS NOT NULL AND worker_id IS NOT NULL)
    OR (status NOT IN ('leased','processing') AND lease_token IS NULL)),
  CONSTRAINT _br_backup_jobs_finished_chk
    CHECK ((status IN ('succeeded','failed','cancelled')) = (finished_at IS NOT NULL)),
  CONSTRAINT _br_backup_jobs_idem_key UNIQUE (tenant_id, backup_kind, period_key)
);

CREATE INDEX IF NOT EXISTS idx_br_backup_jobs_claimable
  ON public._br_backup_jobs (next_attempt_at, created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_br_backup_jobs_active_lease
  ON public._br_backup_jobs (lease_expires_at) WHERE status IN ('leased','processing');
CREATE INDEX IF NOT EXISTS idx_br_backup_jobs_tenant_created
  ON public._br_backup_jobs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_br_backup_jobs_backup
  ON public._br_backup_jobs (backup_id) WHERE backup_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public._br_backup_job_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id      uuid NOT NULL,
  tenant_id   uuid NOT NULL,
  event       text NOT NULL CHECK (event IN ('created','leased','renewed','started','retry_scheduled',
                                             'lease_expired_recovered','succeeded','failed','reconciled')),
  from_status text,
  to_status   text,
  attempt     integer,
  worker_id   text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(detail::text) <= 4096),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_br_backup_job_events_job ON public._br_backup_job_events (job_id, id);
CREATE INDEX IF NOT EXISTS idx_br_backup_job_events_tenant ON public._br_backup_job_events (tenant_id, created_at DESC);

-- ============ tenant_backups.job_id ============
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='tenant_backups' AND column_name='job_id') THEN
    ALTER TABLE public.tenant_backups ADD COLUMN job_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tenant_backups_job_id_fkey'
                 AND conrelid='public.tenant_backups'::regclass) THEN
    ALTER TABLE public.tenant_backups ADD CONSTRAINT tenant_backups_job_id_fkey
      FOREIGN KEY (job_id) REFERENCES public._br_backup_jobs(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenant_backups_job_id
  ON public.tenant_backups (job_id) WHERE job_id IS NOT NULL;

-- ============ Triggers ============
CREATE OR REPLACE FUNCTION public._br_backup_jobs_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_br_backup_jobs_touch ON public._br_backup_jobs;
CREATE TRIGGER trg_br_backup_jobs_touch BEFORE UPDATE ON public._br_backup_jobs
  FOR EACH ROW EXECUTE FUNCTION public._br_backup_jobs_touch();

CREATE OR REPLACE FUNCTION public._br_backup_job_events_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'BRJ-EVT: journal append-only' USING ERRCODE = '42501';
  END IF;
  IF coalesce(current_setting('br.allow_event_purge', true), '') <> 'on' THEN
    RAISE EXCEPTION 'BRJ-EVT: purge du journal non autorisée' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_br_backup_job_events_guard ON public._br_backup_job_events;
CREATE TRIGGER trg_br_backup_job_events_guard BEFORE UPDATE OR DELETE ON public._br_backup_job_events
  FOR EACH ROW EXECUTE FUNCTION public._br_backup_job_events_guard();
DROP TRIGGER IF EXISTS trg_br_backup_job_events_guard_truncate ON public._br_backup_job_events;
CREATE TRIGGER trg_br_backup_job_events_guard_truncate BEFORE TRUNCATE ON public._br_backup_job_events
  FOR EACH STATEMENT EXECUTE FUNCTION public._br_backup_job_events_guard();

-- ============ Internes ============
CREATE OR REPLACE FUNCTION public._br_job_log(
  p_job_id uuid, p_tenant_id uuid, p_event text, p_from text, p_to text,
  p_attempt integer, p_worker text, p_detail jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  INSERT INTO public._br_backup_job_events (job_id, tenant_id, event, from_status, to_status, attempt, worker_id, detail)
  VALUES (p_job_id, p_tenant_id, p_event, p_from, p_to, p_attempt, p_worker, coalesce(p_detail, '{}'::jsonb));
$$;

CREATE OR REPLACE FUNCTION public._br_job_lock_owned(p_job_id uuid, p_lease_token uuid, p_require_unexpired boolean)
RETURNS public._br_backup_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_job public._br_backup_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_job FROM public._br_backup_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR p_lease_token IS NULL
     OR v_job.lease_token IS DISTINCT FROM p_lease_token
     OR v_job.status NOT IN ('leased','processing')
     OR (p_require_unexpired AND v_job.lease_expires_at <= now()) THEN
    RAISE EXCEPTION 'BRJ-010: lease not held for job %', p_job_id USING ERRCODE = '55000';
  END IF;
  RETURN v_job;
END $$;

CREATE OR REPLACE FUNCTION public._br_job_try_reconcile(p_job_id uuid, p_via text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
  v_backup_id uuid;
BEGIN
  SELECT * INTO v_job FROM public._br_backup_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND OR v_job.status IN ('succeeded','cancelled') THEN RETURN NULL; END IF;

  SELECT b.id INTO v_backup_id FROM public.tenant_backups b
  WHERE b.job_id = p_job_id AND b.tenant_id = v_job.tenant_id
    AND b.status = 'verified'::br_backup_status;
  IF v_backup_id IS NULL THEN RETURN NULL; END IF;

  UPDATE public._br_backup_jobs
     SET status = 'succeeded', backup_id = v_backup_id, finished_at = now(),
         lease_token = NULL, lease_expires_at = NULL, error_code = NULL, error_message = NULL
   WHERE id = p_job_id;
  PERFORM public._br_job_log(p_job_id, v_job.tenant_id, 'reconciled', v_job.status, 'succeeded',
    v_job.attempts, v_job.worker_id, jsonb_build_object('backup_id', v_backup_id, 'via', p_via));
  RETURN v_backup_id;
END $$;

CREATE OR REPLACE FUNCTION public._br_job_apply_failure(
  p_job_id uuid, p_error_code text, p_error_message text, p_base_backoff_seconds integer, p_event text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
  v_delay integer;
  v_next timestamptz;
  v_code text := left(coalesce(nullif(p_error_code, ''), 'UNKNOWN'), 64);
  v_msg text := left(p_error_message, 2000);
BEGIN
  SELECT * INTO v_job FROM public._br_backup_jobs WHERE id = p_job_id FOR UPDATE;

  IF v_job.attempts >= v_job.max_attempts THEN
    UPDATE public._br_backup_jobs
       SET status = 'failed', finished_at = now(), lease_token = NULL, lease_expires_at = NULL,
           error_code = v_code, error_message = v_msg
     WHERE id = p_job_id;
    PERFORM public._br_job_log(p_job_id, v_job.tenant_id, coalesce(p_event, 'failed'), v_job.status, 'failed',
      v_job.attempts, v_job.worker_id, jsonb_build_object('error_code', v_code));
    RETURN 'failed';
  END IF;

  v_delay := least(p_base_backoff_seconds * power(2, greatest(v_job.attempts - 1, 0))::integer, 21600)
             + floor(random() * 30)::integer;
  v_next := now() + make_interval(secs => v_delay);
  UPDATE public._br_backup_jobs
     SET status = 'pending', next_attempt_at = v_next, lease_token = NULL, lease_expires_at = NULL,
         error_code = v_code, error_message = v_msg
   WHERE id = p_job_id;
  PERFORM public._br_job_log(p_job_id, v_job.tenant_id, coalesce(p_event, 'retry_scheduled'), v_job.status, 'pending',
    v_job.attempts, v_job.worker_id,
    jsonb_build_object('error_code', v_code, 'delay_seconds', v_delay, 'next_attempt_at', v_next));
  RETURN 'pending';
END $$;

-- ============ API (service_role) ============
CREATE OR REPLACE FUNCTION public._br_jobs_enqueue_period(
  p_period_key text,
  p_scheduled_for timestamptz DEFAULT now(),
  p_backup_kind text DEFAULT 'auto',
  p_origin text DEFAULT 'auto',
  p_tenant_ids uuid[] DEFAULT NULL,
  p_max_attempts integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_eligible integer;
  v_inserted integer;
BEGIN
  IF p_period_key IS NULL OR char_length(p_period_key) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'BRJ-001: invalid period_key' USING ERRCODE = '22023';
  END IF;
  IF p_scheduled_for IS NULL THEN
    RAISE EXCEPTION 'BRJ-001: scheduled_for required' USING ERRCODE = '22023';
  END IF;
  IF p_backup_kind NOT IN ('auto','platform_manual') OR p_origin NOT IN ('auto','manual','retry') THEN
    RAISE EXCEPTION 'BRJ-001: invalid kind/origin' USING ERRCODE = '22023';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'BRJ-001: invalid max_attempts' USING ERRCODE = '22023';
  END IF;

  WITH eligible AS (
    SELECT t.id FROM public.tenants t
    WHERE (p_tenant_ids IS NULL AND t.is_active
           AND NOT EXISTS (SELECT 1 FROM public._br_tenant_schedule_override o
                           WHERE o.tenant_id = t.id AND o.suspended))
       OR (p_tenant_ids IS NOT NULL AND t.id = ANY (p_tenant_ids))
  ), ins AS (
    INSERT INTO public._br_backup_jobs
      (tenant_id, backup_kind, period_key, scheduled_for, origin, max_attempts, next_attempt_at)
    SELECT e.id, p_backup_kind, p_period_key, p_scheduled_for, p_origin, p_max_attempts, p_scheduled_for
    FROM eligible e
    ON CONFLICT ON CONSTRAINT _br_backup_jobs_idem_key DO NOTHING
    RETURNING id, tenant_id
  ), ev AS (
    INSERT INTO public._br_backup_job_events (job_id, tenant_id, event, from_status, to_status, attempt, detail)
    SELECT i.id, i.tenant_id, 'created', NULL, 'pending', 0,
           jsonb_build_object('period_key', p_period_key, 'backup_kind', p_backup_kind, 'origin', p_origin)
    FROM ins i
    RETURNING 1
  )
  SELECT (SELECT count(*) FROM eligible), (SELECT count(*) FROM ins) INTO v_eligible, v_inserted;

  RETURN jsonb_build_object('period_key', p_period_key, 'eligible', v_eligible,
                            'inserted', v_inserted, 'already_present', v_eligible - v_inserted);
END $$;

CREATE OR REPLACE FUNCTION public._br_job_claim(p_worker_id text, p_lease_seconds integer DEFAULT 900)
RETURNS TABLE (job_id uuid, tenant_id uuid, backup_kind text, period_key text,
               attempt integer, max_attempts integer, lease_token uuid, lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR char_length(p_worker_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'BRJ-001: invalid worker_id' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'BRJ-001: lease_seconds must be between 60 and 3600' USING ERRCODE = '22023';
  END IF;

  SELECT j.* INTO v_job
  FROM public._br_backup_jobs j
  WHERE j.status = 'pending' AND j.next_attempt_at <= now()
    AND NOT EXISTS (SELECT 1 FROM public._br_backup_jobs o
                    WHERE o.tenant_id = j.tenant_id AND o.status IN ('leased','processing'))
  ORDER BY j.next_attempt_at, j.created_at
  FOR UPDATE OF j SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN RETURN; END IF;

  UPDATE public._br_backup_jobs j
     SET status = 'leased', attempts = j.attempts + 1, worker_id = p_worker_id,
         lease_token = gen_random_uuid(), lease_started_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds), heartbeat_at = now()
   WHERE j.id = v_job.id
  RETURNING j.* INTO v_job;

  PERFORM public._br_job_log(v_job.id, v_job.tenant_id, 'leased', 'pending', 'leased',
    v_job.attempts, p_worker_id, jsonb_build_object('lease_seconds', p_lease_seconds));

  RETURN QUERY SELECT v_job.id, v_job.tenant_id, v_job.backup_kind, v_job.period_key,
                      v_job.attempts, v_job.max_attempts, v_job.lease_token, v_job.lease_expires_at;
END $$;

CREATE OR REPLACE FUNCTION public._br_job_renew_lease(p_job_id uuid, p_lease_token uuid, p_lease_seconds integer DEFAULT 900)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
  v_exp timestamptz;
BEGIN
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'BRJ-001: lease_seconds must be between 60 and 3600' USING ERRCODE = '22023';
  END IF;
  v_job := public._br_job_lock_owned(p_job_id, p_lease_token, true);
  v_exp := now() + make_interval(secs => p_lease_seconds);
  UPDATE public._br_backup_jobs SET lease_expires_at = v_exp, heartbeat_at = now() WHERE id = p_job_id;
  PERFORM public._br_job_log(p_job_id, v_job.tenant_id, 'renewed', v_job.status, v_job.status,
    v_job.attempts, v_job.worker_id, jsonb_build_object('lease_expires_at', v_exp));
  RETURN v_exp;
END $$;

CREATE OR REPLACE FUNCTION public._br_job_mark_processing(p_job_id uuid, p_lease_token uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_job public._br_backup_jobs%ROWTYPE;
BEGIN
  v_job := public._br_job_lock_owned(p_job_id, p_lease_token, true);
  IF v_job.status <> 'leased' THEN
    RAISE EXCEPTION 'BRJ-011: job % is not in leased state', p_job_id USING ERRCODE = '55000';
  END IF;
  UPDATE public._br_backup_jobs SET status = 'processing', started_at = now(), heartbeat_at = now()
   WHERE id = p_job_id;
  PERFORM public._br_job_log(p_job_id, v_job.tenant_id, 'started', 'leased', 'processing',
    v_job.attempts, v_job.worker_id, '{}'::jsonb);
  RETURN now();
END $$;

CREATE OR REPLACE FUNCTION public._br_job_complete_success(p_job_id uuid, p_lease_token uuid, p_backup_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
  v_b record;
BEGIN
  SELECT * INTO v_job FROM public._br_backup_jobs WHERE id = p_job_id FOR UPDATE;
  IF FOUND AND v_job.status = 'succeeded' AND v_job.backup_id = p_backup_id THEN
    RETURN jsonb_build_object('job_id', p_job_id, 'status', 'succeeded', 'backup_id', p_backup_id, 'idempotent', true);
  END IF;

  v_job := public._br_job_lock_owned(p_job_id, p_lease_token, false);

  SELECT b.id, b.tenant_id, b.status, b.job_id INTO v_b
  FROM public.tenant_backups b WHERE b.id = p_backup_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRJ-020: backup % not found', p_backup_id USING ERRCODE = '55000';
  END IF;
  IF v_b.tenant_id <> v_job.tenant_id THEN
    RAISE EXCEPTION 'BRJ-021: backup belongs to another tenant' USING ERRCODE = '55000';
  END IF;
  IF v_b.status <> 'verified'::br_backup_status THEN
    RAISE EXCEPTION 'BRJ-022: backup is not verified' USING ERRCODE = '55000';
  END IF;
  IF v_b.job_id IS NOT NULL AND v_b.job_id <> p_job_id THEN
    RAISE EXCEPTION 'BRJ-023: backup already linked to another job' USING ERRCODE = '55000';
  END IF;
  IF v_b.job_id IS NULL THEN
    UPDATE public.tenant_backups SET job_id = p_job_id WHERE id = p_backup_id;
  END IF;

  UPDATE public._br_backup_jobs
     SET status = 'succeeded', backup_id = p_backup_id, finished_at = now(), heartbeat_at = now(),
         lease_token = NULL, lease_expires_at = NULL, error_code = NULL, error_message = NULL
   WHERE id = p_job_id;
  PERFORM public._br_job_log(p_job_id, v_job.tenant_id, 'succeeded', v_job.status, 'succeeded',
    v_job.attempts, v_job.worker_id, jsonb_build_object('backup_id', p_backup_id));
  RETURN jsonb_build_object('job_id', p_job_id, 'status', 'succeeded', 'backup_id', p_backup_id, 'idempotent', false);
END $$;

CREATE OR REPLACE FUNCTION public._br_job_complete_failure(
  p_job_id uuid, p_lease_token uuid, p_error_code text, p_error_message text,
  p_base_backoff_seconds integer DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
  v_backup uuid;
  v_status text;
BEGIN
  IF p_base_backoff_seconds IS NULL OR p_base_backoff_seconds NOT BETWEEN 10 AND 3600 THEN
    RAISE EXCEPTION 'BRJ-001: base_backoff_seconds must be between 10 and 3600' USING ERRCODE = '22023';
  END IF;
  v_job := public._br_job_lock_owned(p_job_id, p_lease_token, false);

  v_backup := public._br_job_try_reconcile(p_job_id, 'complete_failure');
  IF v_backup IS NOT NULL THEN
    RETURN jsonb_build_object('job_id', p_job_id, 'status', 'succeeded', 'reconciled', true, 'backup_id', v_backup);
  END IF;

  v_status := public._br_job_apply_failure(p_job_id, p_error_code, p_error_message, p_base_backoff_seconds, NULL);
  RETURN jsonb_build_object('job_id', p_job_id, 'status', v_status, 'reconciled', false,
    'next_attempt_at', (SELECT next_attempt_at FROM public._br_backup_jobs WHERE id = p_job_id));
END $$;

CREATE OR REPLACE FUNCTION public._br_jobs_recover_expired(p_limit integer DEFAULT 50, p_base_backoff_seconds integer DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_reconciled integer := 0;
  v_retried integer := 0;
  v_failed integer := 0;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'BRJ-001: limit must be between 1 and 500' USING ERRCODE = '22023';
  END IF;
  IF p_base_backoff_seconds IS NULL OR p_base_backoff_seconds NOT BETWEEN 10 AND 3600 THEN
    RAISE EXCEPTION 'BRJ-001: base_backoff_seconds must be between 10 and 3600' USING ERRCODE = '22023';
  END IF;

  FOR v_id IN
    SELECT j.id FROM public._br_backup_jobs j
    WHERE j.status IN ('leased','processing') AND j.lease_expires_at < now()
    ORDER BY j.lease_expires_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  LOOP
    IF public._br_job_try_reconcile(v_id, 'recover_expired') IS NOT NULL THEN
      v_reconciled := v_reconciled + 1;
    ELSIF public._br_job_apply_failure(v_id, 'LEASE_EXPIRED', 'Lease expired before completion',
                                       p_base_backoff_seconds, 'lease_expired_recovered') = 'pending' THEN
      v_retried := v_retried + 1;
    ELSE
      v_failed := v_failed + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('reconciled', v_reconciled, 'requeued', v_retried, 'failed', v_failed);
END $$;

CREATE OR REPLACE FUNCTION public._br_job_reconcile(p_job_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_backup uuid;
  v_status text;
BEGIN
  v_backup := public._br_job_try_reconcile(p_job_id, 'reconcile');
  SELECT status INTO v_status FROM public._br_backup_jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRJ-030: job % not found', p_job_id USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('job_id', p_job_id, 'status', v_status,
                            'reconciled', v_backup IS NOT NULL, 'backup_id', v_backup);
END $$;

-- ============ Sécurité ============
ALTER TABLE public._br_backup_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._br_backup_job_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public._br_backup_jobs, public._br_backup_job_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public._br_backup_jobs, public._br_backup_job_events FROM service_role;
GRANT SELECT ON TABLE public._br_backup_jobs, public._br_backup_job_events TO service_role;
REVOKE ALL ON SEQUENCE public._br_backup_job_events_id_seq FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION
  public._br_backup_jobs_touch(),
  public._br_backup_job_events_guard(),
  public._br_job_log(uuid, uuid, text, text, text, integer, text, jsonb),
  public._br_job_lock_owned(uuid, uuid, boolean),
  public._br_job_try_reconcile(uuid, text),
  public._br_job_apply_failure(uuid, text, text, integer, text),
  public._br_jobs_enqueue_period(text, timestamptz, text, text, uuid[], integer),
  public._br_job_claim(text, integer),
  public._br_job_renew_lease(uuid, uuid, integer),
  public._br_job_mark_processing(uuid, uuid),
  public._br_job_complete_success(uuid, uuid, uuid),
  public._br_job_complete_failure(uuid, uuid, text, text, integer),
  public._br_jobs_recover_expired(integer, integer),
  public._br_job_reconcile(uuid)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public._br_jobs_enqueue_period(text, timestamptz, text, text, uuid[], integer),
  public._br_job_claim(text, integer),
  public._br_job_renew_lease(uuid, uuid, integer),
  public._br_job_mark_processing(uuid, uuid),
  public._br_job_complete_success(uuid, uuid, uuid),
  public._br_job_complete_failure(uuid, uuid, text, text, integer),
  public._br_jobs_recover_expired(integer, integer),
  public._br_job_reconcile(uuid)
TO service_role;

-- ============ Registre de sauvegarde (exclu, préservé) ============
INSERT INTO public._br_table_registry
  (schema_name, table_name, tenant_link, tenant_id_column, category, restore_order, reset_behavior, is_mandatory, exclusion_reason)
SELECT 'public', v.t, 'excluded', 'tenant_id', 'backup_system', 0, 'preserve', false, v.r
FROM (VALUES
  ('_br_backup_jobs', 'Backup job queue — operational metadata, never restored as tenant data'),
  ('_br_backup_job_events', 'Backup job event journal — append-only operational log')
) AS v(t, r)
WHERE NOT EXISTS (SELECT 1 FROM public._br_table_registry r WHERE r.schema_name = 'public' AND r.table_name = v.t);
