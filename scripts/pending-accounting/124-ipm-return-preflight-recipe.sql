-- Après 123. Recette isolée.
BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();u uuid:=gen_random_uuid();site uuid:=gen_random_uuid();art1 uuid:=gen_random_uuid();art2 uuid:=gen_random_uuid();sid uuid:=gen_random_uuid();li1 uuid:=gen_random_uuid();li2 uuid:=gen_random_uuid();org uuid:=gen_random_uuid();ipm uuid:=gen_random_uuid();b uuid:=gen_random_uuid();f uuid:=gen_random_uuid();r jsonb;items jsonb;allitems jsonb;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE DIAGNOSTIC IPM','[]','{}');
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Recette IPM',true);
 INSERT INTO public.sites(id,tenant_id,name,is_active) VALUES(site,t,'Pharmacie fictive',true);
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,track_stock) VALUES(art1,t,'EL','Produit eligible',8000,true),(art2,t,'NE','Produit non eligible',2000,true);
 INSERT INTO public.sales(id,tenant_id,site_id,user_id,sale_number,subtotal,total,paid,status,source,vat_enabled_at_issue) VALUES(sid,t,site,u,'IPM-REC-01',10000,10000,3600,'partial','invoice',false);
 INSERT INTO public.sale_items(id,tenant_id,sale_id,article_id,name,quantity,unit_price,total,site_id) VALUES(li1,t,sid,art1,'Produit eligible',1,8000,8000,site),(li2,t,sid,art2,'Produit non eligible',1,2000,2000,site);
 INSERT INTO public.ipm_organismes(id,tenant_id,nom) VALUES(org,t,'IPM fictive');
 INSERT INTO public.ipm_ventes(id,tenant_id,organisme_id,sale_id,part_ipm,part_client,montant_total,montant_eligible,montant_non_eligible,taux_prise_en_charge,part_beneficiaire_payee) VALUES(ipm,t,org,sid,6400,3600,10000,8000,2000,80,3600);
 items:=jsonb_build_array(jsonb_build_object('sale_item_id',li2,'quantity',1));
 allitems:=items||jsonb_build_array(jsonb_build_object('sale_item_id',li1,'quantity',1));
 PERFORM set_config('request.jwt.claim.sub',u::text,true); EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.inspect_ipm_return(sid,items);
 IF r->>'state' IS DISTINCT FROM 'ventilation_a_justifier' OR r->>'split_exact' IS DISTINCT FROM 'false' OR r->>'patient_return' IS NOT NULL OR (r->>'gross')::numeric<>2000 OR (r->>'ipm_min')::numeric<>0 OR (r->>'ipm_max')::numeric<>2000 THEN RAISE EXCEPTION 'Ventilation partielle inventée : %',r;END IF;
 r:=public.inspect_ipm_return(sid,allitems);
 IF r->>'state' IS DISTINCT FROM 'non_bordereaute' OR (r->>'ipm_return')::numeric<>6400 OR (r->>'patient_return')::numeric<>3600 THEN RAISE EXCEPTION 'Retour complet incorrect : %',r;END IF;
 EXECUTE 'RESET ROLE';
 INSERT INTO public.ipm_bordereaux(id,tenant_id,organisme_id,numero,periode_debut,periode_fin,total_part_ipm,nombre_factures,statut) VALUES(b,t,org,'BOR-REC',current_date,current_date,6400,1,'brouillon');
 UPDATE public.ipm_ventes SET bordereau_id=b WHERE id=ipm;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.inspect_ipm_return(sid,allitems);
 IF r->>'state' IS DISTINCT FROM 'bordereau_brouillon' THEN RAISE EXCEPTION 'Brouillon non détecté : %',r;END IF;
 EXECUTE 'RESET ROLE';
 INSERT INTO public.ipm_factures(id,tenant_id,organisme_id,bordereau_id,numero,montant_total,reste_a_payer) VALUES(f,t,org,b,'FAC-IPM-REC',6400,6400);
 UPDATE public.ipm_bordereaux SET facture_ipm_id=f,statut='envoye' WHERE id=b;
 UPDATE public.ipm_ventes SET facture_ipm_id=f WHERE id=ipm;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.inspect_ipm_return(sid,allitems);
 IF r->>'state' IS DISTINCT FROM 'regularisation_document_emis' THEN RAISE EXCEPTION 'Facture émise non détectée : %',r;END IF;
 EXECUTE 'RESET ROLE';
 INSERT INTO public.ipm_reglements(tenant_id,organisme_id,facture_id,montant_recu) VALUES(t,org,f,1000);
 UPDATE public.ipm_factures SET montant_regle=1000,reste_a_payer=5400 WHERE id=f;
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.inspect_ipm_return(sid,allitems);
 IF r->>'state' IS DISTINCT FROM 'regularisation_reglement_rejet' OR r->>'organism_payment' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Règlement non détecté : %',r;END IF;
 BEGIN
  PERFORM public.inspect_ipm_return(sid,jsonb_build_array(jsonb_build_object('sale_item_id',li2,'quantity',2)));
  RAISE EXCEPTION 'Quantité excessive acceptée';
 EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 EXECUTE 'RESET ROLE';
 IF EXISTS(SELECT 1 FROM public.sale_returns WHERE tenant_id=t) OR NOT EXISTS(SELECT 1 FROM public.ipm_ventes WHERE id=ipm AND part_ipm=6400 AND part_client=3600 AND bordereau_id=b AND facture_ipm_id=f) OR (SELECT montant_regle FROM public.ipm_factures WHERE id=f)<>1000 THEN RAISE EXCEPTION 'Diagnostic non passif';END IF;
END $test$;
ROLLBACK;
SELECT 'DIAGNOSTIC_IPM_OK' AS resultat;