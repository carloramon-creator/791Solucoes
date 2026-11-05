begin;

insert into public.holding_permission_resources(code,label,category,parent_code,sort_order,active)
  values('action.websites.approve','Websites > Aprovar entrega e ativar assinaturas','action','menu.websites',854,true);
insert into public.holding_profile_resource_permissions(profile_id,resource_code,enabled)
  select id,'action.websites.approve',true from public.holding_permission_profiles
  where active and (name='Administrador' or (name='Dono' and is_system))
  on conflict(profile_id,resource_code) do nothing;

alter table public.holding_website_contracts
  add column production_stage text not null default 'configuration'
    check (production_stage in ('configuration','briefing','production','internal_review','customer_review','completed')),
  add column production_version integer not null default 1,
  add column production_completed_at timestamptz;

-- Existing approvals are not retroactive remuneration entitlements.
update public.holding_website_contracts c set production_stage='completed',
  production_completed_at=s.approved_at
from (
  select contract_id,coalesce(min(approved_at),min(created_at)) approved_at
  from public.holding_website_subscriptions where approval_status='approved'
  group by contract_id
) s where s.contract_id=c.id;

create table public.holding_website_productivity_rates (
  plan_id uuid primary key references public.holding_website_plans(id),
  amount_cents integer not null check (amount_cents between 1 and 999999999),
  version integer not null default 1,
  updated_by text not null,
  updated_at timestamptz not null default now()
);
create table public.holding_website_production_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.holding_website_contracts(id),
  stage text not null,
  actor_email text not null,
  created_at timestamptz not null default now()
);
create table public.holding_website_productivity (
  contract_id uuid primary key references public.holding_website_contracts(id),
  subscription_id uuid not null references public.holding_website_subscriptions(id),
  designer_email text not null,
  amount_cents integer not null check (amount_cents > 0),
  plan_snapshot jsonb not null,
  approved_by text not null,
  approved_at timestamptz not null default now(),
  finance_record_id uuid references public.system_finance_records(id) on delete set null
);
create unique index holding_website_productivity_finance on public.system_finance_records
  ((metadata->>'website_contract_id')) where metadata->>'kind'='website_productivity'
    and not (metadata ? 'settlement_parent_id');
create index holding_website_productivity_finance_all on public.system_finance_records
  ((metadata->>'website_contract_id')) where metadata->>'kind'='website_productivity';
create index holding_website_productivity_designer on public.holding_website_productivity(designer_email,approved_at);
create index holding_website_production_events_contract on public.holding_website_production_events(contract_id,created_at);

alter table public.holding_website_productivity_rates enable row level security;
alter table public.holding_website_productivity enable row level security;
alter table public.holding_website_production_events enable row level security;
revoke all on public.holding_website_productivity_rates,public.holding_website_productivity,
  public.holding_website_production_events from public,anon,authenticated;
grant select,insert,update on public.holding_website_productivity_rates to service_role;
grant select,insert on public.holding_website_productivity,public.holding_website_production_events to service_role;

create view public.holding_website_productivity_summary as
  select e.*,c.customer_snapshot,
    f.finance_record_count,f.pending_cents,f.paid_cents,f.cancelled_cents
  from public.holding_website_productivity e
  join public.holding_website_contracts c on c.id=e.contract_id
  cross join lateral (
    select count(*) as finance_record_count,
      coalesce(round(sum(r.value) filter(where r.status='pending')*100),0)::bigint as pending_cents,
      coalesce(round(sum(r.value) filter(where r.status='paid')*100),0)::bigint as paid_cents,
      coalesce(round(sum(r.value) filter(where r.status='cancelled')*100),0)::bigint as cancelled_cents
    from public.system_finance_records r
    where r.metadata->>'kind'='website_productivity'
      and r.metadata->>'website_contract_id'=e.contract_id::text
  ) f;
revoke all on public.holding_website_productivity_summary from public,anon,authenticated;
grant select on public.holding_website_productivity_summary to service_role;

create function public.holding_website_permission(p_email text,p_code text) returns boolean
language sql stable set search_path=public,pg_temp as $$
  select exists(
    select 1 from holding_user_permission_profiles a
    join holding_permission_profiles p on p.id=a.profile_id and p.active
    join holding_profile_resource_permissions rp on rp.profile_id=p.id and rp.enabled
    join holding_permission_resources r on r.code=rp.resource_code and r.active
    where a.user_email=lower(btrim(p_email)) and r.code=p_code
  )
$$;

create function public.holding_set_website_productivity_rate(
  p_actor text,p_plan_id uuid,p_amount_cents integer,p_version integer
) returns void language plpgsql set search_path=public,pg_temp as $$
declare v_version integer;
begin
  if not holding_website_permission(p_actor,'menu.producao')
    or not holding_website_permission(p_actor,'action.producao.manage') then
    raise exception 'Sem permissao para configurar produtividade';
  end if;
  perform 1 from holding_website_plans where id=p_plan_id and category='creation' for update;
  if not found then raise exception 'Selecione um plano de criacao'; end if;
  select version into v_version from holding_website_productivity_rates where plan_id=p_plan_id for update;
  if coalesce(v_version,0) is distinct from p_version then
    raise exception 'Valor alterado por outra pessoa. Atualize antes de salvar';
  end if;
  insert into holding_website_productivity_rates(plan_id,amount_cents,updated_by)
    values(p_plan_id,p_amount_cents,lower(btrim(p_actor)))
    on conflict(plan_id) do update set amount_cents=excluded.amount_cents,
      version=holding_website_productivity_rates.version+1,updated_by=excluded.updated_by,updated_at=now();
end
$$;

create function public.holding_advance_website_production(
  p_actor text,p_contract_id uuid,p_stage text,p_version integer
) returns jsonb language plpgsql set search_path=public,pg_temp as $$
declare v_contract holding_website_contracts; v_steps text[]:=array['configuration','briefing','production','internal_review','customer_review'];
begin
  select * into strict v_contract from holding_website_contracts where id=p_contract_id for update;
  if not holding_website_permission(p_actor,'menu.websites')
    or not holding_website_permission(p_actor,'action.websites.view')
    or not holding_website_permission(p_actor,'action.websites.edit')
    or (v_contract.designer_email is distinct from lower(btrim(p_actor))
      and not holding_website_permission(p_actor,'action.websites.manage')) then
    raise exception 'Sem acesso ao projeto atribuido';
  end if;
  if v_contract.project_type is null or not exists(
    select 1 from holding_website_subscriptions where contract_id=p_contract_id
      and customer_id=v_contract.customer_id and lifecycle_status='active'
  ) then raise exception 'Projeto sem contratacao ativa'; end if;
  if p_stage is null or not (p_stage=any(v_steps)) then raise exception 'Etapa invalida'; end if;
  if v_contract.production_stage=p_stage then
    return jsonb_build_object('stage',p_stage,'version',v_contract.production_version);
  end if;
  if p_version is distinct from v_contract.production_version then raise exception 'Etapa alterada. Atualize o projeto'; end if;
  if v_contract.production_stage='completed'
    or array_position(v_steps,p_stage) is distinct from array_position(v_steps,v_contract.production_stage)+1 then
    raise exception 'Avance uma etapa por vez. A conclusao depende da aprovacao na Holding';
  end if;
  update holding_website_contracts set production_stage=p_stage,production_version=production_version+1 where id=p_contract_id;
  insert into holding_website_production_events(contract_id,stage,actor_email) values(p_contract_id,p_stage,lower(btrim(p_actor)));
  return jsonb_build_object('stage',p_stage,'version',v_contract.production_version+1);
end
$$;

create function public.holding_approve_website_delivery(
  p_actor text,p_user_id uuid,p_subscription_id uuid
) returns void language plpgsql set search_path=public,pg_temp as $$
declare v_subscription holding_website_subscriptions; v_contract holding_website_contracts;
  v_contract_id uuid; v_rate holding_website_productivity_rates; v_finance uuid;
begin
  if not holding_website_permission(p_actor,'action.websites.manage')
    and not holding_website_permission(p_actor,'action.websites.approve') then
    raise exception 'Somente gestor ou comercial autorizado pode aprovar assinaturas';
  end if;
  select contract_id into strict v_contract_id from holding_website_subscriptions where id=p_subscription_id;
  if v_contract_id is not null then
    select * into strict v_contract from holding_website_contracts where id=v_contract_id for update;
  end if;
  select * into strict v_subscription from holding_website_subscriptions where id=p_subscription_id for update;
  if v_subscription.contract_id is distinct from v_contract_id then raise exception 'Vinculo alterado. Atualize'; end if;
  if v_subscription.billing_state not in ('local','issued') or v_subscription.lifecycle_status<>'active' then
    raise exception 'Assinatura nao esta disponivel para ativacao';
  end if;
  if v_subscription.approval_status='approved'
    and (v_contract.id is null or v_contract.project_type is null or v_contract.production_stage='completed') then return; end if;
  if v_contract.project_type is not null and v_contract.production_stage<>'completed' then
    if v_contract.customer_id is distinct from v_subscription.customer_id then raise exception 'Cliente divergente'; end if;
    if v_contract.production_stage<>'customer_review' then
      raise exception 'Conclua configuracao, briefing, producao e revisao interna no Websites antes de aprovar';
    end if;
    if v_contract.designer_email is null then raise exception 'Atribua um webdesigner antes de aprovar'; end if;
    select * into v_rate from holding_website_productivity_rates where plan_id=v_contract.plan_id for share;
    if not found then raise exception 'Configure o valor de produtividade deste plano em Producao'; end if;
    insert into system_finance_records(type,value,description,category,status,metadata)
      values('expense',v_rate.amount_cents::numeric/100,
        left('Produtividade Websites - '||v_contract.designer_email||' - '||(v_contract.customer_snapshot->>'name'),300),
        'Produtividade Websites','pending',
        jsonb_build_object('kind','website_productivity','business_unit','websites',
          'website_contract_id',v_contract.id,'subscription_id',p_subscription_id,
          'designer_email',v_contract.designer_email,'amount_cents',v_rate.amount_cents,
          'approved_by',lower(btrim(p_actor))))
      returning id into v_finance;
    insert into holding_website_productivity(contract_id,subscription_id,designer_email,
      amount_cents,plan_snapshot,approved_by,finance_record_id)
      values(v_contract.id,p_subscription_id,v_contract.designer_email,v_rate.amount_cents,
        v_contract.plan_snapshot||jsonb_build_object('productivity_rate_version',v_rate.version),
        lower(btrim(p_actor)),v_finance);
    update holding_website_contracts set production_stage='completed',production_version=production_version+1,
      production_completed_at=now() where id=v_contract.id;
    insert into holding_website_production_events(contract_id,stage,actor_email)
      values(v_contract.id,'completed',lower(btrim(p_actor)));
  end if;
  update holding_website_subscriptions set approval_status='approved',approved_at=now(),approved_by=p_user_id
    where id=p_subscription_id and approval_status='pending';
end
$$;

revoke all on function public.holding_website_permission(text,text),
  public.holding_set_website_productivity_rate(text,uuid,integer,integer),
  public.holding_advance_website_production(text,uuid,text,integer),
  public.holding_approve_website_delivery(text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.holding_website_permission(text,text),
  public.holding_set_website_productivity_rate(text,uuid,integer,integer),
  public.holding_advance_website_production(text,uuid,text,integer),
  public.holding_approve_website_delivery(text,uuid,uuid) to service_role;

update public.holding_permission_resources set label='Producao > Configurar valores de produtividade'
  where code='action.producao.manage';

create function public.holding_guard_legacy_production() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.area='producao' or (tg_op='UPDATE' and old.area='producao') then
    raise exception 'As etapas de producao agora sao avancadas no Websites. Use Producao para conferir produtividade';
  end if;
  return new;
end
$$;
create trigger holding_guard_legacy_production before insert or update on public.holding_operations
  for each row execute function public.holding_guard_legacy_production();

create function public.holding_website_production_metrics(p_actor text,p_start date,p_end date)
returns table(area text,product text,owner_email text,open_records bigint,overdue_records bigint,
  created bigint,conversions bigint,deliveries bigint,on_time_deliveries bigint)
language plpgsql stable set search_path=public,pg_temp as $$
begin
  if not holding_website_permission(p_actor,'menu.gestao') then raise exception 'Sem acesso aos indicadores'; end if;
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Periodo invalido'; end if;
  return query select 'producao'::text,'websites'::text,coalesce(e.designer_email,c.designer_email),
    count(*) filter(where c.production_stage<>'completed'),0::bigint,
    count(*) filter(where (c.created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end),0::bigint,
    count(*) filter(where (c.production_completed_at at time zone 'America/Sao_Paulo')::date between p_start and p_end),0::bigint
    from holding_website_contracts c left join holding_website_productivity e on e.contract_id=c.id
    where c.project_type is not null
    group by coalesce(e.designer_email,c.designer_email);
end
$$;
revoke all on function public.holding_guard_legacy_production(),
  public.holding_website_production_metrics(text,date,date) from public,anon,authenticated;
grant execute on function public.holding_website_production_metrics(text,date,date) to service_role;

commit;
