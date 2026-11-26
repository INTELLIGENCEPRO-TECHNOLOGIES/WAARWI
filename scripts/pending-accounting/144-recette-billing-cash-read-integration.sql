BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();depot uuid:=gen_random_uuid();art uuid:=gen_random_uuid();cust uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();w uuid:=gen_random_uuid();qid uuid;sid uuid;li uuid;tok uuid;v text;r jsonb;items jsonb;req text:=gen_random_uuid()::text;ret uuid;other jsonb;reg uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE FACTURATION ATOMIQUE','[]','{"stock_method":"lot"}');
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
 INSERT INTO public.sales(id,tenant_id,site_id,cash_session_id,customer_id,user_id,sale_number,subtotal,total,paid,status,source,vat_enabled_at_issue) VALUES(sid,t,site,cs,cust,u,'HIST-001',10000,10000,1000,'partial','pos',false);
 INSERT INTO public.sale_items(id,tenant_id,sale_id,article_id,name,quantity,unit_price,total,purchase_cost,site_id) VALUES(li,t,sid,art,'Article recette',10,1000,10000,500,depot);
 INSERT INTO public.sale_lot_deductions(tenant_id,sale_id,sale_item_id,lot_id,article_id,site_id,quantity) VALUES(t,sid,li,a,art,depot,6),(t,sid,li,b,art,depot,4);
 UPDATE public.stock_levels SET quantity=0 WHERE tenant_id=t AND site_id=depot;
 UPDATE public.stock_lots SET remaining_quantity=0 WHERE tenant_id=t;
 INSERT INTO public.sale_payments(tenant_id,sale_id,payment_method_id,method_name,amount,status,cash_session_id) VALUES(t,sid,pm,'Espèces',1000,'confirmed',cs);
 UPDATE public.cash_sessions SET theoretical_amount=10100 WHERE id=cs;
 PERFORM set_config('request.jwt.claim.sub',u::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 items:=jsonb_build_array(jsonb_build_object('sale_item_id',li,'quantity',1,'lots',jsonb_build_array(jsonb_build_object('lot_id',a,'quantity',1))));
 r:=public.prepare_invoice_return(sid,site,items,'Retour facturation différé',true,req,false);ret:=(r->>'id')::uuid;
 IF ret IS NULL OR r->>'status' IS DISTINCT FROM 'pending' OR r->>'requested_refund_mode' IS DISTINCT FROM 'deferred' OR r->>'cash_session_id' IS NOT NULL THEN RAISE EXCEPTION 'Retour différé incorrect : %',r;END IF;
 r:=public.prepare_invoice_return(sid,site,items,'Retour facturation différé',true,req,false);
 IF (r->>'id')::uuid IS DISTINCT FROM ret THEN RAISE EXCEPTION 'Réessai dupliqué';END IF;
 BEGIN
  PERFORM public.prepare_invoice_return(sid,site,items,'Retour facturation différé',true,req,true);
  RAISE EXCEPTION 'Changement de mode accepté';
 EXCEPTION WHEN unique_violation THEN NULL;END;
 r:=public.rpc_paginated_invoices(t,site);
 IF (r->>'total_count')::int<>1 OR (r->'rows'->0->>'id')::uuid IS DISTINCT FROM sid THEN RAISE EXCEPTION 'Factures illisibles : %',r;END IF;
 r:=public.rpc_paginated_quotes(t,site);
 IF (r->>'total_count')::int<>0 THEN RAISE EXCEPTION 'Liste devis inattendue : %',r;END IF;
 r:=public.rpc_paginated_returns(t,site);
 IF (r->>'total_count')::int<>1 OR (r->'rows'->0->>'id')::uuid IS DISTINCT FROM ret THEN RAISE EXCEPTION 'Retours illisibles : %',r;END IF;
 r:=public.my_operational_cash_session(site);
 IF (r->'session'->>'id')::uuid IS DISTINCT FROM cs THEN RAISE EXCEPTION 'Caisse opérationnelle introuvable : %',r;END IF;
 r:=public.cash_pos_context(site);
 IF (r->'site_session'->>'id')::uuid IS DISTINCT FROM cs THEN RAISE EXCEPTION 'Contexte POS incorrect : %',r;END IF;
 r:=public.rpc_pos_popularity_scores(t,site);
 IF (r->>art::text)::numeric IS DISTINCT FROM 10 THEN RAISE EXCEPTION 'Popularité incorrecte : %',r;END IF;
 BEGIN
  PERFORM public.rpc_paginated_invoices(gen_random_uuid(),NULL);
  RAISE EXCEPTION 'Accès facture étrangère accepté';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Accès facture étrangère accepté' THEN RAISE;END IF;END;
 BEGIN
  PERFORM public.rpc_paginated_returns(gen_random_uuid(),NULL);
  RAISE EXCEPTION 'Accès retour étranger accepté';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Accès retour étranger accepté' THEN RAISE;END IF;END;
 r:=public.approve_return_as_avoir(ret);
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Avoir refusé : %',r;END IF;
 r:=public.approve_return_as_avoir(ret);
 IF r->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Avoir dupliqué';END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT count(*) FROM public.sale_returns WHERE tenant_id=t)<>1 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=depot)<>1 OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>10100 OR NOT EXISTS(SELECT 1 FROM public.sale_returns WHERE id=ret AND status='approved' AND refund_method='avoir' AND total=1000 AND refunded_at IS NOT NULL) THEN RAISE EXCEPTION 'Soldes ou avoir incorrects';END IF;
END $test$;
ROLLBACK;
SELECT 'LECTURES_FACTURATION_CAISSE_OK' AS resultat;