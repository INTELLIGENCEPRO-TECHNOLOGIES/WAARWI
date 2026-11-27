-- Expose the original patient amount on its invoice without exposing the private line snapshot.
ALTER TABLE public.sales ADD COLUMN ipm_patient_total numeric
 CHECK (ipm_patient_total IS NULL OR (
  ipm_patient_total BETWEEN 0 AND total
  AND ipm_patient_total=round(ipm_patient_total,2)
  AND ipm_patient_total::text NOT IN ('NaN','Infinity','-Infinity')
 ));

CREATE FUNCTION public._protect_ipm_billing_patient_amount()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.ipm_patient_total IS NOT NULL AND current_user IN ('anon','authenticated') THEN
   RAISE EXCEPTION 'La part patient est calculée à l’émission de la facture.' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF OLD.ipm_patient_total IS DISTINCT FROM NEW.ipm_patient_total
    AND (OLD.ipm_patient_total IS NOT NULL OR current_user IN ('anon','authenticated')) THEN
  RAISE EXCEPTION 'La part patient d’origine est protégée.' USING ERRCODE='42501';
 END IF;
 IF NEW.ipm_patient_total IS NOT NULL AND NEW.status IN ('paid','partial','validated') THEN
  NEW.status:=CASE WHEN coalesce(NEW.paid,0)>=NEW.ipm_patient_total THEN 'paid'
                   WHEN coalesce(NEW.paid,0)>0 THEN 'partial' ELSE 'validated' END;
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public._protect_ipm_billing_patient_amount() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER protect_ipm_billing_patient_amount
 BEFORE INSERT OR UPDATE OF ipm_patient_total,paid,status ON public.sales
 FOR EACH ROW EXECUTE FUNCTION public._protect_ipm_billing_patient_amount();

DO $patch$
DECLARE definition text; amendment record;
BEGIN
 FOR amendment IN SELECT * FROM (VALUES
  ('public.rpc_paginated_invoices(uuid,uuid,integer,timestamptz,uuid,text,text,uuid,timestamptz,timestamptz,numeric,numeric,text)',
    $a$SELECT id, sale_number, total, paid, status, customer_id$a$,
    $b$SELECT id, sale_number, total, paid, status, ipm_patient_total, customer_id$b$,1),
  ('public.rpc_paginated_invoices(uuid,uuid,integer,timestamptz,uuid,text,text,uuid,timestamptz,timestamptz,numeric,numeric,text)',
    $a$paid >= total$a$,$b$paid >= coalesce(ipm_patient_total,total)$b$,2),
  ('public.rpc_paginated_invoices(uuid,uuid,integer,timestamptz,uuid,text,text,uuid,timestamptz,timestamptz,numeric,numeric,text)',
    $a$paid > 0 AND paid < total$a$,$b$paid > 0 AND paid < coalesce(ipm_patient_total,total)$b$,1),
  ('public.rpc_paginated_invoices(uuid,uuid,integer,timestamptz,uuid,text,text,uuid,timestamptz,timestamptz,numeric,numeric,text)',
    $a$AND paid = 0$a$,$b$AND paid = 0 AND (ipm_patient_total IS NULL OR ipm_patient_total>0)$b$,2),
  ('public.get_public_sale_invoice(text)',
    $a$'paid', COALESCE(v_sale.paid, 0),$a$,
    $b$'paid', COALESCE(v_sale.paid, 0),
      'ipm_patient_total', v_sale.ipm_patient_total,$b$,1),
  ('public.register_sale_payment(uuid,uuid,text,numeric,text,uuid)',
    $a$SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id;$a$,
    $b$SELECT * INTO v_sale FROM sales WHERE id = p_sale_id AND tenant_id = v_tenant_id FOR UPDATE;$b$,1),
  ('public.register_sale_payment(uuid,uuid,text,numeric,text,uuid)',
    $a$INSERT INTO sale_payments ($a$,
    $b$IF v_sale.ipm_patient_total IS NOT NULL THEN
  IF p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount>v_sale.ipm_patient_total-coalesce(v_sale.paid,0) THEN
   RAISE EXCEPTION 'Le règlement dépasse le solde patient.' USING ERRCODE='22023';
  END IF;
  PERFORM 1 FROM public.cash_sessions
  WHERE id=p_cash_session_id AND tenant_id=v_tenant_id AND site_id=v_sale.site_id AND status='open'
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ouvrez une caisse du magasin de la facture.' USING ERRCODE='42501';END IF;
  IF public._cs_multi_enabled(v_tenant_id) THEN
   PERFORM public._cs_assert_operational(p_cash_session_id,v_tenant_id,v_sale.site_id);
  END IF;
END IF;
INSERT INTO sale_payments ($b$,1),
  ('public.register_sale_payment(uuid,uuid,text,numeric,text,uuid)',
    $a$>= v_sale.total$a$,$b$>= coalesce(v_sale.ipm_patient_total,v_sale.total)$b$,2),
  ('public.register_sale_payment(uuid,uuid,text,numeric,text,uuid)',
    $a$UPDATE sales SET paid = v_new_paid, status = v_new_status WHERE id = p_sale_id;$a$,
    $b$UPDATE sales SET paid = v_new_paid, status = v_new_status WHERE id = p_sale_id;
IF v_sale.ipm_patient_total IS NOT NULL THEN
 UPDATE public.ipm_ventes i
 SET part_beneficiaire_payee=coalesce(i.part_beneficiaire_payee,0)+p_amount
 FROM public.ipm_sale_line_snapshots proof
 WHERE proof.tenant_id=v_tenant_id AND proof.sale_id=p_sale_id
   AND i.tenant_id=v_tenant_id AND i.id=proof.ipm_sale_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Ventilation IPM indisponible.' USING ERRCODE='55000';END IF;
END IF;$b$,1)
 ) AS amendments(signature,anchor,replacement,expected) LOOP
  definition:=pg_get_functiondef(amendment.signature::regprocedure);
  IF (length(definition)-length(replace(definition,amendment.anchor,'')))/length(amendment.anchor)<>amendment.expected THEN
   RAISE EXCEPTION 'Ancre part patient inattendue pour % : %',amendment.signature,left(amendment.anchor,100);
  END IF;
  EXECUTE replace(definition,amendment.anchor,amendment.replacement);
 END LOOP;

 definition:=pg_get_functiondef('public._ipm_capture_new_sale_snapshot(uuid,uuid,uuid)'::regprocedure);
 IF strpos(definition,$a$cv.application_plafond)));$a$)=0 THEN
  RAISE EXCEPTION 'Ancre de capture de la part patient introuvable';
 END IF;
 EXECUTE replace(definition,$a$cv.application_plafond)));$a$,
 $b$cv.application_plafond)));
 UPDATE public.sales SET ipm_patient_total=i.part_client WHERE tenant_id=p_tenant AND id=p_sale;$b$);
END $patch$;
