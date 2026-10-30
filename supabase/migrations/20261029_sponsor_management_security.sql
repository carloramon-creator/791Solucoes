alter table public.patrocinadores enable row level security;
alter table public.vouchers enable row level security;

create or replace function public.current_user_is_sponsor()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'sponsor'
    or exists (
      select 1
      from public.patrocinadores sponsor
      where lower(sponsor.email) = lower(auth.jwt() ->> 'email')
    );
$$;

revoke all on function public.current_user_is_sponsor() from public, anon;
grant execute on function public.current_user_is_sponsor() to authenticated;

drop policy if exists "Allow all for authenticated users" on public.patrocinadores;
drop policy if exists "Allow all for authenticated users" on public.vouchers;

drop policy if exists "Permitir leitura de patrocinadores para autenticados" on public.patrocinadores;
drop policy if exists "Permitir leitura publica de patrocinadores" on public.patrocinadores;
drop policy if exists "Leitura autenticada de patrocinadores" on public.patrocinadores;
create policy "Leitura autenticada de patrocinadores"
  on public.patrocinadores
  for select
  to authenticated
  using (
    not public.current_user_is_sponsor()
    or lower(email) = lower(auth.jwt() ->> 'email')
  );

drop policy if exists "Permitir leitura autenticada de vouchers" on public.vouchers;
drop policy if exists "Permitir leitura publica de vouchers" on public.vouchers;
create policy "Permitir leitura autenticada de vouchers"
  on public.vouchers
  for select
  to authenticated
  using (not public.current_user_is_sponsor());

revoke insert, update, delete on public.patrocinadores from anon, authenticated;
revoke insert, update, delete on public.vouchers from anon, authenticated;
revoke select on public.patrocinadores from anon;
revoke select on public.vouchers from anon;
grant select on public.patrocinadores to authenticated;
grant select on public.vouchers to authenticated;
