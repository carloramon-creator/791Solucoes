begin;

insert into public.holding_permission_resources(code,label,category,parent_code,sort_order,active)
  values('action.assinaturas.adjust_due_date','Assinaturas > Ajustar vencimento e situacao do Glass',
    'action','menu.assinaturas',856,true);
insert into public.holding_profile_resource_permissions(profile_id,resource_code,enabled)
  select id,'action.assinaturas.adjust_due_date',true from public.holding_permission_profiles
  where active and (name='Administrador' or (name='Dono' and is_system))
  on conflict(profile_id,resource_code) do nothing;

create function public.holding_can_adjust_glass_due_date(p_email text) returns boolean
language sql stable set search_path=public,pg_temp as $$
  select count(distinct r.code)=2
  from holding_user_permission_profiles a
  join holding_permission_profiles p on p.id=a.profile_id and p.active
  join holding_profile_resource_permissions rp on rp.profile_id=p.id and rp.enabled
  join holding_permission_resources r on r.code=rp.resource_code and r.active
  where a.user_email=lower(btrim(p_email))
    and r.code in ('menu.assinaturas','action.assinaturas.adjust_due_date')
$$;
revoke all on function public.holding_can_adjust_glass_due_date(text) from public,anon,authenticated;
grant execute on function public.holding_can_adjust_glass_due_date(text) to service_role;

commit;
