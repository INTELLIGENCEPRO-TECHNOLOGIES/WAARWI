-- RECETTE EN COURS : pas de validation de restauration tant que tous les contrôles ne passent pas.
-- Exécuter exclusivement dans une transaction de la branche isolée après 64/67/68/71/73/80/93, drift, lot D et 98 ; jamais sur main.
BEGIN;
SELECT public._br_lotd_install_hooks();
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();depot uuid:=gen_random_uuid();art uuid:=gen_random_uuid();cust uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();w uuid:=gen_random_uuid();qid uuid;sid uuid;li uuid;tok uuid;v text;r jsonb;items jsonb;req text:=gen_random_uuid()::text;ret uuid;other jsonb;reg uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();li2 uuid:=gen_random_uuid();da uuid;db uuid;matches jsonb;archive_id uuid:=gen_random_uuid();old_archive uuid:=gen_random_uuid();payload jsonb:='{}';counts jsonb:='{}';checks jsonb:='{}';data_rows jsonb;chk text;regrow record;job_id uuid;lease_token uuid;outcome jsonb;old_count int;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE RESTAURATION LOT D','[]','{"stock_method":"lot"}');
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
 INSERT INTO public.sale_lot_deductions(tenant_id,sale_id,sale_item_id,lot_id,article_id,site_id,quantity) VALUES(t,sid,NULL,a,art,depot,6),(t,sid,NULL,b,art,depot,4);
 UPDATE public.stock_levels SET quantity=0 WHERE tenant_id=t AND site_id=depot;
 UPDATE public.stock_lots SET remaining_quantity=0 WHERE tenant_id=t;
 UPDATE public.cash_sessions SET theoretical_amount=10100 WHERE id=cs;
 UPDATE public.sale_items SET quantity=5,total=5000 WHERE id=li;
 INSERT INTO public.sale_items(id,tenant_id,sale_id,article_id,name,quantity,unit_price,total,purchase_cost,site_id) VALUES(li2,t,sid,art,'Article identique',5,1000,5000,500,depot);
 PERFORM set_config('request.jwt.claim.sub',u::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 IF jsonb_array_length(public.read_fiscal_return_lots(sid)->li::text) IS DISTINCT FROM 0 THEN RAISE EXCEPTION 'Attribution ambiguë proposée';END IF;
 items:=jsonb_build_array(jsonb_build_object('sale_item_id',li,'quantity',3));
 BEGIN
  PERFORM public.process_sale_return(sid,site,cs,items,'Retour physique ambigu',true,true,req,NULL);
  RAISE EXCEPTION 'Retour physique ambigu accepté';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 EXECUTE 'RESET ROLE';
 IF EXISTS(SELECT 1 FROM public.sale_returns WHERE tenant_id=t) OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>10100 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND site_id=depot)<>0 THEN RAISE EXCEPTION 'Échec non atomique';END IF;

 SELECT id INTO STRICT da FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=sid AND lot_id=a;
 SELECT id INTO STRICT db FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_id=sid AND lot_id=b;
 matches:=jsonb_build_array(jsonb_build_object('deduction_id',da,'sale_item_id',li,'quantity',5),jsonb_build_object('deduction_id',da,'sale_item_id',li2,'quantity',1),jsonb_build_object('deduction_id',db,'sale_item_id',li2,'quantity',4));
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.read_historical_sale_lot_match(sid,art);
 IF jsonb_array_length(r->'lines')<>2 OR jsonb_array_length(r->'deductions')<>2 THEN RAISE EXCEPTION 'Données de rapprochement incomplètes';END IF;
 BEGIN
  PERFORM public.save_historical_sale_lot_match(sid,art,jsonb_build_array(matches->0),'Bordereau REC-01');
  RAISE EXCEPTION 'Rapprochement partiel accepté';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 r:=public.save_historical_sale_lot_match(sid,art,matches,'Bordereau REC-01');
 IF r->>'success' IS DISTINCT FROM 'true' OR r->>'idempotent' IS DISTINCT FROM 'false' THEN RAISE EXCEPTION 'Rapprochement échoué : %',r;END IF;
 r:=public.save_historical_sale_lot_match(sid,art,matches,'Bordereau REC-01');
 IF r->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Réessai incorrect';END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT count(*) FROM public.historical_sale_lot_matches WHERE tenant_id=t)<>3 OR (SELECT count(*) FROM public.audit_logs WHERE tenant_id=t AND action='historical_sale_lots_matched')<>1 OR EXISTS(SELECT 1 FROM public.sale_lot_deductions WHERE tenant_id=t AND sale_item_id IS NOT NULL) OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>10100 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND site_id=depot)<>0 THEN RAISE EXCEPTION 'Rapprochement a modifié un historique ou un solde';END IF;


 UPDATE public.tenants SET owner_user_id=u WHERE id=t;
 -- Archive v2 synthétique complète, construite avec le périmètre réel du registre et son format d'empreinte.
 FOR regrow IN SELECT table_name FROM public._br_table_registry WHERE schema_name='public' AND tenant_link IN ('direct','indirect') ORDER BY table_name LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb) FROM public.%I q WHERE %s',regrow.table_name,public._br_rs_tenant_pred(regrow.table_name,'q')) INTO data_rows USING t;
  SELECT encode(sha256(convert_to(string_agg(j::text,'' ORDER BY j::text),'UTF8')),'hex') INTO chk FROM jsonb_array_elements(data_rows) j;
  payload:=payload||jsonb_build_object(regrow.table_name,data_rows);counts:=counts||jsonb_build_object(regrow.table_name,jsonb_array_length(data_rows));checks:=checks||jsonb_build_object(regrow.table_name,chk);
 END LOOP;
 INSERT INTO public.tenant_backups(id,tenant_id,created_by,label,format_version,status,kind,payload,row_counts,checksums,created_at) VALUES
 (archive_id,t,u,'Archive complète de recette',2,'verified','manual',payload,counts,checks,clock_timestamp()),
 (old_archive,t,u,'Archive historique sans rapprochements',2,'verified','manual',payload-'historical_sale_lot_matches',counts-'historical_sale_lot_matches',checks-'historical_sale_lot_matches',clock_timestamp()-interval '1 day');
 UPDATE public._br_restore_config SET enabled=true WHERE id=1;
 outcome:=public._br_rs_request_restore(t,u,2,old_archive);
 IF outcome->>'status' IS DISTINCT FROM 'failed' OR outcome->>'error_code' IS DISTINCT FROM 'BRR-020' THEN RAISE EXCEPTION 'Archive sans rapprochements acceptée : %',outcome;END IF;
 -- Mutation post-archive puis restauration via le vrai moteur, sans simuler le swap.
 UPDATE public.stock_levels SET quantity=quantity+17 WHERE tenant_id=t AND site_id=depot;
 INSERT INTO public.customers(tenant_id,name) VALUES(t,'Client après sauvegarde');
 outcome:=public._br_rs_request_restore(t,u,2,archive_id);job_id:=(outcome->>'job_id')::uuid;
 IF outcome->>'status' IS DISTINCT FROM 'preparing' THEN RAISE EXCEPTION 'Préparation rejetée : %',outcome;END IF;
 outcome:=public._br_rs_claim(job_id,'recette-sql');lease_token:=(outcome->>'token')::uuid;
 FOR old_count IN 1..150 LOOP
  outcome:=public._br_rs_load_v2(job_id,lease_token,10);
  IF outcome->>'status'='failed' THEN RAISE EXCEPTION 'Chargement échoué : %',outcome;END IF;
  EXIT WHEN coalesce((outcome->>'done')::boolean,false);
 END LOOP;
 IF NOT coalesce((outcome->>'done')::boolean,false) THEN RAISE EXCEPTION 'Chargement incomplet : %',outcome;END IF;
 outcome:=public._br_rs_verify(job_id,lease_token);
 IF outcome->>'status' IS DISTINCT FROM 'prepared' THEN RAISE EXCEPTION 'Vérification moteur : %',outcome;END IF;
 outcome:=public._br_rs_request_execute(job_id,u);
 IF outcome->>'execute_requested' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Exécution refusée : %',outcome;END IF;
 PERFORM public._br_rs_enter_maintenance(job_id,lease_token);
 outcome:=public._br_rs_swap(job_id,lease_token);
 IF outcome->>'status' IS DISTINCT FROM 'succeeded' THEN RAISE EXCEPTION 'Swap moteur : %',outcome;END IF;
 PERFORM public._br_rs_release(job_id);
 IF (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=depot)<>0 OR EXISTS(SELECT 1 FROM public.customers WHERE tenant_id=t AND name='Client après sauvegarde') OR (SELECT count(*) FROM public.historical_sale_lot_matches WHERE tenant_id=t)<>3 OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>10100 THEN RAISE EXCEPTION 'Données restaurées incorrectes';END IF;
 IF EXISTS(SELECT 1 FROM public._br_tenant_maintenance WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public._br_restore_context WHERE tenant_id=t) THEN RAISE EXCEPTION 'Maintenance ou contexte restant';END IF;
 BEGIN PERFORM public._br_assert_destructive_available();RAISE EXCEPTION 'BR020 non maintenu';EXCEPTION WHEN SQLSTATE 'BR020' THEN NULL;END;
END $test$;
ROLLBACK;
SELECT 'LOT_D_RESTORE_V2_OK' AS resultat;