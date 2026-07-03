create table if not exists public.support_ticket_priority_sla (
  priority text primary key check (priority in ('low', 'normal', 'high', 'urgent')),
  response_minutes integer not null check (response_minutes > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_support_ticket_priority_sla_updated_at on public.support_ticket_priority_sla;
create trigger trg_support_ticket_priority_sla_updated_at
before update on public.support_ticket_priority_sla
for each row execute procedure public.set_support_updated_at();

alter table public.support_ticket_priority_sla enable row level security;

drop policy if exists "support_ticket_priority_sla_service_role_full" on public.support_ticket_priority_sla;
create policy "support_ticket_priority_sla_service_role_full" on public.support_ticket_priority_sla
  using (true)
  with check (true);

insert into public.support_ticket_priority_sla (priority, response_minutes, active)
values
  ('low', 1440, true),
  ('normal', 480, true),
  ('high', 240, true),
  ('urgent', 60, true)
on conflict (priority) do update
set
  response_minutes = excluded.response_minutes,
  active = excluded.active,
  updated_at = now();
