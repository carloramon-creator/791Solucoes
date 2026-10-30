-- Usuário sem role em app_metadata fazia a função devolver NULL e as políticas bloqueavam admins.
create or replace function public.current_user_is_sponsor()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'sponsor', false)
    or exists (
      select 1
      from public.patrocinadores sponsor
      where lower(sponsor.email) = lower(auth.jwt() ->> 'email')
    );
$$;
