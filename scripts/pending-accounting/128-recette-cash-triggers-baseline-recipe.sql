-- Après 127 sur branche isolée.
BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();reg uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();m uuid:=gen_random_uuid();n text;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE GARDES CAISSE','[]','{}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Recette caisse',true);
 INSERT INTO public.sites(id,tenant_id,name,is_active) VALUES(site,t,'Magasin recette',true);
 INSERT INTO public.cash_registers(id,tenant_id,site_id,code,name) VALUES(reg,t,site,'REC','Caisse recette');
 INSERT INTO public.cash_sessions(id,tenant_id,site_id,user_id,cash_register_id,status,theoretical_amount) VALUES(cs,t,site,u,reg,'open',10000);
 BEGIN
  INSERT INTO public.cash_sessions(tenant_id,site_id,user_id,cash_register_id,status,theoretical_amount) VALUES(t,site,u,reg,'open',10000);
  RAISE EXCEPTION 'Deuxième caisse ouverte autorisée';
 EXCEPTION WHEN unique_violation THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 INSERT INTO public.cash_movements(id,tenant_id,site_id,cash_session_id,user_id,kind,amount,reason) VALUES(m,t,site,cs,u,'refund',100,'Retour recette');
 SELECT receipt_number INTO n FROM public.cash_movements WHERE id=m;
 IF n IS DISTINCT FROM 'RMB-00000001' THEN RAISE EXCEPTION 'Numéro reçu incorrect : %',n;END IF;
 UPDATE public.cash_sessions SET status='closed' WHERE id=cs;
 IF (SELECT closed_by FROM public.cash_sessions WHERE id=cs) IS DISTINCT FROM u THEN RAISE EXCEPTION 'Clôture non tracée';END IF;
END $test$;
ROLLBACK;
SELECT 'RECETTE_GARDES_CAISSE_OK' AS resultat;