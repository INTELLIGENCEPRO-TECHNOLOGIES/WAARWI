-- F10: the accounting report RPCs are SECURITY DEFINER and filtered only on the
-- caller-supplied p_tenant_id, so any caller could read another company's ledger.
-- Inject an explicit tenant guard into each and remove anon EXECUTE.
DO $mig$
DECLARE
  v_name text;
  v_def text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'grand_livre','balance_generale','balance_par_journal','balance_tiers','recherche_ecritures'
  ] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name AND p.prolang = (SELECT oid FROM pg_language WHERE lanname='sql');

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'sql function % not found', v_name;
    END IF;

    IF position('assert_tenant_access' in v_def) = 0 THEN
      v_def := regexp_replace(
        v_def,
        'AS \$function\$',
        'AS $function$' || E'\n SELECT public.assert_tenant_access(p_tenant_id);\n'
      );
      EXECUTE v_def;
    END IF;
  END LOOP;

  -- plpgsql variant
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'interrogation_tiers';

  IF v_def IS NOT NULL AND position('assert_tenant_access' in v_def) = 0 THEN
    v_def := regexp_replace(v_def, E'\nBEGIN\n',
      E'\nBEGIN\n  PERFORM public.assert_tenant_access(p_tenant_id);\n');
    EXECUTE v_def;
  END IF;
END;
$mig$;

REVOKE ALL ON FUNCTION public.grand_livre(uuid, date, date, text) FROM anon;
REVOKE ALL ON FUNCTION public.balance_generale(uuid, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.balance_par_journal(uuid, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.balance_tiers(uuid, text, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.recherche_ecritures(uuid, text, text, text, date, date, numeric, numeric, integer) FROM anon;
REVOKE ALL ON FUNCTION public.interrogation_tiers(uuid, uuid, text, date, date) FROM anon;
