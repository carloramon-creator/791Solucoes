-- ================================================================
-- Migration: Módulo de Tickets de Suporte (Holding)
-- Escopo: Banco da Holding (Documents/791)
-- ================================================================

create extension if not exists pgcrypto;

-- Catálogo de assuntos configuráveis da Holding
create table if not exists public.support_subjects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Responsáveis por assunto (mapeado por e-mail do perfil interno da Holding)
create table if not exists public.support_subject_assignments (
  subject_id uuid not null references public.support_subjects(id) on delete cascade,
  assignee_email text not null,
  created_at timestamptz not null default now(),
  primary key (subject_id, assignee_email)
);

-- Tickets principais
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  protocol text unique,
  tenant_slug text not null,
  tenant_name text,
  tenant_id text,

  requester_name text,
  requester_email text,
  requester_phone text,

  subject_id uuid references public.support_subjects(id) on delete set null,
  title text not null,
  description text not null,

  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'new' check (status in ('new', 'in_progress', 'waiting_customer', 'resolved', 'closed')),

  assigned_to_email text,
  created_by_email text,

  due_at timestamptz,
  first_response_at timestamptz,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mensagens de conversa do ticket
create table if not exists public.support_ticket_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,

  origin text not null default 'holding' check (origin in ('holding', 'tenant', 'system')),
  author_email text,
  author_name text,
  message text not null,
  is_internal boolean not null default false,

  created_at timestamptz not null default now()
);

create index if not exists idx_support_tickets_status_created_at
  on public.support_tickets(status, created_at desc);

create index if not exists idx_support_tickets_assigned_status
  on public.support_tickets(assigned_to_email, status, created_at desc);

create index if not exists idx_support_tickets_due_open
  on public.support_tickets(due_at)
  where status in ('new', 'in_progress', 'waiting_customer');

create index if not exists idx_support_tickets_subject
  on public.support_tickets(subject_id);

create index if not exists idx_support_ticket_messages_ticket_created
  on public.support_ticket_messages(ticket_id, created_at asc);

create index if not exists idx_support_subject_assignments_email
  on public.support_subject_assignments(assignee_email);

create or replace function public.set_support_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Evita criar trigger duplicado em reexecuções
 drop trigger if exists trg_support_subjects_updated_at on public.support_subjects;
create trigger trg_support_subjects_updated_at
before update on public.support_subjects
for each row execute procedure public.set_support_updated_at();

 drop trigger if exists trg_support_tickets_updated_at on public.support_tickets;
create trigger trg_support_tickets_updated_at
before update on public.support_tickets
for each row execute procedure public.set_support_updated_at();

create or replace function public.set_support_ticket_protocol()
returns trigger
language plpgsql
as $$
declare
  year_chunk text;
  seq bigint;
begin
  if new.protocol is not null and length(trim(new.protocol)) > 0 then
    return new;
  end if;

  year_chunk := to_char(now(), 'YYYY');

  select count(*) + 1
    into seq
  from public.support_tickets
  where created_at >= date_trunc('year', now())
    and created_at < date_trunc('year', now()) + interval '1 year';

  new.protocol := 'SUP-' || year_chunk || '-' || lpad(seq::text, 6, '0');
  return new;
end;
$$;

 drop trigger if exists trg_support_tickets_protocol on public.support_tickets;
create trigger trg_support_tickets_protocol
before insert on public.support_tickets
for each row execute procedure public.set_support_ticket_protocol();

alter table public.support_subjects enable row level security;
alter table public.support_subject_assignments enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

-- Neste projeto, o acesso ocorre via rotas server-side com service_role.
-- Mantemos políticas permissivas para evitar bloqueio em ambiente atual.
drop policy if exists "support_subjects_service_role_full" on public.support_subjects;
create policy "support_subjects_service_role_full" on public.support_subjects
  using (true)
  with check (true);

drop policy if exists "support_subject_assignments_service_role_full" on public.support_subject_assignments;
create policy "support_subject_assignments_service_role_full" on public.support_subject_assignments
  using (true)
  with check (true);

drop policy if exists "support_tickets_service_role_full" on public.support_tickets;
create policy "support_tickets_service_role_full" on public.support_tickets
  using (true)
  with check (true);

drop policy if exists "support_ticket_messages_service_role_full" on public.support_ticket_messages;
create policy "support_ticket_messages_service_role_full" on public.support_ticket_messages
  using (true)
  with check (true);
