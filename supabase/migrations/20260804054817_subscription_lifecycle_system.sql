/*
# Subscription Lifecycle Automation System

## Overview
Complete overhaul of subscription management: automated renewals, expiration detection,
admin email alerts with action tokens, in-app real-time reminders, and auto-suspension option.

## New Tables
- subscription_action_tokens: Secure one-time tokens for email-based suspend/reactivate actions

## Modified Tables
- tenants: Add auto_suspend_enabled and auto_suspend_grace_days
- tenant_subscriptions: Add completed_at for clean lifecycle tracking

## New Functions
- process_subscription_lifecycle(): Daily job for renewals, expiry, suspension
- execute_subscription_action_token(p_token): Email action handler
- fix_pending_subscriptions(): One-time data fix
*/

-- 1. Add columns to tenants for auto-suspension config
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_suspend_enabled boolean DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_suspend_grace_days integer DEFAULT 7;

-- 2. Add completed_at to tenant_subscriptions for clean lifecycle
ALTER TABLE tenant_subscriptions ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- 3. Create action tokens table
CREATE TABLE IF NOT EXISTS subscription_action_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('suspend', 'reactivate')),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '48 hours'),
  used_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_action_tokens_token ON subscription_action_tokens(token);
CREATE INDEX IF NOT EXISTS idx_action_tokens_tenant ON subscription_action_tokens(tenant_id);

ALTER TABLE subscription_action_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "super_admin_select_action_tokens" ON subscription_action_tokens;
CREATE POLICY "super_admin_select_action_tokens" ON subscription_action_tokens
  FOR SELECT TO authenticated USING (is_super_admin());

DROP POLICY IF EXISTS "super_admin_insert_action_tokens" ON subscription_action_tokens;
CREATE POLICY "super_admin_insert_action_tokens" ON subscription_action_tokens
  FOR INSERT TO authenticated WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "super_admin_update_action_tokens" ON subscription_action_tokens;
CREATE POLICY "super_admin_update_action_tokens" ON subscription_action_tokens
  FOR UPDATE TO authenticated USING (is_super_admin()) WITH CHECK (is_super_admin());

DROP POLICY IF EXISTS "super_admin_delete_action_tokens" ON subscription_action_tokens;
CREATE POLICY "super_admin_delete_action_tokens" ON subscription_action_tokens
  FOR DELETE TO authenticated USING (is_super_admin());

-- 4. Fix pending subscriptions that should be active
CREATE OR REPLACE FUNCTION fix_pending_subscriptions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  fixed_count integer;
BEGIN
  UPDATE tenant_subscriptions
  SET status = 'active'
  WHERE status = 'pending'
    AND started_at <= now()
    AND (ends_at IS NULL OR ends_at > now())
    AND tenant_id IN (
      SELECT id FROM tenants WHERE is_active = true AND approval_status = 'approved'
    );
  GET DIAGNOSTICS fixed_count = ROW_COUNT;
  RETURN fixed_count;
END;
$$;

SELECT fix_pending_subscriptions();

-- 5. Execute action token (suspend/reactivate from email)
CREATE OR REPLACE FUNCTION execute_subscription_action_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record subscription_action_tokens%ROWTYPE;
  v_tenant_name text;
BEGIN
  SELECT * INTO v_record
  FROM subscription_action_tokens
  WHERE token = p_token;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token invalide ou introuvable');
  END IF;

  IF v_record.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ce lien a deja ete utilise');
  END IF;

  IF v_record.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ce lien a expire (validite 48h)');
  END IF;

  UPDATE subscription_action_tokens SET used_at = now() WHERE id = v_record.id;

  SELECT name INTO v_tenant_name FROM tenants WHERE id = v_record.tenant_id;

  IF v_record.action = 'suspend' THEN
    UPDATE tenants
    SET is_active = false, status = 'suspended', subscription_status = 'suspended'
    WHERE id = v_record.tenant_id;

    INSERT INTO platform_events (actor_email, tenant_id, action, payload)
    VALUES ('system@waarwi.com', v_record.tenant_id, 'tenant.suspend',
      jsonb_build_object('reason', 'Suspendu via email admin', 'method', 'action_token'));

    RETURN jsonb_build_object('success', true, 'action', 'suspend', 'tenant_name', v_tenant_name);

  ELSIF v_record.action = 'reactivate' THEN
    UPDATE tenants
    SET is_active = true, status = 'active', subscription_status = 'active'
    WHERE id = v_record.tenant_id;

    INSERT INTO platform_events (actor_email, tenant_id, action, payload)
    VALUES ('system@waarwi.com', v_record.tenant_id, 'tenant.reactivate',
      jsonb_build_object('reason', 'Reactive via email admin', 'method', 'action_token'));

    RETURN jsonb_build_object('success', true, 'action', 'reactivate', 'tenant_name', v_tenant_name);
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Action inconnue');
END;
$$;

-- 6. Main lifecycle processing function
CREATE OR REPLACE FUNCTION process_subscription_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_renewed integer := 0;
  v_expired integer := 0;
  v_suspended integer := 0;
  v_reminders integer := 0;
  v_tenant RECORD;
  v_new_start timestamptz;
  v_new_end timestamptz;
BEGIN
  -- PHASE 1: Auto-renew expired subscriptions with auto_renew = true
  FOR v_tenant IN
    SELECT t.id, t.name, t.email, t.plan, t.billing_cycle, t.plan_expires_at
    FROM tenants t
    WHERE t.is_active = true
      AND t.approval_status = 'approved'
      AND t.auto_renew = true
      AND t.plan_expires_at IS NOT NULL
      AND t.plan_expires_at <= now()
      AND t.billing_cycle != 'lifetime'
      AND t.subscription_status != 'suspended'
  LOOP
    v_new_start := v_tenant.plan_expires_at;
    IF v_tenant.billing_cycle = 'yearly' THEN
      v_new_end := v_new_start + interval '1 year';
    ELSE
      v_new_end := v_new_start + interval '1 month';
    END IF;

    UPDATE tenant_subscriptions
    SET status = 'completed', completed_at = now()
    WHERE tenant_id = v_tenant.id AND status = 'active';

    INSERT INTO tenant_subscriptions (tenant_id, plan_code, billing_cycle, amount, currency, started_at, ends_at, auto_renew, status, notes)
    SELECT v_tenant.id, v_tenant.plan, v_tenant.billing_cycle,
      CASE WHEN v_tenant.billing_cycle = 'yearly' THEN p.price_yearly ELSE p.price_monthly END,
      'FCFA', v_new_start, v_new_end, true, 'active',
      'Renouvellement automatique'
    FROM plans p WHERE p.code = v_tenant.plan;

    UPDATE tenants
    SET plan_expires_at = v_new_end,
        subscription_start_date = v_new_start,
        subscription_status = 'active'
    WHERE id = v_tenant.id;

    INSERT INTO platform_events (actor_email, tenant_id, action, payload)
    VALUES ('system@waarwi.com', v_tenant.id, 'subscription.auto_renewed',
      jsonb_build_object('new_start', v_new_start, 'new_end', v_new_end, 'plan', v_tenant.plan));

    v_renewed := v_renewed + 1;
  END LOOP;

  -- PHASE 2: Mark expired (no auto-renew, past expiration)
  FOR v_tenant IN
    SELECT t.id, t.name, t.email, t.plan, t.plan_expires_at
    FROM tenants t
    WHERE t.is_active = true
      AND t.approval_status = 'approved'
      AND t.auto_renew = false
      AND t.plan_expires_at IS NOT NULL
      AND t.plan_expires_at <= now()
      AND t.billing_cycle != 'lifetime'
      AND t.subscription_status NOT IN ('expired', 'suspended')
  LOOP
    UPDATE tenants SET subscription_status = 'expired' WHERE id = v_tenant.id;

    UPDATE tenant_subscriptions
    SET status = 'expired'
    WHERE tenant_id = v_tenant.id AND status = 'active';

    INSERT INTO platform_events (actor_email, tenant_id, action, payload)
    VALUES ('system@waarwi.com', v_tenant.id, 'subscription.expired',
      jsonb_build_object('plan', v_tenant.plan, 'expired_at', v_tenant.plan_expires_at));

    v_expired := v_expired + 1;
  END LOOP;

  -- PHASE 3: Auto-suspend if enabled and grace period exceeded
  FOR v_tenant IN
    SELECT t.id, t.name, t.plan_expires_at, t.auto_suspend_grace_days
    FROM tenants t
    WHERE t.is_active = true
      AND t.auto_suspend_enabled = true
      AND t.subscription_status = 'expired'
      AND t.plan_expires_at IS NOT NULL
      AND t.plan_expires_at + (t.auto_suspend_grace_days || ' days')::interval <= now()
  LOOP
    UPDATE tenants
    SET is_active = false, status = 'suspended', subscription_status = 'suspended'
    WHERE id = v_tenant.id;

    INSERT INTO platform_events (actor_email, tenant_id, action, payload)
    VALUES ('system@waarwi.com', v_tenant.id, 'tenant.auto_suspended',
      jsonb_build_object('grace_days', v_tenant.auto_suspend_grace_days,
        'expired_at', v_tenant.plan_expires_at));

    v_suspended := v_suspended + 1;
  END LOOP;

  -- PHASE 4: In-app reminders for expiring-soon (5 days before)
  FOR v_tenant IN
    SELECT t.id, t.name, t.plan, t.plan_expires_at, t.billing_cycle
    FROM tenants t
    WHERE t.is_active = true
      AND t.approval_status = 'approved'
      AND t.plan_expires_at IS NOT NULL
      AND t.plan_expires_at > now()
      AND t.plan_expires_at <= now() + interval '5 days'
      AND t.billing_cycle != 'lifetime'
      AND t.subscription_status NOT IN ('expired', 'suspended')
      AND NOT EXISTS (
        SELECT 1 FROM tenant_messages tm
        WHERE tm.tenant_id = t.id
          AND tm.title LIKE '%expiration%'
          AND tm.created_at > now() - interval '1 day'
      )
  LOOP
    INSERT INTO tenant_messages (title, body, severity, target, tenant_id, requires_ack, expires_at)
    VALUES (
      'Votre abonnement arrive a expiration',
      'Votre abonnement ' || v_tenant.plan || ' (' ||
        CASE WHEN v_tenant.billing_cycle = 'yearly' THEN 'annuel' ELSE 'mensuel' END ||
        ') expire le ' || to_char(v_tenant.plan_expires_at, 'DD/MM/YYYY') ||
        '. Veuillez contacter l''administrateur pour le renouvellement.',
      'warning',
      'tenant',
      v_tenant.id,
      true,
      v_tenant.plan_expires_at + interval '7 days'
    );
    v_reminders := v_reminders + 1;
  END LOOP;

  -- PHASE 4b: Urgent reminders for already-expired (daily)
  FOR v_tenant IN
    SELECT t.id, t.name, t.plan, t.plan_expires_at
    FROM tenants t
    WHERE t.is_active = true
      AND t.subscription_status = 'expired'
      AND NOT EXISTS (
        SELECT 1 FROM tenant_messages tm
        WHERE tm.tenant_id = t.id
          AND tm.title LIKE '%expir%'
          AND tm.created_at > now() - interval '1 day'
      )
  LOOP
    INSERT INTO tenant_messages (title, body, severity, target, tenant_id, requires_ack, expires_at)
    VALUES (
      'Votre abonnement est expire',
      'Votre abonnement a expire le ' || to_char(v_tenant.plan_expires_at, 'DD/MM/YYYY') ||
        '. Votre acces peut etre suspendu a tout moment. Veuillez contacter l''administrateur pour le renouvellement.',
      'critical',
      'tenant',
      v_tenant.id,
      true,
      now() + interval '2 days'
    );
    v_reminders := v_reminders + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'renewed', v_renewed,
    'expired', v_expired,
    'suspended', v_suspended,
    'reminders_sent', v_reminders,
    'processed_at', now()
  );
END;
$$;

-- 7. Clean up old irrelevant subscription records
UPDATE tenant_subscriptions
SET status = 'completed', completed_at = now()
WHERE status = 'superseded';

DELETE FROM tenant_subscriptions
WHERE status = 'cancelled'
  AND started_at > now();

-- 8. Schedule via pg_cron if available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('subscription_lifecycle_daily');
    PERFORM cron.schedule(
      'subscription_lifecycle_daily',
      '0 6 * * *',
      'SELECT process_subscription_lifecycle()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron not available';
END;
$$;