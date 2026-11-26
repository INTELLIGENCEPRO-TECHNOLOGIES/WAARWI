-- Exécuter après 125 sur base isolée uniquement.
BEGIN;
DO $test$
DECLARE t1 uuid:=gen_random_uuid();t2 uuid:=gen_random_uuid();u1 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();s1 uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();a1 uuid:=gen_random_uuid();a2 uuid:=gen_random_uuid();c1 uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();n int;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t1,'RECETTE RLS 1','[]','{}'),(t2,'RECETTE RLS 2','[]','{}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u1,u1::text||'@example.invalid','authenticated','authenticated'),(u2,u2::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u1,t1,'admin','all','RLS 1',true),(u2,t2,'admin','all','RLS 2',true);
 INSERT INTO public.sites(id,tenant_id,name,is_active) VALUES(s1,t1,'Magasin 1',true),(s2,t2,'Magasin 2',true);
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,track_stock) VALUES(a1,t1,'A1','Article 1',100,true),(a2,t2,'A2','Article 2',200,true);
 INSERT INTO public.customers(id,tenant_id,name) VALUES(c1,t1,'Client 1'),(c2,t2,'Client 2');
 PERFORM set_config('request.jwt.claim.sub',u1::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF (SELECT count(*) FROM public.customers WHERE id IN(c1,c2))<>1 OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=c1) OR EXISTS(SELECT 1 FROM public.customers WHERE id=c2) THEN RAISE EXCEPTION 'Isolation clients invalide';END IF;
 IF (SELECT count(*) FROM public.articles WHERE id IN(a1,a2))<>1 OR NOT EXISTS(SELECT 1 FROM public.articles WHERE id=a1) THEN RAISE EXCEPTION 'Isolation articles invalide';END IF;
 UPDATE public.customers SET name='Modification étrangère' WHERE id=c2;GET DIAGNOSTICS n=ROW_COUNT;IF n<>0 THEN RAISE EXCEPTION 'Modification inter-tenant autorisée';END IF;
 BEGIN INSERT INTO public.customers(tenant_id,name) VALUES(t2,'Interdit');RAISE EXCEPTION 'Insertion inter-tenant autorisée';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 UPDATE public.customers SET name='Client 1 corrigé' WHERE id=c1;GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'Modification légitime refusée';END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT name FROM public.customers WHERE id=c2)<>'Client 2' THEN RAISE EXCEPTION 'Client étranger modifié';END IF;
 PERFORM set_config('request.jwt.claim.sub','',true);EXECUTE 'SET LOCAL ROLE anon';
 IF EXISTS(SELECT 1 FROM public.articles WHERE id IN(a1,a2)) THEN RAISE EXCEPTION 'Article privé visible anonymement';END IF;
 EXECUTE 'RESET ROLE';
END $test$;
ROLLBACK;
SELECT 'RECETTE_RLS_COMMERCIAL_OK' AS resultat;