CREATE OR REPLACE FUNCTION public._document_edit_access(t uuid, k text, r text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE s public.sales%ROWTYPE; m date;
BEGIN
 IF auth.uid() IS NULL OR t IS NULL OR t IS DISTINCT FROM public.current_tenant_id() THEN RAISE EXCEPTION 'Accès refusé.' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.tenant_id=t AND p.is_active IS NOT FALSE) THEN RAISE EXCEPTION 'Compte utilisateur inactif.' USING ERRCODE='42501'; END IF;
 IF k='accounting_journal' THEN
  PERFORM public._bank_reconciliation_access(t,true);
  IF r IS NULL OR r !~ '^[A-Z]{2,3}:[0-9]{4}-(0[1-9]|1[0-2])$' THEN RAISE EXCEPTION 'Journal ou période invalide.' USING ERRCODE='22023'; END IF;
  m:= (split_part(r,':',2)||'-01')::date;
  IF m<date '2000-01-01' OR m>date_trunc('month',now() AT TIME ZONE 'Africa/Dakar')::date OR NOT public._accounting_journal_allowed(t,split_part(r,':',1),true) THEN RAISE EXCEPTION 'Journal ou période indisponible.' USING ERRCODE='22023';END IF;
 ELSIF k='sale' THEN
  IF r IS NULL OR r !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RAISE EXCEPTION 'Document invalide.' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM public.sales WHERE tenant_id=t AND id=r::uuid;
  IF NOT FOUND OR public.current_user_can_access_site(s.site_id) IS DISTINCT FROM true OR public._cr_profile_has_permission(auth.uid(),'edit_invoices') IS DISTINCT FROM true THEN RAISE EXCEPTION 'Accès au document refusé.' USING ERRCODE='42501'; END IF;
 ELSE RAISE EXCEPTION 'Type de document non pris en charge.' USING ERRCODE='22023';END IF;
END $function$;
ALTER POLICY "waarwi_document_edit_private_receive" ON realtime.messages USING (extension='broadcast' AND topic=(SELECT realtime.topic()) AND topic='waarwi-edit:'||(SELECT auth.uid())::text);

