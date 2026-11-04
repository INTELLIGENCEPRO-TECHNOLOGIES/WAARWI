/*
# Supervision de caisse : mise à jour du solde théorique lors d'une dépense supervisée

1. Modifié
- `_trg_cs_open_guard()` : le garde refusait la mise à jour du solde théorique par un non-propriétaire.
  Exception étroite ajoutée : autorisée uniquement si le marqueur transactionnel
  `waarwi.cs_supervised_expense` vaut l'identifiant de CETTE session (posé seulement par
  `cash_supervision_record_expense`), que la session est ouverte et que l'appelant peut superviser le site.
2. Sécurité
- Aucun autre champ ne devient modifiable ; aucun contournement général. Logique existante inchangée sinon.
*/
CREATE OR REPLACE FUNCTION public._trg_cs_open_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
v_uid uuid := auth.uid();
v_multi boolean;
v_changed text[];
BEGIN
IF NEW.status = 'open' AND (TG_OP = 'INSERT'
OR OLD.status IS DISTINCT FROM 'open'
OR NEW.site_id IS DISTINCT FROM OLD.site_id
OR NEW.user_id IS DISTINCT FROM OLD.user_id
OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id) THEN
PERFORM public._cs_lock_open_keys(NEW.tenant_id, NEW.site_id, NEW.user_id);
v_multi := public._cs_multi_enabled(NEW.tenant_id);
IF NOT v_multi THEN
IF EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.site_id = NEW.site_id AND cs.status = 'open' AND cs.id <> NEW.id) THEN
RAISE EXCEPTION 'duplicate key value violates unique constraint "idx_cash_sessions_one_open_per_site"'
USING ERRCODE = '23505', CONSTRAINT = 'idx_cash_sessions_one_open_per_site',
DETAIL = 'Key (site_id)=(' || NEW.site_id::text || ') already exists.';
END IF;
ELSE
IF NEW.user_id IS NULL THEN
RAISE EXCEPTION 'Une session de caisse doit avoir un opérateur' USING ERRCODE = '23514';
END IF;
IF EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.user_id = NEW.user_id AND cs.status = 'open' AND cs.id <> NEW.id) THEN
RAISE EXCEPTION 'Vous avez déjà une session de caisse ouverte. Clôturez-la avant d''en ouvrir une autre.' USING ERRCODE = '23505';
END IF;
END IF;
END IF;

IF TG_OP = 'UPDATE' AND v_uid IS NOT NULL
AND COALESCE(current_setting('waarwi.cs_close_session', true), '') <> OLD.id::text
AND public._cs_multi_enabled(OLD.tenant_id) THEN
SELECT array_agg(n.key ORDER BY n.key) INTO v_changed
FROM jsonb_each(to_jsonb(NEW)) n
WHERE n.value IS DISTINCT FROM (to_jsonb(OLD) -> n.key)
AND n.key NOT IN ('theoretical_amount', 'updated_at');
IF v_changed IS NOT NULL THEN
RAISE EXCEPTION 'En mode multi-caisse, une session ne peut être modifiée que par les opérations de caisse (%)', array_to_string(v_changed, ', ')
USING ERRCODE = '42501';
END IF;
IF NEW.theoretical_amount IS DISTINCT FROM OLD.theoretical_amount
AND (OLD.user_id IS DISTINCT FROM v_uid OR OLD.status <> 'open')
AND NOT (OLD.status = 'open'
  AND COALESCE(current_setting('waarwi.cs_supervised_expense', true), '') = OLD.id::text
  AND public._cs_profile_can_supervise_site(v_uid, OLD.site_id)) THEN
RAISE EXCEPTION 'Cette session de caisse appartient à un autre opérateur' USING ERRCODE = '42501';
END IF;
END IF;
RETURN NEW;
END;
$function$;