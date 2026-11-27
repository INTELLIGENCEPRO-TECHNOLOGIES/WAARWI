-- Facture, stock, transfert de bail et version. Fixtures uniquement, rollback complet.
BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();other uuid:=gen_random_uuid();u uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();u3 uuid:=gen_random_uuid();s1 uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();s3 uuid:=gen_random_uuid();a uuid:=gen_random_uuid();c uuid:=gen_random_uuid();f uuid:=gen_random_uuid();w uuid:=gen_random_uuid();w2 uuid:=gen_random_uuid();tok uuid;tok2 uuid;v text;v2 text;res jsonb;items jsonb;olditems jsonb;pos_sale uuid:=gen_random_uuid();rep uuid:=gen_random_uuid();num text:='F-RECETTE-'||gen_random_uuid()::text;
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules) VALUES(t,'RECETTE FACTURE VERROU','["accounting"]'),(other,'RECETTE AUTRE','[]');
 INSERT INTO auth.users(id,email,aud,role) SELECT id,id::text||'@example.invalid','authenticated','authenticated' FROM unnest(ARRAY[u,u2,u3]) id;
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active) VALUES(u,t,'admin','all','Commercial A',true),(u2,t,'admin','all','Commercial B',true),(u3,other,'admin','all','Autre entreprise',true) ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id,role=excluded.role,site_access_mode=excluded.site_access_mode,is_active=true;
 INSERT INTO public.sites(id,tenant_id,name,is_active) VALUES(s1,t,'Facturation',true),(s2,t,'Dépôt sortie',true),(s3,t,'Autre magasin',true);
 INSERT INTO public.customers(id,tenant_id,name,balance) VALUES(c,t,'Client recette',2000);
 INSERT INTO public.articles(id,tenant_id,name,internal_ref,track_stock,purchase_price) VALUES(a,t,'Article recette','REC',true,600);
 INSERT INTO public.sales(id,tenant_id,site_id,customer_id,user_id,sale_number,source,status,subtotal,total,paid,doc_header) VALUES(f,t,s1,c,u,num,'billing','validated',2000,2000,0,'{"ancienne_cle":"conservée"}');
 INSERT INTO public.sale_items(tenant_id,sale_id,article_id,name,quantity,unit_price,total,purchase_cost,site_id) VALUES(t,f,a,'Article recette',2,1000,2000,500,s1);
 INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(t,a,s1,10),(t,a,s2,18),(t,a,s3,30);
 INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,note) VALUES(t,a,s2,'sale',-2,20,18,'Facture '||num);
 PERFORM set_config('request.jwt.claim.sub',u::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 res:=public.document_edit_lease(t,'sale',f::text,w,'acquire');tok:=(res->>'token')::uuid;
 IF res->>'state' IS DISTINCT FROM 'held' THEN RAISE EXCEPTION 'Verrou initial absent';END IF;
 res:=public.load_locked_invoice_edit(t,f,w,tok);v:=res->>'version';olditems:=res->'items';
 items:=jsonb_build_array(jsonb_build_object('article_id',a,'name','Article recette','quantity',3,'unit_price',1000,'discount',0));
 PERFORM set_config('request.jwt.claim.sub',u2::text,true);
 res:=public.document_edit_lease(t,'sale',f::text,w2,'acquire');
 IF res->>'state' IS DISTINCT FROM 'busy' THEN RAISE EXCEPTION 'Double accès';END IF;
 BEGIN PERFORM public.save_locked_invoice_edit(t,f,w2,tok,v,items,c,'{}',NULL,NULL);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Jeton volé accepté';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 res:=public.document_edit_lease(t,'sale',f::text,w2,'request');
 PERFORM set_config('request.jwt.claim.sub',u3::text,true);
 BEGIN PERFORM public.load_locked_invoice_edit(t,f,w,tok);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Accès inter-entreprises';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 BEGIN PERFORM public.save_locked_invoice_edit(t,f,w,tok,v,jsonb_set(items,'{0,quantity}','1000'),c,'{}',NULL,NULL,true);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Stock négatif accepté';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 res:=public.document_edit_lease(t,'sale',f::text,w,'status');
 IF res->>'state' IS DISTINCT FROM 'held' OR res->>'request_state' IS DISTINCT FROM 'pending' THEN RAISE EXCEPTION 'Échec a transféré le verrou';END IF;
 res:=public.save_locked_invoice_edit(t,f,w,tok,v,items,c,'{"reference":"test"}',NULL,NULL,true);
 IF res->>'success' IS DISTINCT FROM 'true' OR res->>'lock_released' IS DISTINCT FROM 'true' OR (res->>'new_total')::numeric<>3000 THEN RAISE EXCEPTION 'Sauvegarde/cession incorrecte';END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s1)<>10 OR (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s2)<>17 OR (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s3)<>30 THEN RAISE EXCEPTION 'Erreur isolation stock';END IF;
 IF (SELECT purchase_cost FROM public.sale_items WHERE sale_id=f)<>500 THEN RAISE EXCEPTION 'Coût historique perdu';END IF;
 IF (SELECT balance FROM public.customers WHERE id=c)<>3000 THEN RAISE EXCEPTION 'Solde client incorrect';END IF;
 PERFORM set_config('request.jwt.claim.sub',u2::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 res:=public.document_edit_lease(t,'sale',f::text,w2,'status');tok2:=(res->>'token')::uuid;
 IF res->>'state' IS DISTINCT FROM 'held' OR tok2=tok THEN RAISE EXCEPTION 'Transfert incorrect';END IF;
 BEGIN PERFORM public.save_locked_invoice_edit(t,f,w2,tok2,v,olditems,c,'{}',NULL,NULL);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Ancienne version acceptée';EXCEPTION WHEN serialization_failure THEN NULL;END;
 res:=public.load_locked_invoice_edit(t,f,w2,tok2);v2:=res->>'version';items:=res->'items';
 BEGIN PERFORM public.save_locked_invoice_edit(t,f,w2,tok2,v2,items,NULL,'{}',NULL,NULL);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Créance sans débiteur';EXCEPTION WHEN invalid_parameter_value THEN NULL;END;
 res:=public.save_locked_invoice_edit(t,f,w2,tok2,v2,items,c,'{"reference":"métadonnée"}',NULL,NULL);
 IF res->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Modification entête impossible';END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT count(*) FROM public.stock_movements WHERE reference_type='invoice_edit' AND reference_id=f)<>1 THEN RAISE EXCEPTION 'Mouvement inutile';END IF;
 IF (SELECT count(*) FROM public.audit_logs WHERE reference_id=f AND action='invoice_edit')<>2 THEN RAISE EXCEPTION 'Audit incomplet';END IF;
 IF (SELECT doc_header->>'ancienne_cle' FROM public.sales WHERE id=f) IS DISTINCT FROM 'conservée' THEN RAISE EXCEPTION 'Métadonnée historique perdue';END IF;
 -- Missing original movement must not cause a speculative stock adjustment.
 UPDATE public.stock_movements SET note='fixture sans référence' WHERE tenant_id=t AND reference_id IS NULL;
 PERFORM set_config('request.jwt.claim.sub',u2::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 res:=public.load_locked_invoice_edit(t,f,w2,tok2);v2:=res->>'version';
 BEGIN PERFORM public.save_locked_invoice_edit(t,f,w2,tok2,v2,jsonb_set(items,'{0,quantity}','4'),c,'{}',NULL,NULL);RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Historique incomplet accepté';EXCEPTION WHEN SQLSTATE '55000' THEN NULL;END;
 EXECUTE 'RESET ROLE';
 IF (SELECT total FROM public.sales WHERE id=f)<>3000 OR (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s2)<>17 THEN RAISE EXCEPTION 'Écriture résiduelle après rejet';END IF;
 IF has_function_privilege('anon','public.save_locked_invoice_edit(uuid,uuid,uuid,uuid,text,jsonb,uuid,jsonb,uuid,jsonb,boolean)','EXECUTE') OR has_function_privilege('authenticated','public._invoice_edit_snapshot(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'API exposée sans contrôle';END IF;

 -- Une vente de caisse est éditée au journal avec le même bail, mais ses
 -- mouvements identifient directement la vente et le dépôt réellement utilisé.
 INSERT INTO public.sales_representatives(id,tenant_id,code,first_name,last_name)
 VALUES(rep,t,'REP-RECETTE','Représentant','Recette');
 INSERT INTO public.sales(id,tenant_id,site_id,customer_id,user_id,sale_number,source,status,subtotal,total,paid,doc_header,representative_id,rep_commission)
 VALUES(pos_sale,t,s1,c,u,'POS-'||pos_sale::text,'pos','validated',2000,2000,0,'{"terminal":"caisse initiale"}',rep,
        '{"base":"marge","type":"pct_marge","rate":10,"base_amount":1000,"amount":100}');
 INSERT INTO public.sale_items(tenant_id,sale_id,article_id,name,quantity,unit_price,total,purchase_cost,site_id)
 VALUES(t,pos_sale,a,'Article recette',2,1000,2000,500,s2);
 UPDATE public.stock_levels SET quantity=15 WHERE article_id=a AND site_id=s2;
 INSERT INTO public.stock_movements(tenant_id,article_id,site_id,movement_type,quantity,previous_qty,new_qty,reference_type,reference_id)
 VALUES(t,a,s2,'sale',-2,17,15,'sale',pos_sale);
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 res:=public.document_edit_lease(t,'sale',pos_sale::text,w,'acquire');
 tok:=(res->>'token')::uuid;
 res:=public.load_locked_invoice_edit(t,pos_sale,w,tok);
 v:=res->>'version';
 items:=jsonb_set(res->'items','{0,quantity}','1');
 res:=public.save_locked_invoice_edit(t,pos_sale,w,tok,v,items,c,NULL,rep,NULL,true);
 IF res->>'success' IS DISTINCT FROM 'true' OR res->>'lock_released' IS DISTINCT FROM 'true' THEN
  RAISE EXCEPTION 'Modification de la vente POS impossible';
 END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s2)<>16
    OR (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s1)<>10
    OR (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s3)<>30
    OR (SELECT site_id FROM public.sale_items WHERE sale_id=pos_sale) IS DISTINCT FROM s2
    OR (SELECT doc_header->>'terminal' FROM public.sales WHERE id=pos_sale) IS DISTINCT FROM 'caisse initiale'
    OR (SELECT representative_id FROM public.sales WHERE id=pos_sale) IS DISTINCT FROM rep
    OR (SELECT (rep_commission->>'amount')::numeric FROM public.sales WHERE id=pos_sale) IS DISTINCT FROM 50 THEN
  RAISE EXCEPTION 'Modification POS : le dépôt, la vente ou le stock ne correspondent pas';
 END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 res:=public.cancel_sale(pos_sale,t,'Recette annulation POS après modification','none',NULL);
 IF res->>'success' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Annulation de la vente éditée impossible : %',res; END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s2)<>17
    OR (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s1)<>10
    OR (SELECT quantity FROM public.stock_levels WHERE article_id=a AND site_id=s3)<>30
    OR (SELECT status FROM public.sales WHERE id=pos_sale) IS DISTINCT FROM 'cancelled' THEN
  RAISE EXCEPTION 'Annulation POS : la restitution doit porter sur la quantité corrigée et le dépôt d’origine';
 END IF;
END $test$;
ROLLBACK;
