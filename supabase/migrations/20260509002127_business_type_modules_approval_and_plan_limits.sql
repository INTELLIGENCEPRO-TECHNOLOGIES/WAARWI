/*
  # Business type, enabled modules, approval workflow, plan limits

  1. Tenants
    - Add business_type (default 'auto_parts')
    - Add enabled_modules jsonb
    - Add approval_status (pending / approved / rejected)

  2. Update 4 plans with concrete features and strict limits.

  3. Triggers enforcing plan limits on sites, profiles, articles.

  4. RPC tenant_usage for live counts.

  Notes: approval_status defaults 'pending' for new tenants. Existing tenants are
  marked approved so they keep working.
*/

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='business_type') THEN
    ALTER TABLE tenants ADD COLUMN business_type text NOT NULL DEFAULT 'auto_parts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='enabled_modules') THEN
    ALTER TABLE tenants ADD COLUMN enabled_modules jsonb NOT NULL DEFAULT
      '["dashboard","pos","cash_history","articles","stock","tiers","sales","billing","supplier_orders","online_orders","accounting","settings"]'::jsonb;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='tenants' AND column_name='approval_status') THEN
    ALTER TABLE tenants ADD COLUMN approval_status text NOT NULL DEFAULT 'pending';
    -- existing rows: mark approved
    UPDATE tenants SET approval_status = 'approved' WHERE approval_status = 'pending';
  END IF;
END $$;

UPDATE plans SET
  features = '["Catalogue jusqu''à 100 articles","1 magasin","2 utilisateurs","Caisse & ventes","Stock de base","Support email"]'::jsonb,
  limits = '{"sites":1,"users":2,"articles":100,"monthly_sales":200,"online_shop":false,"accounting":false,"supplier_orders":false}'::jsonb
WHERE code = 'trial';

UPDATE plans SET
  features = '["Catalogue jusqu''à 2 000 articles","2 magasins","5 utilisateurs","Boutique en ligne incluse","Commandes fournisseurs","Rapports de ventes","Support prioritaire"]'::jsonb,
  limits = '{"sites":2,"users":5,"articles":2000,"monthly_sales":-1,"online_shop":true,"accounting":false,"supplier_orders":true}'::jsonb
WHERE code = 'starter';

UPDATE plans SET
  features = '["Articles illimités","5 magasins","15 utilisateurs","Comptabilité SYSCOHADA","Rapports avancés","Boutique en ligne","API tierce"]'::jsonb,
  limits = '{"sites":5,"users":15,"articles":-1,"monthly_sales":-1,"online_shop":true,"accounting":true,"supplier_orders":true}'::jsonb
WHERE code = 'pro';

UPDATE plans SET
  features = '["Tout Pro","Magasins illimités","Utilisateurs illimités","Multi-sociétés","Account manager dédié","SLA 99.9%"]'::jsonb,
  limits = '{"sites":-1,"users":-1,"articles":-1,"monthly_sales":-1,"online_shop":true,"accounting":true,"supplier_orders":true}'::jsonb
WHERE code = 'enterprise';

CREATE OR REPLACE FUNCTION enforce_tenant_plan_limit(p_tenant_id uuid, p_key text, p_current int)
RETURNS void AS $$
DECLARE v_plan text; v_limit int;
BEGIN
  SELECT plan INTO v_plan FROM tenants WHERE id = p_tenant_id;
  IF v_plan IS NULL THEN RETURN; END IF;
  SELECT NULLIF(limits->>p_key, '')::int INTO v_limit FROM plans WHERE code = v_plan;
  IF v_limit IS NULL OR v_limit = -1 THEN RETURN; END IF;
  IF p_current >= v_limit THEN
    RAISE EXCEPTION 'Limite du plan % atteinte pour %: max %. Mettez à niveau votre abonnement.', v_plan, p_key, v_limit USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION check_sites_limit() RETURNS trigger AS $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM sites WHERE tenant_id = NEW.tenant_id;
  PERFORM enforce_tenant_plan_limit(NEW.tenant_id, 'sites', v_count);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_sites_plan_limit ON sites;
CREATE TRIGGER trg_sites_plan_limit BEFORE INSERT ON sites FOR EACH ROW EXECUTE FUNCTION check_sites_limit();

CREATE OR REPLACE FUNCTION check_users_limit() RETURNS trigger AS $$
DECLARE v_count int;
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;
  SELECT count(*) INTO v_count FROM profiles WHERE tenant_id = NEW.tenant_id;
  PERFORM enforce_tenant_plan_limit(NEW.tenant_id, 'users', v_count);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_profiles_plan_limit ON profiles;
CREATE TRIGGER trg_profiles_plan_limit BEFORE INSERT ON profiles FOR EACH ROW EXECUTE FUNCTION check_users_limit();

CREATE OR REPLACE FUNCTION check_articles_limit() RETURNS trigger AS $$
DECLARE v_count int;
BEGIN
  SELECT count(*) INTO v_count FROM articles WHERE tenant_id = NEW.tenant_id;
  PERFORM enforce_tenant_plan_limit(NEW.tenant_id, 'articles', v_count);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_articles_plan_limit ON articles;
CREATE TRIGGER trg_articles_plan_limit BEFORE INSERT ON articles FOR EACH ROW EXECUTE FUNCTION check_articles_limit();

CREATE OR REPLACE FUNCTION tenant_usage(p_tenant_id uuid)
RETURNS TABLE(sites_count int, users_count int, articles_count int, plan_code text, plan_limits jsonb) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT count(*) FROM sites WHERE tenant_id = p_tenant_id)::int,
    (SELECT count(*) FROM profiles WHERE tenant_id = p_tenant_id)::int,
    (SELECT count(*) FROM articles WHERE tenant_id = p_tenant_id)::int,
    (SELECT plan FROM tenants WHERE id = p_tenant_id),
    (SELECT p.limits FROM plans p JOIN tenants t ON t.plan = p.code WHERE t.id = p_tenant_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION tenant_usage(uuid) TO authenticated;