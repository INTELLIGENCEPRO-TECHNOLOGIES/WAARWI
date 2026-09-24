-- Security hardening: shared authorization helpers + F1 (delete_tenant_permanently)

CREATE OR REPLACE FUNCTION public.is_trusted_backend()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '') = ''
      OR (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public.assert_tenant_access(p_tenant uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.is_trusted_backend() OR public.is_super_admin() THEN
    RETURN;
  END IF;
  IF p_tenant IS NOT NULL AND p_tenant = public.current_tenant_id() THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'Acces refuse' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_platform_operator()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF public.is_trusted_backend() OR public.is_super_admin() THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'Acces refuse' USING ERRCODE = '42501';
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_trusted_backend() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.assert_tenant_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assert_platform_operator() TO authenticated;

-- F1: only a platform operator may permanently delete a tenant, and the audit
-- actor is derived from the session rather than taken from the request body.
CREATE OR REPLACE FUNCTION public.delete_tenant_permanently(
  p_tenant_id uuid,
  p_actor_id uuid DEFAULT NULL::uuid,
  p_actor_email text DEFAULT ''::text,
  p_reason text DEFAULT ''::text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant_name text;
  v_user_ids uuid[];
  v_user_count int;
  v_tables_summary jsonb;
  v_actor_id uuid;
  v_actor_email text;
BEGIN
  PERFORM public.assert_platform_operator();

  v_actor_id := coalesce(auth.uid(), p_actor_id);
  v_actor_email := coalesce((SELECT email FROM profiles WHERE id = auth.uid()), p_actor_email);

  SELECT name INTO v_tenant_name FROM tenants WHERE id = p_tenant_id;

  IF v_tenant_name IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Tenant introuvable');
  END IF;

  SELECT ARRAY_AGG(id) INTO v_user_ids FROM profiles WHERE tenant_id = p_tenant_id;
  v_user_count := COALESCE(array_length(v_user_ids, 1), 0);

  SELECT jsonb_build_object(
    'tenant_name', v_tenant_name,
    'users', v_user_count,
    'articles', (SELECT COUNT(*) FROM articles WHERE tenant_id = p_tenant_id),
    'sales', (SELECT COUNT(*) FROM sales WHERE tenant_id = p_tenant_id),
    'customers', (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id),
    'suppliers', (SELECT COUNT(*) FROM suppliers WHERE tenant_id = p_tenant_id)
  ) INTO v_tables_summary;

  INSERT INTO platform_events (actor_id, actor_email, tenant_id, action, payload)
  VALUES (v_actor_id, v_actor_email, p_tenant_id, 'tenant.delete',
    jsonb_build_object('reason', p_reason, 'tenant_name', v_tenant_name, 'data_summary', v_tables_summary));

  DELETE FROM tenants WHERE id = p_tenant_id;
  DELETE FROM profiles WHERE id = ANY(COALESCE(v_user_ids, ARRAY[]::uuid[]));

  RETURN jsonb_build_object(
    'success', true,
    'tenant_name', v_tenant_name,
    'user_ids', COALESCE(v_user_ids, ARRAY[]::uuid[]),
    'data_summary', v_tables_summary
  );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_tenant_permanently(uuid, uuid, text, text) FROM anon, authenticated;
