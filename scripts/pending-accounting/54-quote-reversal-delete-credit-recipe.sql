-- À exécuter UNIQUEMENT sur la branche de recette, avec les déclencheurs fiscaux restaurés (script 49).
BEGIN;
DO $test$
DECLARE scenario text;t uuid;u uuid;site uuid;depot uuid;art uuid;svc uuid;cust uuid;org uuid;conv uuid;ben uuid;reg uuid;cs uuid;pm uuid;rid uuid;lot1 uuid;lot2 uuid;badlot uuid;expired uuid;w uuid;qid uuid;tok uuid;v text;res jsonb;sid uuid;items jsonb;payments jsonb;ipm jsonb;assignments jsonb;bad jsonb;expected numeric;pay numeric;
BEGIN
 FOREACH scenario IN ARRAY ARRAY['lot','ipm'] LOOP
 t:=gen_random_uuid();u:=gen_random_uuid();site:=gen_random_uuid();depot:=gen_random_uuid();art:=gen_random_uuid();svc:=gen_random_uuid();cust:=gen_random_uuid();org:=gen_random_uuid();conv:=gen_random_uuid();ben:=gen_random_uuid();reg:=gen_random_uuid();cs:=gen_random_uuid();pm:=gen_random_uuid();rid:=gen_random_uuid();lot1:=gen_random_uuid();lot2:=gen_random_uuid();badlot:=gen_random_uuid();expired:=gen_random_uuid();w:=gen_random_uuid();ipm:=NULL;assignments:='{}';
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE ATOMIQUE DEVIS '||scenario,'[]',jsonb_build_object('stock_method',CASE WHEN scenario='lot' THEN 'lot' ELSE 'none' END));
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Commercial recette',true) ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id,role=excluded.role,site_access_mode=excluded.site_access_mode,full_name=excluded.full_name,is_active=true;
 INSERT INTO public.sites(id,tenant_id,name,is_active,allow_negative_stock) VALUES(site,t,'Magasin recette',true,false);
 INSERT INTO public.sites(id,tenant_id,name,is_active,is_warehouse,parent_site_id,allow_negative_stock) VALUES(depot,t,'Dépôt recette',true,true,site,false);
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,purchase_price,track_stock,vat_rate,ipm_eligible) VALUES(art,t,'REC-001','Article recette',1000,500,true,18,true),(svc,t,'REC-002','Service recette',500,200,false,18,false);
 INSERT INTO public.customers(id,tenant_id,name) VALUES(cust,t,'Client recette');
 INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(t,art,depot,CASE WHEN scenario='vat' THEN 1 ELSE 10 END),(t,art,site,99);
 INSERT INTO public.sales_representatives(id,tenant_id,code,first_name,last_name) VALUES(rid,t,'R001','Représentant','Recette');
 INSERT INTO public.rep_commission_settings(tenant_id,enabled,commission_type,commission_base,rate) VALUES(t,true,'pct_marge','marge',10);
 INSERT INTO public.cash_registers(id,tenant_id,site_id,code,name) VALUES(reg,t,site,'C1','Caisse recette');
 INSERT INTO public.cash_sessions(id,tenant_id,site_id,user_id,cash_register_id,status,theoretical_amount) VALUES(cs,t,site,u,reg,'open',100);
 INSERT INTO public.payment_methods(id,tenant_id,name,code,payment_type,is_active) VALUES(pm,t,'Espèces','CASH','cash',true);
 IF scenario='vat' THEN
  INSERT INTO public.sales_vat_settings(tenant_id,site_id,enabled) VALUES(t,site,true);
  expected:=4720;pay:=1200;
  items:=jsonb_build_array(jsonb_build_object('article_id',art,'name','Article recette','quantity',2,'unit_price',1000,'discount',0),jsonb_build_object('article_id',art,'name','Article recette bis','quantity',1,'unit_price',1000,'discount',0),jsonb_build_object('article_id',svc,'name','Service recette','quantity',1,'unit_price',1000,'discount',0));
 ELSIF scenario='lot' THEN
  expected:=5000;pay:=0;
  INSERT INTO public.stock_lots(id,tenant_id,article_id,site_id,batch_number,expiry_date,initial_quantity,remaining_quantity,purchase_price) VALUES(lot1,t,art,depot,'L1',current_date+30,4,4,400),(lot2,t,art,depot,'L2',current_date+60,6,6,600),(badlot,t,art,site,'AUTRE',current_date+30,10,10,500),(expired,t,art,depot,'PERIME',current_date-1,1,1,300);
  items:=jsonb_build_array(jsonb_build_object('article_id',art,'name','Article recette','quantity',2,'unit_price',1000,'discount',0),jsonb_build_object('article_id',art,'name','Article recette bis','quantity',3,'unit_price',1000,'discount',0));
  assignments:=jsonb_build_object(art::text,jsonb_build_array(jsonb_build_object('lot_id',lot1,'quantity',2),jsonb_build_object('lot_id',lot1,'quantity',1),jsonb_build_object('lot_id',lot2,'quantity',2)));
 ELSE
  expected:=2500;pay:=900;
  INSERT INTO public.ipm_organismes(id,tenant_id,nom) VALUES(org,t,'IPM recette');
  INSERT INTO public.ipm_conventions(id,tenant_id,organisme_id,nom,taux_defaut,mode_calcul,mode_arrondi,numero_ordonnance_obligatoire,matricule_obligatoire) VALUES(conv,t,org,'Convention recette',80,'articles_eligibles','round',true,true);
  INSERT INTO public.ipm_beneficiaires(id,tenant_id,customer_id,organisme_id,convention_id,matricule,statut) VALUES(ben,t,cust,org,conv,'TEST-01','actif');
  items:=jsonb_build_array(jsonb_build_object('article_id',art,'name','Médicament recette','quantity',2,'unit_price',1000,'discount',0),jsonb_build_object('article_id',svc,'name','Article non éligible','quantity',1,'unit_price',500,'discount',0));
  ipm:=jsonb_build_object('beneficiaire_id',ben,'expected_part_ipm',1600,'documents',jsonb_build_object('numero_ordonnance','ORD-REC'));
 END IF;
 payments:=jsonb_build_array(jsonb_build_object('expected_ttc',expected));
 IF pay>0 THEN payments:=payments||jsonb_build_array(jsonb_build_object('payment_method_id',pm,'amount',pay));END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 res:=public.create_quote_atomic(t,site,cust,NULL,'','{"reference":"REC","doc_date":"2025-01-01"}',rid,items,gen_random_uuid());qid:=(res->'quote'->>'id')::uuid;v:=res->>'version';
 res:=public.document_edit_lease(t,'quote',qid::text,w,'acquire');tok:=(res->>'token')::uuid;
 res:=public.change_locked_quote_status(t,qid,v,'accepted',w,tok);v:=res->>'version';
 res:=public.document_edit_lease(t,'quote',qid::text,w,'acquire');tok:=(res->>'token')::uuid;
 IF scenario='vat' THEN
  BEGIN PERFORM public.convert_quote_atomic(t,qid,w,tok,v,depot,cs,payments);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Stock insuffisant accepté';EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM NOT LIKE 'Stock insuffisant%' THEN RAISE;END IF;END;
 ELSIF scenario='lot' THEN
  FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array('{}'::jsonb,jsonb_build_object(art::text,jsonb_build_array(jsonb_build_object('lot_id',lot1,'quantity',4))),jsonb_build_object(art::text,jsonb_build_array(jsonb_build_object('lot_id',lot1,'quantity',6))))) LOOP
   BEGIN PERFORM public.convert_quote_atomic(t,qid,w,tok,v,depot,cs,payments,bad);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Affectation incorrecte acceptée';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
  END LOOP;
  FOR bad IN SELECT value FROM jsonb_array_elements(jsonb_build_array(jsonb_build_object(art::text,jsonb_build_array(jsonb_build_object('lot_id',badlot,'quantity',5))),jsonb_build_object(art::text,jsonb_build_array(jsonb_build_object('lot_id',lot1,'quantity',4),jsonb_build_object('lot_id',expired,'quantity',1))),jsonb_build_object(art::text,jsonb_build_array(jsonb_build_object('lot_id',lot1,'quantity',5))))) LOOP
   BEGIN PERFORM public.convert_quote_atomic(t,qid,w,tok,v,depot,cs,payments,bad);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Lot incorrect accepté';EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM NOT LIKE 'Lot insuffisant%' THEN RAISE;END IF;END;
  END LOOP;
 ELSE
  BEGIN PERFORM public.convert_quote_atomic(t,qid,w,tok,v,depot,cs,payments);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='IPM ignorée';EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM NOT LIKE 'Confirmez la prise%' THEN RAISE;END IF;END;
  BEGIN PERFORM public.convert_quote_atomic(t,qid,w,tok,v,depot,cs,payments,'{}',jsonb_set(ipm,'{documents}','{}'));RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Document manquant accepté';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
  BEGIN PERFORM public.convert_quote_atomic(t,qid,w,tok,v,depot,cs,payments,'{}',jsonb_set(ipm,'{expected_part_ipm}','2000'));RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Part IPM incorrecte acceptée';EXCEPTION WHEN serialization_failure THEN NULL;END;
  BEGIN PERFORM public.convert_quote_atomic(t,qid,w,tok,v,depot,cs,jsonb_set(payments,'{1,amount}','1000'),'{}',ipm);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Surpaiement patient accepté';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Le règlement ou les acomptes%' THEN RAISE;END IF;END;
 END IF;
 EXECUTE 'RESET ROLE';
 IF EXISTS(SELECT 1 FROM public.sales WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.sale_payments WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.stock_movements WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.tenant_doc_counters WHERE tenant_id=t AND doc_kind='invoice') OR EXISTS(SELECT 1 FROM public.sale_lot_deductions WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.ipm_ventes WHERE tenant_id=t) OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>100 OR (SELECT status FROM public.quotes WHERE id=qid)<>'accepted' THEN RAISE EXCEPTION 'Rollback incomplet : %',scenario;END IF;
 IF scenario='vat' THEN UPDATE public.stock_levels SET quantity=10 WHERE tenant_id=t AND site_id=depot AND article_id=art;END IF;
 IF scenario='lot' AND (SELECT remaining_quantity FROM public.stock_lots WHERE id=lot1)<>4 THEN RAISE EXCEPTION 'Rollback lot incomplet';END IF;
 EXECUTE 'SET LOCAL ROLE authenticated';
 res:=public.convert_quote_atomic(t,qid,w,tok,v,depot,cs,payments,assignments,ipm);sid:=(res->>'sale_id')::uuid;
 EXECUTE 'RESET ROLE';
 SET CONSTRAINTS ALL IMMEDIATE;
 IF (SELECT total FROM public.sales WHERE id=sid)<>expected OR (SELECT paid FROM public.sales WHERE id=sid)<>pay OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>100+pay OR coalesce((SELECT sum(amount) FROM public.sale_payments WHERE sale_id=sid),0)<>pay OR (SELECT sale_number FROM public.sales WHERE id=sid)<>'F-00001' OR (SELECT status FROM public.quotes WHERE id=qid)<>'converted' OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=site)<>99 OR EXISTS(SELECT 1 FROM public.stock_levels WHERE tenant_id=t AND article_id=svc) OR (SELECT count(*) FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid)<>1 THEN RAISE EXCEPTION 'Facture, stock ou caisse incohérents : %',scenario;END IF;
 IF scenario='vat' THEN
  IF (SELECT vat_amount FROM public.sales WHERE id=sid)<>720 OR (SELECT vat_net_amount FROM public.sales WHERE id=sid)<>4000 OR (SELECT balance FROM public.customers WHERE id=cust)<>3520 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=depot)<>7 OR (SELECT (rep_commission->>'amount')::numeric FROM public.sales WHERE id=sid)<>230 THEN RAISE EXCEPTION 'TVA, stock, commission ou solde incorrect';END IF;
 ELSIF scenario='lot' THEN
  IF (SELECT remaining_quantity FROM public.stock_lots WHERE id=lot1)<>1 OR (SELECT remaining_quantity FROM public.stock_lots WHERE id=lot2)<>4 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=depot)<>5 OR EXISTS(SELECT 1 FROM public.sale_items i WHERE i.sale_id=sid AND (SELECT sum(d.quantity) FROM public.sale_lot_deductions d WHERE d.sale_item_id=i.id) IS DISTINCT FROM i.quantity) OR abs((SELECT sum(quantity*purchase_cost) FROM public.sale_items WHERE sale_id=sid)-2400)>0.01 THEN RAISE EXCEPTION 'Traçabilité lot ou coût incorrect';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM public.ipm_ventes WHERE sale_id=sid AND tenant_id=t AND part_ipm=1600 AND part_client=900 AND part_beneficiaire_payee=900 AND numero_ordonnance='ORD-REC' AND montant_non_eligible=500) OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=depot)<>8 THEN RAISE EXCEPTION 'IPM ou stock incorrect';END IF;
 END IF;
 -- Test a corrupted historical movement first, then restore it.
 UPDATE public.stock_movements SET quantity=quantity-1 WHERE tenant_id=t AND reference_id=sid AND reference_type='sale';
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN
  IF scenario='lot' THEN PERFORM public.delete_sale_and_recalculate(sid,t,'Recette suppression'); ELSE PERFORM public.cancel_sale(sid,t,'Recette crédit','keep_credit',NULL);END IF;
  RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Trace incohérente acceptée';
 EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM NOT LIKE 'Historique des sorties%' THEN RAISE;END IF;END;
 EXECUTE 'RESET ROLE';
 UPDATE public.stock_movements SET quantity=quantity+1 WHERE tenant_id=t AND reference_id=sid AND reference_type='sale';
 EXECUTE 'SET LOCAL ROLE authenticated';
 IF scenario='lot' THEN
  res:=public.delete_sale_and_recalculate(sid,t,'Recette suppression');
  IF res->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Suppression échouée : %',res;END IF;
  res:=public.delete_sale_and_recalculate(sid,t,'Recette suppression');
  IF res->>'already_deleted' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Suppression répétée : %',res;END IF;
 ELSE
  res:=public.cancel_sale(sid,t,'Recette crédit','keep_credit',NULL);
  IF res->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Crédit conservé échoué : %',res;END IF;
 END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=depot)<>10 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=site)<>99 OR (SELECT count(*) FROM public.stock_movements WHERE tenant_id=t AND reference_id=sid AND reference_type=CASE WHEN scenario='lot' THEN 'sale_delete' ELSE 'sale_cancel' END)<>1 OR (SELECT status FROM public.quotes WHERE id=qid)<>'converted' THEN RAISE EXCEPTION 'Restitution incorrecte : %',scenario;END IF;
 IF scenario='lot' THEN
  IF (SELECT remaining_quantity FROM public.stock_lots WHERE id=lot1)<>4 OR (SELECT remaining_quantity FROM public.stock_lots WHERE id=lot2)<>6 OR (SELECT status FROM public.sales WHERE id=sid)<>'deleted' OR (SELECT count(*) FROM public.sale_deletion_log WHERE tenant_id=t AND sale_id_snapshot=sid)<>1 OR (SELECT balance FROM public.customers WHERE id=cust)<>0 THEN RAISE EXCEPTION 'Suppression lots ou audit incorrect';END IF;
 ELSE
  IF (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>1000 OR (SELECT balance FROM public.customers WHERE id=cust)<>-900 OR EXISTS(SELECT 1 FROM public.cash_movements WHERE tenant_id=t AND kind='refund') OR NOT EXISTS(SELECT 1 FROM public.ipm_ventes WHERE sale_id=sid AND statut='annule') THEN RAISE EXCEPTION 'Crédit IPM incorrect';END IF;
 END IF;
 END LOOP;
 IF has_function_privilege('authenticated','public.convert_checked_quote_to_sale(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.convert_quote_to_sale(uuid,uuid,uuid,jsonb)','EXECUTE') OR has_function_privilege('anon','public.convert_quote_atomic(uuid,uuid,uuid,uuid,text,uuid,uuid,jsonb,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Ancienne API ou accès anonyme exposé';END IF;
END $test$;
ROLLBACK;

