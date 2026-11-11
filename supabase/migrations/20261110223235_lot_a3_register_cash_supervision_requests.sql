/*
# Lot A — A3 : enregistrement de `cash_supervision_requests` dans le registre des sauvegardes

1. Entrée ajoutée à `_br_table_registry`
- schema `public`, lien `direct` via `tenant_id`, catégorie `operation`.
- restore_order 70 : après `cash_sessions` (50), dont elle dépend (FK cash_session_id ON DELETE CASCADE).
- reset_behavior `delete` (donnée opérationnelle, comme cash_sessions/cash_movements).
- is_mandatory = false : les sauvegardes antérieures ne contiennent pas cette table ; leur absence ne doit
  pas les rendre incompatibles. Une restauration depuis une ancienne sauvegarde la laissera vide pour le
  tenant (comportement à traiter explicitement au lot D, restauration toujours bloquée d'ici là).
- Pas d'auto-référence ni de FK différée.

2. Conflits
- Insertion explicite, sans ON CONFLICT DO NOTHING. Si une entrée existe déjà avec des valeurs différentes,
  la migration échoue avec le détail (aucune correction silencieuse). Entrée identique : aucun changement.
*/

DO $mig$
DECLARE
  r record;
BEGIN
  SELECT * INTO r FROM public._br_table_registry
  WHERE schema_name = 'public' AND table_name = 'cash_supervision_requests';

  IF NOT FOUND THEN
    INSERT INTO public._br_table_registry
      (schema_name, table_name, tenant_link, tenant_id_column, parent_table, category, restore_order,
       reset_behavior, self_ref_columns, is_mandatory, exclusion_reason, deferred_fk_columns)
    VALUES
      ('public', 'cash_supervision_requests', 'direct', 'tenant_id', NULL, 'operation', 70,
       'delete', '{}', false, NULL, '{}');
  ELSIF r.tenant_link IS DISTINCT FROM 'direct'
     OR r.tenant_id_column IS DISTINCT FROM 'tenant_id'
     OR r.parent_table IS NOT NULL
     OR r.category IS DISTINCT FROM 'operation'
     OR r.restore_order IS DISTINCT FROM 70
     OR r.reset_behavior IS DISTINCT FROM 'delete'
     OR r.self_ref_columns IS DISTINCT FROM '{}'::text[]
     OR r.is_mandatory IS DISTINCT FROM false
     OR r.deferred_fk_columns IS DISTINCT FROM '{}'::text[] THEN
    RAISE EXCEPTION 'Lot A: entrée de registre incompatible pour cash_supervision_requests: %', row_to_json(r);
  END IF;
END
$mig$;
