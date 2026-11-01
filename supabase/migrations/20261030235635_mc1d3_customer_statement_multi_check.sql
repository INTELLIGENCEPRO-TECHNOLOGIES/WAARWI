/*
# MC1-D.3 - Correctif releve client : test du mode multi-caisse

1. get_customer_statement : le test du mode utilise _cs_multi_current() (executable par
   authenticated) au lieu de _cs_multi_enabled(...) (non executable par authenticated).
   Aucun autre changement.
*/
DO $mig$
DECLARE
  d text;
  a text := 'public._cs_multi_enabled(v_tenant_id) THEN';
BEGIN
  d := pg_get_functiondef('public.get_customer_statement(uuid,date,date)'::regprocedure);
  IF position(a in d) = 0 THEN RETURN; END IF;
  EXECUTE replace(d, a, 'public._cs_multi_current() THEN');
END;
$mig$;
