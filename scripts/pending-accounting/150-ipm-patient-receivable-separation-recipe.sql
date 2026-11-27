BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();art uuid:=gen_random_uuid();cust uuid:=gen_random_uuid();org uuid:=gen_random_uuid();conv uuid:=gen_random_uuid();ben uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();iid uuid:=gen_random_uuid();normal uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();credit_id uuid:=gen_random_uuid();r jsonb;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE CREANCES IPM','[]','{}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Recette créances',true);
 INSERT INTO public.sites(id,tenant_id,name,is_active) VALUES(site,t,'Pharmacie fictive',true);
 INSERT INTO public.customers(id,tenant_id,name) VALUES(cust,t,'Client fictif');
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,track_stock,ipm_eligible) VALUES(art,t,'IPM-REC','Article éligible',10000,false,true);
 INSERT INTO public.ipm_organismes(id,tenant_id,nom) VALUES(org,t,'Organisme fictif');
 INSERT INTO public.ipm_conventions(id,tenant_id,organisme_id,nom,taux_defaut,mode_calcul,mode_arrondi) VALUES(conv,t,org,'Convention fictive',80,'articles_eligibles','round');
 INSERT INTO public.ipm_beneficiaires(id,tenant_id,customer_id,organisme_id,convention_id,matricule,statut) VALUES(ben,t,cust,org,conv,'REC-01','actif');
 INSERT INTO public.sales(id,tenant_id,site_id,user_id,customer_id,sale_number,subtotal,total,paid,status,source,vat_enabled_at_issue) VALUES(sid,t,site,u,cust,'IPM-REC-150',10000,10000,1500,'partial','billing',false),(normal,t,site,u,cust,'NORMAL-REC-150',3000,3000,0,'validated','billing',false);
 INSERT INTO public.sale_items(tenant_id,sale_id,article_id,name,quantity,unit_price,total,site_id) VALUES(t,sid,art,'Article éligible',1,10000,10000,site);
 INSERT INTO public.ipm_ventes(id,tenant_id,organisme_id,beneficiaire_id,convention_id,sale_id,part_ipm,part_client,montant_total,taux_prise_en_charge,montant_eligible,montant_non_eligible,part_beneficiaire_payee) VALUES(iid,t,org,ben,conv,sid,8000,2000,10000,80,10000,0,1500);
 INSERT INTO public.payment_methods(id,tenant_id,name,code,payment_type,is_active) VALUES(pm,t,'Espèces','CASH','cash',true);
 INSERT INTO public.sale_payments(tenant_id,sale_id,payment_method_id,method_name,amount,affects_balance) VALUES(t,sid,pm,'Espèces',1500,true);
 PERFORM public._ipm_capture_new_sale_snapshot(t,sid,iid);
 PERFORM set_config('request.jwt.claim.sub',u::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.recalculate_customer_balance(cust);
 IF (r->>'computed')::numeric<>3500 THEN RAISE EXCEPTION 'Créance patient et vente ordinaire incohérentes : %',r;END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT balance FROM public.customers WHERE id=cust)<>3500 OR (SELECT count(*) FROM public.sale_payments WHERE sale_id=sid)<>1 OR (SELECT sum(amount) FROM public.sale_payments WHERE sale_id=sid)<>1500 OR (SELECT part_ipm FROM public.ipm_ventes WHERE id=iid)<>8000 THEN RAISE EXCEPTION 'Créance organisme ou encaissement modifié';END IF;
 BEGIN UPDATE public.sales SET paid=2001 WHERE id=sid;RAISE EXCEPTION 'Surpaiement accepté';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 -- Credit 1,000: at most 500 can be allocated to the IPM invoice.
 INSERT INTO public.sale_returns(id,tenant_id,site_id,sale_id,customer_id,return_number,total,refund_method,status,restock) VALUES(credit_id,t,site,normal,cust,'RET-REC-150',1000,'avoir','approved',false);
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.apply_credit_to_sale(credit_id,sid,1000);
 IF r->>'success' IS DISTINCT FROM 'true' OR (r->>'applied')::numeric<>500 THEN RAISE EXCEPTION 'Imputation IPM incorrecte : %',r;END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT paid FROM public.sales WHERE id=sid)<>2000 OR (SELECT credit_used FROM public.sale_returns WHERE id=credit_id)<>500 OR (SELECT sum(amount) FROM public.sale_payments WHERE sale_id=sid AND affects_balance)<>1500 OR (SELECT part_ipm FROM public.ipm_ventes WHERE id=iid)<>8000 THEN RAISE EXCEPTION 'Imputation a consommé la créance organisme';END IF;
 PERFORM public._apply_avoirs_internal(cust,t);
 IF (SELECT paid FROM public.sales WHERE id=sid)<>2000 OR (SELECT paid FROM public.sales WHERE id=normal)<>500 OR (SELECT credit_used FROM public.sale_returns WHERE id=credit_id)<>1000 THEN RAISE EXCEPTION 'Le reliquat de l avoir ne suit pas le parcours normal';END IF;
 IF has_function_privilege('authenticated','public._ipm_patient_ceiling(uuid,uuid,numeric)','EXECUTE') OR has_function_privilege('anon','public._guard_ipm_patient_paid()','EXECUTE') THEN RAISE EXCEPTION 'Primitives privées exposées';END IF;
END $test$;
ROLLBACK;
SELECT 'CREANCES_IPM_PATIENT_OK' AS resultat;
