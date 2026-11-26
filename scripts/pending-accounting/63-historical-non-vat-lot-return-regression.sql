-- Régression reproduite le 26/11/2026 sur waarwi-comptabilite-recette.
-- ATTENDU : remboursement 3000, caisse 7100, dépôt +3, lots A +2 / B +1, magasin inchangé.
-- OBSERVÉ : caisse correcte, dépôt 0, magasin 102 au lieu de 99, lots A/B 0.
-- Les fixtures sont fictives. Exécuter exclusivement dans la branche isolée, jamais en production.
BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();depot uuid:=gen_random_uuid();art uuid:=gen_random_uuid();cust uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();w uuid:=gen_random_uuid();qid uuid;sid uuid;li uuid;tok uuid;v text;r jsonb;items jsonb;req text:=gen_random_uuid()::text;ret uuid;other jsonb;reg uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE HISTORIQUE SANS TVA','[]','{"stock_method":"lot"}');
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

 UPDATE public.sales_vat_settings SET enabled=false WHERE tenant_id=t;
 sid:=gen_random_uuid();li:=gen_random_uuid();
 INSERT INTO public.sales(id,tenant_id,site_id,cash_session_id,customer_id,user_id,sale_number,subtotal,total,paid,status,source,vat_enabled_at_issue) VALUES(sid,t,site,cs,cust,u,'HIST-001',10000,10000,10000,'paid','pos',false);
 INSERT INTO public.sale_items(id,tenant_id,sale_id,article_id,name,quantity,unit_price,total,purchase_cost,site_id) VALUES(li,t,sid,art,'Article recette',10,1000,10000,500,depot);
 INSERT INTO public.sale_lot_deductions(tenant_id,sale_id,sale_item_id,lot_id,article_id,site_id,quantity) VALUES(t,sid,li,a,art,depot,6),(t,sid,li,b,art,depot,4);
 UPDATE public.stock_levels SET quantity=0 WHERE tenant_id=t AND site_id=depot;
 UPDATE public.stock_lots SET remaining_quantity=0 WHERE tenant_id=t;
 UPDATE public.cash_sessions SET theoretical_amount=10100 WHERE id=cs;
 PERFORM set_config('request.jwt.claim.sub',u::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 items:=jsonb_build_array(jsonb_build_object('sale_item_id',li,'quantity',3,'lots',jsonb_build_array(jsonb_build_object('lot_id',a,'quantity',2),jsonb_build_object('lot_id',b,'quantity',1))));
 r:=public.process_sale_return(sid,site,cs,items,'Retour historique sans TVA',true,true,req,NULL);
 EXECUTE 'RESET ROLE';
 IF (r->>'total')::numeric<>3000 OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>7100 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND site_id=depot)<>3 OR (SELECT remaining_quantity FROM public.stock_lots WHERE id=a)<>2 OR (SELECT remaining_quantity FROM public.stock_lots WHERE id=b)<>1 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND site_id=site)<>99 THEN
 RAISE EXCEPTION 'Retour historique sans TVA : montant %, caisse %, stock dépôt %, stock magasin %, lot A %, lot B %',r->>'total',(SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs),(SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND site_id=depot),(SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND site_id=site),(SELECT remaining_quantity FROM public.stock_lots WHERE id=a),(SELECT remaining_quantity FROM public.stock_lots WHERE id=b);
 END IF;
 END $test$;
 ROLLBACK; SELECT 'RECETTE_HISTORIQUE_OK' AS resultat;
