BEGIN;
DO $test$
DECLARE k int;t uuid;u uuid;s uuid;d uuid;a uuid;c uuid;w uuid;q uuid;tok uuid;v text;r jsonb;src uuid;allowed boolean;
BEGIN
 FOR k IN 1..6 LOOP
  -- RESET ROLE does not clear the JWT identity from the previous iteration.
  PERFORM set_config('request.jwt.claim.sub','',true);
  PERFORM set_config('request.jwt.claims','{}',true);
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'Identité précédente encore présente'; END IF;
 t:=gen_random_uuid();u:=gen_random_uuid();s:=gen_random_uuid();d:=gen_random_uuid();a:=gen_random_uuid();c:=gen_random_uuid();w:=gen_random_uuid();src:=CASE WHEN k IN(1,4) THEN s ELSE d END;allowed:=k IN(1,2,5);
 INSERT INTO public.tenants(id,name,enabled_modules,settings) VALUES(t,'RECETTE NEGATIF '||k,'[]',jsonb_build_object('stock_method',CASE WHEN k=6 THEN 'lot' WHEN k=5 THEN 'cmup' ELSE 'none' END,'allow_negative_stock',k IN(3,4)));
 INSERT INTO auth.users(id,email,aud,role) VALUES(u,u::text||'@example.invalid','authenticated','authenticated');
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,is_active) VALUES(u,t,'admin','all',true) ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id,role=excluded.role,site_access_mode=excluded.site_access_mode,is_active=true;
 INSERT INTO public.sites(id,tenant_id,name,is_active,allow_negative_stock) VALUES(s,t,'Magasin recette',true,k IN(1,2,5,6));
 INSERT INTO public.sites(id,tenant_id,name,is_active,is_warehouse,parent_site_id,allow_negative_stock) VALUES(d,t,'Dépôt recette',true,true,s,k IN(3,5,6));
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,purchase_price,track_stock) VALUES(a,t,'REC-001','Article recette',1000,500,true);
 INSERT INTO public.customers(id,tenant_id,name) VALUES(c,t,'Client recette');
 INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(t,a,src,2),(t,a,CASE WHEN src=s THEN d ELSE s END,99);
 PERFORM set_config('request.jwt.claim.sub',u::text,true);EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.create_quote_atomic(t,s,c,NULL,'','{}',NULL,jsonb_build_array(jsonb_build_object('article_id',a,'name','Article recette','quantity',5,'unit_price',1000,'discount',0)),gen_random_uuid());q:=(r->'quote'->>'id')::uuid;v:=r->>'version';
 r:=public.document_edit_lease(t,'quote',q::text,w,'acquire');tok:=(r->>'token')::uuid;
 r:=public.change_locked_quote_status(t,q,v,'accepted',w,tok);v:=r->>'version';
 r:=public.document_edit_lease(t,'quote',q::text,w,'acquire');tok:=(r->>'token')::uuid;
 IF allowed THEN
  r:=public.convert_quote_atomic(t,q,w,tok,v,src,NULL,'[{"expected_ttc":5000}]');
 ELSE
  BEGIN PERFORM public.convert_quote_atomic(t,q,w,tok,v,src,NULL,'[{"expected_ttc":5000}]');RAISE EXCEPTION USING ERRCODE='P9098',MESSAGE='Conversion incorrectement autorisée';EXCEPTION WHEN SQLSTATE '55000' THEN IF SQLERRM NOT LIKE 'Stock insuffisant%' THEN RAISE;END IF;END;
 END IF;
 EXECUTE 'RESET ROLE';
 IF (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=a AND site_id=src) IS DISTINCT FROM (CASE WHEN allowed THEN -3 ELSE 2 END)::numeric OR (SELECT quantity FROM public.stock_levels WHERE tenant_id=t AND article_id=a AND site_id<>src)<>99 OR (SELECT count(*) FROM public.sales WHERE tenant_id=t)<>(CASE WHEN allowed THEN 1 ELSE 0 END) OR (SELECT count(*) FROM public.stock_movements WHERE tenant_id=t)<>(CASE WHEN allowed THEN 1 ELSE 0 END) OR (SELECT status FROM public.quotes WHERE id=q) IS DISTINCT FROM (CASE WHEN allowed THEN 'converted' ELSE 'accepted' END) THEN RAISE EXCEPTION 'Cas % incorrect',k;END IF;
 END LOOP;
END $test$;
ROLLBACK;
