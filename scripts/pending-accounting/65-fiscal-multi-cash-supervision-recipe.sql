-- Recette isolée uniquement. Le candidat 64 et la RPC de supervision de la migration 20261104154232 doivent être présents.
BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();depot uuid:=gen_random_uuid();art uuid:=gen_random_uuid();cust uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();w uuid:=gen_random_uuid();qid uuid;sid uuid;li uuid;tok uuid;v text;r jsonb;items jsonb;req text:=gen_random_uuid()::text;ret uuid;other jsonb;reg uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();op uuid:=gen_random_uuid();reg2 uuid:=gen_random_uuid();cs2 uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE SUPERVISION TVA','[]','{"stock_method":"lot"}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Commercial recette',true) ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id,role=excluded.role,site_access_mode=excluded.site_access_mode,is_active=true;
 INSERT INTO public.sites(id,tenant_id,name,is_active,allow_negative_stock) VALUES(site,t,'Magasin recette',true,false);
 INSERT INTO public.sites(id,tenant_id,name,is_active,is_warehouse,parent_site_id,allow_negative_stock) VALUES(depot,t,'Dépôt recette',true,true,site,false);
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,purchase_price,track_stock,vat_rate) VALUES(art,t,'REC-001','Article recette',1000,500,true,18);
 INSERT INTO public.customers(id,tenant_id,name) VALUES(cust,t,'Client recette');
 INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(t,art,depot,10),(t,art,site,99);
 INSERT INTO public.stock_lots(id,tenant_id,article_id,site_id,batch_number,expiry_date,initial_quantity,remaining_quantity,purchase_price) VALUES(a,t,art,depot,'A001',current_date+30,6,6,400),(b,t,art,depot,'B002',current_date+60,4,4,600);
 INSERT INTO public.cash_registers(id,tenant_id,site_id,code,name) VALUES(reg,t,site,'C1','Caisse recette');
 INSERT INTO public.cash_sessions(id,tenant_id,site_id,user_id,cash_register_id,status,theoretical_amount) VALUES(cs,t,site,u,reg,'open',100);
 INSERT INTO public.payment_methods(id,tenant_id,name,code,payment_type,is_active) VALUES(pm,t,'Espèces','CASH','cash',true);
 INSERT INTO public.sales_vat_settings(tenant_id,site_id,enabled) VALUES(t,site,true);
 INSERT INTO auth.users(id,email,aud,role) VALUES(op,op::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(op,t,'cashier','all','Caissier recette',true) ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id,role=excluded.role,site_access_mode=excluded.site_access_mode,is_active=true;
 INSERT INTO public.role_permissions(tenant_id,role,permissions) VALUES(t,'cashier','{"access_pos":true,"pos_open_session":true,"pos_returns":true}') ON CONFLICT(tenant_id,role) DO UPDATE SET permissions=excluded.permissions;
 INSERT INTO public.cash_registers(id,tenant_id,site_id,code,name) VALUES(reg2,t,site,'C2','Deuxième caisse recette');
 INSERT INTO public.cash_register_assignments(tenant_id,cash_register_id,user_id) VALUES(t,reg2,op);
 INSERT INTO public.cash_sessions(id,tenant_id,site_id,user_id,cash_register_id,status,theoretical_amount) VALUES(cs2,t,site,op,reg2,'open',10000);
 INSERT INTO public.cash_register_settings(tenant_id,multi_cash_enabled) VALUES(t,true) ON CONFLICT(tenant_id) DO UPDATE SET multi_cash_enabled=true;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.create_quote_atomic(t,site,cust,NULL,'','{}',NULL,jsonb_build_array(jsonb_build_object('article_id',art,'name','Article recette','quantity',10,'unit_price',1000,'discount',0)),gen_random_uuid());qid:=(r->'quote'->>'id')::uuid;v:=r->>'version';
 r:=public.document_edit_lease(t,'quote',qid::text,w,'acquire');tok:=(r->>'token')::uuid;
 r:=public.change_locked_quote_status(t,qid,v,'accepted',w,tok);v:=r->>'version';
 r:=public.document_edit_lease(t,'quote',qid::text,w,'acquire');tok:=(r->>'token')::uuid;
 r:=public.convert_quote_atomic(t,qid,w,tok,v,depot,cs,jsonb_build_array(jsonb_build_object('expected_ttc',11800),jsonb_build_object('payment_method_id',pm,'amount',11800)),jsonb_build_object(art::text,jsonb_build_array(jsonb_build_object('lot_id',a,'quantity',6),jsonb_build_object('lot_id',b,'quantity',4))));sid:=(r->>'sale_id')::uuid;
 EXECUTE 'RESET ROLE'; SET CONSTRAINTS ALL IMMEDIATE;
 SELECT id INTO STRICT li FROM public.sale_items WHERE tenant_id=t AND sale_id=sid;
 IF NOT EXISTS(SELECT 1 FROM public.sales WHERE id=sid AND site_id=site AND vat_net_amount=10000 AND status IN ('validated','partial','paid')) THEN RAISE EXCEPTION 'Facture fiscale non finalisée : %',(SELECT jsonb_build_object('site',site_id,'status',status,'ht',vat_net_amount,'total',total) FROM public.sales WHERE id=sid);END IF;

 items:=jsonb_build_array(jsonb_build_object('sale_item_id',li,'quantity',3,'lots',jsonb_build_array(jsonb_build_object('lot_id',a,'quantity',2),jsonb_build_object('lot_id',b,'quantity',1))));
 EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN
   PERFORM public.process_sale_return(sid,site,cs2,items,'Accès direct interdit',true,true,gen_random_uuid()::text,NULL);
   RAISE EXCEPTION 'Le superviseur peut rembourser directement dans la session d’un collègue';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',op::text,true);
 BEGIN
   PERFORM public.read_fiscal_return_lots(sid);
   RAISE EXCEPTION 'Le caissier voit les lots d’une vente d’un collègue';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
   PERFORM public.process_sale_return(sid,site,cs2,items,'Vente collègue interdite',true,true,gen_random_uuid()::text,NULL);
   RAISE EXCEPTION 'Le caissier peut retourner la vente d’un collègue';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN
   PERFORM public.cash_supervision_sale_return(cs2,sid,items,'Supervision interdite',NULL,gen_random_uuid()::text);
   RAISE EXCEPTION 'Le caissier peut superviser sans autorisation';
 EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 r:=public.cash_supervision_sale_return(cs2,sid,items,'Retour supervisé',NULL,req);
 ret:=(r->>'return_id')::uuid;
 IF (r->>'total')::numeric<>3540 OR r->>'refunded' IS DISTINCT FROM 'true' OR r->>'replayed' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Retour supervisé incorrect : %',r;END IF;
 r:=public.cash_supervision_sale_return(cs2,sid,items,'Retour supervisé',NULL,req);
 IF (r->>'return_id')::uuid IS DISTINCT FROM ret OR r->>'replayed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Réessai supervision incorrect : %',r;END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>11900 OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs2)<>6460
 OR (SELECT count(*) FROM public.cash_movements WHERE tenant_id=t AND kind='refund' AND sale_return_id=ret AND cash_session_id=cs2 AND amount=3540)<>1
 OR (SELECT count(*) FROM public.cash_supervision_requests WHERE tenant_id=t AND cash_session_id=cs2 AND actor_id=u AND owner_id=op AND operation='sale_return')<>1
 OR (SELECT count(*) FROM public.audit_logs WHERE tenant_id=t AND user_id=u AND action='cash_session_supervised_sale_return' AND reference_id=cs2)<>1
 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=depot)<>3
 THEN RAISE EXCEPTION 'Isolation caisse, journal ou stock incorrect';END IF;
END $test$;
ROLLBACK;
SELECT 'SUPERVISION_FISCALE_OK' AS resultat;