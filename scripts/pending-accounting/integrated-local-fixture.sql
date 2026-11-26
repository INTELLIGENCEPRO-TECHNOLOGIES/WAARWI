-- Only the disposable, network-isolated GitHub Actions database.
-- Never execute on a hosted Supabase instance.
BEGIN;
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
 EXECUTE 'RESET ROLE';
 IF (SELECT count(*) FROM public.journal_lines WHERE tenant_id=t)<>110 THEN RAISE EXCEPTION 'Jeu comptable incomplet';END IF;
END $fixture$;
COMMIT;
SELECT 'FIXTURE_COMPTABLE_110_LIGNES_OK' AS resultat;
