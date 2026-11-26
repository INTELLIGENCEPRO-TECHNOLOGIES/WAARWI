BEGIN;
DO $test$
DECLARE t1 uuid:=gen_random_uuid();t2 uuid:=gen_random_uuid();u1 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();s1 uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();p1 uuid:=gen_random_uuid();p2 uuid:=gen_random_uuid();n int;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t1,'RECETTE RLS GLOBAL 1','[]','{}'),(t2,'RECETTE RLS GLOBAL 2','[]','{}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u1,u1::text||'@example.invalid','authenticated','authenticated'),(u2,u2::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u1,t1,'admin','all','RLS 1',true),(u2,t2,'admin','all','RLS 2',true);
 INSERT INTO public.suppliers(id,tenant_id,name) VALUES(s1,t1,'Fournisseur 1'),(s2,t2,'Fournisseur 2');
 INSERT INTO public.payment_methods(id,tenant_id,name,code,payment_type,is_active) VALUES(p1,t1,'Espèces','CASH','cash',true),(p2,t2,'Espèces','CASH','cash',true);
 PERFORM set_config('request.jwt.claim.sub',u1::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 IF (SELECT count(*) FROM public.suppliers WHERE id IN(s1,s2))<>1 OR NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=s1) THEN RAISE EXCEPTION 'Isolation fournisseurs incorrecte';END IF;
 IF (SELECT count(*) FROM public.payment_methods WHERE id IN(p1,p2))<>1 OR NOT EXISTS(SELECT 1 FROM public.payment_methods WHERE id=p1) THEN RAISE EXCEPTION 'Isolation modes de paiement incorrecte';END IF;
 UPDATE public.suppliers SET name='Interdit' WHERE id=s2;GET DIAGNOSTICS n=ROW_COUNT;IF n<>0 THEN RAISE EXCEPTION 'Modification étrangère';END IF;
 UPDATE public.suppliers SET name='Fournisseur 1 corrigé' WHERE id=s1;GET DIAGNOSTICS n=ROW_COUNT;IF n<>1 THEN RAISE EXCEPTION 'Modification autorisée refusée';END IF;
 BEGIN INSERT INTO public.suppliers(tenant_id,name) VALUES(t2,'Interdit');RAISE EXCEPTION 'Insertion étrangère acceptée';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 IF (SELECT name FROM public.suppliers WHERE id=s2)<>'Fournisseur 2' THEN RAISE EXCEPTION 'Autre tenant altéré';END IF;
END $test$;
ROLLBACK;
SELECT 'RLS_GLOBAL_OK' AS resultat;