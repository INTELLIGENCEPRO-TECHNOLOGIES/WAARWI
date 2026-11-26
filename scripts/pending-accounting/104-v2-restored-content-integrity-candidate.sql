-- Candidat 104 : contrôle du contenu V2 après swap, avant validation de la transaction.
-- Compare le multiensemble des colonnes archivées, avec conversion typée PostgreSQL.
-- Les nouvelles colonnes absentes de l'archive ne sont pas comparées ; seules exceptions :
-- compteurs monotones et rattachement des anciennes sessions à la caisse par défaut.
CREATE FUNCTION public._br_rs_assert_v2_content(p_job uuid,p_tenant uuid,p_table text,p_fill boolean)
RETURNS void LANGUAGE plpgsql SET search_path TO public,pg_temp SET timezone TO 'UTC'
AS $f$
DECLARE keys text[]; projection text; expected text; mismatch boolean; keycols text[]; join_sql text;
BEGIN
 SELECT rt.keys INTO STRICT keys FROM public._br_restore_tables rt JOIN public._br_restore_jobs j ON j.id=rt.job_id
 WHERE rt.job_id=p_job AND rt.table_name=p_table AND rt.presence='archived' AND j.tenant_id=p_tenant AND j.source_format=2;
 IF cardinality(keys)=0 THEN RETURN;END IF;
 IF p_table IN ('tenant_doc_counters','accounting_sequences') THEN
  keycols:=CASE p_table WHEN 'tenant_doc_counters' THEN ARRAY['tenant_id','doc_kind'] ELSE ARRAY['tenant_id','journal_type','fiscal_year'] END;
  SELECT string_agg(format('x.%I IS NOT DISTINCT FROM p.%I',k,k),' AND ') INTO join_sql FROM unnest(keycols) k;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public._br_restore_rows r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%1$I,r.row_data) p WHERE r.job_id=$1 AND r.table_name=$2 AND NOT EXISTS(SELECT 1 FROM public.%1$I x WHERE %2$s AND x.last_number>=p.last_number))',p_table,join_sql) INTO mismatch USING p_job,p_table;
 ELSE
  SELECT string_agg(format('%L,x.%I',k,k),',' ORDER BY k) INTO projection FROM unnest(keys) k;
  SELECT string_agg(CASE WHEN p_fill AND p_table='cash_sessions' AND k='cash_register_id'
    THEN format('%L,coalesce(p.cash_register_id,(SELECT cr.id FROM public.cash_registers cr WHERE cr.tenant_id=p.tenant_id AND cr.site_id=p.site_id ORDER BY cr.is_default DESC,cr.created_at LIMIT 1))',k)
    ELSE format('%L,p.%I',k,k) END,',' ORDER BY k) INTO expected FROM unnest(keys) k;
  EXECUTE format('WITH live AS (SELECT jsonb_build_object(%s) AS row FROM public.%I x WHERE %s), archived AS (SELECT jsonb_build_object(%s) AS row FROM public._br_restore_rows r CROSS JOIN LATERAL jsonb_populate_record(NULL::public.%I,r.row_data) p WHERE r.job_id=$2 AND r.table_name=$3) SELECT EXISTS((SELECT row FROM live EXCEPT ALL SELECT row FROM archived) UNION ALL (SELECT row FROM archived EXCEPT ALL SELECT row FROM live))',projection,p_table,public._br_rs_tenant_pred(p_table,'x'),expected,p_table) INTO mismatch USING p_tenant,p_job,p_table;
 END IF;
 IF mismatch THEN RAISE EXCEPTION 'BRR-077: % restored content differs from verified V2 archive',p_table USING ERRCODE='XX000';END IF;
END $f$;
REVOKE ALL ON FUNCTION public._br_rs_assert_v2_content(uuid,uuid,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public._br_rs_swap(uuid,uuid)'::regprocedure);
 a:=$a$      IF t.presence = 'archived' THEN
        IF t.table_name IN ('tenant_doc_counters', 'accounting_sequences') THEN$a$;
 b:=$b$      IF t.presence = 'archived' THEN
        IF j.source_format=2 THEN PERFORM public._br_rs_assert_v2_content(j.id,j.tenant_id,t.table_name,v_fill);END IF;
        IF t.table_name IN ('tenant_doc_counters', 'accounting_sequences') THEN$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre intégrité V2 inattendue : %',n;END IF;
 EXECUTE replace(src,a,b);
END $p$;
