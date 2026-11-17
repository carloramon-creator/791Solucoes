begin;

insert into public.holding_permission_resources(code,label,category,parent_code,sort_order,active)
  values('action.assinaturas.purge_test_tenant',
    'Assinaturas > Excluir tenant de teste sem pagamento',
    'action','menu.assinaturas',857,true)
  on conflict(code) do nothing;

insert into public.holding_profile_resource_permissions(profile_id,resource_code,enabled)
  select id,'action.assinaturas.purge_test_tenant',true
    from public.holding_permission_profiles
   where active and (name='Administrador' or (name='Dono' and is_system))
  on conflict(profile_id,resource_code) do nothing;

commit;
