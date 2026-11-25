-- Recette transactionnelle après migrations 08 et 09, sur tenant de test.
BEGIN;
DO $test$
DECLARE t uuid;u uuid;other uuid;r jsonb;rev bigint;blocked boolean;yr int:=2026;
BEGIN
 SELECT id INTO STRICT t FROM public.tenants WHERE name='TEST COMPTA';
 SELECT id INTO STRICT other FROM public.tenants WHERE name='INTELLIGENCEPRO';
 SELECT id INTO u FROM public.profiles WHERE tenant_id=t AND role='admin' ORDER BY id LIMIT 1;
 IF u IS NULL OR EXISTS(SELECT 1 FROM public.accounting_financial_workpapers WHERE tenant_id=t AND fiscal_year=yr) THEN RAISE EXCEPTION 'Dossier de recette non vierge.';END IF;
 PERFORM set_config('request.jwt.claim.sub',u::text,true);
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 EXECUTE 'SET LOCAL ROLE authenticated';
 r:=public.save_financial_workpaper(t,yr,0,'{"FA":140000}','{"FA":"Recette"}','{"methods":"Recette"}');rev:=(r->>'revision')::bigint;
 IF rev IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'Version initiale incorrecte.';END IF;
 blocked:=false;BEGIN PERFORM public.save_financial_workpaper(t,yr,0,'{}','{}','{}');EXCEPTION WHEN serialization_failure THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Écrasement concurrent accepté.';END IF;
 blocked:=false;BEGIN PERFORM public.save_financial_workpaper(t,yr,rev,'{"FA":1}','{}','{}');EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'Justification obligatoire%' THEN blocked:=true;ELSE RAISE;END IF;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Montant non justifié accepté.';END IF;
 blocked:=false;BEGIN PERFORM public.save_financial_workpaper(other,yr,0,'{}','{}','{}');EXCEPTION WHEN insufficient_privilege THEN blocked:=true;END;
 IF NOT blocked THEN RAISE EXCEPTION 'Accès inter-tenant accepté.';END IF;
 r:=public.save_financial_workpaper(t,yr,rev,'{"FA":140000,"FG":-100}','{"FA":"Recette","FG":"Pièce test"}','{"methods":"Recette révisée"}');
 IF (r->>'revision')::bigint<>2 OR NOT EXISTS(SELECT 1 FROM public.accounting_financial_workpapers WHERE tenant_id=t AND fiscal_year=yr AND revision=2 AND annexes->>'methods'='Recette révisée') THEN RAISE EXCEPTION 'Dossier non enregistré.';END IF;
 EXECUTE 'RESET ROLE';
END;$test$;
ROLLBACK;
