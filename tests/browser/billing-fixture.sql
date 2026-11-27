-- Jeu de données synthétiques réservé au conteneur temporaire GitHub Actions.
BEGIN;
SELECT set_config('waarwi_recipe.browser_actor', :'browser_actor', true) IS NOT NULL;
DO $fixture$
DECLARE
 actor uuid:=current_setting('waarwi_recipe.browser_actor')::uuid;
 t uuid:=gen_random_uuid(); site uuid:=gen_random_uuid(); article uuid:=gen_random_uuid();
 patient uuid:=gen_random_uuid(); regular_customer uuid:=gen_random_uuid(); org uuid:=gen_random_uuid(); convention uuid:=gen_random_uuid();
 beneficiary uuid:=gen_random_uuid(); register_id uuid:=gen_random_uuid(); session_id uuid:=gen_random_uuid();
 method uuid:=gen_random_uuid(); sale uuid; result jsonb;
 token text:=replace(gen_random_uuid()::text,'-','');
 next_article uuid:=gen_random_uuid();
 article_name text:='Article recette navigateur ' || repeat('DésignationDeCatalogueSansEspaces', 4);
BEGIN
 INSERT INTO public.tenants(id,name,enabled_modules,settings,approval_status)
 VALUES(t,'RECETTE NAVIGATEUR IPM','["dashboard","billing","articles","stock","sales","pos","ipm","accounting"]','{"stock_method":"none"}','approved');
 PERFORM waarwi_recipe.provision_enterprise(t);
 INSERT INTO public.profiles(id,tenant_id,role,site_access_mode,full_name,is_active)
 VALUES(actor,t,'admin','all','Recette navigateur',true)
 ON CONFLICT(id) DO UPDATE SET tenant_id=excluded.tenant_id,role=excluded.role,site_access_mode=excluded.site_access_mode,is_active=true;
 UPDATE public.tenants SET owner_user_id=actor WHERE id=t;
 INSERT INTO public.accounts(tenant_id,code,name,class)
 VALUES(t,'6310000','Frais bancaires de recette',6),(t,'5210000','Banque de recette',5)
 ON CONFLICT(tenant_id,code) DO NOTHING;
 INSERT INTO public.document_settings(tenant_id,doc_type,allow_edit)
 VALUES(t,'invoice',true) ON CONFLICT(tenant_id,doc_type) DO UPDATE SET allow_edit=excluded.allow_edit;
 INSERT INTO public.sites(id,tenant_id,name,is_active,allow_negative_stock) VALUES(site,t,'Pharmacie de recette',true,false);
 INSERT INTO public.customers(id,tenant_id,name)
 VALUES(patient,t,'Patient recette navigateur'),(regular_customer,t,'Client fictif du journal');
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,purchase_price,track_stock,ipm_eligible)
 VALUES(article,t,'NAV-001',article_name,2500,500,true,true);
 INSERT INTO public.articles(id,tenant_id,internal_ref,name,sale_price,purchase_price,track_stock,ipm_eligible)
 VALUES(next_article,t,'NAV-002','Article recette voisin',1500,600,false,false);
 INSERT INTO public.stock_levels(tenant_id,article_id,site_id,quantity) VALUES(t,article,site,10);
 INSERT INTO public.ipm_organismes(id,tenant_id,nom) VALUES(org,t,'Organisme recette navigateur');
 INSERT INTO public.ipm_conventions(id,tenant_id,organisme_id,nom,taux_defaut,mode_calcul,mode_arrondi)
 VALUES(convention,t,org,'Convention recette navigateur',64,'articles_eligibles','round');
 INSERT INTO public.ipm_beneficiaires(id,tenant_id,customer_id,organisme_id,convention_id,matricule,statut)
 VALUES(beneficiary,t,patient,org,convention,'NAV-REC','actif');
 INSERT INTO public.cash_registers(id,tenant_id,site_id,code,name) VALUES(register_id,t,site,'C1','Caisse de recette');
 INSERT INTO public.cash_sessions(id,tenant_id,site_id,user_id,cash_register_id,status,theoretical_amount)
 VALUES(session_id,t,site,actor,register_id,'open',100);
 INSERT INTO public.cash_register_assignments(tenant_id,cash_register_id,user_id,is_active,assigned_by)
 VALUES(t,register_id,actor,true,actor);
 INSERT INTO public.payment_methods(id,tenant_id,name,code,payment_type,is_active)
 VALUES(method,t,'Espèces recette','CASH-REC','cash',true);

 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 result:=public.create_direct_invoice_atomic(t,
   jsonb_build_object('site_id',site,'customer_id',patient,'cash_session_id',session_id,'total',2500,
     'ipm',jsonb_build_object('beneficiaire_id',beneficiary,'expected_part_ipm',1600)),
   jsonb_build_array(jsonb_build_object('article_id',article,'name',article_name,'quantity',1,'unit_price',2500,'discount',0)),
   jsonb_build_array(jsonb_build_object('payment_method_id',method,'amount',400)),site,'{}',gen_random_uuid());
 sale:=(result->>'sale_id')::uuid;
 -- Two adjacent sales exercise every separator in the mobile journal.
 FOR i IN 1..2 LOOP
   PERFORM public.create_direct_invoice_atomic(t,
     jsonb_build_object('site_id',site,'customer_id',regular_customer,'cash_session_id',session_id,'total',1500),
     jsonb_build_array(jsonb_build_object('article_id',next_article,'name','Article recette voisin','quantity',1,'unit_price',1500,'discount',0)),
     '[]'::jsonb,site,'{}',gen_random_uuid());
 END LOOP;
 EXECUTE 'RESET ROLE';
 UPDATE public.sales SET public_code=token WHERE id=sale;
END $fixture$;
COMMIT;
SELECT jsonb_build_object('id',s.id,'number',s.sale_number,'token',s.public_code,'method',m.id)
FROM public.sales s
JOIN public.tenants t ON t.id=s.tenant_id AND t.name='RECETTE NAVIGATEUR IPM'
JOIN public.payment_methods m ON m.tenant_id=t.id AND m.code='CASH-REC'
WHERE s.ipm_patient_total=900 AND s.total=2500 AND s.paid=400;
