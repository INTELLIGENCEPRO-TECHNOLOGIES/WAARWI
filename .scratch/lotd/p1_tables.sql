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
