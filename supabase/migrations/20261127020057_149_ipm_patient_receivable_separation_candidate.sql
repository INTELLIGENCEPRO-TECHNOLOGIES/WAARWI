-- 149 : patient receivable ceiling from the original server-created snapshot only.
-- No retrospective inference, no update of historical rows, no cash movement.
CREATE FUNCTION public._ipm_patient_ceiling(p_tenant uuid,p_sale uuid,p_fallback numeric)
RETURNS numeric LANGUAGE sql STABLE SET search_path='' AS $f$
 SELECT coalesce((SELECT (x.snapshot->>'patient')::numeric FROM public.ipm_sale_line_snapshots x WHERE x.tenant_id=p_tenant AND x.sale_id=p_sale),p_fallback)
$f$;
REVOKE ALL ON FUNCTION public._ipm_patient_ceiling(uuid,uuid,numeric) FROM PUBLIC,anon,authenticated,service_role;

-- Safety net for all writers of sales.paid; old invoices are deliberately not reclassified.
CREATE FUNCTION public._guard_ipm_patient_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE cap numeric;
BEGIN
 SELECT (x.snapshot->>'patient')::numeric INTO cap FROM public.ipm_sale_line_snapshots x WHERE x.tenant_id=OLD.tenant_id AND x.sale_id=OLD.id;
 IF FOUND AND coalesce(NEW.paid,0)>coalesce(OLD.paid,0) AND (NEW.paid>cap OR NEW.paid::text IN ('NaN','Infinity','-Infinity')) THEN
  RAISE EXCEPTION 'Le règlement dépasse la part patient historique ; la part organisme ne peut pas être encaissée sur cette facture.' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public._guard_ipm_patient_paid() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER guard_ipm_patient_paid BEFORE UPDATE OF paid ON public.sales FOR EACH ROW EXECUTE FUNCTION public._guard_ipm_patient_paid();

DO $p$
DECLARE src text;a text;b text;n int;
BEGIN
 src:=pg_get_functiondef('public.recalculate_customer_balance(uuid)'::regprocedure);
 a:=$a$SELECT COALESCE\(SUM\(total\), 0\)[[:space:]]+INTO v_sales[[:space:]]+FROM public\.sales[[:space:]]+WHERE customer_id = p_customer_id AND tenant_id = v_tenant_id[[:space:]]+AND status <> 'cancelled' AND deleted_at IS NULL;$a$;
 b:=$b$SELECT COALESCE(SUM(public._ipm_patient_ceiling(s.tenant_id,s.id,s.total)), 0) INTO v_sales
FROM public.sales s
WHERE s.customer_id = p_customer_id AND s.tenant_id = v_tenant_id
AND s.status <> 'cancelled' AND s.deleted_at IS NULL;$b$;
 SELECT count(*) INTO n FROM regexp_matches(src,a,'g');IF n<>1 THEN RAISE EXCEPTION 'Ancre solde patient : %',n;END IF;EXECUTE regexp_replace(src,a,b);

 src:=pg_get_functiondef('public.apply_credit_to_sale(uuid,uuid,numeric)'::regprocedure);
 a:=$a$v_remaining := GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0));$a$;
 b:=$b$v_remaining := GREATEST(0, public._ipm_patient_ceiling(v_tenant_id,v_sale.id,COALESCE(v_sale.total,0)) - COALESCE(v_sale.paid,0));$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>1 THEN RAISE EXCEPTION 'Ancre avoir patient : %',n;END IF;EXECUTE replace(src,a,b);

 src:=pg_get_functiondef('public._apply_avoirs_internal(uuid,uuid)'::regprocedure);
 a:=$a$GREATEST(0, COALESCE(v_sale.total, 0) - COALESCE(v_sale.paid, 0))$a$;
 b:=$b$GREATEST(0, public._ipm_patient_ceiling(p_tenant_id,v_sale.id,COALESCE(v_sale.total,0)) - COALESCE(v_sale.paid,0))$b$;
 n:=(length(src)-length(replace(src,a,'')))/length(a);IF n<>2 THEN RAISE EXCEPTION 'Ancres avoirs automatiques patient : %',n;END IF;EXECUTE replace(src,a,b);
END $p$;
