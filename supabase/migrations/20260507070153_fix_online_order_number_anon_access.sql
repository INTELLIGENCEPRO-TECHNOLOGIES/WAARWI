/*
  # Fix next_online_order_number for anon access

  ## Problem
  The function next_online_order_number uses SECURITY INVOKER (default), so when
  called by the anon role from the public shop, it tries to call nextval() as anon
  which lacks USAGE on the sequence. This causes the RLS violation cascade.

  ## Fix
  1. Recreate the function as SECURITY DEFINER so it runs as the owner (postgres)
     regardless of who calls it.
  2. Grant EXECUTE on the function to anon so the shop can call it.
*/

CREATE OR REPLACE FUNCTION next_online_order_number(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_num bigint;
BEGIN
  v_num := nextval('online_order_seq');
  RETURN 'WEB-' || to_char(v_num, 'FM000000');
END;
$$;

GRANT EXECUTE ON FUNCTION next_online_order_number(uuid) TO anon;
