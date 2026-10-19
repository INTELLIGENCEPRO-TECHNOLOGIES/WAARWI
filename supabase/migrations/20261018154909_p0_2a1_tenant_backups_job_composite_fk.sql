/*
# P0-2A.1 — Intégrité multi-tenant entre sauvegardes et jobs

1. Modifications
- `_br_backup_jobs` : contrainte unique `_br_backup_jobs_tenant_id_id_key (tenant_id, id)`, cible de la FK composite.
- `tenant_backups` : la FK simple `tenant_backups_job_id_fkey (job_id) ON DELETE SET NULL` est remplacée par
  `tenant_backups_tenant_job_fkey (tenant_id, job_id) REFERENCES _br_backup_jobs (tenant_id, id) ON DELETE RESTRICT`.

2. Effets
- Une sauvegarde ne peut référencer que le job de son propre tenant, même par écriture directe de service_role.
- MATCH SIMPLE : les sauvegardes existantes avec job_id NULL restent valides et ne sont pas modifiées.
- ON DELETE RESTRICT : un job référencé ne peut pas être supprimé ; tenant_id n'est jamais mis à NULL.

3. Notes
- Aucune donnée modifiée (0 job existant, 0 sauvegarde liée au moment de la migration).
- Aucun changement de RLS, de privilèges, de fonctions ni de CRON.
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '_br_backup_jobs_tenant_id_id_key' AND conrelid = 'public._br_backup_jobs'::regclass) THEN
    ALTER TABLE public._br_backup_jobs ADD CONSTRAINT _br_backup_jobs_tenant_id_id_key UNIQUE (tenant_id, id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_backups_tenant_job_fkey' AND conrelid = 'public.tenant_backups'::regclass) THEN
    ALTER TABLE public.tenant_backups
      ADD CONSTRAINT tenant_backups_tenant_job_fkey
      FOREIGN KEY (tenant_id, job_id) REFERENCES public._br_backup_jobs (tenant_id, id)
      MATCH SIMPLE ON DELETE RESTRICT;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_backups_job_id_fkey' AND conrelid = 'public.tenant_backups'::regclass) THEN
    ALTER TABLE public.tenant_backups DROP CONSTRAINT tenant_backups_job_id_fkey;
  END IF;
END $$;