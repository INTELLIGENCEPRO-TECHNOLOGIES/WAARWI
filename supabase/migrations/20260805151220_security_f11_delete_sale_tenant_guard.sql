-- F11: delete_sale_and_recalculate accepted both the sale id and the tenant id from
-- the request, so any caller could delete another company's invoice.
DO $mig$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='delete_sale_and_recalculate';

  IF v_def IS NULL THEN RAISE EXCEPTION 'function not found'; END IF;

  IF position('assert_tenant_access' in v_def) = 0 THEN
    v_def := regexp_replace(v_def, E'\nBEGIN\n',
      E'\nBEGIN\n  PERFORM public.assert_tenant_access(p_tenant_id);\n');
    EXECUTE v_def;
  END IF;
END;
$mig$;

REVOKE ALL ON FUNCTION public.delete_sale_and_recalculate(uuid, uuid) FROM anon;
