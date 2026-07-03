insert into public.holding_permission_resources (code, label, category, parent_code, sort_order, active)
values
  ('action.finance.manage_paid_records', 'Financeiro > Editar/Excluir lancamento pago', 'action', null, 210, true)
on conflict (code) do update
set
  label = excluded.label,
  category = excluded.category,
  parent_code = excluded.parent_code,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

insert into public.holding_profile_resource_permissions (profile_id, resource_code, enabled)
select p.id, 'action.finance.manage_paid_records', true
from public.holding_permission_profiles p
where lower(trim(p.name)) = 'administrador'
on conflict (profile_id, resource_code) do update
set enabled = true,
    updated_at = now();
