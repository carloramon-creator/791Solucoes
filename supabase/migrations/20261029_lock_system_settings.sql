-- system_settings guarda chaves de API (Asaas, Inter, service keys).
-- Só o servidor (service role) pode ler/gravar; anon/authenticated ficam sem acesso.
drop policy if exists "Acesso Total Autenticado" on public.system_settings;
alter table public.system_settings enable row level security;
revoke all on table public.system_settings from anon, authenticated;
