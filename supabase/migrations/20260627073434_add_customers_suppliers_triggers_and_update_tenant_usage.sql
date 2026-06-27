
-- Trigger function for customers limit
CREATE OR REPLACE FUNCTION check_customers_limit()
RETURNS TRIGGER AS $$
DECLARE v_count int;
BEGIN
SELECT count(*) INTO v_count FROM customers WHERE tenant_id = NEW.tenant_id;
PERFORM enforce_tenant_plan_limit(NEW.tenant_id, 'max_clients', v_count);
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger function for suppliers limit
CREATE OR REPLACE FUNCTION check_suppliers_limit()
RETURNS TRIGGER AS $$
DECLARE v_count int;
BEGIN
SELECT count(*) INTO v_count FROM suppliers WHERE tenant_id = NEW.tenant_id;
PERFORM enforce_tenant_plan_limit(NEW.tenant_id, 'max_suppliers', v_count);
RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers
CREATE TRIGGER trg_customers_plan_limit
BEFORE INSERT ON customers
FOR EACH ROW EXECUTE FUNCTION check_customers_limit();

CREATE TRIGGER trg_suppliers_plan_limit
BEFORE INSERT ON suppliers
FOR EACH ROW EXECUTE FUNCTION check_suppliers_limit();

-- Update tenant_usage() to include customers_count and suppliers_count
DROP FUNCTION IF EXISTS tenant_usage(uuid);

CREATE OR REPLACE FUNCTION tenant_usage(p_tenant_id uuid)
RETURNS TABLE(
  sites_count int,
  users_count int,
  articles_count int,
  customers_count int,
  suppliers_count int,
  plan_code text,
  plan_limits jsonb
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
RETURN QUERY
SELECT
(SELECT count(*) FROM sites WHERE tenant_id = p_tenant_id)::int,
(SELECT count(*) FROM profiles WHERE tenant_id = p_tenant_id)::int,
(SELECT count(*) FROM articles WHERE tenant_id = p_tenant_id)::int,
(SELECT count(*) FROM customers WHERE tenant_id = p_tenant_id)::int,
(SELECT count(*) FROM suppliers WHERE tenant_id = p_tenant_id)::int,
(SELECT plan FROM tenants WHERE id = p_tenant_id),
get_tenant_effective_limits(p_tenant_id);
END;
$$;
