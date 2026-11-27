BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();art uuid:=gen_random_uuid();svc uuid:=gen_random_uuid();cust uuid:=gen_random_uuid();org uuid:=gen_random_uuid();conv uuid:=gen_random_uuid();ben uuid:=gen_random_uuid();reg uuid:=gen_random_uuid();cs uuid:=gen_random_uuid();pm uuid:=gen_random_uuid();key uuid:=gen_random_uuid();key2 uuid:=gen_random_uuid();sid uuid;sid2 uuid;normal uuid:=gen_random_uuid();cr uuid:=gen_random_uuid();header jsonb;items jsonb;payments jsonb;r jsonb;public_token text;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE FACTURE IPM DIRECTE','[]','{"stock_method":"none"}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Recette IPM directe',true);
 INSERT INTO public.sites(id,tenant_id,name,is_active,allow_negative_stock) VALUES(site,t,'Pharmacie recette',true,false);
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,purchase_price,track_stock,ipm_eligible) VALUES(art,t,'REC-IPM','Médicament',1000,500,true,true),(svc,t,'REC-SVC','Non éligible',500,200,false,false);
 INSERT INTO public.customers(id,tenant_id,name) VALUES(cust,t,'Patient recette');
 INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(t,art,site,1);
 INSERT INTO public.ipm_organismes(id,tenant_id,nom) VALUES(org,t,'Organisme recette');
 INSERT INTO public.ipm_conventions(id,tenant_id,organisme_id,nom,taux_defaut,mode_calcul,mode_arrondi,numero_ordonnance_obligatoire,matricule_obligatoire) VALUES(conv,t,org,'Convention recette',80,'articles_eligibles','round',true,true);
 INSERT INTO public.ipm_beneficiaires(id,tenant_id,customer_id,organisme_id,convention_id,matricule,statut) VALUES(ben,t,cust,org,conv,'REC-152','actif');
 INSERT INTO public.cash_registers(id,tenant_id,site_id,code,name) VALUES(reg,t,site,'C1','Caisse recette');
 INSERT INTO public.cash_sessions(id,tenant_id,site_id,user_id,cash_register_id,status,theoretical_amount) VALUES(cs,t,site,u,reg,'open',100);
 INSERT INTO public.payment_methods(id,tenant_id,name,code,payment_type,is_active) VALUES(pm,t,'Espèces','CASH','cash',true);
 UPDATE public.tenants SET owner_user_id=u WHERE id=t;
 INSERT INTO public.cash_register_assignments(tenant_id,cash_register_id,user_id,is_active,assigned_by) VALUES(t,reg,u,true,u);
 header:=jsonb_build_object('site_id',site,'customer_id',cust,'cash_session_id',cs,'total',2500,'ipm',jsonb_build_object('beneficiaire_id',ben,'expected_part_ipm',1600,'documents',jsonb_build_object('numero_ordonnance','ORD-152')));
 items:=jsonb_build_array(jsonb_build_object('article_id',art,'name','Médicament','quantity',2,'unit_price',1000,'discount',0),jsonb_build_object('article_id',svc,'name','Non éligible','quantity',1,'unit_price',500,'discount',0));
 payments:=jsonb_build_array(jsonb_build_object('payment_method_id',pm,'amount',400));
 PERFORM set_config('request.jwt.claim.sub',u::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 BEGIN PERFORM public.create_direct_invoice_atomic(t,header-'ipm',items,payments,site,'{}',key);RAISE EXCEPTION 'IPM ignorée';EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM NOT LIKE 'Confirmez la prise%' THEN RAISE;END IF;END;
 BEGIN PERFORM public.create_direct_invoice_atomic(t,jsonb_set(header,'{ipm,documents}','{}'),items,payments,site,'{}',key);RAISE EXCEPTION 'Ordonnance ignorée';EXCEPTION WHEN invalid_parameter_value THEN IF SQLERRM NOT LIKE 'Documents IPM obligatoires%' THEN RAISE;END IF;END;
 BEGIN PERFORM public.create_direct_invoice_atomic(t,jsonb_set(header,'{ipm,expected_part_ipm}','2000'),items,payments,site,'{}',key);RAISE EXCEPTION 'Part IPM falsifiée';EXCEPTION WHEN serialization_failure THEN NULL;END;
 BEGIN PERFORM public.create_direct_invoice_atomic(t,header,items,jsonb_set(payments,'{0,amount}','901'),site,'{}',key);RAISE EXCEPTION 'Surpaiement accepté';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 BEGIN PERFORM public.create_direct_invoice_atomic(t,header,items,payments,site,'{}',key);RAISE EXCEPTION 'Stock insuffisant accepté';EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM NOT LIKE 'Stock insuffisant%' THEN RAISE;END IF;END;
 EXECUTE 'RESET ROLE';
 IF EXISTS(SELECT 1 FROM public.sales WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.ipm_ventes WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.ipm_sale_line_snapshots WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.sale_payments WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.stock_movements WHERE tenant_id=t) OR EXISTS(SELECT 1 FROM public.tenant_doc_counters WHERE tenant_id=t AND doc_kind='invoice') OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>100 THEN RAISE EXCEPTION 'Rollback facture IPM incomplet';END IF;
 UPDATE public.stock_levels SET quantity=10 WHERE tenant_id=t AND article_id=art AND site_id=site;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.create_direct_invoice_atomic(t,header,items,payments,site,'{}',key);sid:=(r->>'sale_id')::uuid;
 EXECUTE 'RESET ROLE';
 IF NOT EXISTS(SELECT 1 FROM public.sales WHERE id=sid AND total=2500 AND paid=400 AND status='partial' AND sale_number='F-00001') OR NOT EXISTS(SELECT 1 FROM public.ipm_ventes WHERE sale_id=sid AND part_ipm=1600 AND part_client=900 AND part_beneficiaire_payee=400 AND montant_non_eligible=500) OR NOT EXISTS(SELECT 1 FROM public.ipm_sale_line_snapshots WHERE sale_id=sid AND (snapshot->>'patient')::numeric=900) OR (SELECT balance FROM public.customers WHERE id=cust)<>500 OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>500 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=site)<>8 THEN RAISE EXCEPTION 'Facture IPM partielle incohérente';END IF;
 UPDATE public.ipm_conventions SET taux_defaut=50 WHERE id=conv;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.create_direct_invoice_atomic(t,header,items,payments,site,'{}',key);
 IF r->>'sale_id' IS DISTINCT FROM sid::text OR r->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Réessai IPM non idempotent';END IF;
 EXECUTE 'RESET ROLE';
 UPDATE public.ipm_conventions SET taux_defaut=80 WHERE id=conv;
 -- An existing 1,000 FCFA return credit must never settle the 1,600 FCFA organism share.
 INSERT INTO public.sales(id,tenant_id,site_id,user_id,customer_id,sale_number,subtotal,total,paid,status,source,vat_enabled_at_issue) VALUES(normal,t,site,u,cust,'NORMAL-152',1000,1000,0,'validated','billing',false);
 INSERT INTO public.sale_returns(id,tenant_id,site_id,sale_id,customer_id,return_number,total,refund_method,status,restock) VALUES(cr,t,site,normal,cust,'RET-152',1000,'avoir','approved',false);
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.create_direct_invoice_atomic(t,header-'cash_session_id',items,'[]',site,'{}',key2);sid2:=(r->>'sale_id')::uuid;
 EXECUTE 'RESET ROLE';
 SET CONSTRAINTS ALL IMMEDIATE;
 IF (SELECT paid FROM public.sales WHERE id=sid2)<>900 OR (SELECT credit_used FROM public.sale_returns WHERE id=cr)<>900 OR (SELECT count(*) FROM public.ipm_ventes WHERE tenant_id=t)<>2 OR (SELECT count(*) FROM public.ipm_sale_line_snapshots WHERE tenant_id=t)<>2 OR (SELECT sum(amount) FROM public.sale_payments WHERE sale_id=sid2 AND affects_balance=false)<>900 OR EXISTS(SELECT 1 FROM public.sale_payments WHERE sale_id=sid2 AND affects_balance=true) OR (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs)<>500 OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=art AND site_id=site)<>6 OR (SELECT balance FROM public.customers WHERE id=cust)<>1400 THEN RAISE EXCEPTION 'Facture IPM à crédit ou avoir incohérent';END IF;
 IF has_function_privilege('authenticated','public._create_billing_sale_without_credit_allocation(jsonb,jsonb,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Primitive de facturation exposée';END IF;
 IF NOT EXISTS(SELECT 1 FROM public.sales WHERE id=sid AND ipm_patient_total=900 AND paid=400 AND status='partial')
    OR NOT EXISTS(SELECT 1 FROM public.sales WHERE id=sid2 AND ipm_patient_total=900 AND paid=900 AND status='paid')
    OR NOT EXISTS(SELECT 1 FROM public.sales WHERE id=normal AND ipm_patient_total IS NULL) THEN
  RAISE EXCEPTION 'Part patient ou statut après imputation incohérent';
 END IF;
 UPDATE public.sales SET public_code=gen_random_uuid()::text WHERE id=sid RETURNING public_code INTO public_token;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.rpc_paginated_invoices(t,site,p_status_filter=>'partial');
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'rows') row
                WHERE row->>'id'=sid::text AND (row->>'ipm_patient_total')::numeric=900) THEN
  RAISE EXCEPTION 'Part patient absente du filtre des factures partiellement réglées : %',r;
 END IF;
 BEGIN
  PERFORM public.register_sale_payment(sid,pm,'Espèces',501,'Dépassement',cs);
  RAISE EXCEPTION 'Le paiement au-delà de la part patient a été accepté';
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM NOT LIKE 'Le règlement dépasse%' THEN RAISE;END IF;
 END;
 r:=public.register_sale_payment(sid,pm,'Espèces',500,'Solde patient',cs);
 IF r->>'status' IS DISTINCT FROM 'paid' OR (r->>'paid')::numeric IS DISTINCT FROM 900 THEN
  RAISE EXCEPTION 'Paiement du solde patient incohérent : %',r;
 END IF;
 r:=public.rpc_paginated_invoices(t,site,p_status_filter=>'paid');
 IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(r->'rows') row
                WHERE row->>'id'=sid::text AND (row->>'ipm_patient_total')::numeric=900)
    OR (r->'totals'->>'count_paid')::integer<>2 THEN
  RAISE EXCEPTION 'Classement des factures IPM réglées incohérent : %',r;
 END IF;
 EXECUTE 'RESET ROLE';
 EXECUTE 'SET LOCAL ROLE anon';
 r:=public.get_public_sale_invoice(public_token);
 IF (r->'sale'->>'total')::numeric IS DISTINCT FROM 2500
    OR (r->'sale'->>'ipm_patient_total')::numeric IS DISTINCT FROM 900
    OR (r->'sale'->>'paid')::numeric IS DISTINCT FROM 900
    OR r->'sale'->>'status' IS DISTINCT FROM 'paid' THEN
  RAISE EXCEPTION 'Montants incohérents sur le lien de facture : %',r;
 END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT theoretical_amount FROM public.cash_sessions WHERE id=cs) IS DISTINCT FROM 1000
    OR (SELECT part_beneficiaire_payee FROM public.ipm_ventes WHERE sale_id=sid) IS DISTINCT FROM 900
    OR (SELECT part_ipm FROM public.ipm_ventes WHERE sale_id=sid) IS DISTINCT FROM 1600
    OR (SELECT count(*) FROM public.sale_payments WHERE sale_id=sid)<>2 THEN
  RAISE EXCEPTION 'Caisse, règlement patient ou montant organisme incohérents';
 END IF;
END $test$;
ROLLBACK;
SELECT 'FACTURE_IPM_DIRECTE_ATOMIQUE_OK' AS resultat;
