-- 136 : protection des remboursements historiques IPM ; prise en charge non encaissée exclue.
DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public._nonvat_cash_refund_limit(uuid,uuid,uuid)'::regprocedure);
 a:=$a$DECLARE v_paid numeric; v_count bigint; v_cash numeric; v_refunded numeric;$a$;
 b:=$b$DECLARE v_paid numeric; v_count bigint; v_cash numeric; v_refunded numeric; v_ipm_count bigint; v_patient_paid numeric;$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 136 déclaration';END IF;src:=replace(src,a,b);
 a:=$a$ IF v_count=0 THEN v_cash:=v_paid;END IF;$a$;
 b:=$b$ SELECT count(*),max(i.part_beneficiaire_payee) INTO v_ipm_count,v_patient_paid FROM public.ipm_ventes i WHERE i.tenant_id=p_tenant AND (i.sale_id=p_sale OR i.invoice_id=p_sale);
 IF v_ipm_count>1 THEN RAISE EXCEPTION 'Plusieurs dossiers IPM : rapprochez les paiements avant remboursement.' USING ERRCODE='55000';END IF;
 IF v_count=0 THEN
   IF v_ipm_count=1 THEN
     IF v_patient_paid IS NULL OR v_patient_paid<0 OR v_patient_paid::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'Paiement du bénéficiaire non justifié.' USING ERRCODE='55000';END IF;
     v_cash:=least(v_paid,v_patient_paid);
   ELSE v_cash:=v_paid;END IF;
 END IF;$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 136 plafond';END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public._process_sale_return_without_vat(uuid,uuid,uuid,jsonb,text,boolean,boolean,text,text)'::regprocedure);
 a:=$a$FROM public.ipm_ventes i WHERE i.tenant_id=v_tenant_id AND i.sale_id=p_sale_id$a$;b:=$b$FROM public.ipm_ventes i WHERE i.tenant_id=v_tenant_id AND (i.sale_id=p_sale_id OR i.invoice_id=p_sale_id)$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 136 non TVA';END IF;EXECUTE replace(src,a,b);
 src:=pg_get_functiondef('public._prepare_vat_sale_return(uuid,uuid,jsonb,text,boolean,text,uuid)'::regprocedure);
 a:=$a$FROM public.ipm_ventes i WHERE i.sale_id = p_sale_id AND i.tenant_id = v_tenant_id$a$;b:=$b$FROM public.ipm_ventes i WHERE (i.sale_id = p_sale_id OR i.invoice_id = p_sale_id) AND i.tenant_id = v_tenant_id$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre 136 TVA';END IF;EXECUTE replace(src,a,b);
END $p$;
