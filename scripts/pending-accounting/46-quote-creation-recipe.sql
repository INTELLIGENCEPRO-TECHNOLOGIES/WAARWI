BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();site uuid:=gen_random_uuid();req uuid:=gen_random_uuid();req2 uuid:=gen_random_uuid();res jsonb;first_id uuid;items jsonb:='[{"name":"Prestation recette","quantity":2,"unit_price":1000,"discount":100}]';
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules) VALUES(t,'RECETTE CREATION DEVIS','[]');
 INSERT INTO auth.users(id,email,aud,role) SELECT id,id::text||'@example.invalid','authenticated','authenticated' FROM unnest(ARRAY[u,u2]) id;
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Commercial A',true),(u2,t,'admin','all','Commercial B',true) ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id,role=excluded.role,site_access_mode=excluded.site_access_mode,full_name=excluded.full_name,is_active=true;
 INSERT INTO public.sites(id,tenant_id,name,is_active) VALUES(site,t,'Magasin recette',true);
 PERFORM set_config('request.jwt.claim.sub',u::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.create_quote_atomic(t,site,NULL,NULL,'','{}',NULL,jsonb_set(items,'{0,quantity}','0'),req);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Quantité nulle acceptée';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 res:=public.create_quote_atomic(t,site,NULL,NULL,'','{}',NULL,items,req);first_id:=(res->'quote'->>'id')::uuid;
 IF res->>'success' IS DISTINCT FROM 'true' OR res->>'already_created' IS DISTINCT FROM 'false' OR res->'quote'->>'quote_number' IS DISTINCT FROM 'DEV-00001' OR (res->'quote'->>'total')::numeric<>1900 THEN RAISE EXCEPTION 'Création incohérente';END IF;
 res:=public.create_quote_atomic(t,site,NULL,NULL,'','{}',NULL,items,req);
 IF res->>'already_created' IS DISTINCT FROM 'true' OR (res->'quote'->>'id')::uuid IS DISTINCT FROM first_id THEN RAISE EXCEPTION 'Réessai non idempotent';END IF;
 BEGIN PERFORM public.create_quote_atomic(t,site,NULL,NULL,'Changement','{}',NULL,items,req);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Même identifiant autre contenu';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',u2::text,true);
 BEGIN PERFORM public.create_quote_atomic(t,site,NULL,NULL,'','{}',NULL,items,req);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Clé autre utilisateur acceptée';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 res:=public.create_quote_atomic(t,site,NULL,NULL,'','{}',NULL,items,req2);
 IF res->'quote'->>'quote_number' IS DISTINCT FROM 'DEV-00002' THEN RAISE EXCEPTION 'Numérotation incorrecte';END IF;
 BEGIN UPDATE public.quotes SET total=1 WHERE id=first_id;RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Modification directe autorisée';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN INSERT INTO public.quote_items(tenant_id,quote_id,name,quantity,unit_price,total) VALUES(t,first_id,'Contournement',1,1,1);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Ajout direct autorisé';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 EXECUTE 'RESET ROLE';
 IF (SELECT count(*) FROM public.quotes WHERE tenant_id=t)<>2 OR (SELECT count(*) FROM public.quote_items WHERE tenant_id=t)<>2 OR (SELECT last_number FROM public.tenant_doc_counters WHERE tenant_id=t AND doc_kind='quote')<>2 THEN RAISE EXCEPTION 'Doublons ou compteur incohérent';END IF;
 IF has_function_privilege('anon','public.create_quote_atomic(uuid,uuid,uuid,date,text,jsonb,uuid,jsonb,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Accès anonyme autorisé';END IF;
END $test$;
ROLLBACK;
