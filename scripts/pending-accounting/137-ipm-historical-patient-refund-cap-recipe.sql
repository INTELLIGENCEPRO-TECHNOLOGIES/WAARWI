BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();art uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();li uuid:=gen_random_uuid();org uuid:=gen_random_uuid();ipm uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();ret1 uuid:=gen_random_uuid();ret2 uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();r jsonb;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE PLAFOND IPM','[]','{}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Recette IPM',true);
 INSERT INTO public.sites(id,tenant_id,name,is_active) VALUES(site,t,'Pharmacie fictive',true);
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,track_stock) VALUES(art,t,'IPM-ART','Article recette',1000,true);
 INSERT INTO public.sales(id,tenant_id,site_id,user_id,sale_number,subtotal,total,paid,status,source,vat_enabled_at_issue) VALUES(sid,t,site,u,'IPM-REC-01',10000,10000,7000,'partial','invoice',false);
 INSERT INTO public.sale_items(id,tenant_id,sale_id,article_id,name,quantity,unit_price,total,site_id) VALUES(li,t,sid,art,'Article recette',10,1000,10000,site);
 INSERT INTO public.ipm_organismes(id,tenant_id,nom) VALUES(org,t,'IPM fictive');
 INSERT INTO public.ipm_ventes(id,tenant_id,organisme_id,invoice_id,part_ipm,part_client,montant_total,part_beneficiaire_payee) VALUES(ipm,t,org,sid,6400,3600,10000,600);
 INSERT INTO public.cash_sessions(id,tenant_id,site_id,user_id,status,theoretical_amount) VALUES(cs,t,site,u,'open',10000);
 INSERT INTO public.sale_returns(id,tenant_id,site_id,sale_id,user_id,return_number,total,refund_method,status,restock) VALUES(ret1,t,site,sid,u,'RET-IPM-01',2000,'none','pending',false),(ret2,t,site,sid,u,'RET-IPM-02',600,'none','pending',false);
 IF public._nonvat_cash_refund_limit(t,sid,NULL)<>600 THEN RAISE EXCEPTION 'Prise en charge confondue avec règlement patient';END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN
  PERFORM public.process_sale_return(sid,site,cs,jsonb_build_array(jsonb_build_object('sale_item_id',li,'quantity',1)),'Retour générique interdit',false,false,gen_random_uuid()::text,NULL);
  RAISE EXCEPTION 'Facture liée via invoice_id traitée comme standard';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 BEGIN
  PERFORM public.process_return_as_cash(ret1,cs);
  RAISE EXCEPTION 'Remboursement de la part organisme accepté';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=public.process_return_as_cash(ret2,cs);
 IF r->>'success' IS DISTINCT FROM 'true' OR (r->>'amount')::numeric<>600 THEN RAISE EXCEPTION 'Remboursement patient légitime refusé';END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>9400 OR public._nonvat_cash_refund_limit(t,sid,NULL)<>0 OR (SELECT count(*) FROM public.cash_movements WHERE tenant_id=t AND kind='refund')<>1 OR (SELECT refunded_at FROM public.sale_returns WHERE id=ret1) IS NOT NULL THEN RAISE EXCEPTION 'Solde ou statut incorrect';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ipm_ventes WHERE id=ipm AND part_ipm=6400 AND part_client=3600 AND part_beneficiaire_payee=600) THEN RAISE EXCEPTION 'Dossier organisme altéré';END IF;
 INSERT INTO public.payment_methods(id,tenant_id,name,code,payment_type,is_active) VALUES(pm,t,'Espèces','CASH','cash',true);
 INSERT INTO public.sale_payments(tenant_id,sale_id,payment_method_id,method_name,amount,status,cash_session_id) VALUES(t,sid,pm,'Espèces',1000,'confirmed',cs);
 IF public._nonvat_cash_refund_limit(t,sid,NULL)<>400 THEN RAISE EXCEPTION 'Paiement détaillé non prioritaire';END IF;
END $test$;
ROLLBACK;
SELECT 'PLAFOND_IPM_OK' AS resultat;