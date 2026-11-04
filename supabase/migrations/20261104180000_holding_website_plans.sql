begin;

create table public.holding_website_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text not null default '' check (char_length(description) <= 2000),
  scope text not null check (char_length(btrim(scope)) between 1 and 5000),
  category text not null check (category in ('creation', 'hosting', 'maintenance', 'additional')),
  billing_cycle text not null check (billing_cycle in ('one_time', 'monthly', 'annual')),
  price_cents integer not null check (price_cents between 1 and 999999999),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint holding_website_plans_category_billing_check check (
    (category in ('creation', 'additional') and billing_cycle = 'one_time')
    or (category in ('hosting', 'maintenance') and billing_cycle in ('monthly', 'annual'))
  )
);

create trigger trg_holding_website_plans_updated_at
before update on public.holding_website_plans
for each row execute procedure public.set_holding_updated_at();

alter table public.holding_website_plans enable row level security;
revoke all on public.holding_website_plans from public, anon, authenticated;
grant select, insert, update on public.holding_website_plans to service_role;

insert into public.holding_permission_resources (code, label, category, parent_code, sort_order, active)
values ('submenu.planos.websites', 'Planos > Websites', 'submenu', 'menu.planos', 73, true)
on conflict (code) do update
set label = excluded.label,
    category = excluded.category,
    parent_code = excluded.parent_code,
    sort_order = excluded.sort_order,
    active = excluded.active,
    updated_at = now();

insert into public.holding_profile_resource_permissions (profile_id, resource_code, enabled)
select id, 'submenu.planos.websites', true
from public.holding_permission_profiles
where name = 'Administrador'
on conflict (profile_id, resource_code) do update
set enabled = true, updated_at = now();

commit;
