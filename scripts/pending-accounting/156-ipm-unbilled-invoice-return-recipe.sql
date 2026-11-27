BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();art uuid:=gen_random_uuid();svc uuid:=gen_random_uuid();cust uuid:=gen_random_uuid();org uuid:=gen_random_uuid();conv uuid:=gen_random_uuid();ben uuid:=gen_random_uuid();reg uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();key uuid:=gen_random_uuid();sid uuid; header jsonb; items jsonb; payments jsonb; r jsonb;
 eligible_line uuid; service_line uuid; eligible_item jsonb; service_item jsonb;
 first_return uuid; credit_return uuid; final_return uuid;
 bord uuid:=gen_random_uuid(); first_key text:=gen_random_uuid()::text;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE RETOUR ATOMIQUE IPM','[]','{"stock_method":"none"}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Recette IPM directe',true);
 INSERT INTO public.sites(id,tenant_id,name,is_active,allow_negative_stock) VALUES(site,t,'Pharmacie recette',true,false);
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,purchase_price,track_stock,ipm_eligible) VALUES(art,t,'REC-IPM','Médicament',1000,500,true,true),(svc,t,'REC-SVC','Non éligible',500,200,false,false);
 INSERT INTO public.customers(id,tenant_id,name) VALUES(cust,t,'Patient recette');
 INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(t,art,site,10);
 INSERT INTO public.ipm_organismes(id,tenant_id,nom) VALUES(org,t,'Organisme recette');
 INSERT INTO public.ipm_conventions(id,tenant_id,organisme_id,nom,taux_defaut,mode_calcul,mode_arrondi,numero_ordonnance_obligatoire,matricule_obligatoire) VALUES(conv,t,org,'Convention recette',80,'articles_eligibles','round',true,true);
 INSERT INTO public.ipm_beneficiaires(id,tenant_id,customer_id,organisme_id,convention_id,matricule,statut) VALUES(ben,t,cust,org,conv,'REC-152','actif');
 INSERT INTO public.cash_registers(id,tenant_id,site_id,code,name) VALUES(reg,t,site,'C1','Caisse recette');
 INSERT INTO public.cash_sessions(id,tenant_id,site_id,user_id,cash_register_id,status,theoretical_amount) VALUES(cs,t,site,u,reg,'open',100);
 INSERT INTO public.payment_methods(id,tenant_id,name,code,payment_type,is_active) VALUES(pm,t,'Espèces','CASH','cash',true);
 header:=jsonb_build_object('site_id',site,'customer_id',cust,'cash_session_id',cs,'total',2500,'ipm',jsonb_build_object('beneficiaire_id',ben,'expected_part_ipm',1600,'documents',jsonb_build_object('numero_ordonnance','ORD-152')));
 items:=jsonb_build_array(jsonb_build_object('article_id',art,'name','Médicament','quantity',2,'unit_price',1000,'discount',0),jsonb_build_object('article_id',svc,'name','Non éligible','quantity',1,'unit_price',500,'discount',0));
 payments:=jsonb_build_array(jsonb_build_object('payment_method_id',pm,'amount',400));
 UPDATE public.tenants SET owner_user_id=u WHERE id=t;
 INSERT INTO public.cash_register_assignments(tenant_id,cash_register_id,user_id,is_active,assigned_by) VALUES(t,reg,u,true,u);
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.create_direct_invoice_atomic(t,header,items,payments,site,'{}',key);
 sid:=(r->>'sale_id')::uuid;
 EXECUTE 'RESET ROLE';
 SELECT id INTO STRICT eligible_line FROM public.sale_items WHERE tenant_id=t AND sale_id=sid AND article_id=art;
 SELECT id INTO STRICT service_line FROM public.sale_items WHERE tenant_id=t AND sale_id=sid AND article_id=svc;
 eligible_item:=jsonb_build_array(jsonb_build_object('sale_item_id',eligible_line,'quantity',1,'lots','[]'::jsonb));
 service_item:=jsonb_build_array(jsonb_build_object('sale_item_id',service_line,'quantity',1,'lots','[]'::jsonb));

 INSERT INTO public.ipm_bordereaux(id,tenant_id,organisme_id,numero,periode_debut,periode_fin,total_part_ipm,nombre_factures,statut)
 VALUES(bord,t,org,'BOR-156',current_date,current_date,1600,1,'envoye');
 UPDATE public.ipm_ventes SET bordereau_id=bord,statut='bordereau' WHERE sale_id=sid;
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN
  PERFORM public.prepare_invoice_return(sid,site,eligible_item,'Bordereau émis',true,first_key,true);
  RAISE EXCEPTION 'Retour accepté sur un bordereau transmis';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM NOT LIKE 'Ce dossier IPM doit être régularisé%' THEN RAISE;END IF;
 END;
 EXECUTE 'RESET ROLE';
 IF EXISTS(SELECT 1 FROM public.sale_returns WHERE tenant_id=t)
    OR (SELECT total_part_ipm FROM public.ipm_bordereaux WHERE id=bord) IS DISTINCT FROM 1600
    OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=site) IS DISTINCT FROM 8 THEN
  RAISE EXCEPTION 'Le refus a modifié le retour, le bordereau ou le stock';
 END IF;

 UPDATE public.ipm_ventes SET bordereau_id=NULL,statut='en_attente' WHERE sale_id=sid;
 UPDATE public.ipm_conventions SET taux_defaut=50 WHERE id=conv;
 UPDATE public.articles SET ipm_eligible=false WHERE id=art;
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN
  PERFORM public.prepare_invoice_return(sid,site,
    jsonb_set(eligible_item,'{0,lots}',jsonb_build_array(jsonb_build_object('lot_id',gen_random_uuid(),'quantity',1))),
    'Lot incorrect',true,gen_random_uuid()::text,true);
  RAISE EXCEPTION 'Lot incorrect accepté sur un article sans lot';
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM NOT LIKE 'Aucun lot%' THEN RAISE;END IF;
 END;
 EXECUTE 'RESET ROLE';
 IF EXISTS(SELECT 1 FROM public.sale_returns WHERE tenant_id=t)
    OR EXISTS(SELECT 1 FROM public.ipm_return_line_snapshots WHERE tenant_id=t)
    OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=site) IS DISTINCT FROM 8 THEN
  RAISE EXCEPTION 'Le retour IPM incomplet a laissé des écritures';
 END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 PERFORM public.stage_return_request(first_key,'invoice',sid,site,NULL,eligible_item,'Premier retour',true,'deferred');
 r:=public.execute_return_request(first_key);
 first_return:=(r->>'id')::uuid;
 IF r->>'status' IS DISTINCT FROM 'pending' OR (r->>'total')::numeric IS DISTINCT FROM 200
    OR (r->>'ipm_gross_total')::numeric IS DISTINCT FROM 1000 THEN
  RAISE EXCEPTION 'Montants du retour IPM incorrects : %',r;
 END IF;
 r:=public.execute_return_request(first_key);
 IF (r->>'id')::uuid IS DISTINCT FROM first_return THEN RAISE EXCEPTION 'Le réessai a dupliqué le retour IPM';END IF;
 PERFORM public.finish_return_request(first_key,'ack');
 BEGIN
  PERFORM public.prepare_invoice_return(sid,site,service_item,'Autre retour',false,gen_random_uuid()::text,true);
  RAISE EXCEPTION 'Retour concurrent accepté pendant un retour en attente';
 EXCEPTION WHEN SQLSTATE '55000' THEN
  IF SQLERRM NOT LIKE 'Rapprochez la ventilation IPM%' THEN RAISE;END IF;
 END;
 PERFORM public.process_return_as_cash(first_return,cs);
 r:=public.prepare_invoice_return(sid,site,service_item,'Avoir non éligible',false,gen_random_uuid()::text,true);
 credit_return:=(r->>'id')::uuid;
 IF r->>'refund_method' IS DISTINCT FROM 'avoir' OR (r->>'total')::numeric IS DISTINCT FROM 500 THEN
  RAISE EXCEPTION 'L’avoir a été calculé sur la mauvaise part : %',r;
 END IF;
 EXECUTE 'RESET ROLE';
 IF NOT EXISTS(SELECT 1 FROM public.ipm_return_line_snapshots WHERE tenant_id=t AND return_id=first_return AND quantity=1 AND ipm_amount=800 AND patient_amount=200)
    OR NOT EXISTS(SELECT 1 FROM public.ipm_return_line_snapshots WHERE tenant_id=t AND return_id=credit_return AND ipm_amount=0 AND patient_amount=500)
    OR NOT EXISTS(SELECT 1 FROM public.ipm_ventes WHERE sale_id=sid AND part_ipm=800 AND part_client=200 AND montant_total=1000 AND montant_eligible=1000 AND montant_non_eligible=0)
    OR (SELECT count(*) FROM public.cash_movements WHERE tenant_id=t AND sale_return_id=first_return AND kind='refund' AND amount=200)<>1
    OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs) IS DISTINCT FROM 300
    OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=site) IS DISTINCT FROM 9 THEN
  RAISE EXCEPTION 'La ventilation historique, la caisse ou le stock sont incohérents';
 END IF;

 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.prepare_invoice_return(sid,site,eligible_item,'Solde sans remise en stock',false,gen_random_uuid()::text,true);
 final_return:=(r->>'id')::uuid;
 EXECUTE 'RESET ROLE';
 IF NOT EXISTS(SELECT 1 FROM public.ipm_return_line_snapshots WHERE tenant_id=t AND return_id=final_return AND prior_quantity=1 AND ipm_amount=800 AND patient_amount=200)
    OR NOT EXISTS(SELECT 1 FROM public.ipm_ventes WHERE sale_id=sid AND part_ipm=0 AND part_client=0 AND montant_total=0 AND statut='annulee')
    OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=site) IS DISTINCT FROM 9
    OR (SELECT count(*) FROM public.sale_returns WHERE tenant_id=t)<>3 THEN
  RAISE EXCEPTION 'Le dernier retour n’a pas soldé exactement le dossier IPM';
 END IF;
END $test$;
ROLLBACK;
SELECT 'RETOUR_IPM_NON_BORDEREAUTE_ATOMIQUE_OK' AS resultat;
