-- Give the public wrapper the same 60s timeout as the internal function
-- so the REST/PostgREST layer does not kill the call early.
ALTER FUNCTION public.br_create_backup(text, text)
  SET statement_timeout TO '60s';

NOTIFY pgrst, 'reload schema';