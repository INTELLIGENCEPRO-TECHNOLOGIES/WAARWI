-- Candidat : registre des retours/lots et protection du préflight v2.
-- Les archives antérieures restent lisibles si aucune donnée de ces tables ne serait perdue.
-- Aucun déverrouillage de la restauration ; le moteur complet doit être recetté séparément.
INSERT INTO public._br_table_registry(schema_name,table_name,tenant_link,tenant_id_column,category,restore_order,reset_behavior,is_mandatory)
VALUES ('public','quote_conversion_stock_trace','direct','tenant_id','operation',85,'delete',false),
 ('public','sale_return_lot_allocations','direct','tenant_id','operation',96,'delete',false)
ON CONFLICT(schema_name,table_name) DO NOTHING;
DO $patch$
DECLARE src text; anchor text:=$old$SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$old$; replacement text;
BEGIN
 IF (SELECT count(*) FROM public._br_table_registry WHERE schema_name='public' AND table_name IN ('quote_conversion_stock_trace','sale_return_lot_allocations') AND tenant_link='direct' AND tenant_id_column='tenant_id' AND category='operation' AND reset_behavior='delete' AND is_mandatory=false AND restore_order=CASE table_name WHEN 'quote_conversion_stock_trace' THEN 85 ELSE 96 END)<>2 THEN RAISE EXCEPTION 'Registre de sauvegarde incohérent';END IF;
 src:=pg_get_functiondef('public.br_preflight_restore(uuid)'::regprocedure);
 IF (length(src)-length(replace(src,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Définition préflight inattendue';END IF;
 replacement:=$new$-- Ne pas effacer silencieusement les affectations historiques.
FOR v_rec IN SELECT r.schema_name,r.table_name,r.tenant_id_column FROM public._br_table_registry r
 WHERE r.schema_name='public' AND r.tenant_link='direct'
 AND r.table_name IN ('quote_conversion_stock_trace','sale_return_lot_allocations')
 AND jsonb_typeof(v_backup.payload->r.table_name) IS DISTINCT FROM 'array'
LOOP
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I.%I WHERE %I=$1)',v_rec.schema_name,v_rec.table_name,v_rec.tenant_id_column) INTO v_has_accounting_rows USING v_tenant_id;
 IF v_has_accounting_rows THEN
  v_issues:=v_issues||jsonb_build_array(jsonb_build_object('code','RETURN_TRACE_MISSING','severity','fatal','table',v_rec.table_name,'message','Sauvegarde incompatible : traçabilité des retours existante absente du fichier.'));
 END IF;
END LOOP;
SELECT EXISTS (
SELECT 1 FROM jsonb_array_elements(v_issues) AS iss WHERE iss->>'severity' = 'fatal'
) INTO v_has_fatal;$new$;
 EXECUTE replace(src,anchor,replacement);
END $patch$;
