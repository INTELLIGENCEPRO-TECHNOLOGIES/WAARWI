-- Facture, stock, transfert de bail et version. Fixtures uniquement, rollback complet.
BEGIN;
DO $test$
DECLARE t uuid:=gen_random_uuid();other uuid:=gen_random_uuid();u uuid:=gen_random_uuid();u2 uuid:=gen_random_uuid();u3 uuid:=gen_random_uuid();s1 uuid:=gen_random_uuid();s2 uuid:=gen_random_uuid();s3 uuid:=gen_random_uuid();a uuid:=gen_random_uuid();c uuid:=gen_random_uuid();f uuid:=gen_random_uuid();w uuid:=gen_random_uuid();w2 uuid:=gen_random_uuid();tok uuid;tok2 uuid;v text;v2 text;res jsonb;items jsonb;olditems jsonb;num text:='F-RECETTE-'||gen_random_uuid()::text;
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
 EXECUTE 'RESET ROLE';
 UPDATE public.sites SET allow_negative_stock=true WHERE id=s1;
 UPDATE public.sites SET is_warehouse=true,parent_site_id=s1,allow_negative_stock=false WHERE id=s2;
 EXECUTE 'SET LOCAL ROLE authenticated';
 res:=public.save_locked_invoice_edit(t,f,w,tok,v,jsonb_set(items,'{0,quantity}','25'),c,'{}',NULL,NULL,true);
 EXECUTE 'RESET ROLE';
 IF (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=a AND site_id=s2)<>-5 OR (SELECT total FROM public.sales WHERE id=f)<>25000 THEN RAISE EXCEPTION 'Héritage négatif facture incorrect';END IF;
END $test$;
ROLLBACK;
