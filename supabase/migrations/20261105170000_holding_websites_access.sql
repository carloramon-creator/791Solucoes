begin;

insert into public.holding_permission_resources (code, label, category, parent_code, sort_order, active)
values
  ('menu.websites', '791 Websites', 'menu', null, 85, true),
  ('action.websites.view', '791 Websites > Visualizar websites e biblioteca', 'action', 'menu.websites', 850, true),
  ('action.websites.create', '791 Websites > Criar websites e recursos', 'action', 'menu.websites', 851, true),
  ('action.websites.edit', '791 Websites > Editar websites e recursos', 'action', 'menu.websites', 852, true)
on conflict (code) do update set
  label = excluded.label, category = excluded.category, parent_code = excluded.parent_code,
  sort_order = excluded.sort_order, active = excluded.active, updated_at = now();

insert into public.holding_profile_resource_permissions (profile_id, resource_code, enabled)
select profiles.id, resources.code, true
from public.holding_permission_profiles profiles
cross join public.holding_permission_resources resources
where profiles.active and (profiles.name = 'Administrador' or (profiles.name = 'Dono' and profiles.is_system))
  and resources.code in ('menu.websites', 'action.websites.view', 'action.websites.create', 'action.websites.edit')
on conflict (profile_id, resource_code) do nothing;

commit;
