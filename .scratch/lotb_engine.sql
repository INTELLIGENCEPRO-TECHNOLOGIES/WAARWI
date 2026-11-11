/*
# Lot B — Moteur durable de capture (INACTIF, sans bascule)

## Résumé
Complète la file existante `_br_backup_jobs` (P0-2A) au lieu d'en créer une seconde. Ajoute :
exclusion par tenant garantie par index unique, limite globale de captures garantie par index unique
sur des emplacements numérotés, numéro de prise (fence) monotone, générations de capture immuables,
staging par génération, capture cohérente en UNE seule instruction SQL, erreurs transitoires/permanentes,
état intermédiaire explicite `capture_ready` (jamais restaurable, jamais « verified »).
Aucun CRON, aucun worker, aucune Edge Function modifiée. Le chemin de production v2 est inchangé.

## 1. Tables modifiées
- `_br_backup_jobs` : + `claim_fence` (bigint, incrémenté à chaque prise), + `slot_no` (emplacement global
  réservé pendant le bail), + `capture_generation_id` (génération courante), + `error_class`
  (transient|permanent). Statut `capture_ready` ajouté. Contraintes : slot présent ssi bail actif ;
  `capture_ready` exige une génération.
- `_br_backup_job_events` : événements `capture_ready`, `generation_superseded`, `cancelled` ajoutés.

## 2. Nouvelles tables (RLS active, aucune politique, aucun droit anon/authenticated)
- `_br_capture_slots` : emplacements de capture (1..N). Nombre de lignes = limite globale (2 par défaut).
- `_br_capture_generations` : une ligne immuable par capture (job, numéro, fence de la prise).
- `_br_capture_progress` : par génération et par table : clé d'ordre, lignes capturées, empreinte,
  colonnes d'export réservées au lot C.
- `_br_capture_rows` : staging (LOGGED) : (génération, table, ordre déterministe, ligne jsonb).

## 3. Garanties côté serveur
1. Un seul job actif par tenant : index unique partiel (leased|processing|capture_ready).
2. Limite globale : index unique partiel sur `slot_no` + FK vers `_br_capture_slots`.
   NOT EXISTS n'est qu'un pré-filtre ; la garantie est l'index (23505 en cas de course).
3. Ancien worker : jeton de bail aléatoire remplacé à chaque prise, vérifié sous verrou de ligne
   avec bail non expiré pour renouveler, capturer, échouer, terminer (complete_success/failure durcis).
4. Une génération par prise : UNIQUE (job_id, claim_fence). Écriture staging refusée si la génération
   n'est pas `capturing`. Nouvelle génération => anciennes `superseded`, staging purgé.

## 4. Cohérence de capture
Toutes les tables du tenant sont lues par UN SEUL INSERT … SELECT … UNION ALL (EXECUTE unique) :
une instruction PostgreSQL utilise un instantané unique, quel que soit le niveau d'isolation.

## 5. Sécurité
REVOKE ALL pour PUBLIC/anon/authenticated ; service_role : SELECT sur les tables, EXECUTE sur l'API.
Réinitialisation/restauration/import restent bloqués (BR020) : non modifiés.
*/

-- ============ Emplacements globaux ============
CREATE TABLE IF NOT EXISTS public._br_capture_slots (
  slot_no    smallint PRIMARY KEY CHECK (slot_no BETWEEN 1 AND 32),
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public._br_capture_slots (slot_no) VALUES (1), (2) ON CONFLICT (slot_no) DO NOTHING;

-- ============ Colonnes et contraintes de la file ============
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='_br_backup_jobs' AND column_name='claim_fence') THEN
    ALTER TABLE public._br_backup_jobs ADD COLUMN claim_fence bigint NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='_br_backup_jobs' AND column_name='slot_no') THEN
    ALTER TABLE public._br_backup_jobs ADD COLUMN slot_no smallint;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='_br_backup_jobs' AND column_name='capture_generation_id') THEN
    ALTER TABLE public._br_backup_jobs ADD COLUMN capture_generation_id uuid;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='_br_backup_jobs' AND column_name='error_class') THEN
    ALTER TABLE public._br_backup_jobs ADD COLUMN error_class text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='_br_backup_jobs_slot_fkey' AND conrelid='public._br_backup_jobs'::regclass) THEN
    ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_slot_fkey
      FOREIGN KEY (slot_no) REFERENCES public._br_capture_slots(slot_no) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='_br_backup_jobs_error_class_chk' AND conrelid='public._br_backup_jobs'::regclass) THEN
    ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_error_class_chk
      CHECK (error_class IS NULL OR error_class IN ('transient','permanent'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='_br_backup_jobs_fence_chk' AND conrelid='public._br_backup_jobs'::regclass) THEN
    ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_fence_chk CHECK (claim_fence >= 0);
  END IF;
END $$;

ALTER TABLE public._br_backup_jobs DROP CONSTRAINT IF EXISTS _br_backup_jobs_status_check;
ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_status_check
  CHECK (status IN ('pending','leased','processing','capture_ready','succeeded','failed','cancelled'));

ALTER TABLE public._br_backup_jobs DROP CONSTRAINT IF EXISTS _br_backup_jobs_slot_chk;
ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_slot_chk
  CHECK ((status IN ('leased','processing')) = (slot_no IS NOT NULL));

ALTER TABLE public._br_backup_jobs DROP CONSTRAINT IF EXISTS _br_backup_jobs_capture_ready_chk;
ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_capture_ready_chk
  CHECK (status <> 'capture_ready' OR capture_generation_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_br_backup_jobs_one_active_per_tenant
  ON public._br_backup_jobs (tenant_id) WHERE status IN ('leased','processing','capture_ready');
CREATE UNIQUE INDEX IF NOT EXISTS uq_br_backup_jobs_slot
  ON public._br_backup_jobs (slot_no) WHERE slot_no IS NOT NULL;

ALTER TABLE public._br_backup_job_events DROP CONSTRAINT IF EXISTS _br_backup_job_events_event_check;
ALTER TABLE public._br_backup_job_events ADD CONSTRAINT _br_backup_job_events_event_check
  CHECK (event IN ('created','leased','renewed','started','retry_scheduled','lease_expired_recovered',
                   'succeeded','failed','reconciled','capture_ready','generation_superseded','cancelled'));

-- Le slot est libéré dès que le job quitte un état à bail, quel que soit le chemin (échec, reprise, succès).
CREATE OR REPLACE FUNCTION public._br_backup_jobs_release_slot()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.status NOT IN ('leased','processing') THEN
    NEW.slot_no := NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_br_backup_jobs_release_slot ON public._br_backup_jobs;
CREATE TRIGGER trg_br_backup_jobs_release_slot BEFORE UPDATE ON public._br_backup_jobs
  FOR EACH ROW EXECUTE FUNCTION public._br_backup_jobs_release_slot();

-- ============ Générations, progression, staging ============
CREATE TABLE IF NOT EXISTS public._br_capture_generations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  job_id             uuid NOT NULL,
  generation_no      integer NOT NULL CHECK (generation_no >= 1),
  claim_fence        bigint NOT NULL CHECK (claim_fence >= 1),
  status             text NOT NULL DEFAULT 'capturing'
                     CHECK (status IN ('capturing','capture_ready','superseded','failed')),
  superseded_reason  text CHECK (superseded_reason IS NULL OR char_length(superseded_reason) <= 200),
  capture_isolation  text,
  schema_fingerprint text,
  table_count        integer,
  total_rows         bigint,
  global_checksum    text,
  capture_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  captured_at        timestamptz,
  superseded_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT _br_capture_generations_job_fkey FOREIGN KEY (tenant_id, job_id)
    REFERENCES public._br_backup_jobs (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT _br_capture_generations_job_no_key UNIQUE (job_id, generation_no),
  CONSTRAINT _br_capture_generations_job_fence_key UNIQUE (job_id, claim_fence),
  CONSTRAINT _br_capture_generations_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT _br_capture_generations_ready_chk CHECK (status <> 'capture_ready' OR captured_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_br_capture_generations_one_open_per_job
  ON public._br_capture_generations (job_id) WHERE status IN ('capturing','capture_ready');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='_br_backup_jobs_capture_generation_fkey' AND conrelid='public._br_backup_jobs'::regclass) THEN
    ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_capture_generation_fkey
      FOREIGN KEY (capture_generation_id) REFERENCES public._br_capture_generations(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public._br_capture_progress (
  generation_id uuid NOT NULL,
  tenant_id     uuid NOT NULL,
  table_name    text NOT NULL,
  order_key     text NOT NULL,
  rows_captured bigint NOT NULL CHECK (rows_captured >= 0),
  checksum      text,
  phase         text NOT NULL DEFAULT 'captured' CHECK (phase IN ('captured','exporting','exported')),
  rows_exported bigint NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (generation_id, table_name),
  CONSTRAINT _br_capture_progress_gen_fkey FOREIGN KEY (tenant_id, generation_id)
    REFERENCES public._br_capture_generations (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT _br_capture_progress_export_chk CHECK (rows_exported >= 0 AND rows_exported <= rows_captured)
);

CREATE TABLE IF NOT EXISTS public._br_capture_rows (
  generation_id uuid NOT NULL,
  tenant_id     uuid NOT NULL,
  table_name    text NOT NULL,
  ord           bigint NOT NULL CHECK (ord >= 1),
  row_data      jsonb NOT NULL,
  PRIMARY KEY (generation_id, table_name, ord),
  CONSTRAINT _br_capture_rows_gen_fkey FOREIGN KEY (tenant_id, generation_id)
    REFERENCES public._br_capture_generations (tenant_id, id) ON DELETE CASCADE
);

-- ============ Gardes d'immuabilité ============
CREATE OR REPLACE FUNCTION public._br_capture_generations_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'capturing' THEN
      RAISE EXCEPTION 'BRJ-070: a generation must start in capturing' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.job_id <> OLD.job_id
     OR NEW.generation_no <> OLD.generation_no OR NEW.claim_fence <> OLD.claim_fence
     OR NEW.capture_started_at <> OLD.capture_started_at THEN
    RAISE EXCEPTION 'BRJ-070: generation identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('superseded','failed') THEN
    RAISE EXCEPTION 'BRJ-070: generation % is terminal (%)', OLD.id, OLD.status USING ERRCODE = '55000';
  END IF;
  IF OLD.status = 'capture_ready' AND (
       NEW.total_rows IS DISTINCT FROM OLD.total_rows OR NEW.global_checksum IS DISTINCT FROM OLD.global_checksum
       OR NEW.table_count IS DISTINCT FROM OLD.table_count OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
       OR NEW.schema_fingerprint IS DISTINCT FROM OLD.schema_fingerprint) THEN
    RAISE EXCEPTION 'BRJ-070: captured generation content is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'capturing' AND NEW.status IN ('capture_ready','superseded','failed'))
       OR (OLD.status = 'capture_ready' AND NEW.status = 'superseded')) THEN
    RAISE EXCEPTION 'BRJ-070: invalid generation transition % -> %', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_br_capture_generations_guard ON public._br_capture_generations;
CREATE TRIGGER trg_br_capture_generations_guard BEFORE INSERT OR UPDATE ON public._br_capture_generations
  FOR EACH ROW EXECUTE FUNCTION public._br_capture_generations_guard();

CREATE OR REPLACE FUNCTION public._br_capture_rows_insert_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_bad boolean;
BEGIN
  -- Requête dynamique : la table de transition n'est visible qu'à l'exécution.
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM (SELECT DISTINCT generation_id FROM new_rows) n
             JOIN public._br_capture_generations g ON g.id = n.generation_id
            WHERE g.status <> ''capturing'')' INTO v_bad;
  IF v_bad THEN
    RAISE EXCEPTION 'BRJ-072: staging write refused, generation is not capturing' USING ERRCODE = '55000';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_br_capture_rows_insert_guard ON public._br_capture_rows;
CREATE TRIGGER trg_br_capture_rows_insert_guard AFTER INSERT ON public._br_capture_rows
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT
  EXECUTE FUNCTION public._br_capture_rows_insert_guard();

CREATE OR REPLACE FUNCTION public._br_capture_rows_no_update()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'BRJ-073: captured rows are immutable' USING ERRCODE = '55000';
END $$;

DROP TRIGGER IF EXISTS trg_br_capture_rows_no_update ON public._br_capture_rows;
CREATE TRIGGER trg_br_capture_rows_no_update BEFORE UPDATE ON public._br_capture_rows
  FOR EACH ROW EXECUTE FUNCTION public._br_capture_rows_no_update();

CREATE OR REPLACE FUNCTION public._br_capture_progress_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public._br_capture_generations g
                   WHERE g.id = NEW.generation_id AND g.status = 'capturing') THEN
      RAISE EXCEPTION 'BRJ-072: progress write refused, generation is not capturing' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.generation_id <> OLD.generation_id OR NEW.tenant_id <> OLD.tenant_id OR NEW.table_name <> OLD.table_name
     OR NEW.order_key <> OLD.order_key OR NEW.rows_captured <> OLD.rows_captured
     OR NEW.checksum IS DISTINCT FROM OLD.checksum THEN
    RAISE EXCEPTION 'BRJ-073: captured progress is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_br_capture_progress_guard ON public._br_capture_progress;
CREATE TRIGGER trg_br_capture_progress_guard BEFORE INSERT OR UPDATE ON public._br_capture_progress
  FOR EACH ROW EXECUTE FUNCTION public._br_capture_progress_guard();

-- ============ Prise atomique (remplace le NOT EXISTS seul) ============
CREATE OR REPLACE FUNCTION public._br_job_claim(p_worker_id text, p_lease_seconds integer DEFAULT 900)
RETURNS TABLE (job_id uuid, tenant_id uuid, backup_kind text, period_key text,
               attempt integer, max_attempts integer, lease_token uuid, lease_expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
  v_cand uuid;
  v_slot smallint;
  v_any_slot boolean;
  v_con text;
BEGIN
  IF p_worker_id IS NULL OR char_length(p_worker_id) NOT BETWEEN 1 AND 128 THEN
    RAISE EXCEPTION 'BRJ-001: invalid worker_id' USING ERRCODE = '22023';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 60 AND 3600 THEN
    RAISE EXCEPTION 'BRJ-001: lease_seconds must be between 60 and 3600' USING ERRCODE = '22023';
  END IF;

  PERFORM public._br_jobs_recover_expired(50, 300);

  FOR v_cand IN
    SELECT j.id FROM public._br_backup_jobs j
    WHERE j.status = 'pending' AND j.next_attempt_at <= now()
      AND NOT EXISTS (SELECT 1 FROM public._br_backup_jobs o
                      WHERE o.tenant_id = j.tenant_id AND o.status IN ('leased','processing','capture_ready'))
    ORDER BY j.next_attempt_at, j.created_at, j.id
    LIMIT 20
    FOR UPDATE OF j SKIP LOCKED
  LOOP
    v_any_slot := false;
    FOR v_slot IN
      SELECT s.slot_no FROM public._br_capture_slots s
      WHERE NOT EXISTS (SELECT 1 FROM public._br_backup_jobs o WHERE o.slot_no = s.slot_no)
      ORDER BY s.slot_no
    LOOP
      v_any_slot := true;
      BEGIN
        UPDATE public._br_backup_jobs j
           SET status = 'leased', attempts = j.attempts + 1, claim_fence = j.claim_fence + 1,
               slot_no = v_slot, worker_id = p_worker_id, lease_token = gen_random_uuid(),
               lease_started_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_seconds),
               heartbeat_at = now(), error_class = NULL
         WHERE j.id = v_cand AND j.status = 'pending'
        RETURNING j.* INTO v_job;
        IF NOT FOUND THEN
          EXIT;
        END IF;
        PERFORM public._br_job_log(v_job.id, v_job.tenant_id, 'leased', 'pending', 'leased', v_job.attempts,
          p_worker_id, jsonb_build_object('lease_seconds', p_lease_seconds, 'claim_fence', v_job.claim_fence,
                                          'slot_no', v_job.slot_no));
        RETURN QUERY SELECT v_job.id, v_job.tenant_id, v_job.backup_kind, v_job.period_key,
                            v_job.attempts, v_job.max_attempts, v_job.lease_token, v_job.lease_expires_at;
        RETURN;
      EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_con = CONSTRAINT_NAME;
        IF v_con = 'uq_br_backup_jobs_slot' THEN
          CONTINUE;
        ELSIF v_con = 'uq_br_backup_jobs_one_active_per_tenant' THEN
          EXIT;
        ELSE
          RAISE;
        END IF;
      END;
    END LOOP;
    IF NOT v_any_slot THEN
      RETURN;
    END IF;
  END LOOP;
END $$;

-- ============ Fin de job : bail NON expiré exigé ============
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

  v_job := public._br_job_lock_owned(p_job_id, p_lease_token, true);

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
         lease_token = NULL, lease_expires_at = NULL, error_code = NULL, error_message = NULL, error_class = NULL
   WHERE id = p_job_id;
  PERFORM public._br_job_log(p_job_id, v_job.tenant_id, 'succeeded', v_job.status, 'succeeded',
    v_job.attempts, v_job.worker_id, jsonb_build_object('backup_id', p_backup_id));
  RETURN jsonb_build_object('job_id', p_job_id, 'status', 'succeeded', 'backup_id', p_backup_id, 'idempotent', false);
END $$;

CREATE OR REPLACE FUNCTION public._br_job_complete_failure(
  p_job_id uuid, p_lease_token uuid, p_error_code text, p_error_message text,
  p_base_backoff_seconds integer DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN public._br_job_fail(p_job_id, p_lease_token, p_error_code, p_error_message, false, p_base_backoff_seconds);
END $$;

-- ============ Échec transitoire / permanent ============
CREATE OR REPLACE FUNCTION public._br_job_fail(
  p_job_id uuid, p_lease_token uuid, p_error_code text, p_error_message text,
  p_permanent boolean, p_base_backoff_seconds integer DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
  v_backup uuid;
  v_status text;
  v_perm boolean;
  v_code text := left(coalesce(nullif(p_error_code, ''), 'UNKNOWN'), 64);
BEGIN
  IF p_base_backoff_seconds IS NULL OR p_base_backoff_seconds NOT BETWEEN 10 AND 3600 THEN
    RAISE EXCEPTION 'BRJ-001: base_backoff_seconds must be between 10 and 3600' USING ERRCODE = '22023';
  END IF;
  IF p_permanent IS NULL THEN
    RAISE EXCEPTION 'BRJ-001: permanent flag required' USING ERRCODE = '22023';
  END IF;
  v_job := public._br_job_lock_owned(p_job_id, p_lease_token, true);

  v_backup := public._br_job_try_reconcile(p_job_id, 'fail');
  IF v_backup IS NOT NULL THEN
    RETURN jsonb_build_object('job_id', p_job_id, 'status', 'succeeded', 'reconciled', true, 'backup_id', v_backup);
  END IF;

  -- Les erreurs de structure (registre, dérive de schéma) ne se corrigent pas en réessayant.
  v_perm := p_permanent OR v_code LIKE 'BRJ-05%';
  IF v_perm THEN
    UPDATE public._br_backup_jobs
       SET status = 'failed', finished_at = now(), lease_token = NULL, lease_expires_at = NULL,
           error_code = v_code, error_message = left(p_error_message, 2000), error_class = 'permanent'
     WHERE id = p_job_id;
    PERFORM public._br_job_log(p_job_id, v_job.tenant_id, 'failed', v_job.status, 'failed',
      v_job.attempts, v_job.worker_id, jsonb_build_object('error_code', v_code, 'error_class', 'permanent'));
    v_status := 'failed';
  ELSE
    v_status := public._br_job_apply_failure(p_job_id, v_code, p_error_message, p_base_backoff_seconds, NULL);
    UPDATE public._br_backup_jobs SET error_class = 'transient' WHERE id = p_job_id;
  END IF;

  RETURN jsonb_build_object('job_id', p_job_id, 'status', v_status, 'reconciled', false,
    'error_class', CASE WHEN v_perm THEN 'permanent' ELSE 'transient' END,
    'next_attempt_at', (SELECT j.next_attempt_at FROM public._br_backup_jobs j WHERE j.id = p_job_id));
END $$;

-- ============ Création idempotente pour un tenant ============
CREATE OR REPLACE FUNCTION public._br_v3_request_capture(
  p_tenant_id uuid, p_period_key text, p_backup_kind text DEFAULT 'platform_manual', p_max_attempts integer DEFAULT 3)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_status text;
  v_created boolean;
BEGIN
  IF p_tenant_id IS NULL OR p_period_key IS NULL OR char_length(p_period_key) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'BRJ-001: tenant and period_key required' USING ERRCODE = '22023';
  END IF;
  IF p_backup_kind NOT IN ('auto','platform_manual') THEN
    RAISE EXCEPTION 'BRJ-001: invalid backup_kind' USING ERRCODE = '22023';
  END IF;
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 10 THEN
    RAISE EXCEPTION 'BRJ-001: invalid max_attempts' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = p_tenant_id) THEN
    RAISE EXCEPTION 'BRJ-061: tenant not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public._br_tenant_schedule_override o WHERE o.tenant_id = p_tenant_id AND o.suspended) THEN
    RAISE EXCEPTION 'BRJ-060: backups suspended for this tenant' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public._br_backup_jobs (tenant_id, backup_kind, period_key, scheduled_for, origin, max_attempts, next_attempt_at)
  VALUES (p_tenant_id, p_backup_kind, p_period_key, now(), 'manual', p_max_attempts, now())
  ON CONFLICT ON CONSTRAINT _br_backup_jobs_idem_key DO NOTHING
  RETURNING id INTO v_id;
  v_created := v_id IS NOT NULL;

  IF v_created THEN
    PERFORM public._br_job_log(v_id, p_tenant_id, 'created', NULL, 'pending', 0, NULL,
      jsonb_build_object('period_key', p_period_key, 'backup_kind', p_backup_kind, 'origin', 'manual', 'engine', 'v3'));
  ELSE
    SELECT j.id INTO v_id FROM public._br_backup_jobs j
    WHERE j.tenant_id = p_tenant_id AND j.backup_kind = p_backup_kind AND j.period_key = p_period_key;
  END IF;
  SELECT j.status INTO v_status FROM public._br_backup_jobs j WHERE j.id = v_id;
  RETURN jsonb_build_object('job_id', v_id, 'created', v_created, 'status', v_status);
END $$;

-- ============ Ordre d'export déterministe ============
CREATE OR REPLACE FUNCTION public._br_capture_order(p_rel regclass, p_alias text, OUT order_sql text, OUT order_key text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_cols text[];
BEGIN
  SELECT array_agg(a.attname::text ORDER BY k.n) INTO v_cols
  FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indrelid = p_rel AND i.indisprimary;

  IF v_cols IS NOT NULL THEN
    SELECT string_agg(format('%I.%I', p_alias, c.col), ', ' ORDER BY c.n) INTO order_sql
    FROM unnest(v_cols) WITH ORDINALITY AS c(col, n);
    order_key := 'pk:' || array_to_string(v_cols, ',');
  ELSE
    -- Sans clé primaire : ordre sur le texte canonique jsonb ; des lignes identiques sont interchangeables.
    order_sql := format('to_jsonb(%I)::text', p_alias);
    order_key := 'row_text';
  END IF;
END $$;

-- ============ Invalidation de génération ============
CREATE OR REPLACE FUNCTION public._br_capture_supersede(p_generation_id uuid, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_gen public._br_capture_generations%ROWTYPE;
BEGIN
  UPDATE public._br_capture_generations
     SET status = 'superseded', superseded_reason = left(p_reason, 200), superseded_at = clock_timestamp()
   WHERE id = p_generation_id AND status IN ('capturing','capture_ready')
  RETURNING * INTO v_gen;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  DELETE FROM public._br_capture_rows WHERE generation_id = p_generation_id;
  PERFORM public._br_job_log(v_gen.job_id, v_gen.tenant_id, 'generation_superseded', NULL, NULL, NULL, NULL,
    jsonb_build_object('generation_id', v_gen.id, 'generation_no', v_gen.generation_no, 'reason', left(p_reason, 200)));
  RETURN true;
END $$;

-- ============ Capture cohérente ============
CREATE OR REPLACE FUNCTION public._br_capture_run(p_job_id uuid, p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp SET statement_timeout = '300s' SET work_mem = '64MB' AS $$
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
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
  IF v_job.lease_expires_at - clock_timestamp() < interval '330 seconds' THEN
    RAISE EXCEPTION 'BRJ-041: remaining lease too short for a capture' USING ERRCODE = '55000';
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

-- ============ Contrôle du staging ============
CREATE OR REPLACE FUNCTION public._br_capture_verify_staging(p_generation_id uuid, p_requeue boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '300s' AS $$
DECLARE
  v_gen public._br_capture_generations%ROWTYPE;
  v_job public._br_backup_jobs%ROWTYPE;
  v_mis jsonb;
  v_requeued text;
BEGIN
  SELECT * INTO v_job FROM public._br_backup_jobs j
  WHERE j.id = (SELECT g.job_id FROM public._br_capture_generations g WHERE g.id = p_generation_id) FOR UPDATE;
  SELECT * INTO v_gen FROM public._br_capture_generations WHERE id = p_generation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRJ-030: generation % not found', p_generation_id USING ERRCODE = '55000';
  END IF;
  IF v_gen.status <> 'capture_ready' THEN
    RETURN jsonb_build_object('generation_id', p_generation_id, 'ok', false, 'reason', 'not_capture_ready', 'status', v_gen.status);
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('table', m.tn, 'expected', m.expected, 'found', m.found) ORDER BY m.tn), '[]'::jsonb)
    INTO v_mis
  FROM (
    SELECT coalesce(p.table_name, s.table_name) AS tn, p.rows_captured AS expected, coalesce(s.cnt, 0) AS found
    FROM (SELECT * FROM public._br_capture_progress WHERE generation_id = p_generation_id) p
    FULL JOIN (
      SELECT r.table_name, count(*) AS cnt, md5(string_agg(md5(r.row_data::text), '' ORDER BY r.ord)) AS chk
      FROM public._br_capture_rows r WHERE r.generation_id = p_generation_id GROUP BY r.table_name
    ) s ON s.table_name = p.table_name
    WHERE p.table_name IS NULL OR coalesce(s.cnt, 0) <> p.rows_captured OR s.chk IS DISTINCT FROM p.checksum
  ) m;

  IF v_mis = '[]'::jsonb THEN
    RETURN jsonb_build_object('generation_id', p_generation_id, 'ok', true);
  END IF;

  IF p_requeue AND v_job.status = 'capture_ready' AND v_job.capture_generation_id = p_generation_id THEN
    v_requeued := public._br_job_apply_failure(v_job.id, 'STAGING_LOST', 'Staging incomplete or altered', 10, NULL);
    UPDATE public._br_backup_jobs SET capture_generation_id = NULL, error_class = 'transient' WHERE id = v_job.id;
  END IF;
  PERFORM public._br_capture_supersede(p_generation_id, 'staging_lost');
  RETURN jsonb_build_object('generation_id', p_generation_id, 'ok', false, 'reason', 'staging_lost',
                            'mismatches', v_mis, 'job_status', v_requeued);
END $$;

-- ============ Génération courante (préalable au lot C, ne publie rien) ============
CREATE OR REPLACE FUNCTION public._br_capture_assert_current(p_generation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET statement_timeout = '300s' AS $$
DECLARE
  v_gen public._br_capture_generations%ROWTYPE;
  v_job public._br_backup_jobs%ROWTYPE;
  v_check jsonb;
BEGIN
  SELECT * INTO v_gen FROM public._br_capture_generations WHERE id = p_generation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRJ-030: generation % not found', p_generation_id USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_job FROM public._br_backup_jobs WHERE id = v_gen.job_id;
  IF v_gen.status <> 'capture_ready' OR v_job.status <> 'capture_ready'
     OR v_job.capture_generation_id IS DISTINCT FROM v_gen.id OR v_job.claim_fence <> v_gen.claim_fence
     OR v_job.tenant_id <> v_gen.tenant_id THEN
    RAISE EXCEPTION 'BRJ-071: generation % is not the current capture of its job', p_generation_id USING ERRCODE = '55000';
  END IF;
  v_check := public._br_capture_verify_staging(p_generation_id, false);
  IF NOT (v_check->>'ok')::boolean THEN
    RAISE EXCEPTION 'BRJ-071: generation % staging failed verification', p_generation_id USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('generation_id', v_gen.id, 'job_id', v_job.id, 'tenant_id', v_gen.tenant_id,
    'generation_no', v_gen.generation_no, 'total_rows', v_gen.total_rows, 'global_checksum', v_gen.global_checksum,
    'state', 'capture_ready', 'restorable', false);
END $$;

-- ============ Annulation explicite ============
CREATE OR REPLACE FUNCTION public._br_job_cancel(p_job_id uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_job public._br_backup_jobs%ROWTYPE;
  v_g uuid;
BEGIN
  SELECT * INTO v_job FROM public._br_backup_jobs WHERE id = p_job_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRJ-030: job % not found', p_job_id USING ERRCODE = '55000';
  END IF;
  IF v_job.status IN ('succeeded','failed','cancelled') THEN
    RETURN jsonb_build_object('job_id', p_job_id, 'status', v_job.status, 'changed', false);
  END IF;
  IF v_job.status IN ('leased','processing') AND v_job.lease_expires_at > now() THEN
    RAISE EXCEPTION 'BRJ-012: job % has an active lease', p_job_id USING ERRCODE = '55000';
  END IF;

  UPDATE public._br_backup_jobs
     SET status = 'cancelled', finished_at = now(), lease_token = NULL, lease_expires_at = NULL,
         capture_generation_id = NULL, error_code = 'CANCELLED', error_message = left(p_reason, 2000)
   WHERE id = p_job_id;
  FOR v_g IN SELECT g.id FROM public._br_capture_generations g
             WHERE g.job_id = p_job_id AND g.status IN ('capturing','capture_ready') LOOP
    PERFORM public._br_capture_supersede(v_g, 'job_cancelled');
  END LOOP;
  PERFORM public._br_job_log(p_job_id, v_job.tenant_id, 'cancelled', v_job.status, 'cancelled',
    v_job.attempts, v_job.worker_id, jsonb_build_object('reason', left(p_reason, 200)));
  RETURN jsonb_build_object('job_id', p_job_id, 'status', 'cancelled', 'changed', true);
END $$;

-- ============ Sécurité ============
ALTER TABLE public._br_capture_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._br_capture_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._br_capture_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._br_capture_rows ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public._br_capture_slots, public._br_capture_generations,
                    public._br_capture_progress, public._br_capture_rows
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public._br_capture_slots, public._br_capture_generations,
                      public._br_capture_progress, public._br_capture_rows TO service_role;

REVOKE ALL ON FUNCTION
  public._br_backup_jobs_release_slot(),
  public._br_capture_generations_guard(),
  public._br_capture_rows_insert_guard(),
  public._br_capture_rows_no_update(),
  public._br_capture_progress_guard(),
  public._br_capture_order(regclass, text),
  public._br_capture_supersede(uuid, text),
  public._br_job_fail(uuid, uuid, text, text, boolean, integer),
  public._br_v3_request_capture(uuid, text, text, integer),
  public._br_capture_run(uuid, uuid),
  public._br_capture_verify_staging(uuid, boolean),
  public._br_capture_assert_current(uuid),
  public._br_job_cancel(uuid, text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public._br_job_fail(uuid, uuid, text, text, boolean, integer),
  public._br_v3_request_capture(uuid, text, text, integer),
  public._br_capture_run(uuid, uuid),
  public._br_capture_verify_staging(uuid, boolean),
  public._br_capture_assert_current(uuid),
  public._br_job_cancel(uuid, text)
TO service_role;

-- ============ Registre (exclu, préservé) ============
INSERT INTO public._br_table_registry
  (schema_name, table_name, tenant_link, tenant_id_column, category, restore_order, reset_behavior, is_mandatory, exclusion_reason)
SELECT 'public', v.t, 'excluded', 'tenant_id', 'backup_system', 0, 'preserve', false, v.r
FROM (VALUES
  ('_br_capture_generations', 'Capture generations — operational metadata, never restored as tenant data'),
  ('_br_capture_progress', 'Capture progress — operational metadata, never restored as tenant data'),
  ('_br_capture_rows', 'Capture staging — temporary copy, never restored directly')
) AS v(t, r)
WHERE NOT EXISTS (SELECT 1 FROM public._br_table_registry r WHERE r.schema_name = 'public' AND r.table_name = v.t);
