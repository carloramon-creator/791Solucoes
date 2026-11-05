begin;

create table public.holding_operations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  area text not null check (area in ('comercial','producao')),
  product text not null check (product in ('glass','barber','websites')),
  customer_name text not null check (length(btrim(customer_name)) between 1 and 200),
  title text not null check (length(btrim(title)) between 1 and 200),
  contact text not null default '' check (length(contact)<=300),
  owner_email text check (owner_email=lower(btrim(owner_email)) and owner_email like '%@%'),
  stage text not null,
  due_date date check (due_date between '2020-01-01' and '2100-12-31'),
  next_action text not null default '' check (length(next_action)<=2000),
  loss_reason text not null default '' check (length(loss_reason)<=2000),
  source_type text not null default 'manual' check (source_type in ('manual','glass_subscriber','website_contract')),
  source_id uuid,
  source_status text check (length(source_status)<=100),
  version integer not null default 1,
  active_seconds bigint not null default 0,
  stage_since timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((area='comercial' and stage in ('available','contacted','negotiating','won','lost'))
    or (area='producao' and stage in ('materials','production','internal_review','customer_review','completed'))),
  check ((source_type='manual' and source_id is null) or
    (source_type='glass_subscriber' and product='glass' and area='comercial' and source_id is not null) or
    (source_type='website_contract' and product='websites' and source_id is not null)),
  unique(area,product,source_type,source_id)
);
create index holding_operations_owner on public.holding_operations(area,owner_email,created_at);
create table public.holding_operation_events (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.holding_operations(id),
  actor_email text not null,
  owner_email text,
  stage text not null,
  previous_stage text,
  note text not null default '' check (length(note)<=5000),
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index holding_operation_events_record on public.holding_operation_events(record_id,created_at);
create table public.holding_operation_commissions (
  record_id uuid primary key references public.holding_operations(id),
  seller_email text,
  converted_at timestamptz not null default now(),
  state text not null default 'awaiting_rule' check (state in ('awaiting_rule','void')),
  rule_snapshot jsonb check (rule_snapshot is null),
  amount_cents integer check (amount_cents is null)
);

alter table public.holding_operations enable row level security;
alter table public.holding_operation_events enable row level security;
alter table public.holding_operation_commissions enable row level security;
revoke all on public.holding_operations,public.holding_operation_events,public.holding_operation_commissions from anon,authenticated;
grant select,insert,update on public.holding_operations to service_role;
grant select,insert on public.holding_operation_events to service_role;
grant select,insert,update on public.holding_operation_commissions to service_role;

insert into public.holding_permission_resources(code,label,category,parent_code,sort_order,active) values
 ('menu.comercial','Comercial','menu',null,860,true),
 ('action.comercial.manage','Comercial > Distribuir carteira e gerenciar oportunidades','action','menu.comercial',861,true),
 ('menu.producao','Produção','menu',null,870,true),
 ('action.producao.manage','Produção > Distribuir projetos e gerenciar entregas','action','menu.producao',871,true),
 ('menu.gestao','Gestão > Indicadores operacionais','menu',null,880,true);
insert into public.holding_profile_resource_permissions(profile_id,resource_code,enabled)
select p.id,r.code,true from public.holding_permission_profiles p cross join public.holding_permission_resources r
where p.active and (p.name='Administrador' or (p.name='Dono' and p.is_system))
and r.code in ('menu.comercial','action.comercial.manage','menu.producao','action.producao.manage','menu.gestao')
on conflict (profile_id,resource_code) do nothing;

create function public.holding_operations_permissions(p_email text) returns text[]
language sql stable set search_path=public,pg_temp as $$
 select coalesce(array_agg(distinct r.code),'{}'::text[])
 from holding_user_permission_profiles a
 join holding_permission_profiles p on p.id=a.profile_id and p.active
 join holding_profile_resource_permissions rp on rp.profile_id=p.id and rp.enabled
 join holding_permission_resources r on r.code=rp.resource_code and r.active
 where a.user_email=lower(btrim(p_email))
 and r.code in ('menu.comercial','action.comercial.manage','menu.producao','action.producao.manage','menu.gestao')
$$;

create function public.holding_save_operation(p_actor text,p_data jsonb) returns uuid
language plpgsql set search_path=public,pg_temp as $$
declare
 v_old holding_operations; v_new holding_operations; v_id uuid; v_area text;
 v_permissions text[]; v_manager boolean; v_note text; v_owner text; v_stage text;
begin
 p_actor:=lower(btrim(p_actor));
 v_permissions:=holding_operations_permissions(p_actor);
 v_note:=coalesce(p_data->>'note','');
 if length(v_note)>5000 then raise exception 'O registro de atividade excede 5000 caracteres'; end if;
 if p_data ? 'id' then
   select * into strict v_old from holding_operations where id=(p_data->>'id')::uuid for update;
   v_area:=v_old.area;
 else
   v_area:=p_data->>'area';
 end if;
 if v_area not in ('comercial','producao') or v_area is null or not ('menu.'||v_area=any(v_permissions)) then
   raise exception 'Sem acesso ao módulo';
 end if;
 v_manager:=('action.'||v_area||'.manage'=any(v_permissions));
 if v_old.id is null then
   if not v_manager then raise exception 'Somente gestores criam e distribuem registros'; end if;
   v_owner:=nullif(lower(btrim(p_data->>'owner_email')),'');
 else
   if not v_manager and v_old.owner_email is distinct from p_actor then raise exception 'Registro fora da sua carteira'; end if;
   if (p_data->>'version')::integer is distinct from v_old.version then raise exception 'Registro alterado por outra pessoa. Atualize antes de salvar'; end if;
   v_owner:=case when v_manager and p_data ? 'owner_email' then nullif(lower(btrim(p_data->>'owner_email')),'') else v_old.owner_email end;
   if not v_manager and ((p_data ? 'owner_email' and nullif(p_data->>'owner_email','') is distinct from v_old.owner_email)
     or (p_data ? 'due_date' and nullif(p_data->>'due_date','')::date is distinct from v_old.due_date)) then
     raise exception 'Somente gestores alteram responsável e prazo';
   end if;
 end if;
 if v_owner is not null and not ('menu.'||v_area=any(holding_operations_permissions(v_owner))) then
   raise exception 'Responsável sem permissão ativa neste módulo';
 end if;
 v_stage:=coalesce(p_data->>'stage',v_old.stage,case when v_area='comercial' then 'available' else 'materials' end);
 if v_old.stage in ('won','lost','completed') and v_stage<>v_old.stage and not v_manager then
   raise exception 'Somente gestores reabrem registros concluídos';
 end if;
 if v_stage='won' and v_owner is null then raise exception 'Atribua um vendedor antes da conversão'; end if;
 if v_stage='lost' and length(btrim(coalesce(p_data->>'loss_reason',v_old.loss_reason,'')))=0 then raise exception 'Informe o motivo da perda'; end if;
 if v_old.id is null then
   insert into holding_operations(request_id,area,product,customer_name,title,contact,owner_email,stage,due_date,next_action,loss_reason,source_type,source_id,source_status)
   values ((p_data->>'request_id')::uuid,v_area,p_data->>'product',btrim(p_data->>'customer_name'),btrim(p_data->>'title'),
     coalesce(p_data->>'contact',''),v_owner,v_stage,nullif(p_data->>'due_date','')::date,coalesce(p_data->>'next_action',''),
     coalesce(p_data->>'loss_reason',''),coalesce(p_data->>'source_type','manual'),(p_data->>'source_id')::uuid,p_data->>'source_status')
   returning * into v_new;
 else
   update holding_operations set
     owner_email=v_owner,stage=v_stage,
     due_date=case when v_manager and p_data ? 'due_date' then nullif(p_data->>'due_date','')::date else due_date end,
     next_action=coalesce(p_data->>'next_action',next_action),loss_reason=coalesce(p_data->>'loss_reason',loss_reason),
     active_seconds=active_seconds+case when v_area='producao' and stage in ('production','internal_review')
       then greatest(0,extract(epoch from now()-stage_since))::bigint else 0 end,
     stage_since=now(),
     completed_at=case when v_stage in ('won','lost','completed') then coalesce(completed_at,now()) else null end,
     version=version+1,updated_at=now()
   where id=v_old.id returning * into v_new;
 end if;
 if v_old.id is null and v_stage in ('won','lost','completed') then
   update holding_operations set completed_at=now() where id=v_new.id returning * into v_new;
 end if;
 insert into holding_operation_events(record_id,actor_email,owner_email,stage,previous_stage,note,snapshot)
 values (v_new.id,p_actor,v_new.owner_email,v_new.stage,v_old.stage,v_note,to_jsonb(v_new));
 if v_area='comercial' and v_stage='won' then
   insert into holding_operation_commissions(record_id,seller_email) values(v_new.id,v_owner) on conflict(record_id) do nothing;
 elsif v_area='comercial' and v_old.stage='won' and v_stage<>'won' then
   update holding_operation_commissions set state='void' where record_id=v_new.id;
 end if;
 return v_new.id;
end;
$$;

create function public.holding_operations_metrics(p_actor text,p_start date,p_end date,p_product text default null)
returns table(area text,product text,owner_email text,open_records bigint,overdue_records bigint,created bigint,conversions bigint,deliveries bigint,on_time_deliveries bigint)
language plpgsql stable set search_path=public,pg_temp as $$
begin
 if not ('menu.gestao'=any(holding_operations_permissions(p_actor))) then raise exception 'Sem acesso aos indicadores'; end if;
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>366 then raise exception 'Selecione até 366 dias'; end if;
 return query
 with counts as (
   select o.area,o.product,o.owner_email,
     count(*) filter(where o.stage not in ('won','lost','completed')) as open_records,
     count(*) filter(where o.stage not in ('won','lost','completed') and o.due_date<(now() at time zone 'America/Sao_Paulo')::date) as overdue_records,
     0::bigint as created,
     0::bigint as conversions,0::bigint as deliveries,0::bigint as on_time_deliveries
   from holding_operations o where p_product is null or o.product=p_product group by o.area,o.product,o.owner_email
   union all
   select e.snapshot->>'area',e.snapshot->>'product',e.owner_email,0,0,0,
     count(*) filter(where e.stage='won'),count(*) filter(where e.stage='completed'),
     count(*) filter(where e.stage='completed' and (e.created_at at time zone 'America/Sao_Paulo')::date <= (e.snapshot->>'due_date')::date)
   from holding_operation_events e where e.stage in ('won','completed') and e.stage is distinct from e.previous_stage
     and not exists (select 1 from holding_operation_events earlier
       where earlier.record_id=e.record_id and earlier.stage=e.stage
       and (earlier.snapshot->>'version')::integer < (e.snapshot->>'version')::integer)
     and (e.created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end
     and (p_product is null or e.snapshot->>'product'=p_product)
   group by e.snapshot->>'area',e.snapshot->>'product',e.owner_email
   union all
   select e.snapshot->>'area',e.snapshot->>'product',e.owner_email,0,0,count(*),0,0,0
   from holding_operation_events e where (e.snapshot->>'version')::integer=1
     and (e.created_at at time zone 'America/Sao_Paulo')::date between p_start and p_end
     and (p_product is null or e.snapshot->>'product'=p_product)
   group by e.snapshot->>'area',e.snapshot->>'product',e.owner_email
 )
 select c.area,c.product,c.owner_email,sum(c.open_records)::bigint,sum(c.overdue_records)::bigint,sum(c.created)::bigint,
   sum(c.conversions)::bigint,sum(c.deliveries)::bigint,sum(c.on_time_deliveries)::bigint
 from counts c group by c.area,c.product,c.owner_email order by c.area,c.product,c.owner_email;
end;
$$;
revoke all on function public.holding_operations_permissions(text),public.holding_save_operation(text,jsonb),public.holding_operations_metrics(text,date,date,text) from public,anon,authenticated;
grant execute on function public.holding_operations_permissions(text),public.holding_save_operation(text,jsonb),public.holding_operations_metrics(text,date,date,text) to service_role;
commit;
