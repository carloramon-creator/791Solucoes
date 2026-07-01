-- ================================================================
-- Migration: Permissões Holding + Roteamento de Assuntos por Perfil
-- Escopo: Banco da Holding (Documents/791)
-- ================================================================

create extension if not exists pgcrypto;

create table if not exists public.holding_permission_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.holding_permission_resources (
  code text primary key,
  label text not null,
  category text not null default 'menu',
  parent_code text references public.holding_permission_resources(code) on delete set null,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.holding_profile_resource_permissions (
  profile_id uuid not null references public.holding_permission_profiles(id) on delete cascade,
  resource_code text not null references public.holding_permission_resources(code) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, resource_code)
);

create table if not exists public.holding_user_permission_profiles (
  user_email text not null,
  profile_id uuid not null references public.holding_permission_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_email, profile_id)
);

create table if not exists public.support_subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.support_subject_permission_profiles (
  subject_id uuid not null references public.support_subjects(id) on delete cascade,
  profile_id uuid not null references public.holding_permission_profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (subject_id, profile_id)
);

create index if not exists idx_holding_profile_resource_resource_code
  on public.holding_profile_resource_permissions(resource_code);

create index if not exists idx_holding_user_profiles_profile
  on public.holding_user_permission_profiles(profile_id);

create index if not exists idx_holding_user_profiles_email
  on public.holding_user_permission_profiles(user_email);

create index if not exists idx_subject_profile_permissions_profile
  on public.support_subject_permission_profiles(profile_id);

create or replace function public.set_holding_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_holding_permission_profiles_updated_at on public.holding_permission_profiles;
create trigger trg_holding_permission_profiles_updated_at
before update on public.holding_permission_profiles
for each row execute procedure public.set_holding_updated_at();

drop trigger if exists trg_holding_permission_resources_updated_at on public.holding_permission_resources;
create trigger trg_holding_permission_resources_updated_at
before update on public.holding_permission_resources
for each row execute procedure public.set_holding_updated_at();

drop trigger if exists trg_holding_profile_resource_permissions_updated_at on public.holding_profile_resource_permissions;
create trigger trg_holding_profile_resource_permissions_updated_at
before update on public.holding_profile_resource_permissions
for each row execute procedure public.set_holding_updated_at();

alter table public.holding_permission_profiles enable row level security;
alter table public.holding_permission_resources enable row level security;
alter table public.holding_profile_resource_permissions enable row level security;
alter table public.holding_user_permission_profiles enable row level security;
alter table public.support_subject_permission_profiles enable row level security;

drop policy if exists "holding_permission_profiles_full" on public.holding_permission_profiles;
create policy "holding_permission_profiles_full" on public.holding_permission_profiles
  using (true)
  with check (true);

drop policy if exists "holding_permission_resources_full" on public.holding_permission_resources;
create policy "holding_permission_resources_full" on public.holding_permission_resources
  using (true)
  with check (true);

drop policy if exists "holding_profile_resource_permissions_full" on public.holding_profile_resource_permissions;
create policy "holding_profile_resource_permissions_full" on public.holding_profile_resource_permissions
  using (true)
  with check (true);

drop policy if exists "holding_user_permission_profiles_full" on public.holding_user_permission_profiles;
create policy "holding_user_permission_profiles_full" on public.holding_user_permission_profiles
  using (true)
  with check (true);

drop policy if exists "support_subject_permission_profiles_full" on public.support_subject_permission_profiles;
create policy "support_subject_permission_profiles_full" on public.support_subject_permission_profiles
  using (true)
  with check (true);

insert into public.holding_permission_resources (code, label, category, parent_code, sort_order, active)
values
  ('menu.dashboard', 'Painel', 'menu', null, 10, true),
  ('menu.financeiro', 'Financeiro', 'menu', null, 20, true),
  ('menu.notas_fiscais', 'Notas fiscais', 'menu', null, 30, true),
  ('menu.suporte', 'Suporte', 'menu', null, 40, true),
  ('menu.assinaturas', 'Assinaturas', 'menu', null, 50, true),
  ('menu.patrocinadores', 'Patrocinadores', 'menu', null, 60, true),
  ('menu.planos', 'Planos', 'menu', null, 70, true),
  ('submenu.planos.glass', 'Planos > Glass', 'submenu', 'menu.planos', 71, true),
  ('submenu.planos.barber', 'Planos > Barber', 'submenu', 'menu.planos', 72, true),
  ('menu.cupons', 'Cupons', 'menu', null, 80, true),
  ('menu.configuracoes', 'Configuracoes', 'menu', null, 90, true),
  ('submenu.configuracoes.financeiro', 'Configuracoes > Financeiro e API', 'submenu', 'menu.configuracoes', 91, true),
  ('submenu.configuracoes.contas', 'Configuracoes > Contas bancarias', 'submenu', 'menu.configuracoes', 92, true),
  ('submenu.configuracoes.nfs', 'Configuracoes > Notas fiscais', 'submenu', 'menu.configuracoes', 93, true),
  ('submenu.configuracoes.permissoes', 'Configuracoes > Equipe e permissoes', 'submenu', 'menu.configuracoes', 94, true),
  ('submenu.configuracoes.categorias', 'Configuracoes > Mapa DRE / categorias', 'submenu', 'menu.configuracoes', 95, true),
  ('submenu.configuracoes.notificacoes', 'Configuracoes > Notificacoes', 'submenu', 'menu.configuracoes', 96, true),
  ('action.support.reply', 'Suporte > Responder ticket', 'action', null, 200, true),
  ('action.support.assign', 'Suporte > Atribuir ticket', 'action', null, 201, true),
  ('action.support.manage_subjects', 'Suporte > Gerenciar assuntos', 'action', null, 202, true),
  ('action.permissions.manage_profiles', 'Permissoes > Gerenciar perfis', 'action', null, 300, true)
on conflict (code) do update
set
  label = excluded.label,
  category = excluded.category,
  parent_code = excluded.parent_code,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

insert into public.holding_permission_profiles (name, description, active, is_system)
values ('Administrador', 'Acesso total ao painel da Holding.', true, true)
on conflict (name) do nothing;

insert into public.holding_profile_resource_permissions (profile_id, resource_code, enabled)
select p.id, r.code, true
from public.holding_permission_profiles p
cross join public.holding_permission_resources r
where p.name = 'Administrador'
on conflict (profile_id, resource_code) do update
set enabled = true,
    updated_at = now();
