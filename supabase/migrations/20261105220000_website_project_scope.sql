begin;

alter table public.holding_website_plans add column project_type text
  check (project_type in ('landing','institutional','portfolio','catalog','store'));
alter table public.holding_website_contracts
  add column project_type text check (project_type in ('landing','institutional','portfolio','catalog','store')),
  add column designer_email text check (designer_email = lower(btrim(designer_email)) and designer_email like '%@%');

create function public.holding_website_project_scope() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_type text; v_category text;
begin
  if tg_op='INSERT' then
    select project_type,category into strict v_type,v_category
      from public.holding_website_plans where id=new.plan_id for share;
    if v_category='creation' then
      if v_type is null then raise exception 'Revise o tipo de projeto no produto antes de contratar'; end if;
      new.project_type:=v_type;
      new.plan_snapshot:=new.plan_snapshot || jsonb_build_object('project_type',v_type);
    end if;
  else
    if old.project_type is not null and
      (new.project_type is distinct from old.project_type or new.plan_id is distinct from old.plan_id) then
      raise exception 'Tipo e produto contratados estao bloqueados; registre outra contratacao';
    end if;
    if new.project_type is not null then
      new.plan_snapshot:=new.plan_snapshot || jsonb_build_object('project_type',new.project_type);
    end if;
  end if;
  return new;
end;
$$;
create trigger holding_website_project_scope before insert or update on public.holding_website_contracts
  for each row execute function public.holding_website_project_scope();

create function public.holding_website_subscription_scope() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_type text; v_subscription_type text; v_customer uuid;
begin
  if tg_op='UPDATE' and new.contract_id is not distinct from old.contract_id
    and new.plan_id is not distinct from old.plan_id and new.customer_id is not distinct from old.customer_id then
    return new;
  end if;
  if new.contract_id is not null then
    select project_type,customer_id into strict v_type,v_customer
      from public.holding_website_contracts where id=new.contract_id for share;
    select project_type into strict v_subscription_type from public.holding_website_plans where id=new.plan_id for share;
    if v_customer is distinct from new.customer_id or
      (v_subscription_type is not null and v_subscription_type is distinct from v_type) then
      raise exception 'Assinatura e criacao precisam corresponder ao mesmo cliente e tipo de projeto';
    end if;
  end if;
  return new;
end;
$$;
create trigger holding_website_subscription_scope before insert or update on public.holding_website_subscriptions
  for each row execute function public.holding_website_subscription_scope();

insert into public.holding_permission_resources(code,label,category,parent_code,sort_order,active)
values ('action.websites.manage','791 Websites > Gerenciar escopo e atribuir projetos','action','menu.websites',853,true)
on conflict (code) do update set label=excluded.label,active=true,updated_at=now();
insert into public.holding_profile_resource_permissions(profile_id,resource_code,enabled)
select id,'action.websites.manage',true from public.holding_permission_profiles
where active and (name='Administrador' or (name='Dono' and is_system))
on conflict (profile_id,resource_code) do nothing;

commit;
