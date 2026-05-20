/*
  # Platform Admin — plans, subscriptions, tenant messages, activity log

  1. New tables
    - plans: catalogue de plans (code, name, description, price_monthly, price_yearly, features jsonb, limits jsonb, is_public, sort_order)
    - tenant_subscriptions: historique des abonnements (tenant_id, plan_code, started_at, ends_at, status, auto_renew, amount, currency, notes)
    - tenant_messages: messages envoyés aux tenants (broadcast ou ciblés) affichés en popup au login. Champs: title, body, severity, target (all|tenant|plan), tenant_id, plan_code, requires_ack, published_at, expires_at
    - tenant_message_reads: accusés de lecture par user
    - platform_events: journal d'audit des actions super_admin (actor_id, tenant_id, action, payload)

  2. Seed 4 plans (trial, starter, pro, enterprise)
  3. RLS : super_admin full control ; tenants voient leurs propres données & messages
*/

CREATE TABLE IF NOT EXISTS plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  description text DEFAULT '',
  price_monthly numeric(12,2) DEFAULT 0,
  price_yearly numeric(12,2) DEFAULT 0,
  currency text DEFAULT 'FCFA',
  features jsonb DEFAULT '[]'::jsonb,
  limits jsonb DEFAULT '{}'::jsonb,
  is_public boolean DEFAULT true,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plans' AND policyname='Anyone view plans') THEN
    CREATE POLICY "Anyone view plans" ON plans FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plans' AND policyname='Super admin insert plans') THEN
    CREATE POLICY "Super admin insert plans" ON plans FOR INSERT TO authenticated WITH CHECK (is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plans' AND policyname='Super admin update plans') THEN
    CREATE POLICY "Super admin update plans" ON plans FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='plans' AND policyname='Super admin delete plans') THEN
    CREATE POLICY "Super admin delete plans" ON plans FOR DELETE TO authenticated USING (is_super_admin());
  END IF;
END $$;

INSERT INTO plans (code, name, description, price_monthly, price_yearly, features, limits, sort_order) VALUES
  ('trial', 'Essai', 'Accès limité pendant 14 jours', 0, 0,
    '["Catalogue basique","1 magasin","2 utilisateurs","Support email"]'::jsonb,
    '{"sites":1,"users":2,"articles":100,"monthly_sales":200}'::jsonb, 0),
  ('starter', 'Starter', 'Idéal pour démarrer', 15000, 150000,
    '["Catalogue complet","2 magasins","5 utilisateurs","Boutique en ligne","Support prioritaire"]'::jsonb,
    '{"sites":2,"users":5,"articles":2000,"monthly_sales":-1}'::jsonb, 1),
  ('pro', 'Pro', 'Pour PME en croissance', 35000, 350000,
    '["Tout Starter","5 magasins","15 utilisateurs","Comptabilité SYSCOHADA","Rapports avancés","API"]'::jsonb,
    '{"sites":5,"users":15,"articles":-1,"monthly_sales":-1}'::jsonb, 2),
  ('enterprise', 'Enterprise', 'Grandes entreprises, support dédié', 80000, 800000,
    '["Tout Pro","Magasins illimités","Utilisateurs illimités","Multi-sociétés","Account manager dédié","SLA 99.9%"]'::jsonb,
    '{"sites":-1,"users":-1,"articles":-1,"monthly_sales":-1}'::jsonb, 3)
ON CONFLICT (code) DO NOTHING;

-- Subscriptions history
CREATE TABLE IF NOT EXISTS tenant_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES plans(code),
  status text NOT NULL DEFAULT 'active',
  billing_cycle text DEFAULT 'monthly',
  amount numeric(12,2) DEFAULT 0,
  currency text DEFAULT 'FCFA',
  started_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  auto_renew boolean DEFAULT true,
  cancelled_at timestamptz,
  cancel_reason text DEFAULT '',
  notes text DEFAULT '',
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_status ON tenant_subscriptions(status);

ALTER TABLE tenant_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_subscriptions' AND policyname='Tenant members view own subs') THEN
    CREATE POLICY "Tenant members view own subs" ON tenant_subscriptions FOR SELECT TO authenticated
      USING (tenant_id = current_tenant_id() OR is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_subscriptions' AND policyname='Super admin insert subs') THEN
    CREATE POLICY "Super admin insert subs" ON tenant_subscriptions FOR INSERT TO authenticated WITH CHECK (is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_subscriptions' AND policyname='Super admin update subs') THEN
    CREATE POLICY "Super admin update subs" ON tenant_subscriptions FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_subscriptions' AND policyname='Super admin delete subs') THEN
    CREATE POLICY "Super admin delete subs" ON tenant_subscriptions FOR DELETE TO authenticated USING (is_super_admin());
  END IF;
END $$;

-- Tenant messages (popups)
CREATE TABLE IF NOT EXISTS tenant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  severity text NOT NULL DEFAULT 'info',
  target text NOT NULL DEFAULT 'all',
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  plan_code text REFERENCES plans(code),
  requires_ack boolean DEFAULT true,
  cta_label text DEFAULT '',
  cta_url text DEFAULT '',
  published_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_messages_target ON tenant_messages(target, tenant_id, plan_code);

ALTER TABLE tenant_messages ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_messages' AND policyname='Members view eligible messages') THEN
    CREATE POLICY "Members view eligible messages" ON tenant_messages FOR SELECT TO authenticated
      USING (
        is_super_admin() OR
        target = 'all' OR
        (target = 'tenant' AND tenant_id = current_tenant_id()) OR
        (target = 'plan' AND plan_code = (SELECT plan FROM tenants WHERE id = current_tenant_id()))
      );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_messages' AND policyname='Super admin insert messages') THEN
    CREATE POLICY "Super admin insert messages" ON tenant_messages FOR INSERT TO authenticated WITH CHECK (is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_messages' AND policyname='Super admin update messages') THEN
    CREATE POLICY "Super admin update messages" ON tenant_messages FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_messages' AND policyname='Super admin delete messages') THEN
    CREATE POLICY "Super admin delete messages" ON tenant_messages FOR DELETE TO authenticated USING (is_super_admin());
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS tenant_message_reads (
  message_id uuid NOT NULL REFERENCES tenant_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  acknowledged_at timestamptz DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE tenant_message_reads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_message_reads' AND policyname='Users view own reads') THEN
    CREATE POLICY "Users view own reads" ON tenant_message_reads FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR is_super_admin());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='tenant_message_reads' AND policyname='Users insert own reads') THEN
    CREATE POLICY "Users insert own reads" ON tenant_message_reads FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;
END $$;

-- Platform audit log
CREATE TABLE IF NOT EXISTS platform_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id),
  actor_email text DEFAULT '',
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_events_created ON platform_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_events_tenant ON platform_events(tenant_id, created_at DESC);

ALTER TABLE platform_events ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='platform_events' AND policyname='Super admin view events') THEN
    CREATE POLICY "Super admin view events" ON platform_events FOR SELECT TO authenticated USING (is_super_admin());
  END IF;
END $$;
