-- Run in the disposable accounting replay database after the synthetic fixture.
BEGIN;

DO $recipe$
DECLARE
  t uuid;
  admin_id uuid;
  cashier_id uuid := gen_random_uuid();
  other_tenant uuid;
  template_id uuid;
  historical_id uuid;
  result jsonb;
  count_before bigint;
  due date := (now() AT TIME ZONE 'Africa/Dakar')::date;
  model_name text := 'Recette modèle ' || gen_random_uuid();
  configured_lines jsonb := '[
    {"account_code":"5210000","account_rule":"fixed","label_rule":"input","amount_rule":"input","amount_side":"debit"},
    {"account_rule":"repeat","label_rule":"repeat","amount_rule":"repeat","amount_side":"debit"},
    {"account_code":"7010000","account_rule":"fixed","label_rule":"repeat","amount_rule":"balance","amount_side":"auto"}
  ]';
  historical_lines jsonb := '[
    {"account_code":"5210000","label":"Règle ancienne","debit":125,"credit":0},
    {"account_code":"7010000","label":"Règle ancienne","debit":0,"credit":125}
  ]';
BEGIN
  SELECT id INTO STRICT t FROM public.tenants WHERE name = 'TEST COMPTA';
  SELECT id INTO STRICT other_tenant FROM public.tenants WHERE name = 'TEST COMPTA ISOLEMENT';
  SELECT id INTO STRICT admin_id FROM public.profiles WHERE tenant_id = t AND role = 'admin' AND is_active;
  SELECT count(*) INTO count_before FROM public.journal_entries WHERE tenant_id = t;

  IF has_function_privilege('anon', 'public.write_accounting_entry_template(uuid,uuid,bigint,text,text,text,jsonb)', 'EXECUTE')
    OR has_table_privilege('authenticated', 'public.accounting_entry_templates', 'INSERT,UPDATE') THEN
    RAISE EXCEPTION 'Droits directs inattendus sur les modèles.';
  END IF;

  INSERT INTO auth.users(id,email,aud,role) VALUES(cashier_id,cashier_id::text||'@example.invalid','authenticated','authenticated');
  INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active)
    VALUES(cashier_id,t,'cashier','all','Consultation fictive',true)
    ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id, role=excluded.role, site_access_mode=excluded.site_access_mode, is_active=true;
  INSERT INTO public.role_permissions (tenant_id,role,permissions)
    VALUES (t,'cashier','{"view_accounting":true,"manage_accounting":false}'::jsonb)
    ON CONFLICT(tenant_id,role) DO UPDATE SET permissions=excluded.permissions;
  PERFORM set_config('request.jwt.claim.sub', admin_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',admin_id,'role','authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  result := public.write_accounting_entry_template(t, NULL, NULL, model_name, NULL, 'Recette globale', configured_lines);
  template_id := (result->>'id')::uuid;
  IF result->>'revision' IS DISTINCT FROM '1' OR NOT EXISTS (
    SELECT FROM public.accounting_entry_templates et WHERE et.id = template_id AND et.journal_code IS NULL
      AND et.lines @> '[{"account_rule":"repeat","label_rule":"repeat","amount_rule":"repeat","amount_side":"debit"}]'::jsonb
      AND et.lines @> '[{"amount_rule":"balance","amount_side":"auto"}]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Portée globale ou règles du modèle incorrectes.';
  END IF;

  BEGIN
    PERFORM public.schedule_accounting_entry_template(t, template_id, due, 1);
    RAISE EXCEPTION 'Récurrence acceptée pour un modèle global.';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.write_accounting_entry_template(other_tenant, NULL, NULL, model_name, NULL, 'Autre entreprise', configured_lines);
    RAISE EXCEPTION 'Création autorisée dans une autre entreprise.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.write_accounting_entry_template(t, NULL, NULL, model_name, 'ZZZ', 'Journal inexistant', configured_lines);
    RAISE EXCEPTION 'Journal inexistant accepté.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.write_accounting_entry_template(t, NULL, NULL, model_name, 'OD', 'Règle incohérente',
      jsonb_set(configured_lines, '{0,account_rule}', '"repeat"'));
    RAISE EXCEPTION 'Répétition acceptée sur la première ligne.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.write_accounting_entry_template(t, NULL, NULL, model_name, 'OD', 'Deux contreparties',
      jsonb_set(configured_lines, '{1,amount_rule}', '"balance"'));
    RAISE EXCEPTION 'Deux lignes d’équilibrage acceptées.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  result := public.write_accounting_entry_template(t, template_id, 1, model_name, 'OD', 'Modèle modifié', configured_lines);
  IF result->>'revision' IS DISTINCT FROM '2' OR NOT EXISTS (
    SELECT FROM public.accounting_entry_templates et WHERE et.id = template_id AND et.journal_code = 'OD'
      AND et.description = 'Modèle modifié'
  ) THEN
    RAISE EXCEPTION 'Modification ou version du modèle incorrecte.';
  END IF;
  BEGIN
    PERFORM public.write_accounting_entry_template(t, template_id, 1, model_name, NULL, 'Révision obsolète', configured_lines);
    RAISE EXCEPTION 'Une version obsolète a modifié le modèle.';
  EXCEPTION WHEN serialization_failure THEN NULL;
  END;
  PERFORM public.schedule_accounting_entry_template(t, template_id, due, 2);
  BEGIN
    PERFORM public.write_accounting_entry_template(t, template_id, 3, model_name, NULL, 'Journal planifié', configured_lines);
    RAISE EXCEPTION 'Un modèle planifié a perdu son journal.';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  result := public.write_accounting_entry_template(t, template_id, 3, model_name, 'OD', 'Modèle planifié ajusté', configured_lines);
  IF result->>'revision' IS DISTINCT FROM '4' OR NOT EXISTS (
    SELECT FROM public.accounting_entry_templates et WHERE et.id = template_id AND et.next_due_on = due
  ) THEN
    RAISE EXCEPTION 'L’échéance a été perdue après modification.';
  END IF;

  result := public.save_accounting_entry_template(t, model_name || ' ancien', 'OD', 'Ancien modèle', historical_lines);
  historical_id := (result->>'id')::uuid;
  IF NOT EXISTS (
    SELECT FROM public.accounting_entry_templates et WHERE et.id = historical_id AND et.lines = historical_lines
  ) THEN
    RAISE EXCEPTION 'Incompatibilité avec les modèles existants.';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', cashier_id::text, true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub',cashier_id,'role','authenticated')::text, true);
  IF NOT EXISTS (SELECT FROM public.accounting_entry_templates et WHERE et.id = template_id) THEN
    RAISE EXCEPTION 'Un utilisateur de consultation ne voit pas ses modèles.';
  END IF;
  BEGIN
    PERFORM public.write_accounting_entry_template(t, template_id, 4, model_name, 'OD', 'Lecture seule', configured_lines);
    RAISE EXCEPTION 'Une personne en consultation peut modifier un modèle.';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  EXECUTE 'RESET ROLE';
  IF (SELECT count(*) FROM public.journal_entries WHERE tenant_id = t) <> count_before THEN
    RAISE EXCEPTION 'Le paramétrage a généré une écriture.';
  END IF;
END
$recipe$;

ROLLBACK;
