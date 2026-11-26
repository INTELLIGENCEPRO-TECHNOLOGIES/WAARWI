-- Only the disposable, network-isolated GitHub Actions database.
-- Never execute on a hosted Supabase instance.
BEGIN;
-- Provisioning ONLY for synthetic businesses in the isolated runner.
CREATE SCHEMA waarwi_recipe;
REVOKE ALL ON SCHEMA waarwi_recipe FROM PUBLIC,anon,authenticated;
CREATE FUNCTION waarwi_recipe.provision_enterprise(t uuid) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, extensions, pg_catalog AS $local$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.tenants WHERE id=t AND name LIKE 'RECETTE%') THEN
  RAISE EXCEPTION 'Identité de recette non reconnue';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.plans WHERE code='enterprise' AND limits->>'sites'='-1') THEN
  RAISE EXCEPTION 'Plan entreprise historique absent ou incompatible';
 END IF;
 UPDATE public.tenants SET plan='enterprise',selected_plan_code='enterprise' WHERE id=t;
 INSERT INTO public.accounts(tenant_id,code,name,class,account_type,is_active)
 SELECT t,v.code,v.name,v.cl,v.typ,true FROM (VALUES ('1310000','Résultat bénéficiaire',1,'general'),('1390000','Résultat déficitaire',1,'general'),('5210000','Banque',5,'general'),('5710000','Caisse',5,'general'),('6010000','Achats',6,'general'),('6580000','Charges diverses',6,'general'),('7010000','Ventes',7,'general')) v(code,name,cl,typ)
 ON CONFLICT(tenant_id,code) DO UPDATE SET name=excluded.name,class=excluded.class,account_type=excluded.account_type,is_active=true;
 -- Provision the actual collective accounts and role mappings before customer creation.
 INSERT INTO public.accounts(tenant_id,code,name,class,account_type,is_active)
 SELECT t,v.code,v.name,v.cl,'general',true FROM (VALUES
 ('1200000','Report à nouveau',1),('3110000','Stocks de marchandises',3),
 ('4010000','Fournisseurs',4),('4110000','Clients',4),('4431000','TVA facturée',4),
 ('4456000','TVA récupérable',4),('7580000','Produits divers',7)) v(code,name,cl)
 ON CONFLICT(tenant_id,code) DO UPDATE SET name=excluded.name,class=excluded.class,account_type=excluded.account_type,is_active=true;
 INSERT INTO public.accounting_account_mappings(tenant_id,role_code,account_id)
 SELECT t,v.role_code,a.id FROM (VALUES
 ('BANK_DEFAULT','5210000'),('CARRY_FORWARD','1200000'),('CASH_DEFAULT','5710000'),
 ('CUSTOMER_CONTROL','4110000'),('SUPPLIER_CONTROL','4010000'),('INVENTORY_GOODS','3110000'),
 ('MISC_EXPENSE','6580000'),('MISC_INCOME','7580000'),('PURCHASES_GOODS','6010000'),
 ('RESULT_LOSS','1390000'),('RESULT_PROFIT','1310000'),('SALES_GOODS','7010000'),
 ('VAT_INPUT','4456000'),('VAT_OUTPUT','4431000')) v(role_code,code)
 JOIN public.accounts a ON a.tenant_id=t AND a.code=v.code AND a.is_active
 ON CONFLICT(tenant_id,role_code) DO UPDATE SET account_id=excluded.account_id;
 IF (SELECT count(*) FROM public.accounting_account_mappings WHERE tenant_id=t)<>14 OR public.resolve_account(t,'CUSTOMER_CONTROL') IS DISTINCT FROM '4110000' THEN
 RAISE EXCEPTION 'Paramétrage comptable de recette incomplet'; END IF;

END $local$;
REVOKE ALL ON FUNCTION waarwi_recipe.provision_enterprise(uuid) FROM PUBLIC,anon,authenticated;

DO $fixture$
DECLARE t uuid:=gen_random_uuid(); other uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); c uuid:=gen_random_uuid(); dt date:=(now() AT TIME ZONE 'Africa/Dakar')::date; win uuid:=gen_random_uuid(); tok uuid; result jsonb; i int;
BEGIN
 IF EXISTS(SELECT 1 FROM public.tenants WHERE name='TEST COMPTA') THEN RAISE EXCEPTION 'La base de recette doit être vierge'; END IF;
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'TEST COMPTA','["accounting"]','{}'),(other,'TEST COMPTA ISOLEMENT','["accounting"]','{}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Comptable fictif',true) ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id,role=excluded.role,site_access_mode=excluded.site_access_mode,is_active=true;
 INSERT INTO public.accounts(tenant_id,code,name,class,account_type,is_active)
 SELECT t,v.code,v.name,v.cl,v.typ,true FROM (VALUES ('1310000','Résultat bénéficiaire',1,'general'),('1390000','Résultat déficitaire',1,'general'),('4119901','Client fictif',4,'auxiliary'),('5210000','Banque',5,'general'),('5710000','Caisse',5,'general'),('6010000','Achats',6,'general'),('6580000','Charges diverses',6,'general'),('7010000','Ventes',7,'general')) v(code,name,cl,typ)
 ON CONFLICT(tenant_id,code) DO UPDATE SET name=excluded.name,class=excluded.class,account_type=excluded.account_type,is_active=true;
 -- Provision the actual collective accounts and role mappings before customer creation.
 INSERT INTO public.accounts(tenant_id,code,name,class,account_type,is_active)
 SELECT t,v.code,v.name,v.cl,'general',true FROM (VALUES
 ('1200000','Report à nouveau',1),('3110000','Stocks de marchandises',3),
 ('4010000','Fournisseurs',4),('4110000','Clients',4),('4431000','TVA facturée',4),
 ('4456000','TVA récupérable',4),('7580000','Produits divers',7)) v(code,name,cl)
 ON CONFLICT(tenant_id,code) DO UPDATE SET name=excluded.name,class=excluded.class,account_type=excluded.account_type,is_active=true;
 INSERT INTO public.accounting_account_mappings(tenant_id,role_code,account_id)
 SELECT t,v.role_code,a.id FROM (VALUES
 ('BANK_DEFAULT','5210000'),('CARRY_FORWARD','1200000'),('CASH_DEFAULT','5710000'),
 ('CUSTOMER_CONTROL','4110000'),('SUPPLIER_CONTROL','4010000'),('INVENTORY_GOODS','3110000'),
 ('MISC_EXPENSE','6580000'),('MISC_INCOME','7580000'),('PURCHASES_GOODS','6010000'),
 ('RESULT_LOSS','1390000'),('RESULT_PROFIT','1310000'),('SALES_GOODS','7010000'),
 ('VAT_INPUT','4456000'),('VAT_OUTPUT','4431000')) v(role_code,code)
 JOIN public.accounts a ON a.tenant_id=t AND a.code=v.code AND a.is_active
 ON CONFLICT(tenant_id,role_code) DO UPDATE SET account_id=excluded.account_id;
 IF (SELECT count(*) FROM public.accounting_account_mappings WHERE tenant_id=t)<>14 OR public.resolve_account(t,'CUSTOMER_CONTROL') IS DISTINCT FROM '4110000' THEN
 RAISE EXCEPTION 'Paramétrage comptable de recette incomplet'; END IF;
 INSERT INTO public.customers(id,tenant_id,name,account_code,balance) VALUES(c,t,'Client recette comptable','4119901',0);
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 -- 110 lignes courantes, toutes équilibrées, via le vrai RPC et son verrou.
 FOR i IN 1..55 LOOP
  tok:=(public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(dt,'YYYY-MM'),win,'acquire')->>'token')::uuid;
  result:=public.post_locked_manual_entry(t,'OD',dt,'Pièce fictive de recette','FIXTURE-'||i,jsonb_build_array(jsonb_build_object('account_code','5210000','debit',100+i,'credit',0),jsonb_build_object('account_code','7010000','debit',0,'credit',100+i)),gen_random_uuid(),win,tok);
  IF result->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Échec génération pièce fictive %',i; END IF;
 END LOOP;
 result:=public.document_edit_lease(t,'accounting_journal','OD'||':'||to_char(dt,'YYYY-MM'),win,'release',tok);
 IF result->>'state' IS DISTINCT FROM 'free' THEN RAISE EXCEPTION 'Verrou de préparation non libéré'; END IF;
 EXECUTE 'RESET ROLE';
 IF EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=t) THEN RAISE EXCEPTION 'Verrou résiduel de préparation'; END IF;
 IF (SELECT count(*) FROM public.journal_lines WHERE tenant_id=t)<>110 THEN RAISE EXCEPTION 'Jeu comptable incomplet';END IF;
END $fixture$;
COMMIT;
SELECT 'FIXTURE_COMPTABLE_110_LIGNES_OK' AS resultat;
