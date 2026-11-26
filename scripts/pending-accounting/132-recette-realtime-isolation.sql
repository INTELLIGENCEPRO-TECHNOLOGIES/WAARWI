-- Après installation validée de 131, exclusivement sur la branche isolée.
-- Aucun contournement des permissions du service Realtime.
BEGIN;
DO $test$
DECLARE t1 uuid:=gen_random_uuid();t2 uuid:=gen_random_uuid();u1 uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();c1 uuid:=gen_random_uuid();c2 uuid:=gen_random_uuid();c3 uuid:=gen_random_uuid();a int;b int;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t1,'RECETTE SYNC 1','[]','{}'),(t2,'RECETTE SYNC 2','[]','{}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u1,u1::text||'@example.invalid','authenticated','authenticated'),(u2,u2::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u1,t1,'admin','all','Sync 1',true),(u2,t2,'admin','all','Sync 2',true);
 INSERT INTO public.customers(id,tenant_id,name) VALUES(c1,t1,'Client 1'),(c2,t2,'Client 2'),(c3,t1,'Client 3');
 SELECT count(*) INTO a FROM realtime.messages WHERE topic='waarwi:tenant:'||t1::text AND event='data_changed' AND payload->>'table'='customers';
 SELECT count(*) INTO b FROM realtime.messages WHERE topic='waarwi:tenant:'||t2::text AND event='data_changed' AND payload->>'table'='customers';
 IF a<>1 OR b<>1 THEN RAISE EXCEPTION 'Notification insert par tenant : %, %',a,b;END IF;
 UPDATE public.customers SET name=name||' corrigé' WHERE id IN(c1,c2,c3);
 IF (SELECT count(*) FROM realtime.messages WHERE topic='waarwi:tenant:'||t1::text AND event='data_changed' AND payload->>'table'='customers')<>2 OR (SELECT count(*) FROM realtime.messages WHERE topic='waarwi:tenant:'||t2::text AND event='data_changed' AND payload->>'table'='customers')<>2 THEN RAISE EXCEPTION 'Notification update non groupée';END IF;
 IF EXISTS(SELECT 1 FROM realtime.messages WHERE topic IN('waarwi:tenant:'||t1::text,'waarwi:tenant:'||t2::text) AND event='data_changed' AND payload->>'table'='customers' AND (NOT private OR payload - 'table' - 'id' <> '{}'::jsonb)) THEN RAISE EXCEPTION 'Message non privé ou données métier divulguées';END IF;
 PERFORM set_config('request.jwt.claim.sub',u1::text,true);
 PERFORM set_config('realtime.topic','waarwi:tenant:'||t1::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF (SELECT count(*) FROM realtime.messages WHERE topic='waarwi:tenant:'||t1::text AND event='data_changed' AND payload->>'table'='customers')<>2 THEN RAISE EXCEPTION 'Réception propre tenant refusée';END IF;
 PERFORM set_config('realtime.topic','waarwi:tenant:'||t2::text,true);
 IF EXISTS(SELECT 1 FROM realtime.messages WHERE topic='waarwi:tenant:'||t2::text) THEN RAISE EXCEPTION 'Réception inter-tenant autorisée';END IF;
 EXECUTE 'RESET ROLE';
 PERFORM set_config('request.jwt.claim.sub',u2::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF (SELECT count(*) FROM realtime.messages WHERE topic='waarwi:tenant:'||t2::text AND event='data_changed' AND payload->>'table'='customers')<>2 THEN RAISE EXCEPTION 'Réception tenant 2 refusée';END IF;
 EXECUTE 'RESET ROLE';
END $test$;
ROLLBACK;
SELECT 'SYNC_PRIVEE_SQL_OK' AS resultat;