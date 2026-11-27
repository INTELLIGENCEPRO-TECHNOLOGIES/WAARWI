DO $resume$
DECLARE definition text := pg_get_functiondef('public._br_v3_dispatch_backups()'::regprocedure);
BEGIN
  IF position('j.status IN (''capture_ready'',''exporting'')' IN definition)=0 THEN
    RAISE EXCEPTION 'BRV-045: fonction de planification V3 inattendue';
  END IF;
  EXECUTE replace(definition,
    'j.status IN (''capture_ready'',''exporting'')',
    'j.status IN (''capture_ready'',''exporting'',''verifying'',''publishing'')');
END
$resume$;
