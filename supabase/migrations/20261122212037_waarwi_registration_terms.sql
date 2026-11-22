create schema if not exists registration_private;
revoke all on schema registration_private from public, anon, authenticated;

create table registration_private.terms_acceptances (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  accepted_by uuid references auth.users(id) on delete set null,
  accepted_at timestamptz not null default now(),
  terms_version text not null,
  terms_document text not null
);

revoke all on registration_private.terms_acceptances from public, anon, authenticated;
alter table registration_private.terms_acceptances enable row level security;

alter table public.tenants add column registration_other_activity text;

create function public.register_waarwi_company(
  p_company_name text,
  p_activity_type_id uuid,
  p_other_activity text,
  p_city text,
  p_address text,
  p_user_full_name text,
  p_whatsapp_phone text,
  p_responsible_title text,
  p_plan text,
  p_cycle text,
  p_terms_accepted boolean,
  p_terms_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing_tenant uuid;
  v_existing_role text;
  v_tenant_id uuid;
  v_terms text;
  v_version text;
  v_business_type text;
begin
  if v_user_id is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Connectez-vous pour poursuivre l’inscription.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  select tenant_id, role into v_existing_tenant, v_existing_role
  from public.profiles where id = v_user_id;
  if v_existing_role = 'super_admin' then
    raise exception 'Quittez votre session d’administration pour créer un espace.';
  end if;
  if v_existing_tenant is not null then
    if exists (
      select 1 from registration_private.terms_acceptances
      where tenant_id = v_existing_tenant and accepted_by = v_user_id
    ) then
      return jsonb_build_object('tenant_id', v_existing_tenant, 'created', false);
    end if;
    raise exception 'Ce compte est déjà rattaché à un espace Waarwi.';
  end if;

  if p_terms_accepted is distinct from true then
    raise exception using message = 'Acceptez les conditions générales d’utilisation pour continuer.', errcode = 'WR001';
  end if;

  select terms_of_service into v_terms from public.landing_config where id = 'default' for share;
  v_version := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_terms, 'UTF8')), 'hex');
  if nullif(btrim(v_terms), '') is null or p_terms_version is distinct from v_version then
    raise exception using message = 'Les conditions générales ont été mises à jour. Relisez-les avant de continuer.', errcode = 'WR001';
  end if;

  if coalesce(length(btrim(p_company_name)), 0) not between 2 and 160
    or coalesce(length(btrim(p_user_full_name)), 0) not between 2 and 160
    or coalesce(p_whatsapp_phone, '') !~ '^\+?[0-9]{8,15}$'
    or coalesce(length(p_address), 0) > 250
    or coalesce(length(p_city), 0) > 100
    or coalesce(length(p_responsible_title), 0) > 100 then
    raise exception 'Vérifiez les informations de l’entreprise et les coordonnées du responsable.';
  end if;

  if p_activity_type_id is null then
    if coalesce(length(btrim(p_other_activity)), 0) not between 2 and 160 then
      raise exception 'Précisez l’activité principale de votre entreprise.';
    end if;
    v_business_type := 'generic';
  else
    select coalesce(nullif(legacy_business_type, ''), 'generic') into v_business_type
    from public.business_activity_types where id = p_activity_type_id and is_active;
    if not found then
      raise exception 'Choisissez une activité proposée à l’inscription.';
    end if;
  end if;

  if not exists (
    select 1 from public.plans where code = p_plan and is_public
      and ((p_cycle = 'monthly' and (price_monthly > 0 or coalesce(price_yearly, 0) = 0))
        or (p_cycle = 'yearly' and price_yearly > 0))
  ) then
    raise exception 'Choisissez une offre disponible à l’inscription.';
  end if;

  v_tenant_id := public.provision_tenant(
    btrim(p_company_name), btrim(p_user_full_name), v_business_type, p_activity_type_id,
    btrim(p_city), p_whatsapp_phone, btrim(p_responsible_title), p_plan, p_cycle
  );

  update public.tenants
  set address = nullif(btrim(p_address), ''),
      registration_other_activity = case when p_activity_type_id is null then btrim(p_other_activity) end
  where id = v_tenant_id and owner_user_id = v_user_id and approval_status = 'pending';
  if not found then
    raise exception 'Impossible de finaliser la demande d’inscription.';
  end if;

  insert into registration_private.terms_acceptances (tenant_id, accepted_by, terms_version, terms_document)
  values (v_tenant_id, v_user_id, v_version, v_terms);

  return jsonb_build_object('tenant_id', v_tenant_id, 'created', true);
end;
$$;

revoke all on function public.register_waarwi_company(text,uuid,text,text,text,text,text,text,text,text,boolean,text) from public, anon;
grant execute on function public.register_waarwi_company(text,uuid,text,text,text,text,text,text,text,text,boolean,text) to authenticated;
