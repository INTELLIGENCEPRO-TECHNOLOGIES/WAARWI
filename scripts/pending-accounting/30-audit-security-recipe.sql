-- Run after all pending schema scripts, exclusively in a test database.
DO $audit$
DECLARE t text; c regclass; bad text; expected_tables text[]:=ARRAY[
 'accounting_journal_settings','accounting_entry_templates','accounting_template_occurrences','accounting_line_due_dates',
 'accounting_cycle_reviews','accounting_fixed_assets','accounting_asset_depreciations','accounting_analytic_axes',
 'accounting_analytic_centers','accounting_analytic_budgets','accounting_analytic_allocations'];
BEGIN
 FOREACH t IN ARRAY expected_tables LOOP
  c:=to_regclass('public.'||t);
  IF c IS NULL OR NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=c AND relrowsecurity) THEN RAISE EXCEPTION 'RLS absente : %',t; END IF;
  IF has_table_privilege('anon',c,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated',c,'INSERT,UPDATE,DELETE,TRUNCATE') THEN RAISE EXCEPTION 'Droits directs excessifs : %',t; END IF;
  IF NOT has_table_privilege('authenticated',c,'SELECT') THEN RAISE EXCEPTION 'Lecture authentifiée absente : %',t; END IF;
  IF NOT EXISTS(SELECT 1 FROM public._br_table_registry WHERE schema_name='public' AND table_name=t AND tenant_link='direct') THEN RAISE EXCEPTION 'Table non sauvegardée : %',t; END IF;
 END LOOP;
 SELECT string_agg(child.table_name||' -> '||parent.table_name,', ') INTO bad
 FROM pg_constraint fk
 JOIN public._br_table_registry child ON fk.conrelid=to_regclass(format('%I.%I',child.schema_name,child.table_name))
 JOIN public._br_table_registry parent ON fk.confrelid=to_regclass(format('%I.%I',parent.schema_name,parent.table_name))
 WHERE fk.contype='f' AND child.table_name=ANY(expected_tables) AND child.restore_order<=parent.restore_order;
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'Ordre de restauration incorrect : %',bad;END IF;
 IF has_function_privilege('anon','public.export_accounting_entries(uuid,date,date,text,integer,integer)','EXECUTE') THEN RAISE EXCEPTION 'Export accessible à anon';END IF;
 IF has_table_privilege('authenticated','public.accounting_sequences','INSERT,UPDATE,DELETE,TRUNCATE') OR has_table_privilege('anon','public.accounting_sequences','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Compteurs accessibles directement';END IF;
 IF NOT has_function_privilege('authenticated','public.export_accounting_entries(uuid,date,date,text,integer,integer)','EXECUTE') THEN RAISE EXCEPTION 'Export autorisé indisponible';END IF;
END $audit$;
