/*
# Lot C — Export par blocs et publication vérifiée (INACTIF)

## Résumé
Transforme une génération `capture_ready` (lot B) en archive v3 exportée par blocs bornés en octets,
chiffrés hors base (Edge Function), vérifiés bloc par bloc puis publiés avec un manifeste de référence serveur.
Réutilise la file `_br_backup_jobs` (pas de seconde file) : nouveaux états `exporting`, `verifying`,
`publishing` entre `capture_ready` et `succeeded`/`failed`. Le bail d'export (jeton + fence) est porté par
l'archive, selon le même modèle que le bail de capture. AUCUN cron, AUCUNE activation :
`_br_v3_export_config.enabled = false`, `offsite_enabled = false`, `cleanup_delete_enabled = false`.

## 1. Tables modifiées (aucune donnée modifiée)
- `_br_backup_jobs` : statuts `exporting`, `verifying`, `publishing` ; l'index « un job actif par tenant »
  couvre ces états (le claim existant saute déjà un tenant dont l'index est occupé).
- `_br_backup_job_events` : événements `export_started`, `blocks_exported`, `archive_verified`, `export_failed`.

## 2. Nouvelles tables (RLS active, aucune politique, aucun droit anon/authenticated)
- `_br_v3_export_config` : interrupteurs (désactivés) et limites (taille cible d'un bloc en octets, taille
  maximale d'une ligne, lignes max par bloc, blocs par invocation, bail, nombre de reprises).
- `_br_v3_archives` : une archive par génération ; curseur d'export (table, ord), progression de vérification,
  bail d'export fencé, référence du manifeste publié. `restorable` est contraint à false (lot D non validé).
- `_br_v3_archive_blocks` : blocs validés (plage d'ord, tailles, SHA-256 clair et stocké, objet, clé, nonce).
  Unicité (clé, nonce) : un nonce validé ne peut jamais être réutilisé sous la même clé.
- `_br_v3_offsite_transfers` : copie LWS v3 bloc par bloc, reprise par curseur, manifeste transféré en dernier.

## 3. Garanties
1. Lecture uniquement depuis le staging figé de la génération ; pagination stable sur (génération, table, ord).
2. Limite réelle en octets (octet_length du texte jsonb) ; ligne au-delà de row_max_bytes => BRV-021.
3. Validation d'un bloc : bail vérifié sous verrou, plage attendue, contenu recalculé côté serveur (SHA-256).
4. `verified` seulement après vérification de tous les blocs et contrôle du manifeste recalculé en base.
5. Blocs validés et archives publiées immuables (triggers) ; un ancien worker est refusé (BRV-010/BRV-012).
6. Les archives v3 ne sont pas insérées dans `tenant_backups` : les écrans et la restauration v2 ne les voient pas.

## 4. Stockage
Bucket privé `tenant-backups-v3` (public = false, aucune politique : seul le rôle serveur y accède).

## 5. Sécurité
REVOKE ALL pour PUBLIC/anon/authenticated ; service_role : SELECT sur les tables, EXECUTE sur l'API serveur.
`br_v3_download_authorize` est la seule fonction ouverte à `authenticated` (propriétaire/super_admin du tenant courant).
Réinitialisation, restauration et import restent bloqués (BR020) : fonctions non modifiées.
*/

-- 1. File existante : nouveaux états d'export
ALTER TABLE public._br_backup_jobs DROP CONSTRAINT IF EXISTS _br_backup_jobs_status_check;
ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_status_check
  CHECK (status IN ('pending','leased','processing','capture_ready','exporting','verifying','publishing',
                    'succeeded','failed','cancelled'));

DROP INDEX IF EXISTS public.uq_br_backup_jobs_one_active_per_tenant;
CREATE UNIQUE INDEX uq_br_backup_jobs_one_active_per_tenant
  ON public._br_backup_jobs (tenant_id)
  WHERE status IN ('leased','processing','capture_ready','exporting','verifying','publishing');

ALTER TABLE public._br_backup_job_events DROP CONSTRAINT IF EXISTS _br_backup_job_events_event_check;
ALTER TABLE public._br_backup_job_events ADD CONSTRAINT _br_backup_job_events_event_check
  CHECK (event IN ('created','leased','renewed','started','retry_scheduled','lease_expired_recovered',
                   'succeeded','failed','reconciled','capture_ready','generation_superseded','cancelled',
                   'export_started','blocks_exported','archive_verified','export_failed'));

-- 2. Configuration (inactive)
CREATE TABLE IF NOT EXISTS public._br_v3_export_config (
  id                        smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled                   boolean NOT NULL DEFAULT false,
  offsite_enabled           boolean NOT NULL DEFAULT false,
  cleanup_delete_enabled    boolean NOT NULL DEFAULT false,
  storage_bucket            text NOT NULL DEFAULT 'tenant-backups-v3',
  block_target_bytes        integer NOT NULL DEFAULT 4194304 CHECK (block_target_bytes BETWEEN 1024 AND 16777216),
  row_max_bytes             integer NOT NULL DEFAULT 16777216 CHECK (row_max_bytes BETWEEN 1024 AND 33554432),
  max_rows_per_block        integer NOT NULL DEFAULT 100000 CHECK (max_rows_per_block BETWEEN 1 AND 1000000),
  max_blocks_per_invocation integer NOT NULL DEFAULT 8 CHECK (max_blocks_per_invocation BETWEEN 1 AND 64),
  lease_seconds             integer NOT NULL DEFAULT 300 CHECK (lease_seconds BETWEEN 30 AND 1800),
  max_export_claims         integer NOT NULL DEFAULT 30 CHECK (max_export_claims BETWEEN 1 AND 500),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT _br_v3_export_config_rowmax_chk CHECK (row_max_bytes >= block_target_bytes)
);
INSERT INTO public._br_v3_export_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 3. Archives, blocs, copies hors site
CREATE TABLE IF NOT EXISTS public._br_v3_archives (
  id                      uuid PRIMARY KEY,
  tenant_id               uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id                  uuid NOT NULL,
  generation_id           uuid NOT NULL,
  format_version          integer NOT NULL DEFAULT 3 CHECK (format_version = 3),
  status                  text NOT NULL DEFAULT 'exporting'
                          CHECK (status IN ('exporting','verifying','publishing','verified','failed','abandoned')),
  storage_bucket          text NOT NULL,
  storage_prefix          text NOT NULL,
  registry_fingerprint    text NOT NULL,
  block_target_bytes      integer NOT NULL,
  row_max_bytes           integer NOT NULL,
  max_rows_per_block      integer NOT NULL,
  key_id                  text,
  cur_table               text,
  cur_ord                 bigint NOT NULL DEFAULT 0,
  next_block_no           integer NOT NULL DEFAULT 1,
  blocks_verified         integer NOT NULL DEFAULT 0,
  block_count             integer,
  total_rows              bigint,
  plain_bytes             bigint,
  stored_bytes            bigint,
  manifest_path           text,
  manifest_plain_sha256   text,
  manifest_sha256         text,
  manifest_bytes          bigint,
  manifest_nonce_hex      text,
  export_fence            bigint NOT NULL DEFAULT 0,
  export_lease_token      uuid,
  export_lease_expires_at timestamptz,
  export_worker_id        text,
  export_claims           integer NOT NULL DEFAULT 0,
  transient_errors        integer NOT NULL DEFAULT 0,
  error_code              text CHECK (error_code IS NULL OR char_length(error_code) <= 64),
  error_message           text CHECK (error_message IS NULL OR char_length(error_message) <= 2000),
  restorable              boolean NOT NULL DEFAULT false CHECK (restorable = false),
  created_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at              timestamptz NOT NULL DEFAULT clock_timestamp(),
  verified_at             timestamptz,
  finished_at             timestamptz,
  CONSTRAINT _br_v3_archives_tenant_id_key UNIQUE (tenant_id, id),
  CONSTRAINT _br_v3_archives_generation_key UNIQUE (generation_id),
  CONSTRAINT _br_v3_archives_job_fkey FOREIGN KEY (tenant_id, job_id)
    REFERENCES public._br_backup_jobs (tenant_id, id),
  CONSTRAINT _br_v3_archives_gen_fkey FOREIGN KEY (tenant_id, generation_id)
    REFERENCES public._br_capture_generations (tenant_id, id),
  CONSTRAINT _br_v3_archives_verified_chk CHECK (status <> 'verified' OR (manifest_path IS NOT NULL
    AND manifest_sha256 IS NOT NULL AND verified_at IS NOT NULL AND block_count IS NOT NULL
    AND blocks_verified = block_count)),
  CONSTRAINT _br_v3_archives_lease_chk CHECK ((export_lease_token IS NULL) = (export_lease_expires_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_br_v3_archives_one_open_per_job
  ON public._br_v3_archives (job_id) WHERE status IN ('exporting','verifying','publishing');
CREATE INDEX IF NOT EXISTS idx_br_v3_archives_tenant ON public._br_v3_archives (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public._br_v3_archive_blocks (
  archive_id      uuid NOT NULL,
  tenant_id       uuid NOT NULL,
  block_no        integer NOT NULL CHECK (block_no >= 1),
  table_name      text NOT NULL,
  ord_from        bigint NOT NULL CHECK (ord_from >= 1),
  ord_to          bigint NOT NULL,
  row_count       integer NOT NULL CHECK (row_count >= 1),
  plain_bytes     integer NOT NULL CHECK (plain_bytes > 0),
  plain_sha256    text NOT NULL CHECK (plain_sha256 ~ '^[0-9a-f]{64}$'),
  stored_bytes    integer NOT NULL CHECK (stored_bytes > 0),
  stored_sha256   text NOT NULL CHECK (stored_sha256 ~ '^[0-9a-f]{64}$'),
  object_path     text NOT NULL,
  key_id          text NOT NULL,
  nonce_hex       text NOT NULL CHECK (nonce_hex ~ '^[0-9a-f]{24}$'),
  attempt_id      uuid NOT NULL,
  committed_fence bigint NOT NULL,
  committed_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  verified_at     timestamptz,
  PRIMARY KEY (archive_id, block_no),
  CONSTRAINT _br_v3_blocks_range_key UNIQUE (archive_id, table_name, ord_from),
  CONSTRAINT _br_v3_blocks_object_key UNIQUE (object_path),
  CONSTRAINT _br_v3_blocks_nonce_key UNIQUE (key_id, nonce_hex),
  CONSTRAINT _br_v3_blocks_count_chk CHECK (ord_to >= ord_from AND row_count = ord_to - ord_from + 1),
  CONSTRAINT _br_v3_blocks_archive_fkey FOREIGN KEY (tenant_id, archive_id)
    REFERENCES public._br_v3_archives (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public._br_v3_offsite_transfers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_id         uuid NOT NULL,
  tenant_id          uuid NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','confirmed','failed')),
  remote_prefix      text NOT NULL,
  blocks_confirmed   integer NOT NULL DEFAULT 0 CHECK (blocks_confirmed >= 0),
  manifest_confirmed boolean NOT NULL DEFAULT false,
  fence              bigint NOT NULL DEFAULT 0,
  lease_token        uuid,
  lease_expires_at   timestamptz,
  worker_id          text,
  attempts           integer NOT NULL DEFAULT 0,
  max_attempts       integer NOT NULL DEFAULT 10 CHECK (max_attempts BETWEEN 1 AND 100),
  error_code         text CHECK (error_code IS NULL OR char_length(error_code) <= 64),
  error_message      text CHECK (error_message IS NULL OR char_length(error_message) <= 2000),
  requested_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
  confirmed_at       timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT _br_v3_offsite_archive_key UNIQUE (archive_id),
  CONSTRAINT _br_v3_offsite_archive_fkey FOREIGN KEY (tenant_id, archive_id)
    REFERENCES public._br_v3_archives (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT _br_v3_offsite_confirmed_chk CHECK (status <> 'confirmed' OR (manifest_confirmed AND confirmed_at IS NOT NULL))
);

-- 4. Immuabilité
CREATE OR REPLACE FUNCTION public._br_v3_archives_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('exporting','verifying','publishing','verified')
       AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
      RAISE EXCEPTION 'BRV-070: archive % (%) cannot be deleted', OLD.id, OLD.status USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'exporting' THEN
      RAISE EXCEPTION 'BRV-070: an archive must start in exporting' USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.id <> OLD.id OR NEW.tenant_id <> OLD.tenant_id OR NEW.job_id <> OLD.job_id
     OR NEW.generation_id <> OLD.generation_id OR NEW.storage_bucket <> OLD.storage_bucket
     OR NEW.storage_prefix <> OLD.storage_prefix OR NEW.registry_fingerprint <> OLD.registry_fingerprint
     OR NEW.block_target_bytes <> OLD.block_target_bytes OR NEW.row_max_bytes <> OLD.row_max_bytes
     OR NEW.max_rows_per_block <> OLD.max_rows_per_block OR NEW.created_at <> OLD.created_at
     OR (OLD.key_id IS NOT NULL AND NEW.key_id IS DISTINCT FROM OLD.key_id)
     OR NEW.export_fence < OLD.export_fence THEN
    RAISE EXCEPTION 'BRV-070: archive identity is immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IN ('verified','failed','abandoned') THEN
    RAISE EXCEPTION 'BRV-070: archive % is terminal (%)', OLD.id, OLD.status USING ERRCODE = '55000';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'exporting' AND NEW.status IN ('verifying','publishing'))
    OR (OLD.status = 'verifying' AND NEW.status = 'publishing')
    OR (OLD.status = 'publishing' AND NEW.status = 'verified')
    OR NEW.status IN ('failed','abandoned')) THEN
    RAISE EXCEPTION 'BRV-070: invalid archive transition % -> %', OLD.status, NEW.status USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_br_v3_archives_guard ON public._br_v3_archives;
CREATE TRIGGER trg_br_v3_archives_guard BEFORE INSERT OR UPDATE OR DELETE ON public._br_v3_archives
  FOR EACH ROW EXECUTE FUNCTION public._br_v3_archives_guard();

CREATE OR REPLACE FUNCTION public._br_v3_blocks_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_status text;
BEGIN
  SELECT a.status INTO v_status FROM public._br_v3_archives a WHERE a.id = OLD.archive_id;
  IF TG_OP = 'DELETE' THEN
    IF v_status IS NOT NULL AND v_status NOT IN ('failed','abandoned') THEN
      RAISE EXCEPTION 'BRV-072: committed block of archive % (%) cannot be deleted', OLD.archive_id, v_status
        USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.verified_at IS NOT NULL OR NEW.verified_at IS NULL
     OR ROW(NEW.archive_id, NEW.tenant_id, NEW.block_no, NEW.table_name, NEW.ord_from, NEW.ord_to, NEW.row_count,
            NEW.plain_bytes, NEW.plain_sha256, NEW.stored_bytes, NEW.stored_sha256, NEW.object_path, NEW.key_id,
            NEW.nonce_hex, NEW.attempt_id, NEW.committed_fence, NEW.committed_at)
        IS DISTINCT FROM
        ROW(OLD.archive_id, OLD.tenant_id, OLD.block_no, OLD.table_name, OLD.ord_from, OLD.ord_to, OLD.row_count,
            OLD.plain_bytes, OLD.plain_sha256, OLD.stored_bytes, OLD.stored_sha256, OLD.object_path, OLD.key_id,
            OLD.nonce_hex, OLD.attempt_id, OLD.committed_fence, OLD.committed_at) THEN
    RAISE EXCEPTION 'BRV-072: committed blocks are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_br_v3_blocks_guard ON public._br_v3_archive_blocks;
CREATE TRIGGER trg_br_v3_blocks_guard BEFORE UPDATE OR DELETE ON public._br_v3_archive_blocks
  FOR EACH ROW EXECUTE FUNCTION public._br_v3_blocks_guard();

-- 5. Lecture bornée du staging figé
CREATE OR REPLACE FUNCTION public._br_v3_next_range(p_archive public._br_v3_archives, OUT o_table text, OUT o_ord_from bigint)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_rows bigint;
BEGIN
  IF p_archive.cur_table IS NOT NULL THEN
    SELECT p.rows_captured INTO v_rows FROM public._br_capture_progress p
    WHERE p.generation_id = p_archive.generation_id AND p.table_name = p_archive.cur_table;
    IF p_archive.cur_ord < v_rows THEN
      o_table := p_archive.cur_table;
      o_ord_from := p_archive.cur_ord + 1;
      RETURN;
    END IF;
  END IF;
  SELECT p.table_name INTO o_table FROM public._br_capture_progress p
  WHERE p.generation_id = p_archive.generation_id AND p.rows_captured > 0
    AND (p_archive.cur_table IS NULL OR p.table_name COLLATE "C" > p_archive.cur_table COLLATE "C")
  ORDER BY p.table_name COLLATE "C" LIMIT 1;
  IF o_table IS NOT NULL THEN
    o_ord_from := 1;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_block_text(
  p_archive public._br_v3_archives, p_block_no integer, p_table text, p_ord_from bigint,
  OUT o_body text, OUT o_ord_to bigint, OUT o_rows integer, OUT o_bytes integer)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_lines text[] := '{}';
  v_bytes bigint := 0;
  v_len bigint;
  v_expect bigint := p_ord_from;
BEGIN
  -- Mémoire bornée par la taille cible + une ligne ; ord est contigu (1..n) par table dans le staging.
  FOR r IN SELECT c.ord, c.row_data::text AS t FROM public._br_capture_rows c
           WHERE c.generation_id = p_archive.generation_id AND c.table_name = p_table AND c.ord >= p_ord_from
           ORDER BY c.ord LIMIT p_archive.max_rows_per_block
  LOOP
    IF r.ord <> v_expect THEN
      RAISE EXCEPTION 'BRV-022: staging gap in % at ord % (expected %)', p_table, r.ord, v_expect USING ERRCODE = '55000';
    END IF;
    v_len := octet_length(r.t) + 1;
    IF v_len - 1 > p_archive.row_max_bytes THEN
      RAISE EXCEPTION 'BRV-021: row too large for format v3 (table %, ord %, % bytes, limit % bytes)',
        p_table, r.ord, v_len - 1, p_archive.row_max_bytes USING ERRCODE = '54000';
    END IF;
    IF cardinality(v_lines) > 0 AND v_bytes + v_len > p_archive.block_target_bytes THEN
      EXIT;
    END IF;
    v_lines := v_lines || r.t;
    v_bytes := v_bytes + v_len;
    v_expect := v_expect + 1;
    IF v_bytes >= p_archive.block_target_bytes THEN
      EXIT;
    END IF;
  END LOOP;
  IF cardinality(v_lines) = 0 THEN
    RAISE EXCEPTION 'BRV-022: no staging row for % from ord %', p_table, p_ord_from USING ERRCODE = '55000';
  END IF;
  o_rows := cardinality(v_lines);
  o_ord_to := p_ord_from + o_rows - 1;
  o_body := jsonb_build_object('format', 'waarwi-br-block', 'format_version', 3, 'tenant_id', p_archive.tenant_id,
              'archive_id', p_archive.id, 'generation_id', p_archive.generation_id, 'block_no', p_block_no,
              'table', p_table, 'ord_from', p_ord_from, 'ord_to', o_ord_to, 'rows', o_rows)::text
            || E'\n' || array_to_string(v_lines, E'\n') || E'\n';
  o_bytes := octet_length(o_body);
END $$;

-- 6. Bail d'export (fencé, vérifié sous verrou à chaque écriture)
CREATE OR REPLACE FUNCTION public._br_v3_binding_ok(p_archive public._br_v3_archives)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public._br_backup_jobs j
    JOIN public._br_capture_generations g ON g.id = p_archive.generation_id
    WHERE j.id = p_archive.job_id AND j.status = p_archive.status
      AND j.capture_generation_id = p_archive.generation_id
      AND g.status = 'capture_ready' AND g.claim_fence = j.claim_fence AND g.tenant_id = p_archive.tenant_id);
$$;

CREATE OR REPLACE FUNCTION public._br_v3_lock(p_archive_id uuid, p_token uuid, p_states text[])
RETURNS public._br_v3_archives LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public._br_v3_archives%ROWTYPE;
BEGIN
  PERFORM 1 FROM public._br_backup_jobs j
  WHERE j.id = (SELECT x.job_id FROM public._br_v3_archives x WHERE x.id = p_archive_id) FOR UPDATE;
  SELECT * INTO a FROM public._br_v3_archives WHERE id = p_archive_id FOR UPDATE;
  IF NOT FOUND OR p_token IS NULL OR a.export_lease_token IS DISTINCT FROM p_token
     OR a.export_lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'BRV-010: export lease not held for archive %', p_archive_id USING ERRCODE = '55000';
  END IF;
  IF NOT (a.status = ANY (p_states)) THEN
    RAISE EXCEPTION 'BRV-011: archive % is in state %', p_archive_id, a.status USING ERRCODE = '55000';
  END IF;
  IF NOT public._br_v3_binding_ok(a) THEN
    RAISE EXCEPTION 'BRV-012: archive % is no longer bound to the current generation of its job', p_archive_id
      USING ERRCODE = '55000';
  END IF;
  RETURN a;
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_terminate(p_archive_id uuid, p_status text, p_code text, p_message text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  j public._br_backup_jobs%ROWTYPE;
BEGIN
  UPDATE public._br_v3_archives
     SET status = p_status, finished_at = clock_timestamp(), export_lease_token = NULL, export_lease_expires_at = NULL,
         error_code = left(p_code, 64), error_message = left(p_message, 2000)
   WHERE id = p_archive_id AND status IN ('exporting','verifying','publishing')
  RETURNING * INTO a;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT * INTO j FROM public._br_backup_jobs WHERE id = a.job_id FOR UPDATE;
  IF j.status IN ('exporting','verifying','publishing') AND j.capture_generation_id = a.generation_id THEN
    UPDATE public._br_backup_jobs
       SET status = 'failed', finished_at = now(), error_code = left(p_code, 64),
           error_message = left(p_message, 2000), error_class = 'permanent'
     WHERE id = j.id;
    PERFORM public._br_job_log(j.id, j.tenant_id, 'export_failed', j.status, 'failed', j.attempts, a.export_worker_id,
      jsonb_build_object('archive_id', a.id, 'error_code', left(p_code, 64)));
  END IF;
  PERFORM public._br_capture_supersede(a.generation_id, 'export_' || p_status);
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_export_claim(p_worker_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
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
  SELECT * INTO cfg FROM public._br_v3_export_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.enabled THEN
    RAISE EXCEPTION 'BRV-045: v3 export is disabled' USING ERRCODE = '55000';
  END IF;

  -- Reprise d'abord : archive ouverte sans bail valide.
  FOR a IN SELECT * FROM public._br_v3_archives x
           WHERE x.status IN ('exporting','verifying','publishing')
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
    FOR j IN SELECT * FROM public._br_backup_jobs x
             WHERE x.status = 'capture_ready' AND x.capture_generation_id IS NOT NULL
             ORDER BY x.created_at, x.id
             LIMIT 5
             FOR UPDATE SKIP LOCKED
    LOOP
      v_chk := public._br_capture_verify_staging(j.capture_generation_id, true);
      IF NOT coalesce((v_chk->>'ok')::boolean, false) THEN
        CONTINUE;
      END IF;
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
        p_worker_id, jsonb_build_object('archive_id', v_id, 'generation_id', j.capture_generation_id));
      EXIT;
    END LOOP;
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

CREATE OR REPLACE FUNCTION public._br_v3_export_renew(p_archive_id uuid, p_token uuid, p_seconds integer)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_exp timestamptz;
BEGIN
  IF p_seconds IS NULL OR p_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION 'BRV-001: lease seconds must be between 30 and 1800' USING ERRCODE = '22023';
  END IF;
  PERFORM public._br_v3_lock(p_archive_id, p_token, ARRAY['exporting','verifying','publishing']);
  UPDATE public._br_v3_archives SET export_lease_expires_at = clock_timestamp() + make_interval(secs => p_seconds)
   WHERE id = p_archive_id RETURNING export_lease_expires_at INTO v_exp;
  RETURN v_exp;
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_export_release(p_archive_id uuid, p_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public._br_v3_archives SET export_lease_token = NULL, export_lease_expires_at = NULL
   WHERE id = p_archive_id AND export_lease_token = p_token AND status IN ('exporting','verifying','publishing');
  RETURN FOUND;
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_export_fail(
  p_archive_id uuid, p_token uuid, p_code text, p_message text, p_permanent boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  v_code text := left(coalesce(nullif(p_code, ''), 'UNKNOWN'), 64);
BEGIN
  a := public._br_v3_lock(p_archive_id, p_token, ARRAY['exporting','verifying','publishing']);
  -- BRV-02x (format/plage) et BRV-03x (intégrité) ne se corrigent pas en réessayant.
  IF coalesce(p_permanent, false) OR v_code ~ '^BRV-0[23]' THEN
    PERFORM public._br_v3_terminate(a.id, 'failed', v_code, p_message);
    RETURN jsonb_build_object('archive_id', a.id, 'status', 'failed', 'error_code', v_code);
  END IF;
  UPDATE public._br_v3_archives
     SET export_lease_token = NULL, export_lease_expires_at = NULL, transient_errors = transient_errors + 1,
         error_code = v_code, error_message = left(p_message, 2000)
   WHERE id = a.id;
  RETURN jsonb_build_object('archive_id', a.id, 'status', a.status, 'resumable', true, 'error_code', v_code);
END $$;

-- 7. Blocs : lecture puis validation fencée
CREATE OR REPLACE FUNCTION public._br_v3_read_block(p_archive_id uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  r record;
  b record;
BEGIN
  a := public._br_v3_lock(p_archive_id, p_token, ARRAY['exporting']);
  SELECT * INTO r FROM public._br_v3_next_range(a);
  IF r.o_table IS NULL THEN
    RETURN jsonb_build_object('done', true, 'next_block_no', a.next_block_no);
  END IF;
  SELECT * INTO b FROM public._br_v3_block_text(a, a.next_block_no, r.o_table, r.o_ord_from);
  RETURN jsonb_build_object('done', false, 'block_no', a.next_block_no, 'table', r.o_table,
    'ord_from', r.o_ord_from, 'ord_to', b.o_ord_to, 'rows', b.o_rows, 'plain_bytes', b.o_bytes,
    'plain_sha256', encode(sha256(convert_to(b.o_body, 'UTF8')), 'hex'), 'body', b.o_body);
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_commit_block(p_archive_id uuid, p_token uuid, p_block jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  ex public._br_v3_archive_blocks%ROWTYPE;
  r record;
  b record;
  v_no integer := (p_block->>'block_no')::integer;
  v_attempt uuid := (p_block->>'attempt_id')::uuid;
  v_table text := p_block->>'table';
  v_from bigint := (p_block->>'ord_from')::bigint;
  v_to bigint := (p_block->>'ord_to')::bigint;
  v_rows integer := (p_block->>'rows')::integer;
  v_psha text := p_block->>'plain_sha256';
  v_ssha text := p_block->>'stored_sha256';
  v_sbytes bigint := (p_block->>'stored_bytes')::bigint;
  v_path text := p_block->>'object_path';
  v_kid text := p_block->>'key_id';
  v_nonce text := p_block->>'nonce_hex';
  v_max_stored bigint;
BEGIN
  a := public._br_v3_lock(p_archive_id, p_token, ARRAY['exporting']);

  SELECT * INTO ex FROM public._br_v3_archive_blocks WHERE archive_id = a.id AND block_no = v_no;
  IF FOUND THEN
    IF ex.attempt_id = v_attempt AND ex.stored_sha256 = v_ssha THEN
      RETURN jsonb_build_object('committed', true, 'idempotent', true, 'next_block_no', a.next_block_no);
    END IF;
    RAISE EXCEPTION 'BRV-023: block % already committed by another attempt', v_no USING ERRCODE = '55000';
  END IF;

  IF v_attempt IS NULL OR v_kid IS NULL OR char_length(v_kid) NOT BETWEEN 1 AND 64
     OR v_nonce IS NULL OR v_nonce !~ '^[0-9a-f]{24}$' OR v_psha IS NULL OR v_psha !~ '^[0-9a-f]{64}$'
     OR v_ssha IS NULL OR v_ssha !~ '^[0-9a-f]{64}$' OR v_sbytes IS NULL OR v_sbytes <= 0 THEN
    RAISE EXCEPTION 'BRV-001: invalid block descriptor' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO r FROM public._br_v3_next_range(a);
  IF v_no IS DISTINCT FROM a.next_block_no OR r.o_table IS NULL OR v_table IS DISTINCT FROM r.o_table
     OR v_from IS DISTINCT FROM r.o_ord_from THEN
    RAISE EXCEPTION 'BRV-024: unexpected block % (%:%), expected % (%:%)', v_no, v_table, v_from,
      a.next_block_no, r.o_table, r.o_ord_from USING ERRCODE = '55000';
  END IF;

  SELECT * INTO b FROM public._br_v3_block_text(a, v_no, r.o_table, r.o_ord_from);
  IF b.o_ord_to IS DISTINCT FROM v_to OR b.o_rows IS DISTINCT FROM v_rows
     OR encode(sha256(convert_to(b.o_body, 'UTF8')), 'hex') <> v_psha THEN
    RAISE EXCEPTION 'BRV-024: block % content does not match the frozen staging', v_no USING ERRCODE = '55000';
  END IF;

  IF a.key_id IS NOT NULL AND a.key_id <> v_kid THEN
    RAISE EXCEPTION 'BRV-025: archive key is %, block uses %', a.key_id, v_kid USING ERRCODE = '55000';
  END IF;
  IF v_path IS DISTINCT FROM a.storage_prefix || format('blocks/%s-%s.wbr3', lpad(v_no::text, 6, '0'), v_attempt) THEN
    RAISE EXCEPTION 'BRV-024: unexpected object path for block %', v_no USING ERRCODE = '55000';
  END IF;
  v_max_stored := (a.row_max_bytes + 4096)::bigint + (a.row_max_bytes + 4096) / 1000 + 4096;
  IF v_sbytes > v_max_stored THEN
    RAISE EXCEPTION 'BRV-021: stored block % exceeds % bytes', v_no, v_max_stored USING ERRCODE = '54000';
  END IF;

  BEGIN
    INSERT INTO public._br_v3_archive_blocks (archive_id, tenant_id, block_no, table_name, ord_from, ord_to, row_count,
      plain_bytes, plain_sha256, stored_bytes, stored_sha256, object_path, key_id, nonce_hex, attempt_id, committed_fence)
    VALUES (a.id, a.tenant_id, v_no, v_table, v_from, v_to, v_rows, b.o_bytes, v_psha, v_sbytes, v_ssha,
      v_path, v_kid, v_nonce, v_attempt, a.export_fence);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BRV-026: nonce or object already used' USING ERRCODE = '55000';
  END;

  UPDATE public._br_v3_archives
     SET key_id = v_kid, cur_table = v_table, cur_ord = v_to, next_block_no = v_no + 1, export_claims = 0
   WHERE id = a.id;
  RETURN jsonb_build_object('committed', true, 'idempotent', false, 'next_block_no', v_no + 1);
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_finish_blocks(p_archive_id uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  r record;
  v_bad jsonb;
  v_n integer;
  v_rows bigint;
  v_plain bigint;
  v_stored bigint;
  v_next text;
BEGIN
  a := public._br_v3_lock(p_archive_id, p_token, ARRAY['exporting']);
  SELECT * INTO r FROM public._br_v3_next_range(a);
  IF r.o_table IS NOT NULL THEN
    RAISE EXCEPTION 'BRV-027: export not finished (next %:%)', r.o_table, r.o_ord_from USING ERRCODE = '55000';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('table', m.tn, 'expected', m.expected, 'exported', m.exported)), '[]')
    INTO v_bad
  FROM (
    SELECT coalesce(p.table_name, s.table_name) AS tn, p.rows_captured AS expected, coalesce(s.n, 0) AS exported
    FROM (SELECT * FROM public._br_capture_progress WHERE generation_id = a.generation_id) p
    FULL JOIN (SELECT k.table_name, sum(k.row_count) AS n, min(k.ord_from) AS mi, max(k.ord_to) AS ma
               FROM public._br_v3_archive_blocks k WHERE k.archive_id = a.id GROUP BY k.table_name) s
      ON s.table_name = p.table_name
    WHERE p.table_name IS NULL OR coalesce(s.n, 0) <> p.rows_captured
       OR (p.rows_captured > 0 AND (s.mi <> 1 OR s.ma <> p.rows_captured))
  ) m;
  IF v_bad <> '[]'::jsonb THEN
    RAISE EXCEPTION 'BRV-028: exported row counts differ from capture: %', left(v_bad::text, 500) USING ERRCODE = '55000';
  END IF;

  SELECT count(*), coalesce(sum(k.row_count), 0), coalesce(sum(k.plain_bytes), 0), coalesce(sum(k.stored_bytes), 0)
    INTO v_n, v_rows, v_plain, v_stored
  FROM public._br_v3_archive_blocks k WHERE k.archive_id = a.id;
  IF v_n <> a.next_block_no - 1 THEN
    RAISE EXCEPTION 'BRV-028: block sequence broken' USING ERRCODE = '55000';
  END IF;

  v_next := CASE WHEN v_n = 0 THEN 'publishing' ELSE 'verifying' END;
  UPDATE public._br_v3_archives
     SET status = v_next, block_count = v_n, total_rows = v_rows, plain_bytes = v_plain, stored_bytes = v_stored
   WHERE id = a.id;
  UPDATE public._br_backup_jobs SET status = v_next, heartbeat_at = now() WHERE id = a.job_id;
  PERFORM public._br_job_log(a.job_id, a.tenant_id, 'blocks_exported', 'exporting', v_next, NULL, a.export_worker_id,
    jsonb_build_object('archive_id', a.id, 'blocks', v_n, 'rows', v_rows, 'plain_bytes', v_plain, 'stored_bytes', v_stored));
  RETURN jsonb_build_object('archive_id', a.id, 'status', v_next, 'block_count', v_n, 'total_rows', v_rows);
END $$;

-- 8. Vérification bloc par bloc (relecture réelle du stockage côté worker, comparaison côté serveur)
CREATE OR REPLACE FUNCTION public._br_v3_verify_target(p_archive_id uuid, p_token uuid, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public._br_v3_archives%ROWTYPE;
BEGIN
  a := public._br_v3_lock(p_archive_id, p_token, ARRAY['verifying']);
  RETURN jsonb_build_object('archive_id', a.id, 'tenant_id', a.tenant_id, 'generation_id', a.generation_id,
    'key_id', a.key_id, 'blocks_verified', a.blocks_verified, 'block_count', a.block_count,
    'blocks', coalesce((SELECT jsonb_agg(jsonb_build_object('block_no', k.block_no, 'table', k.table_name,
        'ord_from', k.ord_from, 'ord_to', k.ord_to, 'rows', k.row_count, 'plain_bytes', k.plain_bytes,
        'plain_sha256', k.plain_sha256, 'stored_bytes', k.stored_bytes, 'stored_sha256', k.stored_sha256,
        'object_path', k.object_path, 'key_id', k.key_id, 'nonce_hex', k.nonce_hex) ORDER BY k.block_no)
      FROM public._br_v3_archive_blocks k
      WHERE k.archive_id = a.id AND k.block_no > a.blocks_verified
        AND k.block_no <= a.blocks_verified + least(greatest(coalesce(p_limit, 1), 1), 64)), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_mark_block_verified(p_archive_id uuid, p_token uuid, p_check jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  k public._br_v3_archive_blocks%ROWTYPE;
  h jsonb := p_check->'header';
  v_no integer := (p_check->>'block_no')::integer;
  v_next text;
BEGIN
  a := public._br_v3_lock(p_archive_id, p_token, ARRAY['verifying']);
  SELECT * INTO k FROM public._br_v3_archive_blocks WHERE archive_id = a.id AND block_no = v_no;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRV-031: unexpected block % for archive %', v_no, a.id USING ERRCODE = '55000';
  END IF;
  IF k.verified_at IS NOT NULL THEN
    RETURN jsonb_build_object('verified', true, 'idempotent', true, 'blocks_verified', a.blocks_verified);
  END IF;
  IF v_no <> a.blocks_verified + 1 THEN
    RAISE EXCEPTION 'BRV-031: blocks must be verified in order (expected %)', a.blocks_verified + 1 USING ERRCODE = '55000';
  END IF;
  IF (p_check->>'stored_sha256') IS DISTINCT FROM k.stored_sha256
     OR (p_check->>'stored_bytes')::bigint IS DISTINCT FROM k.stored_bytes::bigint
     OR (p_check->>'plain_sha256') IS DISTINCT FROM k.plain_sha256
     OR (p_check->>'plain_bytes')::bigint IS DISTINCT FROM k.plain_bytes::bigint
     OR (p_check->>'rows')::bigint IS DISTINCT FROM k.row_count::bigint
     OR (p_check->>'key_id') IS DISTINCT FROM k.key_id
     OR (p_check->>'nonce_hex') IS DISTINCT FROM k.nonce_hex
     OR h IS NULL
     OR (h->>'tenant_id') IS DISTINCT FROM a.tenant_id::text
     OR (h->>'archive_id') IS DISTINCT FROM a.id::text
     OR (h->>'generation_id') IS DISTINCT FROM a.generation_id::text
     OR (h->>'block_no') IS DISTINCT FROM k.block_no::text
     OR (h->>'table') IS DISTINCT FROM k.table_name
     OR (h->>'ord_from') IS DISTINCT FROM k.ord_from::text
     OR (h->>'ord_to') IS DISTINCT FROM k.ord_to::text
     OR (h->>'rows') IS DISTINCT FROM k.row_count::text
     OR (h->>'format_version') IS DISTINCT FROM '3' THEN
    RAISE EXCEPTION 'BRV-032: block % does not match its committed record', v_no USING ERRCODE = '55000';
  END IF;

  UPDATE public._br_v3_archive_blocks SET verified_at = clock_timestamp() WHERE archive_id = a.id AND block_no = v_no;
  v_next := CASE WHEN v_no = a.block_count THEN 'publishing' ELSE 'verifying' END;
  UPDATE public._br_v3_archives SET blocks_verified = v_no, status = v_next, export_claims = 0 WHERE id = a.id;
  IF v_next = 'publishing' THEN
    UPDATE public._br_backup_jobs SET status = 'publishing', heartbeat_at = now() WHERE id = a.job_id;
  END IF;
  RETURN jsonb_build_object('verified', true, 'idempotent', false, 'blocks_verified', v_no, 'status', v_next);
END $$;

-- 9. Manifeste (texte déterministe calculé en base = référence serveur) et publication
CREATE OR REPLACE FUNCTION public._br_v3_manifest_text(p_archive_id uuid)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  g public._br_capture_generations%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public._br_v3_archives WHERE id = p_archive_id;
  IF NOT FOUND OR a.status NOT IN ('publishing','verified') THEN
    RAISE EXCEPTION 'BRV-011: manifest not available for archive %', p_archive_id USING ERRCODE = '55000';
  END IF;
  SELECT * INTO g FROM public._br_capture_generations WHERE id = a.generation_id;
  RETURN jsonb_build_object(
    'format', 'waarwi-br-archive-manifest', 'format_version', 3,
    'archive_id', a.id, 'tenant_id', a.tenant_id, 'job_id', a.job_id, 'scope', 'tenant',
    'generation_id', a.generation_id, 'generation_no', g.generation_no,
    'captured_at', to_char(g.captured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'capture_isolation', g.capture_isolation, 'schema_fingerprint', g.schema_fingerprint,
    'registry_fingerprint', a.registry_fingerprint, 'capture_global_checksum', g.global_checksum,
    'row_encoding', 'ndjson-pg-jsonb-text',
    'compression', 'gzip',
    'encryption', jsonb_build_object('algorithm', 'AES-256-GCM', 'key_id', a.key_id, 'nonce_bytes', 12,
      'tag_bytes', 16, 'container', 'WBR3', 'container_version', 1),
    'limits', jsonb_build_object('block_target_bytes', a.block_target_bytes, 'row_max_bytes', a.row_max_bytes,
      'max_rows_per_block', a.max_rows_per_block),
    'tables', coalesce((SELECT jsonb_agg(jsonb_build_object('table', p.table_name, 'order_key', p.order_key,
        'rows', p.rows_captured, 'capture_checksum', p.checksum,
        'blocks', (SELECT count(*) FROM public._br_v3_archive_blocks k WHERE k.archive_id = a.id AND k.table_name = p.table_name),
        'first_block', (SELECT min(k.block_no) FROM public._br_v3_archive_blocks k WHERE k.archive_id = a.id AND k.table_name = p.table_name),
        'last_block', (SELECT max(k.block_no) FROM public._br_v3_archive_blocks k WHERE k.archive_id = a.id AND k.table_name = p.table_name))
        ORDER BY p.table_name COLLATE "C")
      FROM public._br_capture_progress p WHERE p.generation_id = a.generation_id), '[]'::jsonb),
    'blocks', coalesce((SELECT jsonb_agg(jsonb_build_object('block_no', k.block_no, 'table', k.table_name,
        'ord_from', k.ord_from, 'ord_to', k.ord_to, 'rows', k.row_count, 'plain_bytes', k.plain_bytes,
        'plain_sha256', k.plain_sha256, 'stored_bytes', k.stored_bytes, 'stored_sha256', k.stored_sha256,
        'object', k.object_path, 'nonce_hex', k.nonce_hex) ORDER BY k.block_no)
      FROM public._br_v3_archive_blocks k WHERE k.archive_id = a.id), '[]'::jsonb),
    'totals', jsonb_build_object('tables', g.table_count, 'rows', a.total_rows, 'blocks', a.block_count,
      'plain_bytes', a.plain_bytes, 'stored_bytes', a.stored_bytes),
    'restorable', false, 'integrity_only', true)::text;
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_get_manifest(p_archive_id uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  v_text text;
BEGIN
  a := public._br_v3_lock(p_archive_id, p_token, ARRAY['publishing']);
  v_text := public._br_v3_manifest_text(a.id);
  RETURN jsonb_build_object('archive_id', a.id, 'key_id', a.key_id, 'manifest_text', v_text,
    'plain_sha256', encode(sha256(convert_to(v_text, 'UTF8')), 'hex'));
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_publish(p_archive_id uuid, p_token uuid, p_manifest jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  j public._br_backup_jobs%ROWTYPE;
  v_text text;
  v_path text := p_manifest->>'path';
  v_attempt uuid := (p_manifest->>'attempt_id')::uuid;
  v_kid text := p_manifest->>'key_id';
  v_nonce text := p_manifest->>'nonce_hex';
  v_ssha text := p_manifest->>'stored_sha256';
  v_sbytes bigint := (p_manifest->>'stored_bytes')::bigint;
BEGIN
  SELECT * INTO a FROM public._br_v3_archives WHERE id = p_archive_id;
  IF FOUND AND a.status = 'verified' THEN
    IF a.manifest_path = v_path AND a.manifest_sha256 = v_ssha THEN
      RETURN jsonb_build_object('archive_id', a.id, 'status', 'verified', 'idempotent', true,
        'manifest_path', a.manifest_path, 'restorable', false);
    END IF;
    RAISE EXCEPTION 'BRV-010: archive % already published by another worker', p_archive_id USING ERRCODE = '55000';
  END IF;

  a := public._br_v3_lock(p_archive_id, p_token, ARRAY['publishing']);
  IF a.blocks_verified <> a.block_count
     OR EXISTS (SELECT 1 FROM public._br_v3_archive_blocks k WHERE k.archive_id = a.id AND k.verified_at IS NULL) THEN
    RAISE EXCEPTION 'BRV-033: not every block is verified' USING ERRCODE = '55000';
  END IF;
  IF v_attempt IS NULL OR v_path IS DISTINCT FROM a.storage_prefix || format('manifest-%s.wbr3m', v_attempt)
     OR v_nonce IS NULL OR v_nonce !~ '^[0-9a-f]{24}$' OR v_ssha IS NULL OR v_ssha !~ '^[0-9a-f]{64}$'
     OR v_sbytes IS NULL OR v_sbytes <= 0 OR v_kid IS NULL OR char_length(v_kid) NOT BETWEEN 1 AND 64 THEN
    RAISE EXCEPTION 'BRV-001: invalid manifest descriptor' USING ERRCODE = '22023';
  END IF;
  IF a.key_id IS NOT NULL AND v_kid <> a.key_id THEN
    RAISE EXCEPTION 'BRV-025: manifest key differs from archive key' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public._br_v3_archive_blocks k WHERE k.key_id = v_kid AND k.nonce_hex = v_nonce)
     OR EXISTS (SELECT 1 FROM public._br_v3_archives x WHERE x.manifest_nonce_hex = v_nonce AND x.key_id = v_kid) THEN
    RAISE EXCEPTION 'BRV-026: nonce already used' USING ERRCODE = '55000';
  END IF;
  v_text := public._br_v3_manifest_text(a.id);
  IF encode(sha256(convert_to(v_text, 'UTF8')), 'hex') IS DISTINCT FROM p_manifest->>'plain_sha256' THEN
    RAISE EXCEPTION 'BRV-040: manifest does not match the server reference' USING ERRCODE = '55000';
  END IF;

  UPDATE public._br_v3_archives
     SET status = 'verified', key_id = coalesce(a.key_id, v_kid), manifest_path = v_path,
         manifest_plain_sha256 = p_manifest->>'plain_sha256', manifest_sha256 = v_ssha, manifest_bytes = v_sbytes,
         manifest_nonce_hex = v_nonce, verified_at = clock_timestamp(), finished_at = clock_timestamp(),
         export_lease_token = NULL, export_lease_expires_at = NULL, error_code = NULL, error_message = NULL
   WHERE id = a.id;
  SELECT * INTO j FROM public._br_backup_jobs WHERE id = a.job_id;
  UPDATE public._br_backup_jobs
     SET status = 'succeeded', finished_at = now(), heartbeat_at = now(),
         error_code = NULL, error_message = NULL, error_class = NULL
   WHERE id = a.job_id;
  PERFORM public._br_job_log(a.job_id, a.tenant_id, 'archive_verified', j.status, 'succeeded', j.attempts,
    a.export_worker_id, jsonb_build_object('archive_id', a.id, 'blocks', a.block_count, 'manifest_sha256', v_ssha));
  -- Le staging n'est libéré qu'une fois l'archive publiée, dans la même transaction.
  PERFORM public._br_capture_supersede(a.generation_id, 'archived_v3');
  RETURN jsonb_build_object('archive_id', a.id, 'status', 'verified', 'idempotent', false,
    'manifest_path', v_path, 'restorable', false, 'meaning', 'archive_integrity_only');
END $$;

-- 10. Téléchargement : contrôle propriétaire/super_admin + isolation tenant, puis liste paginée des objets chiffrés
CREATE OR REPLACE FUNCTION public.br_v3_download_authorize(p_archive_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public._br_v3_archives%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public._br_v3_archives WHERE id = p_archive_id;
  IF NOT FOUND OR NOT coalesce(public._br_can_manage_backups(a.tenant_id), false) THEN
    RAISE EXCEPTION 'BR-404: Sauvegarde introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF a.status <> 'verified' THEN
    RAISE EXCEPTION 'BR-409: Archive non disponible' USING ERRCODE = '55000';
  END IF;
  RETURN jsonb_build_object('archive_id', a.id, 'tenant_id', a.tenant_id, 'scope', 'tenant',
    'block_count', a.block_count, 'format_version', 3, 'restorable', false);
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_download_entries(p_archive_id uuid, p_offset integer, p_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public._br_v3_archives%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public._br_v3_archives WHERE id = p_archive_id AND status = 'verified';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BR-404: Sauvegarde introuvable' USING ERRCODE = 'P0002';
  END IF;
  RETURN jsonb_build_object('archive_id', a.id, 'tenant_id', a.tenant_id, 'bucket', a.storage_bucket,
    'total', a.block_count + 1,
    'entries', coalesce((SELECT jsonb_agg(e.x ORDER BY e.n) FROM (
        SELECT 0 AS n, jsonb_build_object('kind', 'manifest', 'name', 'manifest.wbr3m', 'object_path', a.manifest_path,
               'stored_bytes', a.manifest_bytes, 'stored_sha256', a.manifest_sha256) AS x
        UNION ALL
        SELECT k.block_no, jsonb_build_object('kind', 'block', 'name', format('blocks/%s.wbr3', lpad(k.block_no::text, 6, '0')),
               'object_path', k.object_path, 'stored_bytes', k.stored_bytes, 'stored_sha256', k.stored_sha256)
        FROM public._br_v3_archive_blocks k WHERE k.archive_id = a.id
      ) e WHERE e.n >= greatest(coalesce(p_offset, 0), 0)
          AND e.n < greatest(coalesce(p_offset, 0), 0) + least(greatest(coalesce(p_limit, 100), 1), 500)), '[]'::jsonb));
END $$;

-- 11. Nettoyage différé : plan uniquement (aucune suppression, non planifié)
CREATE OR REPLACE FUNCTION public._br_v3_cleanup_plan(p_archive_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a public._br_v3_archives%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public._br_v3_archives WHERE id = p_archive_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('archive_id', p_archive_id, 'action', 'none', 'reason', 'unknown_archive');
  END IF;
  RETURN jsonb_build_object('archive_id', a.id, 'status', a.status, 'prefix', a.storage_prefix,
    'bucket', a.storage_bucket, 'finished_at', a.finished_at,
    'delete_enabled', (SELECT c.cleanup_delete_enabled FROM public._br_v3_export_config c WHERE c.id = 1),
    'action', CASE WHEN a.status IN ('exporting','verifying','publishing') THEN 'none'
                   WHEN a.status = 'verified' THEN 'orphans_only' ELSE 'all' END,
    'retained', CASE WHEN a.status IN ('failed','abandoned') THEN '[]'::jsonb
      ELSE coalesce((SELECT jsonb_agg(k.object_path ORDER BY k.block_no) FROM public._br_v3_archive_blocks k
                     WHERE k.archive_id = a.id), '[]'::jsonb)
           || CASE WHEN a.manifest_path IS NOT NULL THEN jsonb_build_array(a.manifest_path) ELSE '[]'::jsonb END END);
END $$;

-- 12. Copie hors site LWS v3 (désactivée)
CREATE OR REPLACE FUNCTION public._br_v3_offsite_request(p_archive_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  a public._br_v3_archives%ROWTYPE;
  t public._br_v3_offsite_transfers%ROWTYPE;
  v_created boolean := false;
BEGIN
  SELECT * INTO a FROM public._br_v3_archives WHERE id = p_archive_id;
  IF NOT FOUND OR a.status <> 'verified' THEN
    RAISE EXCEPTION 'BRV-050: only a verified archive can be copied offsite' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public._br_v3_offsite_transfers (archive_id, tenant_id, remote_prefix)
  VALUES (a.id, a.tenant_id, format('v3/%s/%s/', a.tenant_id, a.id))
  ON CONFLICT ON CONSTRAINT _br_v3_offsite_archive_key DO NOTHING;
  v_created := FOUND;
  SELECT * INTO t FROM public._br_v3_offsite_transfers WHERE archive_id = a.id;
  RETURN jsonb_build_object('transfer_id', t.id, 'created', v_created, 'status', t.status);
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_offsite_lock(p_transfer_id uuid, p_token uuid)
RETURNS public._br_v3_offsite_transfers LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE t public._br_v3_offsite_transfers%ROWTYPE;
BEGIN
  SELECT * INTO t FROM public._br_v3_offsite_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR p_token IS NULL OR t.lease_token IS DISTINCT FROM p_token
     OR t.lease_expires_at <= clock_timestamp() OR t.status <> 'in_progress' THEN
    RAISE EXCEPTION 'BRV-010: offsite lease not held for transfer %', p_transfer_id USING ERRCODE = '55000';
  END IF;
  RETURN t;
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_offsite_claim(p_worker_id text, p_lease_seconds integer DEFAULT 300)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  cfg public._br_v3_export_config%ROWTYPE;
  t public._br_v3_offsite_transfers%ROWTYPE;
  a public._br_v3_archives%ROWTYPE;
BEGIN
  IF p_worker_id IS NULL OR char_length(p_worker_id) NOT BETWEEN 1 AND 128
     OR p_lease_seconds IS NULL OR p_lease_seconds NOT BETWEEN 30 AND 1800 THEN
    RAISE EXCEPTION 'BRV-001: invalid offsite claim arguments' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO cfg FROM public._br_v3_export_config WHERE id = 1;
  IF NOT FOUND OR NOT cfg.offsite_enabled THEN
    RAISE EXCEPTION 'BRV-045: v3 offsite copy is disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO t FROM public._br_v3_offsite_transfers x
  WHERE x.status IN ('pending','in_progress')
    AND (x.lease_expires_at IS NULL OR x.lease_expires_at <= clock_timestamp())
  ORDER BY x.requested_at, x.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF t.attempts >= t.max_attempts THEN
    UPDATE public._br_v3_offsite_transfers
       SET status = 'failed', lease_token = NULL, lease_expires_at = NULL, error_code = 'BRV-047',
           error_message = 'Too many offsite attempts', updated_at = clock_timestamp()
     WHERE id = t.id;
    RETURN jsonb_build_object('transfer_id', t.id, 'status', 'failed');
  END IF;
  UPDATE public._br_v3_offsite_transfers
     SET status = 'in_progress', fence = fence + 1, lease_token = gen_random_uuid(),
         lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds), worker_id = p_worker_id,
         attempts = attempts + 1, updated_at = clock_timestamp()
   WHERE id = t.id RETURNING * INTO t;
  SELECT * INTO a FROM public._br_v3_archives WHERE id = t.archive_id;
  RETURN jsonb_build_object('transfer_id', t.id, 'archive_id', t.archive_id, 'tenant_id', t.tenant_id,
    'status', t.status, 'lease_token', t.lease_token, 'fence', t.fence, 'remote_prefix', t.remote_prefix,
    'blocks_confirmed', t.blocks_confirmed, 'block_count', a.block_count, 'bucket', a.storage_bucket);
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_offsite_next(p_transfer_id uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_offsite_transfers%ROWTYPE;
  a public._br_v3_archives%ROWTYPE;
  k public._br_v3_archive_blocks%ROWTYPE;
BEGIN
  t := public._br_v3_offsite_lock(p_transfer_id, p_token);
  SELECT * INTO a FROM public._br_v3_archives WHERE id = t.archive_id;
  IF t.blocks_confirmed < a.block_count THEN
    SELECT * INTO k FROM public._br_v3_archive_blocks WHERE archive_id = a.id AND block_no = t.blocks_confirmed + 1;
    RETURN jsonb_build_object('kind', 'block', 'block_no', k.block_no, 'object_path', k.object_path,
      'stored_bytes', k.stored_bytes, 'stored_sha256', k.stored_sha256,
      'remote_path', t.remote_prefix || format('blocks/%s.wbr3', lpad(k.block_no::text, 6, '0')));
  END IF;
  IF NOT t.manifest_confirmed THEN
    RETURN jsonb_build_object('kind', 'manifest', 'object_path', a.manifest_path, 'stored_bytes', a.manifest_bytes,
      'stored_sha256', a.manifest_sha256, 'remote_path', t.remote_prefix || 'manifest.wbr3m');
  END IF;
  RETURN jsonb_build_object('kind', 'done');
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_offsite_commit(p_transfer_id uuid, p_token uuid, p_item jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_offsite_transfers%ROWTYPE;
  a public._br_v3_archives%ROWTYPE;
  k public._br_v3_archive_blocks%ROWTYPE;
BEGIN
  t := public._br_v3_offsite_lock(p_transfer_id, p_token);
  SELECT * INTO a FROM public._br_v3_archives WHERE id = t.archive_id;
  IF p_item->>'kind' = 'block' THEN
    IF (p_item->>'block_no')::integer IS DISTINCT FROM t.blocks_confirmed + 1 THEN
      RAISE EXCEPTION 'BRV-051: unexpected offsite block (expected %)', t.blocks_confirmed + 1 USING ERRCODE = '55000';
    END IF;
    SELECT * INTO k FROM public._br_v3_archive_blocks WHERE archive_id = a.id AND block_no = t.blocks_confirmed + 1;
    IF NOT FOUND OR (p_item->>'remote_sha256') IS DISTINCT FROM k.stored_sha256
       OR (p_item->>'remote_bytes')::bigint IS DISTINCT FROM k.stored_bytes::bigint THEN
      RAISE EXCEPTION 'BRV-052: remote block copy differs from the primary archive' USING ERRCODE = '55000';
    END IF;
    UPDATE public._br_v3_offsite_transfers SET blocks_confirmed = blocks_confirmed + 1, attempts = 0,
           updated_at = clock_timestamp()
     WHERE id = t.id;
    RETURN jsonb_build_object('blocks_confirmed', t.blocks_confirmed + 1, 'status', 'in_progress');
  ELSIF p_item->>'kind' = 'manifest' THEN
    IF t.blocks_confirmed <> a.block_count THEN
      RAISE EXCEPTION 'BRV-051: manifest must be transferred after every block' USING ERRCODE = '55000';
    END IF;
    IF (p_item->>'remote_sha256') IS DISTINCT FROM a.manifest_sha256
       OR (p_item->>'remote_bytes')::bigint IS DISTINCT FROM a.manifest_bytes THEN
      RAISE EXCEPTION 'BRV-052: remote manifest copy differs from the primary archive' USING ERRCODE = '55000';
    END IF;
    UPDATE public._br_v3_offsite_transfers
       SET manifest_confirmed = true, status = 'confirmed', confirmed_at = clock_timestamp(),
           lease_token = NULL, lease_expires_at = NULL, error_code = NULL, error_message = NULL,
           updated_at = clock_timestamp()
     WHERE id = t.id;
    RETURN jsonb_build_object('status', 'confirmed');
  END IF;
  RAISE EXCEPTION 'BRV-001: invalid offsite item' USING ERRCODE = '22023';
END $$;

CREATE OR REPLACE FUNCTION public._br_v3_offsite_fail(
  p_transfer_id uuid, p_token uuid, p_code text, p_message text, p_permanent boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  t public._br_v3_offsite_transfers%ROWTYPE;
  v_status text := CASE WHEN coalesce(p_permanent, false) THEN 'failed' ELSE 'in_progress' END;
BEGIN
  t := public._br_v3_offsite_lock(p_transfer_id, p_token);
  UPDATE public._br_v3_offsite_transfers
     SET status = v_status, lease_token = NULL, lease_expires_at = NULL,
         error_code = left(coalesce(nullif(p_code, ''), 'UNKNOWN'), 64), error_message = left(p_message, 2000),
         updated_at = clock_timestamp()
   WHERE id = t.id;
  RETURN jsonb_build_object('transfer_id', t.id, 'status', v_status, 'blocks_confirmed', t.blocks_confirmed);
END $$;

-- 13. Stockage privé (sans politique : inaccessible à anon/authenticated)
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit)
    VALUES ('tenant-backups-v3', 'tenant-backups-v3', false, 41943040)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- 14. Sécurité
ALTER TABLE public._br_v3_export_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._br_v3_archives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._br_v3_archive_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._br_v3_offsite_transfers ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public._br_v3_export_config, public._br_v3_archives, public._br_v3_archive_blocks,
                    public._br_v3_offsite_transfers
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public._br_v3_export_config, public._br_v3_archives, public._br_v3_archive_blocks,
                      public._br_v3_offsite_transfers TO service_role;

REVOKE ALL ON FUNCTION
  public._br_v3_archives_guard(),
  public._br_v3_blocks_guard(),
  public._br_v3_next_range(public._br_v3_archives),
  public._br_v3_block_text(public._br_v3_archives, integer, text, bigint),
  public._br_v3_binding_ok(public._br_v3_archives),
  public._br_v3_lock(uuid, uuid, text[]),
  public._br_v3_terminate(uuid, text, text, text),
  public._br_v3_export_claim(text),
  public._br_v3_export_renew(uuid, uuid, integer),
  public._br_v3_export_release(uuid, uuid),
  public._br_v3_export_fail(uuid, uuid, text, text, boolean),
  public._br_v3_read_block(uuid, uuid),
  public._br_v3_commit_block(uuid, uuid, jsonb),
  public._br_v3_finish_blocks(uuid, uuid),
  public._br_v3_verify_target(uuid, uuid, integer),
  public._br_v3_mark_block_verified(uuid, uuid, jsonb),
  public._br_v3_manifest_text(uuid),
  public._br_v3_get_manifest(uuid, uuid),
  public._br_v3_publish(uuid, uuid, jsonb),
  public.br_v3_download_authorize(uuid),
  public._br_v3_download_entries(uuid, integer, integer),
  public._br_v3_cleanup_plan(uuid),
  public._br_v3_offsite_request(uuid),
  public._br_v3_offsite_lock(uuid, uuid),
  public._br_v3_offsite_claim(text, integer),
  public._br_v3_offsite_next(uuid, uuid),
  public._br_v3_offsite_commit(uuid, uuid, jsonb),
  public._br_v3_offsite_fail(uuid, uuid, text, text, boolean)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public._br_v3_export_claim(text),
  public._br_v3_export_renew(uuid, uuid, integer),
  public._br_v3_export_release(uuid, uuid),
  public._br_v3_export_fail(uuid, uuid, text, text, boolean),
  public._br_v3_read_block(uuid, uuid),
  public._br_v3_commit_block(uuid, uuid, jsonb),
  public._br_v3_finish_blocks(uuid, uuid),
  public._br_v3_verify_target(uuid, uuid, integer),
  public._br_v3_mark_block_verified(uuid, uuid, jsonb),
  public._br_v3_get_manifest(uuid, uuid),
  public._br_v3_publish(uuid, uuid, jsonb),
  public._br_v3_download_entries(uuid, integer, integer),
  public._br_v3_cleanup_plan(uuid),
  public._br_v3_offsite_request(uuid),
  public._br_v3_offsite_claim(text, integer),
  public._br_v3_offsite_next(uuid, uuid),
  public._br_v3_offsite_commit(uuid, uuid, jsonb),
  public._br_v3_offsite_fail(uuid, uuid, text, text, boolean)
TO service_role;
GRANT EXECUTE ON FUNCTION public.br_v3_download_authorize(uuid) TO authenticated;

INSERT INTO public._br_table_registry
  (schema_name, table_name, tenant_link, tenant_id_column, category, restore_order, reset_behavior, is_mandatory, exclusion_reason)
SELECT 'public', v.t, 'excluded', 'tenant_id', 'backup_system', 0, 'preserve', false, v.r
FROM (VALUES
  ('_br_v3_archives', 'v3 archive references — backup metadata, never restored as tenant data'),
  ('_br_v3_archive_blocks', 'v3 archive blocks — backup metadata, never restored as tenant data'),
  ('_br_v3_offsite_transfers', 'v3 offsite copies — backup metadata, never restored as tenant data')
) AS v(t, r)
WHERE NOT EXISTS (SELECT 1 FROM public._br_table_registry r WHERE r.schema_name = 'public' AND r.table_name = v.t);
