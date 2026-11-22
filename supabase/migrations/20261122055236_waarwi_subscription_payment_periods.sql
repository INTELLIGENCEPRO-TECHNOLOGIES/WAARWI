alter table public.tenant_subscription_payments add column billing_months smallint;

update public.tenant_subscription_payments
set billing_months = case billing_cycle when 'monthly' then 1 when 'yearly' then 12 end;

alter table public.tenant_subscription_payments
  add constraint tenant_subscription_payments_billing_months_check check (
    case billing_cycle
      when 'monthly' then billing_months is not null and billing_months in (1, 3, 6, 12)
      when 'yearly' then billing_months is not distinct from 12
      else billing_months is null
    end
  );

create function public.prepare_subscription_payment(
  p_actor_id uuid, p_environment text, p_reserve boolean, p_billing_months integer
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
  v_months integer;
  v_total numeric;
  v_options jsonb;
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
      'payment_id', v_payment.id, 'reserved', false,
      'period_conflict', p_reserve and p_billing_months is not null
        and v_payment.billing_months is distinct from p_billing_months);
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

  v_months := case v_cycle when 'monthly' then coalesce(p_billing_months, 1) when 'yearly' then 12 end;
  if (v_cycle = 'monthly' and v_months not in (1, 3, 6, 12))
     or (v_cycle <> 'monthly' and p_billing_months is not null
        and p_billing_months is distinct from v_months) then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id, 'period_unavailable', true);
  end if;

  v_total := v_amount * case when v_cycle = 'monthly' then v_months else 1 end;
  if v_total > 2147483647 then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id, 'period_unavailable', true);
  end if;

  if v_cycle = 'monthly' then
    select jsonb_agg(jsonb_build_object('months', term.months, 'amount', v_amount * term.months) order by term.months)
    into v_options
    from (values (1), (3), (6), (12)) as term(months)
    where v_amount * term.months <= 2147483647;
  end if;

  v_quote := jsonb_build_object('plan_name', v_plan.name, 'amount', v_total,
    'billing_cycle', v_cycle, 'billing_months', v_months, 'billing_options', v_options, 'purpose', v_purpose);
  if not p_reserve then
    return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id, 'quote', v_quote);
  end if;

  insert into public.tenant_subscription_payments
    (tenant_id, tenant_name, requested_by, plan_code, billing_cycle, billing_months, purpose,
      amount, environment, base_expires_at, base_subscription_id)
  values (v_tenant.id, v_tenant.name, p_actor_id, v_plan_code, v_cycle, v_months, v_purpose,
    v_total::integer, p_environment, v_tenant.plan_expires_at,
    case when v_sub.status <> 'pending' then v_sub.id end)
  returning * into v_payment;
  return jsonb_build_object('authorized', true, 'tenant_id', v_tenant.id, 'quote', v_quote,
    'payment_id', v_payment.id, 'reserved', true);
end;
$$;

revoke execute on function public.prepare_subscription_payment(uuid, text, boolean, integer)
  from public, anon, authenticated;
grant execute on function public.prepare_subscription_payment(uuid, text, boolean, integer)
  to service_role;

-- Keep callers deployed before this migration on their normal billing cycle.
create or replace function public.prepare_subscription_payment(
  p_actor_id uuid, p_environment text, p_reserve boolean default false
)
returns jsonb
language sql
set search_path = ''
as $$
  select public.prepare_subscription_payment(p_actor_id, p_environment, p_reserve, null::integer);
$$;

create or replace function public.apply_subscription_payment(p_payment_id uuid)
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
  if v_payment.billing_months is not null then
    v_ends := v_starts + make_interval(months => v_payment.billing_months);
  end if;

  update public.tenant_subscriptions
  set status = 'completed', completed_at = now()
  where tenant_id = v_tenant.id and status in ('active', 'pending');

  -- Keep the recurring rate for renewals and MRR. The payment ledger records the full charge.
  insert into public.tenant_subscriptions
    (tenant_id, plan_code, billing_cycle, amount, currency, started_at, ends_at, auto_renew,
      status, notes, created_by, custom_limits)
  values (v_tenant.id, v_payment.plan_code, v_payment.billing_cycle,
    case when v_payment.billing_cycle = 'monthly' then v_payment.amount / v_payment.billing_months
      else v_payment.amount end,
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
      'amount', v_payment.amount, 'currency', 'XOF', 'billing_months', v_payment.billing_months, 'ends_at', v_ends));
end;
$$;

notify pgrst, 'reload schema';
