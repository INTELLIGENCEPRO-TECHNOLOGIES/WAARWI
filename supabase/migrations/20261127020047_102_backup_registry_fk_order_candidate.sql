-- Candidat 102 : ordre de restauration corrigé selon les FK constatées dans le schéma isolé.
-- N'affecte ni contenu des tables ni clés étrangères. Après 98. Recette avant toute migration finale.
UPDATE public._br_table_registry r SET restore_order=greatest(r.restore_order,v.ord)
FROM (VALUES ('expense_categories',11),('mt_commission_tiers',11),('part_categories',11),('shop_settings',11),
 ('mt_accounts',21),('mt_init_balances',21),('quotes',61),('cash_movements',81),('customer_payments',81),
 ('customer_prepayments',81),('sale_payments',81)) v(tbl,ord)
WHERE r.schema_name='public' AND r.table_name=v.tbl AND r.tenant_link IN ('direct','indirect');
-- Cycle IPM : facture_ipm_id est nullable et la FK d'origine utilise ON DELETE SET NULL.
DO $p$
DECLARE bad text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1] WHERE c.conname='ipm_bordereaux_facture_ipm_id_fkey' AND c.conrelid='public.ipm_bordereaux'::regclass AND c.confrelid='public.ipm_factures'::regclass AND cardinality(c.conkey)=1 AND a.attname='facture_ipm_id' AND NOT a.attnotnull AND c.confdeltype='n') THEN RAISE EXCEPTION 'Cycle IPM différent du schéma de recette';END IF;
 UPDATE public._br_table_registry SET deferred_fk_columns=array_append(coalesce(deferred_fk_columns,'{}'::text[]),'facture_ipm_id') WHERE schema_name='public' AND table_name='ipm_bordereaux' AND NOT 'facture_ipm_id'=ANY(coalesce(deferred_fk_columns,'{}'::text[]));
 SELECT string_agg(c.conname,', ' ORDER BY c.conname) INTO bad FROM pg_constraint c
 JOIN public._br_table_registry ch ON to_regclass(format('%I.%I',ch.schema_name,ch.table_name))=c.conrelid
 JOIN public._br_table_registry pa ON to_regclass(format('%I.%I',pa.schema_name,pa.table_name))=c.confrelid
 WHERE c.contype='f' AND c.conrelid<>c.confrelid AND ch.tenant_link IN ('direct','indirect') AND pa.tenant_link IN ('direct','indirect')
 AND (ch.restore_order,ch.table_name)<=(pa.restore_order,pa.table_name)
 AND NOT EXISTS(SELECT 1 FROM unnest(c.conkey) k(attnum) JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum WHERE a.attname=ANY(ch.deferred_fk_columns) AND NOT a.attnotnull);
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'Ordre de restauration non résolu : %',bad;END IF;
END $p$;
