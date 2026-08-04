/*
# Improve subscription action token - better UX for already-used tokens

## Changes
- Updated execute_subscription_action_token function to show tenant's current
  status when a token has already been used, instead of a generic error.
- Also handles the case where the tenant is already in the desired state
  (e.g., trying to suspend an already-suspended tenant).
*/

CREATE OR REPLACE FUNCTION execute_subscription_action_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_record subscription_action_tokens%ROWTYPE;
  v_tenant_name text;
  v_tenant_active boolean;
BEGIN
  SELECT * INTO v_record
  FROM subscription_action_tokens
  WHERE token = p_token;

  IF v_record IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token invalide ou introuvable');
  END IF;

  SELECT name, is_active INTO v_tenant_name, v_tenant_active
  FROM tenants WHERE id = v_record.tenant_id;

  IF v_record.used_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_used', true,
      'action', v_record.action,
      'tenant_name', v_tenant_name,
      'tenant_active', v_tenant_active
    );
  END IF;

  IF v_record.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ce lien a expire (validite 48h)');
  END IF;

  UPDATE subscription_action_tokens SET used_at = now() WHERE id = v_record.id;

  IF v_record.action = 'suspend' THEN
    IF NOT v_tenant_active THEN
      RETURN jsonb_build_object('success', true, 'action', 'suspend', 'tenant_name', v_tenant_name, 'already_done', true);
    END IF;

    UPDATE tenants
    SET is_active = false, status = 'suspended', subscription_status = 'suspended'
    WHERE id = v_record.tenant_id;

    INSERT INTO platform_events (actor_email, tenant_id, action, payload)
    VALUES ('system@waarwi.com', v_record.tenant_id, 'tenant.suspend',
      jsonb_build_object('reason', 'Suspendu via email admin', 'method', 'action_token'));

    RETURN jsonb_build_object('success', true, 'action', 'suspend', 'tenant_name', v_tenant_name);

  ELSIF v_record.action = 'reactivate' THEN
    IF v_tenant_active THEN
      RETURN jsonb_build_object('success', true, 'action', 'reactivate', 'tenant_name', v_tenant_name, 'already_done', true);
    END IF;

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