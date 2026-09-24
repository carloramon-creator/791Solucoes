-- Acesso temporário da Holding ao cenário de um tenant, sempre vinculado a um ticket.

insert into public.holding_permission_resources (code, label, category, parent_code, sort_order, active)
values
  ('action.support.investigate_tenant', 'Suporte > Investigar tenant no 791glass', 'action', null, 204, true)
on conflict (code) do update
set
  label = excluded.label,
  category = excluded.category,
  parent_code = excluded.parent_code,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

insert into public.holding_profile_resource_permissions (profile_id, resource_code, enabled)
select p.id, 'action.support.investigate_tenant', true
from public.holding_permission_profiles p
where lower(trim(p.name)) = 'administrador'
on conflict (profile_id, resource_code) do update
set enabled = true,
    updated_at = now();

create table if not exists public.support_tenant_investigations (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  tenant_id text,
  tenant_slug text not null,
  investigator_email text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_tenant_investigations_ticket
  on public.support_tenant_investigations(ticket_id, opened_at desc);

create index if not exists idx_support_tenant_investigations_investigator
  on public.support_tenant_investigations(investigator_email, opened_at desc);

alter table public.support_tenant_investigations enable row level security;

drop policy if exists "support_tenant_investigations_service_role_full" on public.support_tenant_investigations;