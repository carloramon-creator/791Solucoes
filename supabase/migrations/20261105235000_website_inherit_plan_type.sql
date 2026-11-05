begin;

create function public.holding_website_inherit_plan_type() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if old.project_type is null then
    select project_type into new.project_type
      from public.holding_website_plans where id=new.plan_id and category='creation' for share;
  end if;
  return new;
end;
$$;

create trigger holding_website_inherit_scope before update on public.holding_website_contracts
  for each row execute function public.holding_website_inherit_plan_type();

create function public.holding_website_fill_missing_contract_types() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.category='creation' and new.project_type is not null then
    update public.holding_website_contracts set project_type=new.project_type
      where plan_id=new.id and project_type is null;
  end if;
  return new;
end;
$$;

create trigger holding_website_fill_missing_contract_types after update of project_type,category on public.holding_website_plans
  for each row execute function public.holding_website_fill_missing_contract_types();

update public.holding_website_contracts c set project_type=p.project_type
  from public.holding_website_plans p
  where c.plan_id=p.id and c.project_type is null and p.category='creation' and p.project_type is not null;

commit;
