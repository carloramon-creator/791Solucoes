begin;

insert into public.holding_permission_resources (
  code,
  label,
  category,
  parent_code,
  sort_order,
  active
)
values (
  'action.assinaturas.new_tenant_notification',
  'Assinaturas > Receber aviso de novo tenant Glass',
  'action',
  'menu.assinaturas',
  858,
  true
)
on conflict (code) do update
set
  label = excluded.label,
  category = excluded.category,
  parent_code = excluded.parent_code,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

insert into public.holding_profile_resource_permissions (
  profile_id,
  resource_code,
  enabled
)
select
  id,
  'action.assinaturas.new_tenant_notification',
  true
from public.holding_permission_profiles
where active
  and (
    name = 'Administrador'
    or (name = 'Dono' and is_system)
  )
on conflict (profile_id, resource_code) do update
set
  enabled = true,
  updated_at = now();

commit;
