-- F13: _apply_tenant_metadata allow-listed which columns could be written but never
-- checked who was calling, so anyone could rewrite a tenant's identity and modules.
DO $mig$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='_apply_tenant_metadata';

  IF v_def IS NULL THEN RAISE EXCEPTION 'function not found'; END IF;

  IF position('assert_tenant_access' in v_def) = 0 THEN
    v_def := regexp_replace(v_def, E'\nBEGIN\n',
      E'\nBEGIN\n  PERFORM public.assert_tenant_access(p_tenant);\n');
    EXECUTE v_def;
  END IF;
END;
$mig$;

REVOKE ALL ON FUNCTION public._apply_tenant_metadata(uuid, jsonb) FROM anon, authenticated;
