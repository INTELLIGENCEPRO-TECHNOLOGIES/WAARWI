-- Checkout attempts are separate from subscription periods and from shop sales.
create table public.tenant_subscription_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete set null,
  tenant_name text not null,
  requested_by uuid references auth.users(id) on delete set null,
  plan_code text not null,
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly', 'lifetime')),
  purpose text not null check (purpose in ('initial', 'renewal')),
  amount integer not null check (amount > 0),
  environment text not null check (environment in ('test', 'prod')),
  base_expires_at timestamptz,
  base_subscription_id uuid,
  state text not null default 'creating'
    check (state in ('creating', 'pending', 'paid', 'cancelled', 'failed', 'refunded')),
  provider_token text unique,
  callback_key uuid not null default gen_random_uuid(),
  checkout_url text,
  payment_method text,
  paid_at timestamptz,
  subscription_id uuid references public.tenant_subscriptions(id) on delete set null,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activity_at timestamptz generated always as (coalesce(paid_at, created_at)) stored
);

create unique index tenant_subscription_payments_one_open
  on public.tenant_subscription_payments (tenant_id, environment)
  where state in ('creating', 'pending');
create index tenant_subscription_payments_tenant_created
  on public.tenant_subscription_payments (tenant_id, created_at desc);
create index tenant_subscription_payments_environment_activity
  on public.tenant_subscription_payments (environment, activity_at desc);

alter table public.tenant_subscription_payments enable row level security;
revoke all on public.tenant_subscription_payments from public, anon, authenticated;
grant select, insert, update on public.tenant_subscription_payments to service_role;

alter table public.tenants
  add column subscription_billing_online boolean not null default false,
  add column subscription_expiry_suspended boolean not null default false;
revoke update (subscription_billing_online, subscription_expiry_suspended)
  on public.tenants from anon, authenticated;

update public.tenants t
set subscription_expiry_suspended = true
where t.status = 'suspended' and t.subscription_status = 'suspended'
  and (select e.action from public.platform_events e
    where e.tenant_id = t.id
      and e.action in ('tenant.auto_suspended', 'tenant.suspend', 'tenant.reactivate')
    order by e.created_at desc, e.id desc limit 1) = 'tenant.auto_suspended';

create function public.sync_tenant_subscription_billing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.subscription_billing_online then
    new.auto_renew := false;
  end if;
  if new.status is distinct from 'suspended' or new.is_active is true then
    new.subscription_expiry_suspended := false;
  end if;
  if new.approval_status = 'rejected' and old.approval_status is distinct from 'rejected' then
    update public.tenant_subscription_payments
    set review_reason = 'tenant_unavailable', updated_at = now()
    where tenant_id = new.id and state = 'paid' and environment = 'prod'
      and subscription_id is null and review_reason is null;
  end if;
  return new;
end;
$$;

revoke execute on function public.sync_tenant_subscription_billing() from public, anon, authenticated;
grant execute on function public.sync_tenant_subscription_billing() to service_role;

create trigger trg_sync_tenant_subscription_billing
before update of approval_status, status, is_active, subscription_billing_online, auto_renew
on public.tenants for each row execute function public.sync_tenant_subscription_billing();

create function public.subscription_payment_allowed(p_tenant public.tenants)
returns boolean
language sql stable
set search_path = ''
as $$
  select coalesce(
    (p_tenant.approval_status = 'pending' and p_tenant.status = 'pending')
    or (p_tenant.approval_status = 'approved' and (
      (coalesce(p_tenant.is_active, true) and p_tenant.status <> 'suspended')
      or (p_tenant.status = 'suspended' and p_tenant.subscription_expiry_suspended
        and p_tenant.plan_expires_at <= now())
    )), false);
$$;

create function public.prepare_subscription_payment(
  p_actor_id uuid, p_environment text, p_reserve boolean default false
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_plan public.plans%rowtype;
  v_sub public.tenant_subscriptions%rowtype;
  v_payment public.tenant_subscription_payments%rowtype;
  v_plan_code text;
  v_cycle text;
  v_purpose text;
  v_amount numeric;
  v_quote jsonb;
begin
  if p_environment not in ('test', 'prod') then
    raise exception 'Environnement de paiement invalide';
  end if;

  select t.* into v_tenant
  from public.tenants t
  join public.profiles p on p.tenant_id = t.id
  where p.id = p_actor_id and p.role = 'admin' and p.is_active is distinct from false
    and (t.owner_user_id = p.id or t.owner_user_id is null)
  for update of t;

  if not found then
    return jsonb_build_object('authorized', false);
  end if;
  if not public.subscription_payment_allowed(v_tenant) then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id);
  end if;

  v_plan_code := case when v_tenant.approval_status = 'pending'
    then coalesce(v_tenant.selected_plan_code, v_tenant.plan) else v_tenant.plan end;
  v_cycle := coalesce(v_tenant.billing_cycle, 'monthly');

  -- An expired reservation never had a checkout URL to share.
  update public.tenant_subscription_payments
  set state = 'failed', updated_at = now()
  where tenant_id = v_tenant.id and environment = p_environment
    and state = 'creating' and created_at < now() - interval '2 minutes';

  select * into v_payment
  from public.tenant_subscription_payments
  where tenant_id = v_tenant.id and environment = p_environment
    and (state in ('creating', 'pending')
      or (state = 'paid' and purpose = 'initial' and subscription_id is null
        and review_reason is null and v_tenant.approval_status = 'pending'))
  order by created_at desc
  limit 1;
  if found then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id,
      'payment_id', v_payment.id, 'reserved', false);
  end if;

  select * into v_plan from public.plans where code = v_plan_code;
  if not found
     or (v_tenant.approval_status = 'pending' and v_plan.is_public is distinct from true)
     or coalesce(v_plan.currency, '') not in ('FCFA', 'XOF') then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id);
  end if;

  select * into v_sub
  from public.tenant_subscriptions
  where tenant_id = v_tenant.id and plan_code = v_plan_code and billing_cycle = v_cycle
    and status in ('active', 'expired', 'cancelled', 'pending')
    and ends_at is not distinct from v_tenant.plan_expires_at
  order by created_at desc, id desc
  limit 1;

  v_purpose := case when v_tenant.approval_status = 'pending'
    or (v_tenant.subscription_status in ('trial_active', 'pending_review')
      and (v_sub.id is null or v_sub.status = 'pending'))
    then 'initial' else 'renewal' end;

  if v_sub.status = 'cancelled' or (v_cycle = 'lifetime' and v_purpose = 'renewal') then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id);
  end if;

  if v_purpose = 'renewal' and v_sub.id is not null
     and coalesce(v_sub.currency, '') not in ('FCFA', 'XOF') then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id);
  end if;

  v_amount := case when v_purpose = 'renewal' and v_sub.id is not null
      then v_sub.amount
    when v_cycle = 'yearly' then v_plan.price_yearly
    when v_cycle = 'lifetime' then v_plan.price_lifetime
    else v_plan.price_monthly end;
  if v_amount is null or v_amount <= 0 or v_amount <> trunc(v_amount)
     or v_amount > 2147483647 then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id);
  end if;

  v_quote := jsonb_build_object('plan_name', v_plan.name, 'amount', v_amount,
    'billing_cycle', v_cycle, 'purpose', v_purpose);
  if not p_reserve then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id, 'quote', v_quote);
  end if;

  insert into public.tenant_subscription_payments
    (tenant_id, tenant_name, requested_by, plan_code, billing_cycle, purpose,
      amount, environment, base_expires_at, base_subscription_id)
  values (v_tenant.id, v_tenant.name, p_actor_id, v_plan_code, v_cycle, v_purpose,
    v_amount::integer, p_environment, v_tenant.plan_expires_at,
    case when v_sub.status <> 'pending' then v_sub.id end)
  returning * into v_payment;
  return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id, 'quote', v_quote,
    'payment_id', v_payment.id, 'reserved', true);
end;
$$;

create function public.apply_subscription_payment(p_payment_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.tenant_subscription_payments%rowtype;
  v_tenant public.tenants%rowtype;
  v_latest_sub_id uuid;
  v_latest_sub_status text;
  v_custom_limits jsonb;
  v_review text;
  v_starts timestamptz;
  v_ends timestamptz;
  v_subscription_id uuid;
begin
  -- Every operation affecting an entitlement locks the tenant before the payment.
  select t.* into v_tenant
  from public.tenants t
  join public.tenant_subscription_payments p on p.tenant_id = t.id
  where p.id = p_payment_id for update of t;

  select * into v_payment from public.tenant_subscription_payments
  where id = p_payment_id for update;
  if not found or v_payment.environment <> 'prod' or v_payment.state <> 'paid'
     or v_payment.subscription_id is not null or v_payment.review_reason is not null then
    return;
  end if;

  if v_tenant.approval_status = 'pending' and v_payment.purpose = 'initial' then
    return;
  end if;

  select s.id, s.status, s.custom_limits into v_latest_sub_id, v_latest_sub_status, v_custom_limits
  from public.tenant_subscriptions s
  where s.tenant_id = v_tenant.id and s.status in ('active', 'expired', 'cancelled')
    and s.ends_at is not distinct from v_tenant.plan_expires_at
  order by s.created_at desc, s.id desc
  limit 1;

  v_review := case
    when v_tenant.id is null then 'tenant_missing'
    when v_tenant.approval_status is distinct from 'approved'
      or not public.subscription_payment_allowed(v_tenant) then 'tenant_unavailable'
    when v_tenant.plan is distinct from v_payment.plan_code
      or coalesce(v_tenant.billing_cycle, 'monthly') is distinct from v_payment.billing_cycle
      or not exists (select 1 from public.plans where code = v_payment.plan_code) then 'plan_changed'
    when v_latest_sub_id is distinct from v_payment.base_subscription_id
      or v_latest_sub_status = 'cancelled'
      or (v_payment.purpose = 'renewal'
        and v_tenant.plan_expires_at is distinct from v_payment.base_expires_at) then 'period_changed'
    end;

  if v_review is not null then
    update public.tenant_subscription_payments set review_reason = v_review, updated_at = now()
    where id = p_payment_id;
    return;
  end if;

  if v_payment.purpose = 'initial' then
    v_starts := greatest(now(), v_tenant.trial_end_date);
  else
    v_starts := greatest(now(), v_tenant.plan_expires_at);
  end if;
  v_ends := case v_payment.billing_cycle
    when 'monthly' then v_starts + interval '1 month'
    when 'yearly' then v_starts + interval '1 year'
    end;

  update public.tenant_subscriptions
  set status = 'completed', completed_at = now()
  where tenant_id = v_tenant.id and status in ('active', 'pending');

  insert into public.tenant_subscriptions
    (tenant_id, plan_code, billing_cycle, amount, currency, started_at, ends_at, auto_renew,
      status, notes, created_by, custom_limits)
  values (v_tenant.id, v_payment.plan_code, v_payment.billing_cycle, v_payment.amount,
    'FCFA', v_starts, v_ends, false, 'active', 'Paiement PayTech confirmé',
    v_payment.requested_by, v_custom_limits)
  returning id into v_subscription_id;

  update public.tenants
  set plan_expires_at = v_ends, subscription_start_date = v_starts,
      subscription_status = 'active', is_active = true, status = 'active',
      auto_renew = false, subscription_billing_online = true
  where id = v_tenant.id;

  update public.tenant_subscription_payments
  set subscription_id = v_subscription_id, updated_at = now()
  where id = p_payment_id;

  insert into public.platform_events (actor_email, tenant_id, action, payload)
  values ('system@waarwi.com', v_tenant.id, 'subscription.payment_applied',
    jsonb_build_object('payment_id', p_payment_id, 'subscription_id', v_subscription_id,
      'amount', v_payment.amount, 'currency', 'XOF', 'ends_at', v_ends));
end;
$$;

create function public.record_subscription_payment_status(
  p_id uuid, p_token text, p_state text, p_amount integer, p_method text default null
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.tenant_subscription_payments%rowtype;
begin
  perform 1 from public.tenants t join public.tenant_subscription_payments p
    on p.tenant_id = t.id where p.id = p_id for update of t;
  select * into v_payment from public.tenant_subscription_payments where id = p_id for update;
  if not found or v_payment.provider_token is null or v_payment.provider_token is distinct from p_token then
    raise exception 'Référence de paiement invalide';
  end if;

  if p_state = 'paid' and v_payment.state in ('pending', 'cancelled') then
    if v_payment.amount is distinct from p_amount then
      raise exception 'Montant de paiement invalide';
    end if;
    update public.tenant_subscription_payments
    set state = 'paid', paid_at = now(), payment_method = left(p_method, 80), updated_at = now()
    where id = p_id;
    perform public.apply_subscription_payment(p_id);
  elsif p_state = 'cancelled' and v_payment.state = 'pending' then
    update public.tenant_subscription_payments set state = 'cancelled', updated_at = now() where id = p_id;
  elsif p_state = 'refunded' and v_payment.state = 'paid' then
    update public.tenant_subscription_payments
    set state = 'refunded', review_reason = 'refunded', updated_at = now()
    where id = p_id;
  end if;
end;
$$;

create function public.approve_waarwi_tenant(p_tenant_id uuid, p_actor_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_plan public.plans%rowtype;
  v_plan_code text;
  v_cycle text;
  v_trial_days integer;
  v_trial_end timestamptz;
  v_starts timestamptz;
  v_ends timestamptz;
  v_payment_id uuid;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found or v_tenant.approval_status is distinct from 'pending' then
    return jsonb_build_object('success', false, 'error', 'Inscription déjà traitée ou introuvable');
  end if;
  v_plan_code := coalesce(v_tenant.selected_plan_code, v_tenant.plan, 'trial');
  v_cycle := coalesce(v_tenant.billing_cycle, 'monthly');
  select * into v_plan from public.plans where code = v_plan_code;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Plan introuvable');
  end if;

  v_trial_days := greatest(0, coalesce(v_plan.trial_days, 14));
  v_trial_end := case when v_cycle <> 'lifetime' then now() + make_interval(days => v_trial_days) end;
  v_starts := coalesce(v_trial_end, now());
  v_ends := case v_cycle when 'monthly' then v_starts + interval '30 days'
    when 'yearly' then v_starts + interval '365 days' end;

  update public.tenants
  set approval_status = 'approved', approved_at = now(), approved_by = p_actor_id,
      approval_token = null, is_active = true, status = 'active', plan = v_plan_code,
      subscription_status = case when v_cycle = 'lifetime' then 'active' else 'trial_active' end,
      trial_start_date = case when v_trial_end is not null then now() end, trial_end_date = v_trial_end,
      subscription_start_date = v_starts, plan_expires_at = v_ends, auto_renew = v_cycle <> 'lifetime'
  where id = p_tenant_id;

  select id into v_payment_id from public.tenant_subscription_payments
  where tenant_id = p_tenant_id and environment = 'prod' and state = 'paid' and purpose = 'initial'
    and subscription_id is null and review_reason is null
  order by paid_at, id limit 1;
  if found then
    perform public.apply_subscription_payment(v_payment_id);
  end if;

  if not exists (
    select 1 from public.tenant_subscription_payments
    where id = v_payment_id and subscription_id is not null
  ) then
    insert into public.tenant_subscriptions
      (tenant_id, plan_code, billing_cycle, amount, currency, started_at, ends_at,
        auto_renew, status, notes, created_by)
    values (p_tenant_id, v_plan_code, v_cycle, coalesce(case v_cycle
        when 'lifetime' then v_plan.price_lifetime when 'yearly' then v_plan.price_yearly
        else v_plan.price_monthly end, 0), 'FCFA', v_starts, v_ends, v_cycle <> 'lifetime',
      'pending', 'Abonnement prévu après validation de l’inscription', p_actor_id);
  end if;

  return jsonb_build_object('success', true, 'tenant_name', v_tenant.name,
    'tenant_email', v_tenant.email, 'plan', v_plan_code, 'billing_cycle', v_cycle,
    'trial_days', v_trial_days);
end;
$$;

create or replace function public.auto_approve_tenant_by_token(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid;
  v_result jsonb;
begin
  select id into v_tenant_id from public.tenants
  where approval_token = p_token and approval_status = 'pending' for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Token invalide ou inscription déjà traitée');
  end if;
  v_result := public.approve_waarwi_tenant(v_tenant_id, null);
  if (v_result->>'success')::boolean then
    insert into public.platform_events (actor_email, tenant_id, action, payload)
    values ('system@waarwi.com', v_tenant_id, 'tenant.auto_approve', '{"method":"email_link"}');
  end if;
  return v_result;
end;
$$;

create function public.record_manual_waarwi_subscription(
  p_actor_id uuid, p_tenant_id uuid, p_plan_code text, p_billing_cycle text,
  p_amount numeric, p_currency text, p_started_at timestamptz, p_ends_at timestamptz,
  p_auto_renew boolean, p_notes text, p_custom_limits jsonb
)
returns public.tenant_subscriptions
language plpgsql
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_subscription public.tenant_subscriptions%rowtype;
  v_auto_renew boolean;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then
    raise exception 'Entreprise introuvable';
  end if;

  v_auto_renew := p_auto_renew and not v_tenant.subscription_billing_online;
  update public.tenant_subscriptions set status = 'superseded'
  where tenant_id = p_tenant_id and status = 'active';

  insert into public.tenant_subscriptions
    (tenant_id, plan_code, billing_cycle, amount, currency, started_at, ends_at,
      auto_renew, notes, status, created_by, custom_limits)
  values (p_tenant_id, p_plan_code, p_billing_cycle, p_amount, p_currency, p_started_at,
    p_ends_at, v_auto_renew, p_notes, 'active', p_actor_id, p_custom_limits)
  returning * into v_subscription;

  update public.tenants
  set plan = p_plan_code, plan_expires_at = p_ends_at, status = 'active', is_active = true,
      subscription_status = 'active', billing_cycle = p_billing_cycle,
      auto_renew = v_auto_renew, subscription_start_date = p_started_at
  where id = p_tenant_id;

  return v_subscription;
end;
$$;

create function public.cancel_waarwi_subscription(p_subscription_id uuid, p_reason text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant_id uuid;
begin
  select t.id into v_tenant_id from public.tenants t join public.tenant_subscriptions s
    on s.tenant_id = t.id where s.id = p_subscription_id for update of t;
  if not found then
    return null;
  end if;
  update public.tenant_subscriptions
  set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, auto_renew = false
  where id = p_subscription_id;
  return v_tenant_id;
end;
$$;

revoke execute on function public.subscription_payment_allowed(public.tenants),
  public.prepare_subscription_payment(uuid, text, boolean), public.apply_subscription_payment(uuid),
  public.record_subscription_payment_status(uuid, text, text, integer, text),
  public.approve_waarwi_tenant(uuid, uuid), public.cancel_waarwi_subscription(uuid, text),
  public.record_manual_waarwi_subscription(uuid, uuid, text, text, numeric, text, timestamptz, timestamptz, boolean, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.subscription_payment_allowed(public.tenants),
  public.prepare_subscription_payment(uuid, text, boolean), public.apply_subscription_payment(uuid),
  public.record_subscription_payment_status(uuid, text, text, integer, text),
  public.approve_waarwi_tenant(uuid, uuid), public.cancel_waarwi_subscription(uuid, text),
  public.record_manual_waarwi_subscription(uuid, uuid, text, text, numeric, text, timestamptz, timestamptz, boolean, text, jsonb)
  to service_role;

-- Keep the historical lifecycle for legacy subscriptions. Online periods only extend after payment.
CREATE OR REPLACE FUNCTION public.process_subscription_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
      AND NOT t.subscription_billing_online
      AND NOT EXISTS (
        SELECT 1 FROM public.tenant_subscription_payments p
        WHERE p.tenant_id = t.id AND p.environment = 'prod'
          AND (p.state = 'pending' OR (p.state = 'creating' AND p.created_at >= now() - interval '2 minutes'))
      )
      AND t.plan_expires_at IS NOT NULL
      AND t.plan_expires_at <= now()
      AND t.billing_cycle != 'lifetime'
      AND t.subscription_status != 'suspended'
    FOR UPDATE OF t SKIP LOCKED
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
      AND (t.auto_renew = false OR t.subscription_billing_online)
      AND t.plan_expires_at IS NOT NULL
      AND t.plan_expires_at <= now()
      AND t.billing_cycle != 'lifetime'
      AND t.subscription_status NOT IN ('expired', 'suspended')
    FOR UPDATE OF t SKIP LOCKED
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
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    UPDATE tenants
    SET is_active = false, status = 'suspended', subscription_status = 'suspended',
        subscription_expiry_suspended = true
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

-- Email suspension actions are administrative decisions.
CREATE OR REPLACE FUNCTION public.execute_subscription_action_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    SET is_active = false, status = 'suspended', subscription_status = 'suspended',
        subscription_expiry_suspended = false
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
