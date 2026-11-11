/*
# WAARWI — Lot D : moteur de restauration et de réinitialisation sûres (INACTIF)

## Résumé
Ajoute le moteur serveur de restauration (archives v3 et v2) et de réinitialisation transactionnelle
d'une entreprise entière (tous ses magasins). Le moteur est livré DÉSACTIVÉ :
`_br_restore_config.enabled = false`, aucune tâche planifiée, aucun déclencheur métier modifié.
Les points d'entrée publics destructifs (br_restore_backup, br_reset_operations, br_import_payload,
tenant_restore_*, tenant_reset_operations, reset_tenant_data) restent bloqués par BR020 et ne sont pas modifiés.

## 1. Nouvelles tables (privées, RLS activée, aucune politique, aucun droit anon/authenticated)
- `_br_restore_config` : ligne unique ; enabled (false), lease_seconds, maintenance_ttl_seconds, swap_lock_timeout_ms.
- `_br_restore_jobs` : une demande de restauration/réinitialisation ; un seul job actif par entreprise (index unique partiel).
- `_br_restore_tables` : plan par table (archivée / historiquement absente), comptes et empreintes attendus.
- `_br_restore_rows` : zone de préparation privée (lignes jsonb, ord), alimentée progressivement.
- `_br_restore_blocks` : blocs v3 déjà chargés (reprise).
- `_br_restore_safety`, `_br_restore_safety_tables` : sauvegarde de sécurité vérifiée prise sous verrou exclusif.
- `_br_tenant_maintenance` : maintenance par entreprise (avec expiration).
- `_br_tenant_epoch` : date du dernier remplacement (refus des transactions plus anciennes).
- `_br_restore_context` : contexte privilégié lié au processus et à la transaction en cours.
- `_br_rs_counter_sources` : correspondance colonnes numérotées → compteurs.

## 2. Fonctions
- `_br_restore_bypass()`, `_br_gate()` / `_br_gate_check()` ; `_br_lotd_install_hooks()` (NON exécutée ici),
  `_br_lotd_hooks_status()`.
- API serveur `_br_rs_*` : request_restore, request_reset, claim, unlease, load_v2, v3_plan, v3_manifest,
  v3_load_block, fail_job, verify, request_execute, enter_maintenance, swap, reset_run, release, abandon, recover.
- Procédure `_br_rs_executor` (transactions successives côté serveur ; aucune tâche cron créée).

## 3. Sécurité
1. RLS activée sur chaque nouvelle table, sans politique ; REVOKE ALL pour PUBLIC/anon/authenticated.
2. EXECUTE retiré à PUBLIC/anon/authenticated sur toutes les fonctions `_br_rs_*` ; accordé à service_role
   uniquement pour l'API serveur. Chaque fonction vérifie aussi `_br_is_verified_server()`.
3. Le contexte privilégié n'est pas un paramètre ni un GUC : c'est une ligne privée liée à
   pg_backend_pid() + txid_current(), insérée et supprimée dans la même transaction par le moteur.

## 4. Notes importantes
1. Aucune donnée métier, sauvegarde, suspension ou permission modifiée.
2. Aucune activation : enabled = false et crochets non installés → swap/reset refusés (BRR-000 / BRR-070).
3. Les nouvelles tables sont inscrites au registre comme `excluded / backup_system` (contrôle de dérive inchangé).
4. Migration idempotente, sans contrôle de transaction.
5. Périmètre : restauration et réinitialisation GLOBALES (tous les magasins de l'entreprise, rapport scope = all_sites).
   La restauration et la réinitialisation par magasin sont reportées à un chantier distinct.
6. Livrée pour revue, NON appliquée en production. Validée sur PostgreSQL 17 local avec données synthétiques
   (tests/backup-v3/lotd_restore.test.mjs, D0-D8). Contrôle plpgsql_check à exécuter au moment de l'application.
*/

CREATE TABLE IF NOT EXISTS public._br_restore_config (
  id                       integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled                  boolean NOT NULL DEFAULT false,
  lease_seconds            integer NOT NULL DEFAULT 300 CHECK (lease_seconds BETWEEN 10 AND 3600),
  maintenance_ttl_seconds  integer NOT NULL DEFAULT 1800 CHECK (maintenance_ttl_seconds BETWEEN 30 AND 86400),
  swap_lock_timeout_ms     integer NOT NULL DEFAULT 60000 CHECK (swap_lock_timeout_ms BETWEEN 100 AND 600000),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public._br_restore_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public._br_restore_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  operation             text NOT NULL CHECK (operation IN ('restore','reset')),
  source_format         integer CHECK (source_format IN (2,3)),
  source_backup_id      uuid,
  source_archive_id     uuid,
  source_captured_at    timestamptz,
  requested_by          uuid NOT NULL,
  status                text NOT NULL DEFAULT 'preparing'
                        CHECK (status IN ('preparing','prepared','succeeded','failed','abandoned')),
  manifest_ok           boolean NOT NULL DEFAULT false,
  schema_fingerprint    text,
  fence                 bigint NOT NULL DEFAULT 0,
  lease_token           uuid,
  lease_owner           text,
  lease_expires_at      timestamptz,
  execute_requested_at  timestamptz,
  execute_requested_by  uuid,
  verify_report         jsonb,
  swap_report           jsonb,
  error_code            text,
  error_message         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  prepared_at           timestamptz,
  finished_at           timestamptz,
  CONSTRAINT _br_restore_jobs_source_chk CHECK (
    (operation = 'reset' AND source_format IS NULL AND source_backup_id IS NULL AND source_archive_id IS NULL)
    OR (operation = 'restore' AND source_format = 2 AND source_backup_id IS NOT NULL AND source_archive_id IS NULL)
    OR (operation = 'restore' AND source_format = 3 AND source_archive_id IS NOT NULL AND source_backup_id IS NULL)),
  CONSTRAINT _br_restore_jobs_lease_chk CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS _br_restore_jobs_one_active
  ON public._br_restore_jobs (tenant_id) WHERE status IN ('preparing','prepared');

CREATE TABLE IF NOT EXISTS public._br_restore_tables (
  job_id             uuid NOT NULL REFERENCES public._br_restore_jobs(id) ON DELETE CASCADE,
  tenant_id          uuid NOT NULL,
  table_name         text NOT NULL,
  restore_order      integer NOT NULL,
  presence           text NOT NULL CHECK (presence IN ('archived','historically_absent')),
  expected_rows      bigint,
  expected_checksum  text,
  loaded             boolean NOT NULL DEFAULT false,
  loaded_rows        bigint NOT NULL DEFAULT 0,
  keys               text[],
  PRIMARY KEY (job_id, table_name)
);

CREATE TABLE IF NOT EXISTS public._br_restore_rows (
  job_id      uuid NOT NULL REFERENCES public._br_restore_jobs(id) ON DELETE CASCADE,
  table_name  text NOT NULL,
  ord         bigint NOT NULL,
  row_data    jsonb NOT NULL,
  PRIMARY KEY (job_id, table_name, ord)
);

CREATE TABLE IF NOT EXISTS public._br_restore_blocks (
  job_id     uuid NOT NULL REFERENCES public._br_restore_jobs(id) ON DELETE CASCADE,
  block_no   integer NOT NULL,
  rows       integer NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (job_id, block_no)
);

CREATE TABLE IF NOT EXISTS public._br_restore_safety (
  job_id      uuid NOT NULL REFERENCES public._br_restore_jobs(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  table_name  text NOT NULL,
  ord         bigint NOT NULL,
  row_data    jsonb NOT NULL,
  PRIMARY KEY (job_id, table_name, ord)
);

CREATE TABLE IF NOT EXISTS public._br_restore_safety_tables (
  job_id      uuid NOT NULL REFERENCES public._br_restore_jobs(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL,
  table_name  text NOT NULL,
  rows        bigint NOT NULL,
  checksum    text,
  verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (job_id, table_name)
);

CREATE TABLE IF NOT EXISTS public._br_tenant_maintenance (
  tenant_id   uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_id      uuid NOT NULL REFERENCES public._br_restore_jobs(id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL,
  expires_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS public._br_tenant_epoch (
  tenant_id   uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  changed_at  timestamptz NOT NULL,
  job_id      uuid
);

CREATE TABLE IF NOT EXISTS public._br_restore_context (
  backend_pid  integer PRIMARY KEY,
  xact_id      bigint NOT NULL,
  tenant_id    uuid NOT NULL,
  job_id       uuid NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public._br_rs_counter_sources (
  doc_kind     text PRIMARY KEY,
  table_name   text NOT NULL,
  column_name  text NOT NULL,
  prefix       text
);
INSERT INTO public._br_rs_counter_sources (doc_kind, table_name, column_name, prefix) VALUES
  ('sale','sales','sale_number','V'),
  ('invoice','sales','sale_number','F'),
  ('return','sale_returns','return_number','RET'),
  ('reglement_client','customer_payments','piece_number','REG'),
  ('online_order','online_orders','order_number','WEB'),
  ('stock_exit','stock_documents','doc_number','BS'),
  ('cm_*','cash_movements','receipt_number',NULL)
ON CONFLICT (doc_kind) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['_br_restore_config','_br_restore_jobs','_br_restore_tables','_br_restore_rows',
    '_br_restore_blocks','_br_restore_safety','_br_restore_safety_tables','_br_tenant_maintenance',
    '_br_tenant_epoch','_br_restore_context','_br_rs_counter_sources'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;
GRANT SELECT ON public._br_restore_config, public._br_restore_jobs, public._br_restore_tables,
  public._br_tenant_maintenance TO service_role;

INSERT INTO public._br_table_registry (schema_name, table_name, tenant_link, tenant_id_column, category,
  restore_order, reset_behavior, exclusion_reason)
SELECT 'public', t, 'excluded', 'tenant_id', 'backup_system', 0, 'preserve', 'Lot D restore engine (private)'
FROM unnest(ARRAY['_br_restore_jobs','_br_restore_tables','_br_restore_safety','_br_restore_safety_tables',
  '_br_tenant_maintenance','_br_tenant_epoch','_br_restore_context']) t
WHERE NOT EXISTS (SELECT 1 FROM public._br_table_registry r WHERE r.schema_name = 'public' AND r.table_name = t);

-- ===== Gardes d'intégrité des tables du moteur =====
CREATE OR REPLACE FUNCTION public._br_restore_jobs_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
      RAISE EXCEPTION 'BRR-081: restore jobs are never deleted' USING ERRCODE = '55000';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status IN ('succeeded','failed','abandoned') THEN
    RAISE EXCEPTION 'BRR-081: terminal job is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.operation <> OLD.operation
     OR NEW.source_format IS DISTINCT FROM OLD.source_format
     OR NEW.source_backup_id IS DISTINCT FROM OLD.source_backup_id
     OR NEW.source_archive_id IS DISTINCT FROM OLD.source_archive_id
     OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'BRR-081: job identity is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS _br_restore_jobs_guard ON public._br_restore_jobs;
CREATE TRIGGER _br_restore_jobs_guard BEFORE UPDATE OR DELETE ON public._br_restore_jobs
  FOR EACH ROW EXECUTE FUNCTION public._br_restore_jobs_guard();

CREATE OR REPLACE FUNCTION public._br_restore_safety_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'BRR-082: safety backup is immutable' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN
    RAISE EXCEPTION 'BRR-082: safety backup is never deleted' USING ERRCODE = '55000';
  END IF;
  RETURN OLD;
END $$;
DROP TRIGGER IF EXISTS _br_restore_safety_guard ON public._br_restore_safety;
CREATE TRIGGER _br_restore_safety_guard BEFORE UPDATE OR DELETE ON public._br_restore_safety
  FOR EACH ROW EXECUTE FUNCTION public._br_restore_safety_guard();
DROP TRIGGER IF EXISTS _br_restore_safety_guard ON public._br_restore_safety_tables;
CREATE TRIGGER _br_restore_safety_guard BEFORE UPDATE OR DELETE ON public._br_restore_safety_tables
  FOR EACH ROW EXECUTE FUNCTION public._br_restore_safety_guard();

-- ===== Contexte serveur =====
CREATE OR REPLACE FUNCTION public._br_rs_assert_server() RETURNS void
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT public._br_is_verified_server() THEN
    RAISE EXCEPTION 'BRR-403: server context required' USING ERRCODE = '42501';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_actor_ok(p_actor uuid, p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p_actor IS NOT NULL AND p_tenant IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.profiles p JOIN public.tenants t ON t.id = p.tenant_id
    WHERE p.id = p_actor AND p.tenant_id = p_tenant AND coalesce(p.is_active, true)
      AND (p.role = 'super_admin' OR t.owner_user_id = p_actor));
$$;

-- Le contexte privilégié est une ligne privée liée au processus ET à la transaction courante.
CREATE OR REPLACE FUNCTION public._br_restore_bypass() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public._br_restore_context c
                 WHERE c.backend_pid = pg_backend_pid() AND c.xact_id = txid_current_if_assigned());
$$;

-- ===== Lien entreprise d'une table du registre =====
CREATE OR REPLACE FUNCTION public._br_rs_parent_link(p_table text,
  OUT o_link text, OUT o_tcol text, OUT o_parent text, OUT o_fk text, OUT o_pk text, OUT o_ptcol text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_rel regclass; v_n integer;
BEGIN
  SELECT r.tenant_link, r.tenant_id_column, r.parent_table INTO o_link, o_tcol, o_parent
  FROM public._br_table_registry r
  WHERE r.schema_name = 'public' AND r.table_name = p_table AND r.tenant_link IN ('direct','indirect');
  IF o_link IS NULL THEN
    RAISE EXCEPTION 'BRR-071: % is not a registered tenant table', p_table USING ERRCODE = '55000';
  END IF;
  v_rel := to_regclass(format('public.%I', p_table));
  IF v_rel IS NULL THEN
    RAISE EXCEPTION 'BRR-071: registered table % is missing', p_table USING ERRCODE = '55000';
  END IF;
  IF o_link = 'direct' THEN
    IF o_tcol IS NULL THEN
      RAISE EXCEPTION 'BRR-071: tenant column missing for %', p_table USING ERRCODE = '55000';
    END IF;
    RETURN;
  END IF;
  SELECT count(*) INTO v_n FROM pg_constraint c
  WHERE c.conrelid = v_rel AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
    AND c.confrelid = to_regclass(format('public.%I', o_parent));
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'BRR-071: cannot resolve parent link for %', p_table USING ERRCODE = '55000';
  END IF;
  SELECT a.attname::text, pa.attname::text INTO o_fk, o_pk
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
  WHERE c.conrelid = v_rel AND c.contype = 'f' AND array_length(c.conkey, 1) = 1
    AND c.confrelid = to_regclass(format('public.%I', o_parent));
  SELECT r2.tenant_id_column INTO o_ptcol FROM public._br_table_registry r2
  WHERE r2.schema_name = 'public' AND r2.table_name = o_parent AND r2.tenant_link = 'direct';
  IF o_ptcol IS NULL THEN
    RAISE EXCEPTION 'BRR-071: parent % is not a direct tenant table', o_parent USING ERRCODE = '55000';
  END IF;
END $$;

-- Prédicat « ligne de l'entreprise $1 » pour une table du registre.
CREATE OR REPLACE FUNCTION public._br_rs_tenant_pred(p_table text, p_alias text) RETURNS text
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE l record;
BEGIN
  SELECT * INTO l FROM public._br_rs_parent_link(p_table);
  IF l.o_link = 'direct' THEN
    RETURN format('%I.%I = $1', p_alias, l.o_tcol);
  END IF;
  RETURN format('%I.%I IN (SELECT pp.%I FROM public.%I pp WHERE pp.%I = $1)',
    p_alias, l.o_fk, l.o_pk, l.o_parent, l.o_ptcol);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_pk_cols(p_rel regclass) RETURNS text[]
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT array_agg(a.attname::text ORDER BY k.n)
  FROM pg_index i
  CROSS JOIN LATERAL unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
  JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
  WHERE i.indrelid = p_rel AND i.indisprimary;
$$;

-- Empreinte de structure (formule du lot B) sur les tables du registre.
CREATE OR REPLACE FUNCTION public._br_rs_schema_fp() RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT md5(string_agg(c.relname::text || '.' || a.attname::text || ':' || format_type(a.atttypid, a.atttypmod), ','
             ORDER BY c.relname::text, a.attnum))
  FROM public._br_table_registry r
  JOIN pg_class c ON c.relname = r.table_name
  JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect') AND c.relkind = 'r';
$$;

-- ===== Porte d'écriture par entreprise =====
CREATE OR REPLACE FUNCTION public._br_gate_check(p_tenant uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_exp timestamptz; v_changed timestamptz;
BEGIN
  IF p_tenant IS NULL THEN RETURN; END IF;
  -- Verrou partagé : l'échange/la réinitialisation prend le verrou exclusif et attend les écritures en cours.
  PERFORM pg_advisory_xact_lock_shared(1112689732, hashtext(p_tenant::text));
  SELECT m.expires_at INTO v_exp FROM public._br_tenant_maintenance m WHERE m.tenant_id = p_tenant;
  IF v_exp IS NOT NULL AND v_exp > clock_timestamp() THEN
    RAISE EXCEPTION 'BR-503: maintenance en cours pour cette entreprise, réessayez plus tard'
      USING ERRCODE = '55006', HINT = 'BR-503';
  END IF;
  SELECT e.changed_at INTO v_changed FROM public._br_tenant_epoch e WHERE e.tenant_id = p_tenant;
  IF v_changed IS NOT NULL AND v_changed > transaction_timestamp() THEN
    RAISE EXCEPTION 'BR-504: les données ont été remplacées pendant cette transaction, recommencez'
      USING ERRCODE = '40001', HINT = 'BR-504';
  END IF;
END $$;

-- Arguments : (colonne_entreprise) pour une table directe ; (parent, fk, pk_parent, colonne_entreprise_parent) sinon.
CREATE OR REPLACE FUNCTION public._br_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_new uuid; v_old uuid;
BEGIN
  IF public._br_restore_bypass() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_NARGS = 1 THEN
    IF TG_OP <> 'INSERT' THEN v_old := (to_jsonb(OLD) ->> TG_ARGV[0])::uuid; END IF;
    IF TG_OP <> 'DELETE' THEN v_new := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid; END IF;
  ELSIF TG_NARGS = 4 THEN
    IF TG_OP <> 'INSERT' THEN
      EXECUTE format('SELECT p.%I FROM public.%I p WHERE p.%I::text = $1', TG_ARGV[3], TG_ARGV[0], TG_ARGV[2])
        INTO v_old USING to_jsonb(OLD) ->> TG_ARGV[1];
    END IF;
    IF TG_OP <> 'DELETE' THEN
      EXECUTE format('SELECT p.%I FROM public.%I p WHERE p.%I::text = $1', TG_ARGV[3], TG_ARGV[0], TG_ARGV[2])
        INTO v_new USING to_jsonb(NEW) ->> TG_ARGV[1];
    END IF;
  ELSE
    RAISE EXCEPTION 'BRR-072: invalid gate arguments on %', TG_TABLE_NAME USING ERRCODE = '55000';
  END IF;
  PERFORM public._br_gate_check(v_old);
  IF v_new IS DISTINCT FROM v_old THEN PERFORM public._br_gate_check(v_new); END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- ===== Installation des crochets (NON exécutée par cette migration) =====
CREATE OR REPLACE FUNCTION public._br_lotd_install_hooks() RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  r record; t record; l record;
  v_args text; v_new text; v_gates integer := 0; v_wrapped integer := 0;
BEGIN
  PERFORM public._br_rs_assert_server();
  FOR r IN SELECT reg.table_name FROM public._br_table_registry reg
           WHERE reg.schema_name = 'public' AND reg.tenant_link IN ('direct','indirect') ORDER BY reg.table_name
  LOOP
    SELECT * INTO l FROM public._br_rs_parent_link(r.table_name);
    IF l.o_link = 'direct' THEN
      v_args := quote_literal(l.o_tcol);
    ELSE
      v_args := format('%L, %L, %L, %L', l.o_parent, l.o_fk, l.o_pk, l.o_ptcol);
    END IF;
    EXECUTE format('DROP TRIGGER IF EXISTS _br_gate ON public.%I', r.table_name);
    EXECUTE format('CREATE TRIGGER _br_gate BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public._br_gate(%s)', r.table_name, v_args);
    v_gates := v_gates + 1;
  END LOOP;

  FOR t IN
    SELECT tg.tgname::text AS tgname, c.relname::text AS relname, tg.tgqual IS NOT NULL AS has_when,
           tg.tgenabled::text AS enabled, pg_get_triggerdef(tg.oid) AS def
    FROM pg_trigger tg
    JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT tg.tgisinternal AND tg.tgname <> '_br_gate'
      AND (c.relname IN (SELECT reg.table_name FROM public._br_table_registry reg
                         WHERE reg.schema_name = 'public' AND reg.tenant_link IN ('direct','indirect'))
           OR c.relname = 'profiles')
  LOOP
    IF position('_br_restore_bypass' in t.def) > 0 THEN CONTINUE; END IF;
    IF t.has_when THEN
      v_new := regexp_replace(t.def, ' WHEN \(', ' WHEN (NOT public._br_restore_bypass() AND ');
    ELSE
      v_new := regexp_replace(t.def, ' FOR EACH (ROW|STATEMENT) EXECUTE ',
                              ' FOR EACH \1 WHEN (NOT public._br_restore_bypass()) EXECUTE ');
    END IF;
    IF v_new = t.def THEN
      RAISE EXCEPTION 'BRR-072: cannot wrap trigger % on %', t.tgname, t.relname USING ERRCODE = '55000';
    END IF;
    EXECUTE format('DROP TRIGGER %I ON public.%I', t.tgname, t.relname);
    EXECUTE v_new;
    IF t.enabled = 'D' THEN
      EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER %I', t.relname, t.tgname);
    ELSIF t.enabled = 'R' THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE REPLICA TRIGGER %I', t.relname, t.tgname);
    ELSIF t.enabled = 'A' THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER %I', t.relname, t.tgname);
    END IF;
    v_wrapped := v_wrapped + 1;
  END LOOP;
  RETURN jsonb_build_object('gates', v_gates, 'wrapped', v_wrapped);
END $$;

CREATE OR REPLACE FUNCTION public._br_lotd_hooks_status() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH reg AS (
    SELECT r.table_name FROM public._br_table_registry r
    WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect')
  ), missing AS (
    SELECT reg.table_name FROM reg WHERE NOT EXISTS (
      SELECT 1 FROM pg_trigger tg
      WHERE tg.tgrelid = to_regclass(format('public.%I', reg.table_name))
        AND tg.tgname = '_br_gate' AND tg.tgenabled <> 'D')
  ), unwrapped AS (
    SELECT c.relname::text || '.' || tg.tgname::text AS name
    FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE NOT tg.tgisinternal AND tg.tgname <> '_br_gate' AND tg.tgenabled <> 'D'
      AND (c.relname IN (SELECT reg.table_name FROM reg) OR c.relname = 'profiles')
      AND position('_br_restore_bypass' in pg_get_triggerdef(tg.oid)) = 0
  )
  SELECT jsonb_build_object(
    'missing_gate', coalesce((SELECT jsonb_agg(m.table_name ORDER BY m.table_name) FROM missing m), '[]'::jsonb),
    'unwrapped', coalesce((SELECT jsonb_agg(u.name ORDER BY u.name) FROM unwrapped u), '[]'::jsonb),
    'ok', NOT EXISTS (SELECT 1 FROM missing) AND NOT EXISTS (SELECT 1 FROM unwrapped));
$$;

-- ===== Cycle de vie des jobs =====
CREATE OR REPLACE FUNCTION public._br_rs_fail(p_job uuid, p_code text, p_message text, p_report jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE public._br_restore_jobs
     SET status = 'failed', error_code = p_code, error_message = left(p_message, 2000),
         verify_report = coalesce(p_report, verify_report), finished_at = clock_timestamp(),
         lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = p_job AND status IN ('preparing','prepared');
  DELETE FROM public._br_restore_rows WHERE job_id = p_job;
  DELETE FROM public._br_tenant_maintenance WHERE job_id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'failed', 'error_code', p_code, 'error', left(p_message, 500));
END $$;

-- Verrouille le job, contrôle le bail et l'état, puis prolonge le bail.
CREATE OR REPLACE FUNCTION public._br_rs_lock(p_job uuid, p_token uuid, p_states text[])
RETURNS public._br_restore_jobs LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; v_ttl integer; v_enabled boolean;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled, c.lease_seconds INTO v_enabled, v_ttl FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (j.status = ANY (p_states)) THEN
    RAISE EXCEPTION 'BRR-003: job is %', j.status USING ERRCODE = '55000';
  END IF;
  IF j.lease_token IS DISTINCT FROM p_token OR j.lease_expires_at <= clock_timestamp() THEN
    RAISE EXCEPTION 'BRR-061: lease lost' USING ERRCODE = '55000';
  END IF;
  UPDATE public._br_restore_jobs
     SET lease_expires_at = clock_timestamp() + make_interval(secs => v_ttl), updated_at = now()
   WHERE id = p_job RETURNING * INTO j;
  RETURN j;
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_request_restore(p_tenant uuid, p_actor uuid, p_format integer, p_source uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_enabled boolean; v_job uuid; v_captured timestamptz; v_keys text[];
  v_counts jsonb; v_checks jsonb; v_status text; v_owner uuid; v_fmt integer; v_gen uuid;
  v_missing text[]; v_unknown text[]; v_n integer;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled INTO v_enabled FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  IF NOT public._br_rs_actor_ok(p_actor, p_tenant) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;

  IF p_format = 2 THEN
    SELECT tb.tenant_id, tb.format_version, tb.status::text, tb.created_at, tb.row_counts, tb.checksums
      INTO v_owner, v_fmt, v_status, v_captured, v_counts, v_checks
    FROM public.tenant_backups tb WHERE tb.id = p_source;
    IF v_owner IS NULL OR v_owner <> p_tenant THEN
      RAISE EXCEPTION 'BRR-404: source not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_fmt IS DISTINCT FROM 2 THEN
      RAISE EXCEPTION 'BRR-010: unsupported archive format %', coalesce(v_fmt::text, 'unknown') USING ERRCODE = '22023';
    END IF;
    IF v_status <> 'verified' THEN
      RAISE EXCEPTION 'BRR-011: archive is not verified' USING ERRCODE = '55000';
    END IF;
    SELECT array_agg(k) INTO v_keys
    FROM jsonb_object_keys((SELECT tb.payload FROM public.tenant_backups tb WHERE tb.id = p_source)) k;
    v_keys := coalesce(v_keys, '{}');
  ELSIF p_format = 3 THEN
    SELECT a.tenant_id, a.status, g.captured_at, a.generation_id INTO v_owner, v_status, v_captured, v_gen
    FROM public._br_v3_archives a
    LEFT JOIN public._br_capture_generations g ON g.id = a.generation_id
    WHERE a.id = p_source;
    IF v_owner IS NULL OR v_owner <> p_tenant THEN
      RAISE EXCEPTION 'BRR-404: source not found' USING ERRCODE = 'P0002';
    END IF;
    IF v_status <> 'verified' OR v_captured IS NULL THEN
      RAISE EXCEPTION 'BRR-011: archive is not verified' USING ERRCODE = '55000';
    END IF;
    SELECT array_agg(p.table_name), jsonb_object_agg(p.table_name, p.rows_captured),
           jsonb_object_agg(p.table_name, p.checksum)
      INTO v_keys, v_counts, v_checks
    FROM public._br_capture_progress p WHERE p.generation_id = v_gen;
    v_keys := coalesce(v_keys, '{}');
  ELSE
    RAISE EXCEPTION 'BRR-010: unsupported archive format %', coalesce(p_format::text, 'null') USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public._br_restore_jobs (tenant_id, operation, source_format, source_backup_id, source_archive_id,
      source_captured_at, requested_by)
    VALUES (p_tenant, 'restore', p_format, CASE WHEN p_format = 2 THEN p_source END,
      CASE WHEN p_format = 3 THEN p_source END, v_captured, p_actor)
    RETURNING id INTO v_job;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BRR-002: another restore or reset is already in progress for this tenant' USING ERRCODE = '55006';
  END;

  INSERT INTO public._br_restore_tables (job_id, tenant_id, table_name, restore_order, presence, expected_rows, expected_checksum)
  SELECT v_job, p_tenant, r.table_name, r.restore_order,
         CASE WHEN r.table_name = ANY (v_keys) THEN 'archived' ELSE 'historically_absent' END,
         CASE WHEN r.table_name = ANY (v_keys) THEN (v_counts ->> r.table_name)::bigint END,
         CASE WHEN r.table_name = ANY (v_keys) THEN v_checks ->> r.table_name END
  FROM public._br_table_registry r
  WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect')
    AND (r.table_name = ANY (v_keys) OR r.created_at > v_captured);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  SELECT array_agg(r.table_name ORDER BY r.table_name) INTO v_missing
  FROM public._br_table_registry r
  WHERE r.schema_name = 'public' AND r.tenant_link IN ('direct','indirect')
    AND NOT (r.table_name = ANY (v_keys)) AND r.created_at <= v_captured;
  SELECT array_agg(k ORDER BY k) INTO v_unknown FROM unnest(v_keys) k
  WHERE NOT EXISTS (SELECT 1 FROM public._br_table_registry r
                    WHERE r.schema_name = 'public' AND r.table_name = k AND r.tenant_link IN ('direct','indirect'))
    AND NOT (p_format = 2 AND k LIKE '\_%');

  IF v_missing IS NOT NULL THEN
    RETURN public._br_rs_fail(v_job, 'BRR-020', 'mandatory tables missing from archive: ' || array_to_string(v_missing, ', '),
      jsonb_build_object('missing_tables', to_jsonb(v_missing)));
  END IF;
  IF v_unknown IS NOT NULL THEN
    RETURN public._br_rs_fail(v_job, 'BRR-032', 'archive contains unknown tables: ' || array_to_string(v_unknown, ', '),
      jsonb_build_object('unknown_tables', to_jsonb(v_unknown)));
  END IF;
  RETURN jsonb_build_object('job_id', v_job, 'status', 'preparing', 'tables', v_n,
    'historically_absent', (SELECT coalesce(jsonb_agg(t.table_name ORDER BY t.table_name), '[]'::jsonb)
                            FROM public._br_restore_tables t WHERE t.job_id = v_job AND t.presence = 'historically_absent'));
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_request_reset(p_tenant uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_enabled boolean; v_job uuid;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled INTO v_enabled FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  IF NOT public._br_rs_actor_ok(p_actor, p_tenant) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;
  BEGIN
    INSERT INTO public._br_restore_jobs (tenant_id, operation, requested_by, status, prepared_at)
    VALUES (p_tenant, 'reset', p_actor, 'prepared', now()) RETURNING id INTO v_job;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'BRR-002: another restore or reset is already in progress for this tenant' USING ERRCODE = '55006';
  END;
  UPDATE public._br_restore_jobs SET schema_fingerprint = public._br_rs_schema_fp() WHERE id = v_job;
  RETURN jsonb_build_object('job_id', v_job, 'status', 'prepared', 'scope', 'all_sites');
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_claim(p_job uuid, p_worker text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; v_tok uuid := gen_random_uuid(); v_ttl integer; v_enabled boolean;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled, c.lease_seconds INTO v_enabled, v_ttl FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002'; END IF;
  IF j.status NOT IN ('preparing','prepared') THEN
    RAISE EXCEPTION 'BRR-003: job is %', j.status USING ERRCODE = '55000';
  END IF;
  IF j.lease_expires_at IS NOT NULL AND j.lease_expires_at > clock_timestamp() THEN
    RAISE EXCEPTION 'BRR-060: job is leased by another worker' USING ERRCODE = '55006';
  END IF;
  UPDATE public._br_restore_jobs
     SET fence = fence + 1, lease_token = v_tok, lease_owner = left(coalesce(p_worker, 'worker'), 100),
         lease_expires_at = clock_timestamp() + make_interval(secs => v_ttl), updated_at = now()
   WHERE id = p_job RETURNING * INTO j;
  RETURN jsonb_build_object('job_id', j.id, 'token', v_tok, 'fence', j.fence, 'operation', j.operation,
    'format', j.source_format, 'status', j.status, 'tenant_id', j.tenant_id);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_unlease(p_job uuid, p_token uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._br_rs_assert_server();
  UPDATE public._br_restore_jobs SET lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = p_job AND lease_token = p_token AND status IN ('preparing','prepared');
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_fail_job(p_job uuid, p_token uuid, p_code text, p_message text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public._br_rs_lock(p_job, p_token, ARRAY['preparing','prepared']);
  IF p_code !~ '^BR[A-Z]?-[0-9]{3}$' THEN p_code := 'BRR-099'; END IF;
  RETURN public._br_rs_fail(p_job, p_code, coalesce(p_message, 'worker integrity failure'));
END $$;

-- ===== Chargement v2 : table par table depuis tenant_backups.payload =====
CREATE OR REPLACE FUNCTION public._br_rs_load_v2(p_job uuid, p_token uuid, p_max_tables integer DEFAULT 5)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; t record; v_type text; v_n bigint; v_done integer := 0; v_left integer;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  IF j.source_format IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'BRR-010: job is not a v2 restore' USING ERRCODE = '22023';
  END IF;
  FOR t IN SELECT rt.table_name FROM public._br_restore_tables rt
           WHERE rt.job_id = p_job AND rt.presence = 'archived' AND NOT rt.loaded
           ORDER BY rt.restore_order, rt.table_name LIMIT greatest(coalesce(p_max_tables, 1), 1)
  LOOP
    SELECT jsonb_typeof(tb.payload -> t.table_name) INTO v_type FROM public.tenant_backups tb WHERE tb.id = j.source_backup_id;
    IF v_type IS DISTINCT FROM 'array' THEN
      RETURN public._br_rs_fail(p_job, 'BRR-030', format('table %s is not an array in the archive', t.table_name));
    END IF;
    DELETE FROM public._br_restore_rows WHERE job_id = p_job AND table_name = t.table_name;
    INSERT INTO public._br_restore_rows (job_id, table_name, ord, row_data)
    SELECT p_job, t.table_name, e.ord, e.val
    FROM public.tenant_backups tb
    CROSS JOIN LATERAL jsonb_array_elements(tb.payload -> t.table_name) WITH ORDINALITY AS e(val, ord)
    WHERE tb.id = j.source_backup_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE public._br_restore_tables SET loaded = true, loaded_rows = v_n WHERE job_id = p_job AND table_name = t.table_name;
    v_done := v_done + 1;
  END LOOP;
  SELECT count(*) INTO v_left FROM public._br_restore_tables
  WHERE job_id = p_job AND presence = 'archived' AND NOT loaded;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'loaded_now', v_done, 'remaining', v_left, 'done', v_left = 0);
END $$;

-- ===== Chargement v3 : manifeste puis blocs déchiffrés par le worker =====
CREATE OR REPLACE FUNCTION public._br_rs_v3_plan(p_job uuid, p_token uuid, p_limit integer DEFAULT 20)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; a public._br_v3_archives%ROWTYPE; v_blocks jsonb; v_left integer;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  IF j.source_format IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'BRR-010: job is not a v3 restore' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO a FROM public._br_v3_archives WHERE id = j.source_archive_id;
  IF NOT FOUND OR a.status <> 'verified' OR a.tenant_id <> j.tenant_id THEN
    RETURN public._br_rs_fail(p_job, 'BRR-011', 'archive is no longer verified');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('block_no', b.block_no, 'table', b.table_name, 'ord_from', b.ord_from,
           'ord_to', b.ord_to, 'rows', b.row_count, 'plain_bytes', b.plain_bytes, 'object_path', b.object_path,
           'key_id', b.key_id) ORDER BY b.block_no), '[]'::jsonb)
    INTO v_blocks
  FROM (SELECT * FROM public._br_v3_archive_blocks b0
        WHERE b0.archive_id = a.id
          AND NOT EXISTS (SELECT 1 FROM public._br_restore_blocks rb WHERE rb.job_id = p_job AND rb.block_no = b0.block_no)
        ORDER BY b0.block_no LIMIT greatest(coalesce(p_limit, 1), 1)) b;
  SELECT count(*) INTO v_left FROM public._br_v3_archive_blocks b
  WHERE b.archive_id = a.id
    AND NOT EXISTS (SELECT 1 FROM public._br_restore_blocks rb WHERE rb.job_id = p_job AND rb.block_no = b.block_no);
  RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'manifest_ok', j.manifest_ok, 'remaining', v_left,
    'archive', jsonb_build_object('id', a.id, 'tenant_id', a.tenant_id, 'generation_id', a.generation_id,
      'key_id', a.key_id, 'manifest_path', a.manifest_path, 'manifest_bytes', a.manifest_bytes),
    'blocks', v_blocks);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_v3_manifest(p_job uuid, p_token uuid, p_stored_sha256 text, p_plain_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; a public._br_v3_archives%ROWTYPE; v_ref text;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  SELECT * INTO a FROM public._br_v3_archives WHERE id = j.source_archive_id;
  IF p_stored_sha256 IS DISTINCT FROM a.manifest_sha256 OR p_plain_sha256 IS DISTINCT FROM a.manifest_plain_sha256 THEN
    RETURN public._br_rs_fail(p_job, 'BRR-041', 'manifest altered or mismatched');
  END IF;
  v_ref := encode(sha256(convert_to(public._br_v3_manifest_text(a.id), 'UTF8')), 'hex');
  IF v_ref IS DISTINCT FROM a.manifest_plain_sha256 THEN
    RETURN public._br_rs_fail(p_job, 'BRR-042', 'server-side archive metadata no longer matches the manifest');
  END IF;
  UPDATE public._br_restore_jobs SET manifest_ok = true, updated_at = now() WHERE id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'manifest_ok', true);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_v3_load_block(p_job uuid, p_token uuid, p_block_no integer,
  p_stored_sha256 text, p_lines text[])
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; a public._br_v3_archives%ROWTYPE; k public._br_v3_archive_blocks%ROWTYPE;
  v_body text;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  IF NOT j.manifest_ok THEN
    RAISE EXCEPTION 'BRR-040: manifest not authenticated yet' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO a FROM public._br_v3_archives WHERE id = j.source_archive_id;
  SELECT * INTO k FROM public._br_v3_archive_blocks WHERE archive_id = a.id AND block_no = p_block_no;
  IF NOT FOUND OR k.verified_at IS NULL THEN
    RETURN public._br_rs_fail(p_job, 'BRR-043', format('block %s unknown or not verified', p_block_no));
  END IF;
  IF EXISTS (SELECT 1 FROM public._br_restore_blocks WHERE job_id = p_job AND block_no = p_block_no) THEN
    RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'block_no', p_block_no, 'already_loaded', true);
  END IF;
  IF p_stored_sha256 IS DISTINCT FROM k.stored_sha256 THEN
    RETURN public._br_rs_fail(p_job, 'BRR-044', format('stored object of block %s altered', p_block_no));
  END IF;
  IF coalesce(cardinality(p_lines), 0) <> k.row_count OR array_position(p_lines, NULL) IS NOT NULL THEN
    RETURN public._br_rs_fail(p_job, 'BRR-045', format('block %s row count mismatch', p_block_no));
  END IF;
  v_body := jsonb_build_object('format', 'waarwi-br-block', 'format_version', 3, 'tenant_id', a.tenant_id,
              'archive_id', a.id, 'generation_id', a.generation_id, 'block_no', k.block_no,
              'table', k.table_name, 'ord_from', k.ord_from, 'ord_to', k.ord_to, 'rows', k.row_count)::text
            || E'\n' || array_to_string(p_lines, E'\n') || E'\n';
  IF octet_length(v_body) <> k.plain_bytes OR encode(sha256(convert_to(v_body, 'UTF8')), 'hex') <> k.plain_sha256 THEN
    RETURN public._br_rs_fail(p_job, 'BRR-045', format('block %s content does not match its verified hash', p_block_no));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._br_restore_tables WHERE job_id = p_job AND table_name = k.table_name AND presence = 'archived') THEN
    RETURN public._br_rs_fail(p_job, 'BRR-032', format('block %s targets unplanned table %s', p_block_no, k.table_name));
  END IF;
  INSERT INTO public._br_restore_rows (job_id, table_name, ord, row_data)
  SELECT p_job, k.table_name, k.ord_from + l.n - 1, l.line::jsonb
  FROM unnest(p_lines) WITH ORDINALITY AS l(line, n);
  INSERT INTO public._br_restore_blocks (job_id, block_no, rows) VALUES (p_job, p_block_no, k.row_count);
  UPDATE public._br_restore_tables SET loaded_rows = loaded_rows + k.row_count
   WHERE job_id = p_job AND table_name = k.table_name;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'preparing', 'block_no', p_block_no, 'rows', k.row_count);
END $$;

-- ===== Vérification complète de la zone de préparation (aucune mutation métier) =====
CREATE OR REPLACE FUNCTION public._br_rs_verify(p_job uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp SET timezone = 'UTC' AS $$
DECLARE
  j public._br_restore_jobs%ROWTYPE;
  t record; f record;
  v_issues jsonb := '[]'::jsonb;
  v_rel regclass; v_n bigint; v_bad bigint; v_chk text; v_keys text[]; v_cols text[]; v_pk text[];
  v_tcol text; v_link text; v_sql text; v_err text; v_ccols text[]; v_pcols text[]; v_ptable text; v_pschema text;
  v_ppres text; v_cond text; v_fill boolean; v_sel text; v_ord text;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['preparing']);
  IF j.operation <> 'restore' THEN
    RAISE EXCEPTION 'BRR-003: not a restore job' USING ERRCODE = '55000';
  END IF;

  IF j.source_format = 3 THEN
    IF NOT j.manifest_ok THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-040', 'detail', 'manifest not authenticated');
    END IF;
    SELECT count(*) INTO v_n FROM public._br_v3_archive_blocks b
    WHERE b.archive_id = j.source_archive_id
      AND NOT EXISTS (SELECT 1 FROM public._br_restore_blocks rb WHERE rb.job_id = p_job AND rb.block_no = b.block_no);
    IF v_n > 0 THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-046', 'detail', format('%s blocks not loaded', v_n));
    END IF;
  ELSE
    SELECT count(*) INTO v_n FROM public._br_restore_tables WHERE job_id = p_job AND presence = 'archived' AND NOT loaded;
    IF v_n > 0 THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-046', 'detail', format('%s tables not loaded', v_n));
    END IF;
  END IF;

  v_fill := EXISTS (SELECT 1 FROM public._br_restore_tables WHERE job_id = p_job AND table_name = 'cash_registers'
                    AND presence = 'historically_absent');

  FOR t IN SELECT * FROM public._br_restore_tables WHERE job_id = p_job ORDER BY restore_order, table_name LOOP
    v_rel := to_regclass(format('public.%I', t.table_name));
    IF v_rel IS NULL THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-071', 'table', t.table_name, 'detail', 'table missing');
      CONTINUE;
    END IF;
    IF t.presence = 'historically_absent' THEN CONTINUE; END IF;

    SELECT count(*) INTO v_n FROM public._br_restore_rows WHERE job_id = p_job AND table_name = t.table_name;
    IF v_n IS DISTINCT FROM t.expected_rows THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-030', 'table', t.table_name,
        'detail', format('rows %s, expected %s', v_n, coalesce(t.expected_rows::text, 'unknown')));
      CONTINUE;
    END IF;
    IF v_n = 0 THEN
      UPDATE public._br_restore_tables SET keys = '{}' WHERE job_id = p_job AND table_name = t.table_name;
      CONTINUE;
    END IF;
    IF EXISTS (SELECT 1 FROM public._br_restore_rows WHERE job_id = p_job AND table_name = t.table_name
               AND jsonb_typeof(row_data) <> 'object') THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-030', 'table', t.table_name, 'detail', 'row is not an object');
      CONTINUE;
    END IF;

    SELECT array_agg(s.k ORDER BY s.k) INTO v_keys FROM (
      SELECT DISTINCT jsonb_object_keys(r.row_data) AS k FROM public._br_restore_rows r
      WHERE r.job_id = p_job AND r.table_name = t.table_name) s;
    IF EXISTS (SELECT 1 FROM public._br_restore_rows r WHERE r.job_id = p_job AND r.table_name = t.table_name
               AND (SELECT count(*) FROM jsonb_object_keys(r.row_data)) <> cardinality(v_keys)) THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-033', 'table', t.table_name, 'detail', 'heterogeneous rows');
      CONTINUE;
    END IF;
    SELECT array_agg(k ORDER BY k) INTO v_cols FROM unnest(v_keys) k
    WHERE NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = v_rel AND a.attname = k AND a.attnum > 0 AND NOT a.attisdropped);
    IF v_cols IS NOT NULL THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-033', 'table', t.table_name,
        'detail', 'unknown columns: ' || array_to_string(v_cols, ', '));
      CONTINUE;
    END IF;

    SELECT array_agg(a.attname::text ORDER BY a.attnum) INTO v_cols FROM pg_attribute a
    WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND NOT a.atthasdef
      AND a.attgenerated = '' AND a.attidentity = '' AND NOT (a.attname::text = ANY (v_keys))
      AND NOT (v_fill AND t.table_name = 'cash_sessions' AND a.attname = 'cash_register_id');
    IF v_cols IS NOT NULL THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-036', 'table', t.table_name,
        'detail', 'required columns absent: ' || array_to_string(v_cols, ', '));
      CONTINUE;
    END IF;
    SELECT array_agg(a.attname::text) INTO v_cols FROM pg_attribute a
    WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attnotnull AND a.attgenerated = ''
      AND a.attname::text = ANY (v_keys);
    IF v_cols IS NOT NULL THEN
      SELECT string_agg(format('r.row_data -> %L = %L::jsonb', c, 'null'), ' OR ') INTO v_cond FROM unnest(v_cols) c;
      EXECUTE format('SELECT count(*) FROM public._br_restore_rows r WHERE r.job_id = $1 AND r.table_name = $2 AND (%s)', v_cond)
        INTO v_bad USING p_job, t.table_name;
      IF v_bad > 0 THEN
        v_issues := v_issues || jsonb_build_object('code', 'BRR-036', 'table', t.table_name,
          'detail', format('%s rows with null in a required column', v_bad));
        CONTINUE;
      END IF;
    END IF;

    SELECT l.o_link, l.o_tcol INTO v_link, v_tcol FROM public._br_rs_parent_link(t.table_name) l;
    IF v_link = 'direct' THEN
      SELECT count(*) INTO v_bad FROM public._br_restore_rows r
      WHERE r.job_id = p_job AND r.table_name = t.table_name AND (r.row_data ->> v_tcol) IS DISTINCT FROM j.tenant_id::text;
      IF v_bad > 0 THEN
        v_issues := v_issues || jsonb_build_object('code', 'BRR-037', 'table', t.table_name,
          'detail', format('%s rows belong to another tenant', v_bad));
        CONTINUE;
      END IF;
    END IF;

    BEGIN
      EXECUTE format('SELECT count(*) FROM public._br_restore_rows r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I, r.row_data) p '
                     'WHERE r.job_id = $1 AND r.table_name = $2 AND p IS NOT DISTINCT FROM p', t.table_name)
        INTO v_n USING p_job, t.table_name;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
      v_issues := v_issues || jsonb_build_object('code', 'BRR-035', 'table', t.table_name, 'detail', left(v_err, 300));
      CONTINUE;
    END;

    -- v3 : formule Lot B. v2 : sha256 de la charge (64 car.) ou md5 historique des lignes row_to_json (32 car.),
    -- reconstruit à partir des seules colonnes archivées dans l'ordre physique, trié par id::text sinon par texte.
    IF j.source_format = 3 THEN
      SELECT md5(string_agg(md5(r.row_data::text), '' ORDER BY r.ord)) INTO v_chk
      FROM public._br_restore_rows r WHERE r.job_id = p_job AND r.table_name = t.table_name;
    ELSIF length(t.expected_checksum) = 32 THEN
      SELECT string_agg(format('p.%I', a.attname), ', ' ORDER BY a.attnum) INTO v_sel FROM pg_attribute a
      WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname::text = ANY (v_keys);
      v_ord := CASE WHEN 'id' = ANY (v_keys) THEN 'x.r_id' ELSE 'x.j' END;
      EXECUTE format('SELECT md5(string_agg(md5(x.j), '''' ORDER BY %s)) FROM (SELECT row_to_json(s)::text AS j, r.row_data ->> ''id'' AS r_id '
                     'FROM public._br_restore_rows r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I, r.row_data) p '
                     'CROSS JOIN LATERAL (SELECT %s) s WHERE r.job_id = $1 AND r.table_name = $2) x', v_ord, t.table_name, v_sel)
        INTO v_chk USING p_job, t.table_name;
    ELSE
      SELECT encode(sha256(convert_to(string_agg(r.row_data::text, '' ORDER BY r.row_data::text), 'UTF8')), 'hex') INTO v_chk
      FROM public._br_restore_rows r WHERE r.job_id = p_job AND r.table_name = t.table_name;
    END IF;
    IF t.expected_checksum IS NULL OR v_chk IS DISTINCT FROM t.expected_checksum THEN
      v_issues := v_issues || jsonb_build_object('code', 'BRR-031', 'table', t.table_name, 'detail', 'checksum mismatch');
      CONTINUE;
    END IF;

    v_pk := public._br_rs_pk_cols(v_rel);
    IF v_pk IS NOT NULL THEN
      SELECT string_agg(format('r.row_data -> %L', c), ', ') INTO v_cond FROM unnest(v_pk) c;
      EXECUTE format('SELECT count(*) - count(DISTINCT jsonb_build_array(%s)) FROM public._br_restore_rows r '
                     'WHERE r.job_id = $1 AND r.table_name = $2', v_cond) INTO v_bad USING p_job, t.table_name;
      IF v_bad > 0 THEN
        v_issues := v_issues || jsonb_build_object('code', 'BRR-038', 'table', t.table_name,
          'detail', format('%s duplicate keys', v_bad));
        CONTINUE;
      END IF;
    END IF;
    UPDATE public._br_restore_tables SET keys = v_keys WHERE job_id = p_job AND table_name = t.table_name;
  END LOOP;

  -- Références (internes à l'archive, tables historiquement absentes, et externes)
  IF jsonb_array_length(v_issues) = 0 THEN
    FOR f IN
      SELECT c.conname::text AS conname, cl.relname::text AS child, pcl.relname::text AS parent, pn.nspname::text AS pschema,
             c.conkey, c.confkey, c.conrelid, c.confrelid
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid JOIN pg_namespace cn ON cn.oid = cl.relnamespace AND cn.nspname = 'public'
      JOIN pg_class pcl ON pcl.oid = c.confrelid JOIN pg_namespace pn ON pn.oid = pcl.relnamespace
      JOIN public._br_restore_tables rt ON rt.job_id = p_job AND rt.table_name = cl.relname AND rt.presence = 'archived'
      WHERE c.contype = 'f' AND NOT (pn.nspname = 'public' AND pcl.relname = 'tenants')
      ORDER BY cl.relname, c.conname
    LOOP
      SELECT array_agg(a.attname::text ORDER BY k.n) INTO v_ccols
      FROM unnest(f.conkey) WITH ORDINALITY k(attnum, n) JOIN pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = k.attnum;
      SELECT array_agg(a.attname::text ORDER BY k.n) INTO v_pcols
      FROM unnest(f.confkey) WITH ORDINALITY k(attnum, n) JOIN pg_attribute a ON a.attrelid = f.confrelid AND a.attnum = k.attnum;
      SELECT keys INTO v_keys FROM public._br_restore_tables WHERE job_id = p_job AND table_name = f.child;
      IF v_keys IS NULL OR NOT (v_ccols <@ v_keys) THEN CONTINUE; END IF;
      SELECT string_agg(format('r.row_data ->> %L IS NOT NULL', c), ' AND ') INTO v_cond FROM unnest(v_ccols) c;
      SELECT rt.presence INTO v_ppres FROM public._br_restore_tables rt
      WHERE rt.job_id = p_job AND rt.table_name = f.parent AND f.pschema = 'public';
      IF v_ppres = 'archived' THEN
        v_sql := format('SELECT count(*) FROM public._br_restore_rows r WHERE r.job_id = $1 AND r.table_name = $2 AND %s '
                        'AND NOT EXISTS (SELECT 1 FROM public._br_restore_rows q WHERE q.job_id = $1 AND q.table_name = $3 AND %s)',
          v_cond, (SELECT string_agg(format('q.row_data ->> %L = r.row_data ->> %L', v_pcols[i], v_ccols[i]), ' AND ')
                   FROM generate_subscripts(v_ccols, 1) i));
      ELSE
        v_sql := format('SELECT count(*) FROM public._br_restore_rows r WHERE r.job_id = $1 AND r.table_name = $2 AND %s '
                        'AND NOT EXISTS (SELECT 1 FROM %I.%I x WHERE %s) AND $3 IS NOT NULL',
          v_cond, f.pschema, f.parent,
          (SELECT string_agg(format('x.%I::text = r.row_data ->> %L', v_pcols[i], v_ccols[i]), ' AND ')
           FROM generate_subscripts(v_ccols, 1) i));
      END IF;
      EXECUTE v_sql INTO v_bad USING p_job, f.child, f.parent;
      IF v_bad > 0 THEN
        v_issues := v_issues || jsonb_build_object('code', 'BRR-039', 'table', f.child, 'constraint', f.conname,
          'detail', format('%s rows reference missing %s.%s', v_bad, f.pschema, f.parent));
      END IF;
    END LOOP;
  END IF;

  IF jsonb_array_length(v_issues) > 0 THEN
    RETURN public._br_rs_fail(p_job, v_issues -> 0 ->> 'code', 'archive verification failed',
      jsonb_build_object('issues', v_issues));
  END IF;
  UPDATE public._br_restore_jobs
     SET status = 'prepared', prepared_at = now(), schema_fingerprint = public._br_rs_schema_fp(),
         verify_report = jsonb_build_object('issues', '[]'::jsonb,
           'tables', (SELECT jsonb_object_agg(rt.table_name, jsonb_build_object('presence', rt.presence, 'rows', rt.expected_rows))
                      FROM public._br_restore_tables rt WHERE rt.job_id = p_job)),
         updated_at = now()
   WHERE id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'prepared', 'issues', '[]'::jsonb);
END $$;

-- ===== Outils internes du moteur (appelés uniquement depuis swap / reset) =====
CREATE OR REPLACE FUNCTION public._br_rs_live_state(p_table text, p_tenant uuid, OUT o_rows bigint, OUT o_checksum text)
LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_order text;
BEGIN
  SELECT o.order_sql INTO v_order FROM public._br_capture_order(format('public.%I', p_table)::regclass, 't') o;
  EXECUTE format('SELECT count(*), md5(string_agg(md5(to_jsonb(t)::text), '''' ORDER BY %s)) FROM public.%I t WHERE %s',
                 v_order, p_table, public._br_rs_tenant_pred(p_table, 't'))
    INTO o_rows, o_checksum USING p_tenant;
END $$;

-- Sauvegarde de sécurité de toutes les tables du registre pour le tenant, vérifiée relecture contre vivant.
CREATE OR REPLACE FUNCTION public._br_rs_take_safety(p_job uuid, p_tenant uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE r record; v_order text; v_rows bigint; v_chk text; v_live_rows bigint; v_live_chk text; v_total bigint := 0; v_n integer := 0;
BEGIN
  FOR r IN SELECT g.table_name FROM public._br_table_registry g
           WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect') ORDER BY g.restore_order, g.table_name LOOP
    SELECT o.order_sql INTO v_order FROM public._br_capture_order(format('public.%I', r.table_name)::regclass, 't') o;
    EXECUTE format('INSERT INTO public._br_restore_safety (job_id, tenant_id, table_name, ord, row_data) '
                   'SELECT $2, $1, %L, row_number() OVER (ORDER BY %s), to_jsonb(t) FROM public.%I t WHERE %s',
                   r.table_name, v_order, r.table_name, public._br_rs_tenant_pred(r.table_name, 't'))
      USING p_tenant, p_job;
    SELECT count(*), md5(string_agg(md5(s.row_data::text), '' ORDER BY s.ord)) INTO v_rows, v_chk
    FROM public._br_restore_safety s WHERE s.job_id = p_job AND s.table_name = r.table_name;
    SELECT l.o_rows, l.o_checksum INTO v_live_rows, v_live_chk FROM public._br_rs_live_state(r.table_name, p_tenant) l;
    IF v_rows <> v_live_rows OR v_chk IS DISTINCT FROM v_live_chk THEN
      RAISE EXCEPTION 'BRR-050: safety backup of % does not match live data', r.table_name USING ERRCODE = 'XX001';
    END IF;
    INSERT INTO public._br_restore_safety_tables (job_id, tenant_id, table_name, rows, checksum)
    VALUES (p_job, p_tenant, r.table_name, v_rows, v_chk);
    v_total := v_total + v_rows; v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('tables', v_n, 'rows', v_total);
END $$;

-- Prédicat « toutes les références sortantes existent » (hors auto-références), sur l'alias d'un enregistrement.
CREATE OR REPLACE FUNCTION public._br_rs_fk_filter(p_table text, p_alias text)
RETURNS text LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT coalesce(string_agg(
    format('(%s OR EXISTS (SELECT 1 FROM %I.%I x WHERE %s))',
      (SELECT string_agg(format('%I.%I IS NULL', p_alias, a.attname), ' OR ')
       FROM unnest(c.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum),
      pn.nspname, pc.relname,
      (SELECT string_agg(format('x.%I = %I.%I', pa.attname, p_alias, ca.attname), ' AND ')
       FROM unnest(c.conkey, c.confkey) z(ck, pk)
       JOIN pg_attribute ca ON ca.attrelid = c.conrelid AND ca.attnum = z.ck
       JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = z.pk)), ' AND '), 'true')
  FROM pg_constraint c
  JOIN pg_class pc ON pc.oid = c.confrelid JOIN pg_namespace pn ON pn.oid = pc.relnamespace
  WHERE c.contype = 'f' AND c.conrelid = format('public.%I', p_table)::regclass AND c.confrelid <> c.conrelid;
$$;

-- Insère les lignes d'une table depuis la zone de préparation ('stage') ou la sauvegarde de sécurité ('safety').
CREATE OR REPLACE FUNCTION public._br_rs_insert_table(p_job uuid, p_table text, p_src text, p_keys text[],
  p_deferred text[], p_filter boolean, p_fill_register boolean)
RETURNS bigint LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_src text; v_cols text[]; v_sel text; v_ins text; v_self text[]; v_pk text[]; v_where text := 'true';
  v_n bigint; v_total bigint := 0; v_left bigint;
BEGIN
  v_src := CASE p_src WHEN 'stage' THEN 'public._br_restore_rows' WHEN 'safety' THEN 'public._br_restore_safety' END;
  IF v_src IS NULL THEN RAISE EXCEPTION 'BRR-099: bad source'; END IF;
  v_cols := public._br_insertable_columns('public', p_table, p_keys, coalesce(p_deferred, '{}'));
  IF coalesce(cardinality(v_cols), 0) = 0 THEN RETURN 0; END IF;
  SELECT string_agg(format('%I', c), ', ' ORDER BY n) INTO v_ins FROM unnest(v_cols) WITH ORDINALITY u(c, n);
  SELECT string_agg(format('p.%I', c), ', ' ORDER BY n) INTO v_sel FROM unnest(v_cols) WITH ORDINALITY u(c, n);
  IF p_fill_register AND NOT ('cash_register_id' = ANY (v_cols)) THEN
    v_ins := v_ins || ', cash_register_id';
    v_sel := v_sel || ', (SELECT cr.id FROM public.cash_registers cr WHERE cr.tenant_id = p.tenant_id AND cr.site_id = p.site_id '
                      'ORDER BY cr.is_default DESC, cr.created_at LIMIT 1)';
  ELSIF p_fill_register THEN
    v_sel := replace(v_sel, 'p.cash_register_id', 'coalesce(p.cash_register_id, (SELECT cr.id FROM public.cash_registers cr '
      'WHERE cr.tenant_id = p.tenant_id AND cr.site_id = p.site_id ORDER BY cr.is_default DESC, cr.created_at LIMIT 1))');
  END IF;
  IF p_filter THEN v_where := public._br_rs_fk_filter(p_table, 'p'); END IF;

  SELECT coalesce(g.self_ref_columns, '{}') INTO v_self FROM public._br_table_registry g
  WHERE g.schema_name = 'public' AND g.table_name = p_table;
  v_self := ARRAY(SELECT s FROM unnest(coalesce(v_self, '{}')) s WHERE s = ANY (v_cols));

  IF cardinality(v_self) = 0 THEN
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM %s r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I, r.row_data) p '
                   'WHERE r.job_id = $1 AND r.table_name = $2 AND %s ORDER BY r.ord', p_table, v_ins, v_sel, v_src, p_table, v_where)
      USING p_job, p_table;
    GET DIAGNOSTICS v_total = ROW_COUNT;
    RETURN v_total;
  END IF;

  v_pk := public._br_rs_pk_cols(format('public.%I', p_table)::regclass);
  IF coalesce(cardinality(v_pk), 0) <> 1 THEN
    RAISE EXCEPTION 'BRR-075: self-referencing table % needs a single-column key', p_table USING ERRCODE = 'XX000';
  END IF;
  LOOP
    EXECUTE format('INSERT INTO public.%1$I (%2$s) SELECT %3$s FROM %4$s r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I, r.row_data) p '
                   'WHERE r.job_id = $1 AND r.table_name = $2 AND %5$s AND NOT EXISTS (SELECT 1 FROM public.%1$I e WHERE e.%6$I = p.%6$I) AND %7$s ORDER BY r.ord',
                   p_table, v_ins, v_sel, v_src, v_where, v_pk[1],
                   (SELECT string_agg(format('(p.%1$I IS NULL OR EXISTS (SELECT 1 FROM public.%2$I y WHERE y.%3$I = p.%1$I))', s, p_table, v_pk[1]), ' AND ')
                    FROM unnest(v_self) s))
      USING p_job, p_table;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
    EXIT WHEN v_n = 0;
  END LOOP;
  IF NOT p_filter THEN
    EXECUTE format('SELECT count(*) FROM %s r WHERE r.job_id = $1 AND r.table_name = $2', v_src) INTO v_left USING p_job, p_table;
    IF v_left <> v_total THEN
      RAISE EXCEPTION 'BRR-075: % rows of % form an unresolvable self-reference', v_left - v_total, p_table USING ERRCODE = 'XX000';
    END IF;
  END IF;
  RETURN v_total;
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_apply_deferred(p_job uuid, p_table text, p_cols text[])
RETURNS bigint LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_pk text[]; v_n bigint;
BEGIN
  IF coalesce(cardinality(p_cols), 0) = 0 THEN RETURN 0; END IF;
  v_pk := public._br_rs_pk_cols(format('public.%I', p_table)::regclass);
  IF coalesce(cardinality(v_pk), 0) <> 1 THEN
    RAISE EXCEPTION 'BRR-075: table % with deferred columns needs a single-column key', p_table USING ERRCODE = 'XX000';
  END IF;
  EXECUTE format('UPDATE public.%1$I x SET (%2$s) = ROW(%3$s) FROM public._br_restore_rows r '
                 'CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I, r.row_data) p '
                 'WHERE r.job_id = $1 AND r.table_name = $2 AND x.%4$I = p.%4$I',
                 p_table,
                 (SELECT string_agg(format('%I', c), ', ') FROM unnest(p_cols) c),
                 (SELECT string_agg(format('p.%I', c), ', ') FROM unnest(p_cols) c), v_pk[1])
    USING p_job, p_table;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- Compteurs : max(courant avant opération, archivé, plus grand numéro présent). Retourne les écarts justifiés.
CREATE OR REPLACE FUNCTION public._br_rs_fix_counters(p_tenant uuid, p_before jsonb, p_seq_before jsonb)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  k text; s record; v_arch bigint; v_before bigint; v_found bigint; v_final bigint; v_prefix text;
  v_report jsonb := '{}'::jsonb; v_seq record; v_cur integer;
BEGIN
  FOR k IN SELECT x FROM jsonb_object_keys(coalesce(p_before, '{}'::jsonb)) x
           UNION SELECT c.doc_kind FROM public.tenant_doc_counters c WHERE c.tenant_id = p_tenant
           UNION SELECT cs.doc_kind FROM public._br_rs_counter_sources cs WHERE cs.doc_kind <> 'cm_*'
  LOOP
    SELECT c.last_number INTO v_arch FROM public.tenant_doc_counters c WHERE c.tenant_id = p_tenant AND c.doc_kind = k;
    v_before := (p_before ->> k)::bigint;
    v_found := NULL;
    SELECT * INTO s FROM public._br_rs_counter_sources cs
    WHERE cs.doc_kind = k OR (cs.doc_kind = 'cm_*' AND k LIKE 'cm\_%') ORDER BY (cs.doc_kind = k) DESC LIMIT 1;
    IF FOUND THEN
      v_prefix := coalesce(s.prefix, substr(k, 4));
      IF v_prefix ~ '^[A-Za-z0-9]{1,10}$' THEN
        EXECUTE format('SELECT max((substring(x.%I from %L))::bigint) FROM public.%I x WHERE %s',
                       s.column_name, '^' || v_prefix || '-0*([0-9]{1,18})$', s.table_name,
                       public._br_rs_tenant_pred(s.table_name, 'x'))
          INTO v_found USING p_tenant;
      END IF;
    END IF;
    v_final := greatest(coalesce(v_before, 0), coalesce(v_arch, 0), coalesce(v_found, 0));
    IF v_arch IS NULL AND v_final = 0 THEN CONTINUE; END IF;
    IF v_arch IS NULL THEN
      INSERT INTO public.tenant_doc_counters (tenant_id, doc_kind, last_number) VALUES (p_tenant, k, v_final);
    ELSIF v_final <> v_arch THEN
      UPDATE public.tenant_doc_counters SET last_number = v_final WHERE tenant_id = p_tenant AND doc_kind = k;
    END IF;
    IF v_final IS DISTINCT FROM v_arch THEN
      v_report := v_report || jsonb_build_object(k, jsonb_build_object('archived', v_arch, 'before', v_before,
                                                                      'max_number_found', v_found, 'final', v_final));
    END IF;
  END LOOP;

  FOR v_seq IN SELECT e.key AS k, (e.value)::text::integer AS n FROM jsonb_each(coalesce(p_seq_before, '{}'::jsonb)) e LOOP
    SELECT a.last_number INTO v_cur FROM public.accounting_sequences a
    WHERE a.tenant_id = p_tenant AND a.journal_type || '|' || a.fiscal_year = v_seq.k;
    IF NOT FOUND THEN
      INSERT INTO public.accounting_sequences (tenant_id, journal_type, fiscal_year, last_number)
      VALUES (p_tenant, split_part(v_seq.k, '|', 1), split_part(v_seq.k, '|', 2)::integer, v_seq.n);
      v_cur := NULL;
    ELSIF v_cur < v_seq.n THEN
      UPDATE public.accounting_sequences SET last_number = v_seq.n
      WHERE tenant_id = p_tenant AND journal_type || '|' || fiscal_year = v_seq.k;
    ELSE CONTINUE;
    END IF;
    v_report := v_report || jsonb_build_object('accounting:' || v_seq.k, jsonb_build_object('archived', v_cur, 'final', v_seq.n));
  END LOOP;
  RETURN v_report;
END $$;

-- Vérifications communes avant toute mutation (swap / reset). Prend le verrou exclusif du tenant.
CREATE OR REPLACE FUNCTION public._br_rs_exec_preflight(p_job public._br_restore_jobs)
RETURNS void LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_hooks jsonb; v_drift jsonb; v_timeout integer;
BEGIN
  IF p_job.execute_requested_at IS NULL THEN
    RAISE EXCEPTION 'BRR-005: execution was not requested' USING ERRCODE = '55000';
  END IF;
  v_hooks := public._br_lotd_hooks_status();
  IF NOT coalesce((v_hooks ->> 'ok')::boolean, false) THEN
    RAISE EXCEPTION 'BRR-070: write gate and trigger guards are not installed' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public._br_tenant_maintenance m
                 WHERE m.tenant_id = p_job.tenant_id AND m.job_id = p_job.id AND m.expires_at > clock_timestamp()) THEN
    RAISE EXCEPTION 'BRR-072: tenant is not in maintenance for this job' USING ERRCODE = '55000';
  END IF;
  SELECT c.swap_lock_timeout_ms INTO v_timeout FROM public._br_restore_config c WHERE c.id = 1;
  PERFORM set_config('lock_timeout', greatest(coalesce(v_timeout, 60000), 1000)::text || 'ms', true);
  BEGIN
    PERFORM pg_advisory_xact_lock(1112689732, hashtext(p_job.tenant_id::text));
  EXCEPTION WHEN lock_not_available THEN
    RAISE EXCEPTION 'BRR-074: in-flight writes did not finish in time' USING ERRCODE = '55P03';
  END;
  PERFORM set_config('lock_timeout', '0', true);
  v_drift := public.br_check_schema_drift();
  IF coalesce((v_drift ->> 'drift_detected')::boolean, true) THEN
    RAISE EXCEPTION 'BRR-073: schema drift detected' USING ERRCODE = '55000';
  END IF;
  IF p_job.schema_fingerprint IS DISTINCT FROM public._br_rs_schema_fp() THEN
    RAISE EXCEPTION 'BRR-073: schema changed since verification' USING ERRCODE = '55000';
  END IF;
END $$;

-- ===== Demande d'exécution et maintenance =====
CREATE OR REPLACE FUNCTION public._br_rs_request_execute(p_job uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; v_enabled boolean;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT c.enabled INTO v_enabled FROM public._br_restore_config c WHERE c.id = 1;
  IF NOT coalesce(v_enabled, false) THEN
    RAISE EXCEPTION 'BRR-000: restore engine disabled' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._br_rs_actor_ok(p_actor, j.tenant_id) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;
  IF j.status <> 'prepared' THEN
    RAISE EXCEPTION 'BRR-003: job is %', j.status USING ERRCODE = '55000';
  END IF;
  IF j.execute_requested_at IS NOT NULL THEN
    RAISE EXCEPTION 'BRR-004: execution already requested' USING ERRCODE = '55006';
  END IF;
  UPDATE public._br_restore_jobs SET execute_requested_at = now(), execute_requested_by = p_actor, updated_at = now()
   WHERE id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'prepared', 'execute_requested', true, 'scope', 'all_sites');
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_enter_maintenance(p_job uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE; v_ttl integer; v_owner uuid;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['prepared']);
  IF j.execute_requested_at IS NULL THEN
    RAISE EXCEPTION 'BRR-005: execution was not requested' USING ERRCODE = '55000';
  END IF;
  SELECT c.maintenance_ttl_seconds INTO v_ttl FROM public._br_restore_config c WHERE c.id = 1;
  INSERT INTO public._br_tenant_maintenance AS m (tenant_id, job_id, started_at, expires_at)
  VALUES (j.tenant_id, j.id, clock_timestamp(), clock_timestamp() + make_interval(secs => v_ttl))
  ON CONFLICT (tenant_id) DO UPDATE SET job_id = EXCLUDED.job_id, started_at = EXCLUDED.started_at, expires_at = EXCLUDED.expires_at
    WHERE m.job_id = EXCLUDED.job_id OR m.expires_at <= clock_timestamp();
  SELECT m.job_id INTO v_owner FROM public._br_tenant_maintenance m WHERE m.tenant_id = j.tenant_id;
  IF v_owner IS DISTINCT FROM j.id THEN
    RAISE EXCEPTION 'BRR-002: tenant already in maintenance for another job' USING ERRCODE = '55006';
  END IF;
  RETURN jsonb_build_object('job_id', p_job, 'maintenance', true);
END $$;

-- ===== Restauration atomique =====
CREATE OR REPLACE FUNCTION public._br_rs_swap(p_job uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j public._br_restore_jobs%ROWTYPE; t record; s record;
  v_safety jsonb; v_before jsonb; v_seq jsonb; v_prof jsonb; v_counters jsonb; v_kept jsonb := '{}'::jsonb;
  v_fill boolean; v_n bigint; v_rows bigint; v_chk text; v_def text[]; v_keys text[]; v_prof_set integer; v_deleted bigint := 0;
  v_inserted bigint := 0; v_err text; v_state text; v_report jsonb;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['prepared']);
  IF j.operation <> 'restore' THEN RAISE EXCEPTION 'BRR-003: not a restore job' USING ERRCODE = '55000'; END IF;
  BEGIN
    PERFORM public._br_rs_exec_preflight(j);
    v_safety := public._br_rs_take_safety(j.id, j.tenant_id);
    INSERT INTO public._br_restore_context (backend_pid, xact_id, tenant_id, job_id)
    VALUES (pg_backend_pid(), txid_current(), j.tenant_id, j.id)
    ON CONFLICT (backend_pid) DO UPDATE SET xact_id = EXCLUDED.xact_id, tenant_id = EXCLUDED.tenant_id, job_id = EXCLUDED.job_id;

    SELECT jsonb_object_agg(c.doc_kind, c.last_number) INTO v_before FROM public.tenant_doc_counters c WHERE c.tenant_id = j.tenant_id;
    SELECT jsonb_object_agg(a.journal_type || '|' || a.fiscal_year, a.last_number) INTO v_seq
    FROM public.accounting_sequences a WHERE a.tenant_id = j.tenant_id;
    SELECT jsonb_object_agg(p.id::text, p.default_site_id) INTO v_prof
    FROM public.profiles p WHERE p.tenant_id = j.tenant_id AND p.default_site_id IS NOT NULL;
    v_fill := EXISTS (SELECT 1 FROM public._br_restore_tables WHERE job_id = j.id AND table_name = 'cash_registers'
                      AND presence = 'historically_absent');

    FOR t IN SELECT g.table_name FROM public._br_table_registry g
             WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect')
             ORDER BY g.restore_order DESC, g.table_name DESC LOOP
      EXECUTE format('DELETE FROM public.%I t WHERE %s', t.table_name, public._br_rs_tenant_pred(t.table_name, 't')) USING j.tenant_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_deleted := v_deleted + v_n;
    END LOOP;

    FOR t IN SELECT rt.table_name, rt.presence, rt.expected_rows, rt.keys, g.category, g.deferred_fk_columns
             FROM public._br_restore_tables rt
             JOIN public._br_table_registry g ON g.schema_name = 'public' AND g.table_name = rt.table_name
             WHERE rt.job_id = j.id ORDER BY rt.restore_order, rt.table_name LOOP
      IF t.presence = 'archived' AND t.expected_rows > 0 THEN
        v_def := ARRAY(SELECT c FROM unnest(coalesce(t.deferred_fk_columns, '{}')) c WHERE c = ANY (t.keys));
        v_n := public._br_rs_insert_table(j.id, t.table_name, 'stage', t.keys, v_def, false,
                                          v_fill AND t.table_name = 'cash_sessions');
        v_inserted := v_inserted + v_n;
      ELSIF t.presence = 'historically_absent' AND t.category = 'structure' THEN
        SELECT array_agg(k) INTO v_keys FROM jsonb_object_keys((
          SELECT sf.row_data FROM public._br_restore_safety sf
          WHERE sf.job_id = j.id AND sf.table_name = t.table_name ORDER BY sf.ord LIMIT 1)) k;
        v_n := CASE WHEN v_keys IS NULL THEN 0
                    ELSE public._br_rs_insert_table(j.id, t.table_name, 'safety', v_keys, '{}', true, false) END;
        SELECT st.rows INTO v_rows FROM public._br_restore_safety_tables st WHERE st.job_id = j.id AND st.table_name = t.table_name;
        v_kept := v_kept || jsonb_build_object(t.table_name, jsonb_build_object('before', v_rows, 'kept', v_n));
      END IF;
      IF v_fill AND t.table_name = 'cash_registers' THEN
        FOR s IN SELECT st.id FROM public.sites st WHERE st.tenant_id = j.tenant_id ORDER BY st.id LOOP
          PERFORM public._ensure_default_cash_register(j.tenant_id, s.id);
        END LOOP;
      END IF;
    END LOOP;

    FOR t IN SELECT rt.table_name, rt.keys, g.deferred_fk_columns FROM public._br_restore_tables rt
             JOIN public._br_table_registry g ON g.schema_name = 'public' AND g.table_name = rt.table_name
             WHERE rt.job_id = j.id AND rt.presence = 'archived' AND rt.expected_rows > 0
               AND coalesce(cardinality(g.deferred_fk_columns), 0) > 0 LOOP
      PERFORM public._br_rs_apply_deferred(j.id, t.table_name,
        ARRAY(SELECT c FROM unnest(t.deferred_fk_columns) c WHERE c = ANY (t.keys)));
    END LOOP;

    v_counters := public._br_rs_fix_counters(j.tenant_id, v_before, v_seq);

    UPDATE public.profiles p SET default_site_id = (v_prof ->> p.id::text)::uuid
     WHERE p.tenant_id = j.tenant_id AND p.default_site_id IS NULL AND v_prof ? p.id::text
       AND EXISTS (SELECT 1 FROM public.sites st WHERE st.id = (v_prof ->> p.id::text)::uuid AND st.tenant_id = j.tenant_id);
    GET DIAGNOSTICS v_prof_set = ROW_COUNT;

    FOR t IN SELECT rt.table_name, rt.presence, rt.expected_rows, rt.expected_checksum, g.category
             FROM public._br_restore_tables rt
             JOIN public._br_table_registry g ON g.schema_name = 'public' AND g.table_name = rt.table_name
             WHERE rt.job_id = j.id LOOP
      SELECT l.o_rows, l.o_checksum INTO v_rows, v_chk FROM public._br_rs_live_state(t.table_name, j.tenant_id) l;
      IF t.presence = 'archived' THEN
        IF t.table_name IN ('tenant_doc_counters', 'accounting_sequences') THEN
          IF v_rows < t.expected_rows THEN
            RAISE EXCEPTION 'BRR-077: % has % rows, archive %', t.table_name, v_rows, t.expected_rows USING ERRCODE = 'XX000';
          END IF;
        ELSIF v_rows <> t.expected_rows THEN
          RAISE EXCEPTION 'BRR-077: % has % rows, archive %', t.table_name, v_rows, t.expected_rows USING ERRCODE = 'XX000';
        ELSIF j.source_format = 3 AND v_chk IS DISTINCT FROM t.expected_checksum THEN
          RAISE EXCEPTION 'BRR-077: % content differs from archive', t.table_name USING ERRCODE = 'XX000';
        END IF;
      ELSIF t.category = 'structure' THEN
        IF v_rows < coalesce((v_kept -> t.table_name ->> 'kept')::bigint, 0)
           OR (t.table_name <> 'cash_registers' AND v_rows <> coalesce((v_kept -> t.table_name ->> 'kept')::bigint, 0)) THEN
          RAISE EXCEPTION 'BRR-077: % kept rows mismatch', t.table_name USING ERRCODE = 'XX000';
        END IF;
      ELSIF v_rows <> 0 THEN
        RAISE EXCEPTION 'BRR-077: historically absent table % is not empty', t.table_name USING ERRCODE = 'XX000';
      END IF;
    END LOOP;

    INSERT INTO public._br_tenant_epoch (tenant_id, changed_at, job_id) VALUES (j.tenant_id, clock_timestamp(), j.id)
    ON CONFLICT (tenant_id) DO UPDATE SET changed_at = EXCLUDED.changed_at, job_id = EXCLUDED.job_id;
    DELETE FROM public._br_tenant_maintenance WHERE tenant_id = j.tenant_id AND job_id = j.id;
    DELETE FROM public._br_restore_context WHERE backend_pid = pg_backend_pid();

    v_report := jsonb_build_object('safety', v_safety, 'deleted_rows', v_deleted, 'inserted_rows', v_inserted,
      'kept_historically_absent', v_kept, 'counters', v_counters, 'default_site_restored', v_prof_set,
      'default_site_cleared', coalesce((SELECT count(*) FROM jsonb_object_keys(coalesce(v_prof, '{}'::jsonb))), 0) - v_prof_set);
    UPDATE public._br_restore_jobs
       SET status = 'succeeded', swap_report = v_report, finished_at = clock_timestamp(),
           lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = j.id;
    DELETE FROM public._br_restore_rows WHERE job_id = j.id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    RETURN public._br_rs_fail(j.id, coalesce(substring(v_err from '^(BRR?-[0-9]{3})'), 'BRR-079'), v_err,
      jsonb_build_object('phase', 'swap', 'sqlstate', v_state, 'message', left(v_err, 500)));
  END;
  RETURN jsonb_build_object('job_id', j.id, 'status', 'succeeded', 'report', v_report);
END $$;

-- ===== Réinitialisation transactionnelle (tout le tenant, structure conservée) =====
CREATE OR REPLACE FUNCTION public._br_rs_state_excluding(p_table text, p_tenant uuid, p_cols text[])
RETURNS text LANGUAGE plpgsql STABLE SET search_path = public, pg_temp AS $$
DECLARE v_order text; v_out text;
BEGIN
  SELECT o.order_sql INTO v_order FROM public._br_capture_order(format('public.%I', p_table)::regclass, 't') o;
  EXECUTE format('SELECT count(*)::text || '':'' || coalesce(md5(string_agg(md5((to_jsonb(t) - $2)::text), '''' ORDER BY %s)), '''') '
                 'FROM public.%I t WHERE %s', v_order, p_table, public._br_rs_tenant_pred(p_table, 't'))
    INTO v_out USING p_tenant, coalesce(p_cols, '{}');
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_reset_run(p_job uuid, p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  j public._br_restore_jobs%ROWTYPE; t record; v_safety jsonb; v_before jsonb := '{}'::jsonb; v_cols text[];
  v_zero CONSTANT jsonb := '{"customers":["balance","updated_at"],"suppliers":["balance","updated_at"],
    "vaults":["current_balance","updated_at"],"mt_accounts":["balance","updated_at"],
    "stock_levels":["quantity","reserved","updated_at"]}'::jsonb;
  v_n bigint; v_deleted jsonb := '{}'::jsonb; v_zeroed jsonb := '{}'::jsonb; v_err text; v_state text; v_report jsonb;
BEGIN
  j := public._br_rs_lock(p_job, p_token, ARRAY['prepared']);
  IF j.operation <> 'reset' THEN RAISE EXCEPTION 'BRR-003: not a reset job' USING ERRCODE = '55000'; END IF;
  BEGIN
    PERFORM public._br_rs_exec_preflight(j);
    v_safety := public._br_rs_take_safety(j.id, j.tenant_id);
    INSERT INTO public._br_restore_context (backend_pid, xact_id, tenant_id, job_id)
    VALUES (pg_backend_pid(), txid_current(), j.tenant_id, j.id)
    ON CONFLICT (backend_pid) DO UPDATE SET xact_id = EXCLUDED.xact_id, tenant_id = EXCLUDED.tenant_id, job_id = EXCLUDED.job_id;

    FOR t IN SELECT g.table_name FROM public._br_table_registry g
             WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect')
               AND NOT (g.reset_behavior = 'delete' AND g.table_name <> 'tenant_doc_counters') AND g.table_name <> 'stock_lots' LOOP
      v_cols := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_zero -> t.table_name, '[]'::jsonb)));
      v_before := v_before || jsonb_build_object(t.table_name, public._br_rs_state_excluding(t.table_name, j.tenant_id, v_cols));
    END LOOP;
    v_before := v_before || jsonb_build_object('profiles',
      (SELECT count(*)::text || ':' || coalesce(md5(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.id)), '')
       FROM public.profiles p WHERE p.tenant_id = j.tenant_id));

    FOR t IN SELECT g.table_name FROM public._br_table_registry g
             WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect')
               AND ((g.reset_behavior = 'delete' AND g.table_name <> 'tenant_doc_counters') OR g.table_name = 'stock_lots')
             ORDER BY g.restore_order DESC, g.table_name DESC LOOP
      EXECUTE format('DELETE FROM public.%I t WHERE %s', t.table_name, public._br_rs_tenant_pred(t.table_name, 't')) USING j.tenant_id;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      IF v_n > 0 THEN v_deleted := v_deleted || jsonb_build_object(t.table_name, v_n); END IF;
    END LOOP;

    UPDATE public.customers SET balance = 0 WHERE tenant_id = j.tenant_id AND balance IS DISTINCT FROM 0;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('customers', v_n);
    UPDATE public.suppliers SET balance = 0 WHERE tenant_id = j.tenant_id AND balance IS DISTINCT FROM 0;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('suppliers', v_n);
    UPDATE public.vaults SET current_balance = 0 WHERE tenant_id = j.tenant_id AND current_balance IS DISTINCT FROM 0;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('vaults', v_n);
    UPDATE public.mt_accounts SET balance = 0 WHERE tenant_id = j.tenant_id AND balance IS DISTINCT FROM 0;
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('mt_accounts', v_n);
    UPDATE public.stock_levels SET quantity = 0, reserved = 0
     WHERE tenant_id = j.tenant_id AND (quantity IS DISTINCT FROM 0 OR reserved IS DISTINCT FROM 0);
    GET DIAGNOSTICS v_n = ROW_COUNT; v_zeroed := v_zeroed || jsonb_build_object('stock_levels', v_n);

    FOR t IN SELECT g.table_name FROM public._br_table_registry g
             WHERE g.schema_name = 'public' AND g.tenant_link IN ('direct','indirect')
               AND ((g.reset_behavior = 'delete' AND g.table_name <> 'tenant_doc_counters') OR g.table_name = 'stock_lots') LOOP
      EXECUTE format('SELECT count(*) FROM public.%I t WHERE %s', t.table_name, public._br_rs_tenant_pred(t.table_name, 't'))
        INTO v_n USING j.tenant_id;
      IF v_n <> 0 THEN RAISE EXCEPTION 'BRR-078: % still has % rows', t.table_name, v_n USING ERRCODE = 'XX000'; END IF;
    END LOOP;
    FOR t IN SELECT e.key AS table_name, e.value #>> '{}' AS state FROM jsonb_each(v_before) e WHERE e.key <> 'profiles' LOOP
      v_cols := ARRAY(SELECT jsonb_array_elements_text(coalesce(v_zero -> t.table_name, '[]'::jsonb)));
      IF public._br_rs_state_excluding(t.table_name, j.tenant_id, v_cols) IS DISTINCT FROM t.state THEN
        RAISE EXCEPTION 'BRR-078: preserved table % changed (cascade or trigger)', t.table_name USING ERRCODE = 'XX000';
      END IF;
    END LOOP;
    IF (SELECT count(*)::text || ':' || coalesce(md5(string_agg(md5(to_jsonb(p)::text), '' ORDER BY p.id)), '')
        FROM public.profiles p WHERE p.tenant_id = j.tenant_id) IS DISTINCT FROM v_before ->> 'profiles' THEN
      RAISE EXCEPTION 'BRR-078: profiles changed' USING ERRCODE = 'XX000';
    END IF;
    IF EXISTS (SELECT 1 FROM public.customers WHERE tenant_id = j.tenant_id AND balance <> 0)
       OR EXISTS (SELECT 1 FROM public.suppliers WHERE tenant_id = j.tenant_id AND balance <> 0)
       OR EXISTS (SELECT 1 FROM public.vaults WHERE tenant_id = j.tenant_id AND current_balance <> 0)
       OR EXISTS (SELECT 1 FROM public.mt_accounts WHERE tenant_id = j.tenant_id AND balance <> 0)
       OR EXISTS (SELECT 1 FROM public.stock_levels WHERE tenant_id = j.tenant_id AND (quantity <> 0 OR reserved <> 0)) THEN
      RAISE EXCEPTION 'BRR-078: a balance is not zero after reset' USING ERRCODE = 'XX000';
    END IF;

    INSERT INTO public._br_tenant_epoch (tenant_id, changed_at, job_id) VALUES (j.tenant_id, clock_timestamp(), j.id)
    ON CONFLICT (tenant_id) DO UPDATE SET changed_at = EXCLUDED.changed_at, job_id = EXCLUDED.job_id;
    DELETE FROM public._br_tenant_maintenance WHERE tenant_id = j.tenant_id AND job_id = j.id;
    DELETE FROM public._br_restore_context WHERE backend_pid = pg_backend_pid();
    v_report := jsonb_build_object('safety', v_safety, 'deleted', v_deleted, 'zeroed', v_zeroed, 'scope', 'all_sites');
    UPDATE public._br_restore_jobs
       SET status = 'succeeded', swap_report = v_report, finished_at = clock_timestamp(),
           lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
     WHERE id = j.id;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT, v_state = RETURNED_SQLSTATE;
    RETURN public._br_rs_fail(j.id, coalesce(substring(v_err from '^(BRR?-[0-9]{3})'), 'BRR-079'), v_err,
      jsonb_build_object('phase', 'reset', 'sqlstate', v_state, 'message', left(v_err, 500)));
  END;
  RETURN jsonb_build_object('job_id', j.id, 'status', 'succeeded', 'report', v_report);
END $$;

-- ===== Libération, abandon, reprise après crash =====
CREATE OR REPLACE FUNCTION public._br_rs_release(p_job uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n integer;
BEGIN
  PERFORM public._br_rs_assert_server();
  DELETE FROM public._br_tenant_maintenance WHERE job_id = p_job;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('job_id', p_job, 'released', v_n);
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_abandon(p_job uuid, p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE j public._br_restore_jobs%ROWTYPE;
BEGIN
  PERFORM public._br_rs_assert_server();
  SELECT * INTO j FROM public._br_restore_jobs WHERE id = p_job FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BRR-404: job not found' USING ERRCODE = 'P0002'; END IF;
  IF NOT public._br_rs_actor_ok(p_actor, j.tenant_id) THEN
    RAISE EXCEPTION 'BRR-403: actor is not owner or super_admin of this tenant' USING ERRCODE = '42501';
  END IF;
  IF j.status NOT IN ('preparing','prepared') THEN
    RAISE EXCEPTION 'BRR-003: job is %', j.status USING ERRCODE = '55000';
  END IF;
  IF j.lease_expires_at IS NOT NULL AND j.lease_expires_at > clock_timestamp() THEN
    RAISE EXCEPTION 'BRR-060: job is leased by a worker' USING ERRCODE = '55006';
  END IF;
  UPDATE public._br_restore_jobs SET status = 'abandoned', finished_at = clock_timestamp(),
         lease_token = NULL, lease_owner = NULL, lease_expires_at = NULL, updated_at = now()
   WHERE id = p_job;
  DELETE FROM public._br_restore_rows WHERE job_id = p_job;
  DELETE FROM public._br_restore_blocks WHERE job_id = p_job;
  DELETE FROM public._br_tenant_maintenance WHERE job_id = p_job;
  RETURN jsonb_build_object('job_id', p_job, 'status', 'abandoned');
END $$;

CREATE OR REPLACE FUNCTION public._br_rs_recover()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_maint integer; v_ctx integer;
BEGIN
  PERFORM public._br_rs_assert_server();
  DELETE FROM public._br_tenant_maintenance m
   WHERE m.expires_at <= clock_timestamp()
      OR NOT EXISTS (SELECT 1 FROM public._br_restore_jobs j WHERE j.id = m.job_id AND j.status = 'prepared'
                     AND j.lease_expires_at > clock_timestamp());
  GET DIAGNOSTICS v_maint = ROW_COUNT;
  DELETE FROM public._br_restore_context c
   WHERE NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.pid = c.backend_pid);
  GET DIAGNOSTICS v_ctx = ROW_COUNT;
  RETURN jsonb_build_object('released_maintenance', v_maint, 'stale_contexts', v_ctx);
END $$;

-- ===== Orchestrateur côté serveur (indépendant d'une requête HTTP ; aucune planification installée) =====
CREATE OR REPLACE PROCEDURE public._br_rs_executor(p_job uuid, p_worker text, INOUT p_result jsonb DEFAULT NULL)
LANGUAGE plpgsql AS $$
DECLARE v_claim jsonb; v_tok uuid; v_r jsonb; v_status text; v_op text; v_fmt integer; v_req timestamptz;
BEGIN
  v_claim := public._br_rs_claim(p_job, p_worker);
  v_tok := (v_claim ->> 'token')::uuid;
  COMMIT;
  SELECT j.status, j.operation, j.source_format INTO v_status, v_op, v_fmt FROM public._br_restore_jobs j WHERE j.id = p_job;
  IF v_status = 'preparing' AND v_fmt = 2 THEN
    LOOP
      v_r := public._br_rs_load_v2(p_job, v_tok, 5);
      COMMIT;
      IF v_r ->> 'status' = 'failed' THEN p_result := v_r; RETURN; END IF;
      EXIT WHEN (v_r ->> 'done')::boolean;
    END LOOP;
    v_r := public._br_rs_verify(p_job, v_tok);
    COMMIT;
    IF v_r ->> 'status' <> 'prepared' THEN p_result := v_r; RETURN; END IF;
  ELSIF v_status = 'preparing' THEN
    PERFORM public._br_rs_unlease(p_job, v_tok);
    COMMIT;
    p_result := jsonb_build_object('job_id', p_job, 'status', 'preparing', 'awaiting', 'v3_block_worker');
    RETURN;
  END IF;
  SELECT j.execute_requested_at INTO v_req FROM public._br_restore_jobs j WHERE j.id = p_job;
  IF v_req IS NULL THEN
    PERFORM public._br_rs_unlease(p_job, v_tok);
    COMMIT;
    p_result := jsonb_build_object('job_id', p_job, 'status', 'prepared', 'awaiting', 'execute_request');
    RETURN;
  END IF;
  PERFORM public._br_rs_enter_maintenance(p_job, v_tok);
  COMMIT;
  IF v_op = 'reset' THEN v_r := public._br_rs_reset_run(p_job, v_tok);
  ELSE v_r := public._br_rs_swap(p_job, v_tok);
  END IF;
  COMMIT;
  PERFORM public._br_rs_release(p_job);
  COMMIT;
  p_result := v_r;
END $$;

-- ===== Droits : rien pour PUBLIC/anon/authenticated ; API serveur pour service_role =====
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig, p.proname::text AS name, p.prokind
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname LIKE '\_br\_rs\_%' OR p.proname IN ('_br_gate', '_br_gate_check', '_br_lotd_install_hooks',
           '_br_lotd_hooks_status', '_br_restore_jobs_guard', '_br_restore_safety_guard'))
  LOOP
    EXECUTE format('REVOKE ALL ON %s %s FROM PUBLIC, anon, authenticated',
                   CASE WHEN f.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, f.sig);
    IF f.name IN ('_br_rs_request_restore', '_br_rs_request_reset', '_br_rs_claim', '_br_rs_unlease', '_br_rs_fail_job',
                  '_br_rs_load_v2', '_br_rs_v3_plan', '_br_rs_v3_manifest', '_br_rs_v3_load_block', '_br_rs_verify',
                  '_br_rs_request_execute', '_br_rs_enter_maintenance', '_br_rs_swap', '_br_rs_reset_run',
                  '_br_rs_release', '_br_rs_abandon', '_br_rs_recover', '_br_lotd_hooks_status', '_br_rs_executor') THEN
      EXECUTE format('GRANT EXECUTE ON %s %s TO service_role',
                     CASE WHEN f.prokind = 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END, f.sig);
    END IF;
  END LOOP;
END $$;
-- Évaluée dans les clauses WHEN des déclencheurs pour tout rôle ; ne révèle que l'état de la transaction courante.
GRANT EXECUTE ON FUNCTION public._br_restore_bypass() TO PUBLIC;
