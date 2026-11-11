/*
# Lot A — A1/A4 : accès aux sauvegardes, paramètres, droits excédentaires, protection de la dernière sauvegarde vérifiée

1. tenant_backups
- Lecture et suppression réservées au propriétaire du tenant ou au super_admin rattaché (`_br_can_manage_backups`).
- Le contenu (payload, manifest, checksums) n'est plus lisible directement : privilèges colonne limités aux
  métadonnées. Téléchargement via la nouvelle RPC `br_download_backup(uuid)` (même contrôle + tenant).
- Retrait de INSERT/UPDATE/TRUNCATE/REFERENCES/TRIGGER pour authenticated et de tout privilège pour anon.
- Nouveau déclencheur BEFORE DELETE `trg_br_protect_latest_verified` : refuse la suppression de la sauvegarde
  vérifiée la plus récente d'un tenant (BR-022), pour tous les chemins (UI, service, rotation).
  - Exception : suppression en cascade d'un tenant (ligne tenant déjà absente).
  - Verrou consultatif transactionnel par tenant : sérialise les suppressions concurrentes.
  - Aucune règle de conservation nouvelle (pas de « sécurité 30 jours »), rotation actuelle inchangée.

2. tenant_backup_settings
- SELECT/INSERT/UPDATE réservés au propriétaire ou super_admin ; anon sans privilège ; DELETE/TRUNCATE retirés.

3. Tables internes du planificateur et de l'externalisation
- `_br_schedule_policy`, `_br_schedule_runs`, `_br_schedule_run_items`, `_br_tenant_schedule_override`,
  `_br_offsite_config`, `_br_offsite_transfers` : tout privilège retiré à anon/authenticated
  (RLS sans politique : aucun usage applicatif ; TRUNCATE n'était pas couvert par RLS). service_role conservé.

4. Notes
- Aucune donnée supprimée ni modifiée. Sauvegardes existantes et rotation préservées.
*/

DROP POLICY IF EXISTS tenant_backups_select ON public.tenant_backups;
CREATE POLICY tenant_backups_select ON public.tenant_backups FOR SELECT TO authenticated
  USING (public._br_can_manage_backups(tenant_id));
DROP POLICY IF EXISTS tenant_backups_delete ON public.tenant_backups;
CREATE POLICY tenant_backups_delete ON public.tenant_backups FOR DELETE TO authenticated
  USING (public._br_can_manage_backups(tenant_id));

REVOKE ALL ON public.tenant_backups FROM anon, authenticated;
GRANT SELECT (id, tenant_id, created_at, created_by, label, kind, is_auto, size_bytes, format_version,
  schema_fingerprint, row_counts, global_checksum, verified_at, error_message, status, job_id)
  ON public.tenant_backups TO authenticated;
GRANT DELETE ON public.tenant_backups TO authenticated;

DROP POLICY IF EXISTS tenant_backup_settings_select ON public.tenant_backup_settings;
CREATE POLICY tenant_backup_settings_select ON public.tenant_backup_settings FOR SELECT TO authenticated
  USING (public._br_can_manage_backups(tenant_id));
DROP POLICY IF EXISTS tenant_backup_settings_insert ON public.tenant_backup_settings;
CREATE POLICY tenant_backup_settings_insert ON public.tenant_backup_settings FOR INSERT TO authenticated
  WITH CHECK (public._br_can_manage_backups(tenant_id));
DROP POLICY IF EXISTS tenant_backup_settings_update ON public.tenant_backup_settings;
CREATE POLICY tenant_backup_settings_update ON public.tenant_backup_settings FOR UPDATE TO authenticated
  USING (public._br_can_manage_backups(tenant_id)) WITH CHECK (public._br_can_manage_backups(tenant_id));

REVOKE ALL ON public.tenant_backup_settings FROM anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.tenant_backup_settings FROM authenticated;

REVOKE ALL ON public._br_schedule_policy, public._br_schedule_runs, public._br_schedule_run_items,
  public._br_tenant_schedule_override, public._br_offsite_config, public._br_offsite_transfers
  FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.br_download_backup(p_backup_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp SET statement_timeout = '60s' AS $$
DECLARE
  v_tenant uuid := public.current_tenant_id();
  v_res jsonb;
BEGIN
  PERFORM public._br_assert_backup_admin(v_tenant);
  SELECT jsonb_build_object(
    'payload', b.payload, 'created_at', b.created_at, 'label', b.label,
    'format_version', b.format_version, 'checksums', b.checksums,
    'global_checksum', b.global_checksum, 'row_counts', b.row_counts)
  INTO v_res
  FROM public.tenant_backups b
  WHERE b.id = p_backup_id AND b.tenant_id = v_tenant;
  IF v_res IS NULL THEN
    RAISE EXCEPTION 'BR-404: Sauvegarde introuvable' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_res;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.br_download_backup(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.br_download_backup(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public._br_protect_latest_verified_backup()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_latest uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM 'verified' THEN RETURN OLD; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id) THEN RETURN OLD; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('br_backup_delete:' || OLD.tenant_id::text, 0));
  SELECT b.id INTO v_latest FROM public.tenant_backups b
  WHERE b.tenant_id = OLD.tenant_id AND b.status = 'verified'
  ORDER BY b.created_at DESC, b.id DESC LIMIT 1;
  IF v_latest = OLD.id THEN
    RAISE EXCEPTION 'La dernière sauvegarde vérifiée ne peut pas être supprimée.'
      USING ERRCODE = '42501', HINT = 'BR-022';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._br_protect_latest_verified_backup() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_br_protect_latest_verified ON public.tenant_backups;
CREATE TRIGGER trg_br_protect_latest_verified BEFORE DELETE ON public.tenant_backups
  FOR EACH ROW EXECUTE FUNCTION public._br_protect_latest_verified_backup();
