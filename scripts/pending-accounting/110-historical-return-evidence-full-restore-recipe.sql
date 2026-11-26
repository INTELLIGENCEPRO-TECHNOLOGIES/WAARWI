-- Recette intégrée : 109, br_check_schema_drift, capture_order, lot D, 98/102/104/106. Jamais main.
BEGIN;
SELECT public._br_lotd_install_hooks();
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();depot uuid:=gen_random_uuid();art uuid:=gen_random_uuid();cust uuid:=gen_random_uuid();a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();w uuid:=gen_random_uuid();qid uuid;sid uuid;li uuid;tok uuid;v text;r jsonb;items jsonb;req text:=gen_random_uuid()::text;ret uuid;other jsonb;reg uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();li2 uuid:=gen_random_uuid();da uuid;db uuid;matches jsonb;archive_id uuid:=gen_random_uuid();old_archive uuid:=gen_random_uuid();payload jsonb:='{}';counts jsonb:='{}';checks jsonb:='{}';data_rows jsonb;chk text;regrow record;job_id uuid;lease_token uuid;outcome jsonb;old_count int;ri uuid;proof_time timestamptz;org uuid:=gen_random_uuid();conv uuid:=gen_random_uuid();bord uuid:=gen_random_uuid();fac uuid:=gen_random_uuid();vente uuid:=gen_random_uuid();regl uuid:=gen_random_uuid();rejet uuid:=gen_random_uuid();assignment uuid:=gen_random_uuid();lease uuid:=gen_random_uuid();control_t uuid:=gen_random_uuid();control_cust uuid:=gen_random_uuid();
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE RESTORE PREUVES HISTORIQUES','[]','{"stock_method":"lot"}');
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
 INSERT INTO public.cash_register_assignments(id,tenant_id,cash_register_id,user_id,is_active,assigned_by) VALUES(assignment,t,reg,u,true,u);
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.process_sale_return(sid,site,cs,items,'Retour partiel avant sauvegarde',true,true,req,NULL);
 IF r->>'success' IS DISTINCT FROM 'true' OR (r->>'total')::numeric<>3000 THEN RAISE EXCEPTION 'Retour avant sauvegarde rejeté : %',r;END IF;
 ret:=(r->>'return_id')::uuid;
 EXECUTE 'RESET ROLE';
 SELECT id INTO STRICT ri FROM public.sale_return_items WHERE tenant_id=t AND return_id=ret;
 -- Simuler un ancien retour déjà traité dont seule l'affectation historique manque.
 DELETE FROM public.sale_return_lot_allocations WHERE tenant_id=t AND return_item_id=ri;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.save_historical_return_lot_match(ri,jsonb_build_array(jsonb_build_object('lot_id',a,'quantity',3)),'Preuve historique REC-RET-01',true);
 IF r->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Rapprochement non effectué : %',r;END IF;
 EXECUTE 'RESET ROLE';
 SELECT reconciled_at INTO STRICT proof_time FROM public.sale_return_lot_allocations WHERE tenant_id=t AND return_item_id=ri;
 IF (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND site_id=depot)<>3 OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>7100 THEN RAISE EXCEPTION 'Rapprochement a modifié les soldes';END IF;
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(control_t,'RECETTE CONTROLE PREUVES','[]','{}');
 INSERT INTO public.customers(id,tenant_id,name,balance) VALUES(control_cust,control_t,'Client témoin',7000);
 INSERT INTO public.ipm_organismes(id,tenant_id,nom) VALUES(org,t,'IPM fictive');
 INSERT INTO public.ipm_conventions(id,tenant_id,organisme_id,nom,taux_defaut) VALUES(conv,t,org,'Convention fictive',80);
 INSERT INTO public.ipm_bordereaux(id,tenant_id,organisme_id,numero,periode_debut,periode_fin,total_part_ipm,nombre_factures,total_accepte,total_paye,total_rejete,total_ecart,nb_factures_rejetees) VALUES(bord,t,org,'BOR-REC-001',current_date-30,current_date,8000,1,7500,5000,500,500,1);
 INSERT INTO public.ipm_factures(id,tenant_id,organisme_id,bordereau_id,numero,montant_total,montant_regle,reste_a_payer) VALUES(fac,t,org,bord,'FAC-REC-001',7500,5000,2500);
 UPDATE public.ipm_bordereaux SET facture_ipm_id=fac WHERE id=bord;
 INSERT INTO public.ipm_ventes(id,tenant_id,organisme_id,convention_id,sale_id,part_ipm,part_client,montant_total,bordereau_id,facture_ipm_id,taux_prise_en_charge,montant_eligible,part_beneficiaire_payee,montant_ipm_accepte,montant_ipm_paye,montant_rejete,ecart_ipm) VALUES(vente,t,org,conv,sid,8000,2000,10000,bord,fac,80,10000,2000,7500,5000,500,500);
 INSERT INTO public.ipm_reglements(id,tenant_id,organisme_id,facture_id,montant_recu,montant_attendu,reference) VALUES(regl,t,org,fac,5000,7500,'VIR-REC');
 INSERT INTO public.ipm_rejets(id,tenant_id,vente_ipm_id,facture_id,organisme_id,montant_rejete,motif,montant_ipm_attendu,montant_accepte,ecart) VALUES(rejet,t,vente,fac,org,500,'Justificatif fictif',8000,7500,500);
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
 UPDATE public.ipm_factures SET montant_regle=6000,reste_a_payer=1500 WHERE id=fac;
 UPDATE public.ipm_bordereaux SET total_paye=6000,facture_ipm_id=NULL WHERE id=bord;
 DELETE FROM public.ipm_rejets WHERE id=rejet;
 UPDATE public.sale_return_lot_allocations SET reconciliation_evidence='Justificatif altéré en recette' WHERE tenant_id=t AND return_item_id=ri;
 UPDATE public.cash_register_assignments SET is_active=false WHERE id=assignment;
 INSERT INTO public.document_edit_leases(tenant_id,resource_type,resource_key,owner_id,window_id,token,opened_at,heartbeat_at,activity_at,expires_at) VALUES(t,'sale',sid::text,u,w,lease,now(),now(),now(),now()+interval '5 min');
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
 IF (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=depot)<>3 OR EXISTS(SELECT 1 FROM public.customers WHERE tenant_id=t AND name='Client après sauvegarde') OR (SELECT count(*) FROM public.historical_sale_lot_matches WHERE tenant_id=t)<>3 OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>7100 OR (SELECT sum(alloc.quantity) FROM public.sale_return_lot_allocations alloc WHERE alloc.tenant_id=t)<>3 OR NOT EXISTS(SELECT 1 FROM public.cash_register_assignments WHERE id=assignment AND tenant_id=t AND is_active) OR EXISTS(SELECT 1 FROM public.document_edit_leases WHERE tenant_id=t) OR NOT EXISTS(SELECT 1 FROM public.customers WHERE id=control_cust AND tenant_id=control_t AND balance=7000) THEN RAISE EXCEPTION 'Données restaurées incorrectes';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.ipm_bordereaux WHERE id=bord AND facture_ipm_id=fac AND total_part_ipm=8000 AND total_paye=5000 AND total_rejete=500) OR NOT EXISTS(SELECT 1 FROM public.ipm_factures WHERE id=fac AND bordereau_id=bord AND montant_total=7500 AND montant_regle=5000 AND reste_a_payer=2500) OR NOT EXISTS(SELECT 1 FROM public.ipm_ventes WHERE id=vente AND facture_ipm_id=fac AND bordereau_id=bord AND part_ipm=8000 AND part_client=2000) OR NOT EXISTS(SELECT 1 FROM public.ipm_rejets WHERE id=rejet AND vente_ipm_id=vente AND facture_id=fac AND montant_rejete=500) OR NOT EXISTS(SELECT 1 FROM public.ipm_reglements WHERE id=regl AND facture_id=fac AND montant_recu=5000) THEN RAISE EXCEPTION 'Restauration IPM inexacte';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sale_return_lot_allocations WHERE tenant_id=t AND return_item_id=ri AND lot_id=a AND quantity=3 AND restocked AND reconciliation_evidence='Preuve historique REC-RET-01' AND reconciled_by=u AND reconciled_at=proof_time) THEN RAISE EXCEPTION 'Métadonnées de preuve historiques non restaurées';END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE tenant_id=t AND action='historical_return_lots_matched')<>1 THEN RAISE EXCEPTION 'Audit historique non restauré';END IF;
 IF EXISTS(SELECT 1 FROM public._br_tenant_maintenance WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public._br_restore_context WHERE tenant_id=t) THEN RAISE EXCEPTION 'Maintenance ou contexte restant';END IF;
 BEGIN PERFORM public._br_assert_destructive_available();RAISE EXCEPTION 'BR020 non maintenu';EXCEPTION WHEN SQLSTATE 'BR020' THEN NULL;END;
END $test$;
ROLLBACK;
SELECT 'ENSEMBLE_PREUVES_RESTAUREES_OK' AS resultat;