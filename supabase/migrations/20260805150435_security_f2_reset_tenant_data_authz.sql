-- F2: reset_tenant_data may only wipe the caller's own tenant (or any tenant for
-- a platform operator / trusted backend). Guard injected at the top of the body.
DO $mig$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'reset_tenant_data';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'reset_tenant_data not found';
  END IF;

  IF position('assert_tenant_access' in v_def) > 0 THEN
    RETURN;
  END IF;

  v_def := regexp_replace(
    v_def,
    E'\nBEGIN\n',
    E'\nBEGIN\n  PERFORM public.assert_tenant_access(p_tenant_id);\n'
  );

  EXECUTE v_def;
END;
$mig$;

REVOKE ALL ON FUNCTION public.reset_tenant_data(uuid) FROM anon;
