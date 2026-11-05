begin;

alter table public.holding_website_contract_edits add column changed_by text;

create or replace function public.holding_website_project_scope() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare v_type text; v_category text;
begin
  if tg_op='INSERT' then
    select project_type,category into strict v_type,v_category
      from public.holding_website_plans where id=new.plan_id for share;
    if v_category='creation' then
      if v_type is null then raise exception 'Defina o tipo de projeto no plano antes de contratar'; end if;
      new.project_type:=v_type;
    end if;
  else
    if new.plan_id is distinct from old.plan_id or (old.project_type is not null and new.project_type is distinct from old.project_type) then
      if current_setting('holding.website_scope_edit',true) is distinct from (txid_current()::text||':'||new.id::text)
        or new.edit_revision<>old.edit_revision+1 then
        raise exception 'Troca de produto exige edição autorizada pelo gestor na Holding';
      end if;
      select project_type,category into strict v_type,v_category from public.holding_website_plans where id=new.plan_id for share;
      if v_category<>'creation' or v_type is null then raise exception 'O plano precisa ser de criação e ter tipo definido'; end if;
      if exists(select 1 from public.holding_website_subscriptions s
        join public.holding_website_plans p on p.id=s.plan_id
        where s.contract_id=new.id and s.lifecycle_status<>'cancelled' and p.project_type is not null and p.project_type<>v_type) then
        raise exception 'Existe assinatura vinculada restrita a outro tipo de site. Ajuste essa assinatura antes de trocar o produto';
      end if;
      new.project_type:=v_type;
    end if;
  end if;
  if new.project_type is not null then
    new.plan_snapshot:=new.plan_snapshot||jsonb_build_object('project_type',new.project_type);
  end if;
  return new;
end;
$$;

create function public.holding_correct_website_contract(
  p_actor text,p_id uuid,p_revision integer,p_locked_at timestamptz,p_previous_state text,
  p_plan_id uuid,p_total_cents integer,p_payment_method text,p_schedule jsonb
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare v_id uuid;
begin
  if not exists(
    select 1 from holding_user_permission_profiles a
    join holding_permission_profiles p on p.id=a.profile_id and p.active
    join holding_profile_resource_permissions rp on rp.profile_id=p.id and rp.enabled
    join holding_permission_resources r on r.code=rp.resource_code and r.active
    where a.user_email=lower(btrim(p_actor)) and r.code='action.websites.manage'
  ) then raise exception 'Somente gestores podem trocar o produto contratado'; end if;
  perform set_config('holding.website_scope_edit',txid_current()::text||':'||p_id::text,true);
  v_id:=holding_edit_website_contract(p_id,p_revision,p_locked_at,p_previous_state,p_plan_id,p_total_cents,p_payment_method,p_schedule);
  update holding_website_contract_edits set changed_by=lower(btrim(p_actor))
    where contract_id=p_id and (previous_contract->>'edit_revision')::integer=p_revision;
  perform set_config('holding.website_scope_edit','',true);
  return v_id;
end;
$$;
revoke all on function public.holding_correct_website_contract(text,uuid,integer,timestamptz,text,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.holding_correct_website_contract(text,uuid,integer,timestamptz,text,uuid,integer,text,jsonb) to service_role;
commit;
